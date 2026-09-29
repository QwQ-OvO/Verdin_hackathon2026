import { DatabaseSync } from 'node:sqlite';
import { evaluateStepAllocations, getOwnerBlockers } from './allocation-rule-engine.ts';
import type { AllocationFacts, AllocationOwner, AllocationStep, StepAllocationProposal, StepKey } from './allocation-rule-engine.ts';
import { ApiError, TaskWorkflowService } from './task-workflow-service.ts';

type AllocationRow = {
  step_id: string;
  step_key: StepKey;
  system_suggestion: AllocationOwner;
};

type AssignmentDecision = {
  stepId: string;
  owner: AllocationOwner;
  overrideReason?: string;
};

export class TaskAllocationService {
  private readonly db: DatabaseSync;
  private readonly now: () => Date;
  private readonly workflow: TaskWorkflowService;

  constructor(db: DatabaseSync, now: () => Date = () => new Date()) {
    this.db = db;
    this.now = now;
    this.workflow = new TaskWorkflowService(db);
  }

  /** Generate one explainable proposal while the task is still a draft. */
  generateProposal(input: { taskId: string; actorId: string; expectedVersion: number }): {
    taskId: string; status: 'proposed'; version: number; steps: StepAllocationProposal[];
  } {
    let steps: StepAllocationProposal[] = [];
    const result = this.workflow.transition({ ...input, event: 'proposal_generated' }, () => {
      const facts = this.loadFacts(input.taskId);
      const taskSteps = this.loadSteps(input.taskId);
      steps = evaluateStepAllocations(taskSteps, facts);
      const insert = this.db.prepare(`INSERT INTO allocations
        (task_id, step_id, system_suggestion, rule_ids_json, hard_blockers_json, reason)
        VALUES (?, ?, ?, ?, ?, ?)`);
      for (const step of steps) {
        insert.run(input.taskId, step.stepId, step.suggestedOwner,
          JSON.stringify(step.ruleIds), JSON.stringify(step.hardBlockers), step.reason);
      }
    });
    return { taskId: result.id, status: 'proposed', version: result.version, steps };
  }

  /** Re-evaluate hard constraints at confirmation; a stale proposal cannot grant access. */
  confirmAssignment(input: { taskId: string; actorId: string; expectedVersion: number; decisions: AssignmentDecision[] }): {
    taskId: string; status: 'assigned'; version: number;
  } {
    const result = this.workflow.transition({ ...input, event: 'assignment_confirmed' }, () => {
      const proposals = this.db.prepare(`SELECT a.step_id, s.step_key, a.system_suggestion
        FROM allocations a JOIN task_steps s ON s.id = a.step_id
        WHERE a.task_id = ? ORDER BY a.step_id`).all(input.taskId) as AllocationRow[];
      const decisions = input.decisions;
      const uniqueIds = new Set(decisions.map((decision) => decision.stepId));
      if (proposals.length === 0 || decisions.length !== proposals.length || uniqueIds.size !== decisions.length ||
          proposals.some((proposal) => !uniqueIds.has(proposal.step_id))) {
        throw new ApiError(422, 'invalid_assignment', 'Provide one decision for every proposed step');
      }

      const facts = this.loadFacts(input.taskId);
      const proposalById = new Map(proposals.map((proposal) => [proposal.step_id, proposal]));
      const update = this.db.prepare(`UPDATE allocations SET confirmed_owner = ?, override_reason = ?,
        confirmed_by = ?, confirmed_at = ? WHERE task_id = ? AND step_id = ?`);
      const confirmedAt = this.now().toISOString();
      for (const decision of decisions) {
        const proposal = proposalById.get(decision.stepId)!;
        if (!['ai', 'learner', 'manager'].includes(decision.owner)) {
          throw new ApiError(422, 'invalid_assignment', 'Unknown owner in assignment');
        }
        const blockers = getOwnerBlockers(proposal.step_key, decision.owner, facts);
        if (blockers.length) {
          throw new ApiError(422, 'hard_constraint_violation', `Step ${decision.stepId} violates ${blockers.join(', ')}`);
        }
        const changed = decision.owner !== proposal.system_suggestion;
        const reason = decision.overrideReason?.trim() || null;
        if (changed && !reason) throw new ApiError(422, 'override_reason_required', `Step ${decision.stepId} requires an override reason`);
        update.run(decision.owner, changed ? reason : null, input.actorId, confirmedAt, input.taskId, decision.stepId);
      }
    });
    return { taskId: result.id, status: 'assigned', version: result.version };
  }

  /** Build rule inputs from the database, including the persisted data boundary. */
  private loadFacts(taskId: string): AllocationFacts {
    const row = this.db.prepare(`SELECT t.source_record_id, t.source_type, t.deadline_at,
      t.risk_level, t.is_reversible, t.learner_id, t.reviewer_id, t.capability_id,
      a.allowed_feedback_source_id, a.contains_personal_data,
      a.learner_may_read_original_feedback, reviewer.role AS reviewer_role,
      learner.starting_point, learner.starting_point_source,
      lc.capability_id AS learner_capability_id
      FROM tasks t
      LEFT JOIN task_access_scopes a ON a.task_id = t.id
      LEFT JOIN users reviewer ON reviewer.id = t.reviewer_id
      LEFT JOIN users learner ON learner.id = t.learner_id
      LEFT JOIN learner_capabilities lc ON lc.learner_id = t.learner_id AND lc.capability_id = t.capability_id
      WHERE t.id = ?`).get(taskId) as Record<string, any> | undefined;
    if (!row) throw new ApiError(404, 'not_found', 'Task not found');
    const feedback = this.db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN source_type = ? THEN 1 ELSE 0 END) AS matching
      FROM feedback_items WHERE task_id = ?`).get(row.source_type, taskId) as { total: number; matching: number | null };
    const deadline = Date.parse(row.deadline_at);
    return {
      learnerCanReadFeedback: row.learner_may_read_original_feedback === 1,
      sourceWithinScope: row.allowed_feedback_source_id === row.source_record_id &&
        feedback.total > 0 && feedback.matching === feedback.total,
      reviewerAvailable: row.reviewer_role === 'manager' && row.reviewer_id !== row.learner_id,
      hoursUntilDeadline: (deadline - this.now().getTime()) / 3_600_000,
      riskLevel: row.risk_level,
      isReversible: row.is_reversible === 1,
      capabilityMatch: row.learner_capability_id === row.capability_id,
      learnerReady: Boolean(row.starting_point?.trim() && row.starting_point_source?.trim()),
      containsPersonalData: row.contains_personal_data !== 0,
    };
  }

  private loadSteps(taskId: string): AllocationStep[] {
    const rows = this.db.prepare(`SELECT id, step_key, requires_manager_approval FROM task_steps
      WHERE task_id = ? ORDER BY CASE step_key
        WHEN 'organize_feedback' THEN 1 WHEN 'identify_patterns' THEN 2
        WHEN 'select_priorities' THEN 3 WHEN 'approve_business_use' THEN 4 ELSE 5 END`).all(taskId) as {
      id: string; step_key: StepKey; requires_manager_approval: number;
    }[];
    if (rows.length !== 4) throw new ApiError(422, 'invalid_task_steps', 'The demo task requires four defined steps');
    return rows.map((row) => ({ id: row.id, key: row.step_key, requiresManagerApproval: Boolean(row.requires_manager_approval) }));
  }
}
