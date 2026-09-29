import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { ApiError, TaskWorkflowService } from './task-workflow-service.ts';

type Priority = { focus: string; reason: string; evidence_ids: string[]; contrary_evidence_ids: string[]; next_check: string };
type FirstJudgment = { patterns: string; evidence_ids: string[]; priorities: Priority[];
  journey_stage_distinctions: string; uncertainties: string; assisted: boolean };

function nonEmptyText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4000) {
    throw new ApiError(422, 'validation_error', `${field} must be non-empty text of at most 4000 characters`);
  }
  return value.trim();
}

function sourceIds(value: unknown, field: string, required: boolean): string[] {
  if (!Array.isArray(value) || (required && value.length === 0) || value.length > 100 ||
      value.some((id) => typeof id !== 'string' || !id.trim()) || new Set(value).size !== value.length) {
    throw new ApiError(422, 'validation_error', `${field} must contain distinct feedback IDs`);
  }
  return value as string[];
}

/** Owns the first learner judgment and all source references written with it. */
export class FirstJudgmentService {
  private readonly db: DatabaseSync;
  private readonly workflow: TaskWorkflowService;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.workflow = new TaskWorkflowService(db);
  }

  startTask(input: { taskId: string; actorId: string; expectedVersion: number }) {
    return this.workflow.transition({ ...input, event: 'learner_started' });
  }

  /** Validate learner-authored work and save version one inside the state transaction. */
  submit(input: { taskId: string; actorId: string; expectedVersion: number; body: Record<string, unknown> }) {
    let judgmentId = '';
    let content!: FirstJudgment;
    const result = this.workflow.transition({ taskId: input.taskId, actorId: input.actorId,
      expectedVersion: input.expectedVersion, event: 'first_judgment_submitted' }, () => {
      const body = input.body;
      if (!Array.isArray(body.priorities) || body.priorities.length !== 2) {
        throw new ApiError(422, 'validation_error', 'Exactly two investigation priorities are required');
      }
      const priorities = body.priorities.map((item, index) => {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) {
          throw new ApiError(422, 'validation_error', `priorities[${index}] must be an object`);
        }
        const row = item as Record<string, unknown>;
        return { focus: nonEmptyText(row.focus, `priorities[${index}].focus`),
          reason: nonEmptyText(row.reason, `priorities[${index}].reason`),
          evidence_ids: sourceIds(row.evidence_ids, `priorities[${index}].evidence_ids`, true),
          contrary_evidence_ids: sourceIds(row.contrary_evidence_ids, `priorities[${index}].contrary_evidence_ids`, false),
          next_check: nonEmptyText(row.next_check, `priorities[${index}].next_check`) };
      });
      const evidenceIds = sourceIds(body.evidence_ids, 'evidence_ids', true);
      // Check every reference, including contrary evidence nested in priorities;
      // the citation table stores the distinct union for later audit and review.
      const citedIds = [...new Set([...evidenceIds, ...priorities.flatMap((priority) => [...priority.evidence_ids, ...priority.contrary_evidence_ids])])];
      const allowed = new Set((this.db.prepare(`SELECT f.id FROM feedback_items f JOIN tasks t ON t.id = f.task_id
        WHERE f.task_id = ? AND f.source_type = t.source_type`).all(input.taskId) as { id: string }[]).map((row) => row.id));
      if (citedIds.some((id) => !allowed.has(id))) {
        throw new ApiError(422, 'invalid_evidence', 'Every cited ID must belong to the task original feedback');
      }
      // Assistance is derived from persisted hint events, never from a client flag.
      const assisted = Boolean(this.db.prepare('SELECT 1 FROM hint_events WHERE task_id = ? AND requester_id = ? LIMIT 1')
        .get(input.taskId, input.actorId));
      content = { patterns: nonEmptyText(body.patterns, 'patterns'), evidence_ids: evidenceIds,
        priorities, journey_stage_distinctions: nonEmptyText(body.journey_stage_distinctions, 'journey_stage_distinctions'),
        uncertainties: nonEmptyText(body.uncertainties, 'uncertainties'), assisted };
      judgmentId = randomUUID();
      this.db.prepare(`INSERT INTO judgment_versions
        (id, task_id, version_number, parent_version_id, author_id, content_json, change_reason, created_at)
        VALUES (?, ?, 1, NULL, ?, ?, NULL, ?)`).run(judgmentId, input.taskId, input.actorId,
          JSON.stringify(content), new Date().toISOString());
      const insertCitation = this.db.prepare('INSERT INTO judgment_citations (judgment_version_id, feedback_id) VALUES (?, ?)');
      for (const id of citedIds) insertCitation.run(judgmentId, id);
    });
    return { task_id: result.id, status: result.status, version: result.version,
      judgment: { id: judgmentId, version_number: 1, assisted: content.assisted } };
  }
}
