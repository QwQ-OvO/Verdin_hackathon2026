import { DatabaseSync } from 'node:sqlite';

/** Stable HTTP-facing errors for rejected task actions and reads. */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

type TaskStatus = 'draft' | 'proposed' | 'assigned' | 'in_progress' | 'first_submitted' |
  'revision_in_progress' | 'pending_review' | 'approved' | 'changes_requested';
type TaskEvent = 'proposal_generated' | 'assignment_confirmed' | 'learner_started' |
  'first_judgment_submitted' | 'revision_started' | 'submitted_for_review' |
  'review_approved' | 'review_changes_requested';

// Events describe business actions; clients never supply a replacement status.
const transitions: Record<TaskEvent, { from: TaskStatus[]; to: TaskStatus; role: 'manager' | 'learner' }> = {
  proposal_generated: { from: ['draft'], to: 'proposed', role: 'manager' },
  assignment_confirmed: { from: ['proposed'], to: 'assigned', role: 'manager' },
  learner_started: { from: ['assigned'], to: 'in_progress', role: 'learner' },
  first_judgment_submitted: { from: ['in_progress'], to: 'first_submitted', role: 'learner' },
  revision_started: { from: ['first_submitted', 'changes_requested'], to: 'revision_in_progress', role: 'learner' },
  submitted_for_review: { from: ['first_submitted', 'revision_in_progress'], to: 'pending_review', role: 'learner' },
  review_approved: { from: ['pending_review'], to: 'approved', role: 'manager' },
  review_changes_requested: { from: ['pending_review'], to: 'changes_requested', role: 'manager' },
};

type TaskRow = {
  id: string; title: string; status: TaskStatus; version: number;
  learner_id: string; reviewer_id: string; is_simulated: number;
  source_type: string; simulation_notice: string; objective: string;
  deadline_at: string; capability_id: string; risk_level: string;
};

export class TaskWorkflowService {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  transition(input: { taskId: string; event: TaskEvent; actorId: string; expectedVersion: number }): { id: string; status: TaskStatus; version: number } {
    // This internal primitive does not have an HTTP route. Later commands must save
    // their proposal, judgment, or review record in the same transaction.
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const task = this.db.prepare('SELECT id, status, version, learner_id, reviewer_id FROM tasks WHERE id = ?').get(input.taskId) as TaskRow | undefined;
      if (!task) throw new ApiError(404, 'not_found', 'Task not found');
      const actor = this.db.prepare('SELECT id, role FROM users WHERE id = ?').get(input.actorId) as { id: string; role: string } | undefined;
      if (!actor) throw new ApiError(401, 'unauthorized', 'Unknown actor');
      const transition = transitions[input.event];
      if (!transition) throw new ApiError(400, 'invalid_event', 'Unknown task event');
      if (actor.role !== transition.role || (actor.role === 'manager' && actor.id !== task.reviewer_id) ||
          (actor.role === 'learner' && actor.id !== task.learner_id)) {
        throw new ApiError(403, 'forbidden', 'Actor cannot perform this task action');
      }
      if (task.version !== input.expectedVersion) throw new ApiError(409, 'version_conflict', 'Task version has changed');
      if (!transition.from.includes(task.status)) throw new ApiError(409, 'invalid_transition', 'Action is not allowed from this task state');

      // The task version and audit event commit together or roll back together.
      const now = new Date().toISOString();
      this.db.prepare(`UPDATE tasks SET status = ?, version = version + 1, updated_at = ?,
        first_submitted_at = CASE WHEN ? = 'first_judgment_submitted' THEN ? ELSE first_submitted_at END
        WHERE id = ? AND version = ?`)
        .run(transition.to, now, input.event, now, task.id, task.version);
      this.db.prepare(`INSERT INTO audit_events
        (task_id, actor_id, event_type, from_status, to_status, occurred_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(task.id, actor.id, input.event, task.status, transition.to, now);
      this.db.exec('COMMIT');
      return { id: task.id, status: transition.to, version: task.version + 1 };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  getTaskView(taskId: string, actorId: string): Record<string, unknown> {
    const task = this.db.prepare(`SELECT id, title, status, version, learner_id, reviewer_id,
      is_simulated, source_type, simulation_notice, objective, deadline_at, capability_id, risk_level
      FROM tasks WHERE id = ?`).get(taskId) as TaskRow | undefined;
    if (!task) throw new ApiError(404, 'not_found', 'Task not found');
    const actor = this.db.prepare('SELECT id, role FROM users WHERE id = ?').get(actorId) as { id: string; role: string } | undefined;
    if (!actor) throw new ApiError(401, 'unauthorized', 'Unknown actor');
    const isManager = actor.role === 'manager' && actor.id === task.reviewer_id;
    const isLearner = actor.role === 'learner' && actor.id === task.learner_id;
    if (!isManager && !isLearner) throw new ApiError(403, 'forbidden', 'Task is outside your access scope');
    if (isLearner && (task.status === 'draft' || task.status === 'proposed')) {
      throw new ApiError(403, 'forbidden', 'Task has not been assigned');
    }

    // Build an allowlisted response; never serialize a complete database row.
    const view: Record<string, unknown> = {
      id: task.id, title: task.title, status: task.status, version: task.version,
      is_simulated: Boolean(task.is_simulated), source_type: task.source_type,
      simulation_notice: task.simulation_notice, objective: task.objective,
      deadline_at: task.deadline_at, capability_id: task.capability_id, risk_level: task.risk_level,
      allowed_actions: isManager ? (task.status === 'draft' ? ['generate_proposal'] : []) :
        (task.status === 'assigned' ? ['start_task'] : []),
    };
    if (task.status !== 'draft' && task.status !== 'proposed') {
      view.feedback = this.db.prepare(`SELECT id, journey_stage, text, source_type, is_simulated
        FROM feedback_items WHERE task_id = ? ORDER BY id`).all(task.id)
        .map((item) => ({ ...item, is_simulated: Boolean((item as { is_simulated: number }).is_simulated) }));
      const links = this.db.prepare(`SELECT g.id, g.label, g.relationship, s.feedback_id
        FROM organization_groups g JOIN organization_group_sources s ON s.group_id = g.id
        WHERE g.task_id = ? ORDER BY g.id, s.feedback_id`).all(task.id) as { id: string; label: string; relationship: string; feedback_id: string }[];
      const groups = new Map<string, { id: string; label: string; relationship: string; source_ids: string[] }>();
      for (const link of links) {
        if (!groups.has(link.id)) groups.set(link.id, { id: link.id, label: link.label, relationship: link.relationship, source_ids: [] });
        groups.get(link.id)!.source_ids.push(link.feedback_id);
      }
      view.organization_groups = [...groups.values()];
    }
    return view;
  }
}
