import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { FeedbackForHint, HintModelAdapter, HintModelInput } from './hint-model-adapter.ts';
import { ApiError, TaskWorkflowService } from './task-workflow-service.ts';

type HintLevel = 1 | 2 | 3;
type HintContent = { kind: 'reflection_question' | 'source_clue' | 'evidence_check'; text: string; source_ids: string[] };
type HintRow = { id: string; level: HintLevel; content: string; model_version: string;
  requester_id: string; created_at: string; request_id: string };

const reflectionQuestion = 'Which comments describe different stages, and what evidence might challenge your current interpretation?';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Enforces the first-submission boundary before and after asynchronous generation. */
export class TaskHintService {
  private readonly db: DatabaseSync;
  private readonly workflow: TaskWorkflowService;
  private readonly model: HintModelAdapter;

  constructor(db: DatabaseSync, model: HintModelAdapter) {
    this.db = db;
    this.workflow = new TaskWorkflowService(db);
    this.model = model;
  }

  async requestHint(input: { taskId: string; actorId: string; expectedVersion: number;
    level: unknown; requestId: unknown }): Promise<{ created: boolean; hint: Record<string, unknown> }> {
    if (input.level !== 1 && input.level !== 2 && input.level !== 3) {
      throw new ApiError(422, 'validation_error', 'level must be 1, 2, or 3');
    }
    if (typeof input.requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(input.requestId)) {
      throw new ApiError(422, 'validation_error', 'request_id must be 1-64 safe characters');
    }
    const level: HintLevel = input.level;
    this.assertEligible(input.taskId, input.actorId, input.expectedVersion, level);

    const existing = this.findRequest(input.taskId, input.actorId, input.requestId);
    if (existing) return this.replay(existing, level);

    let candidate: unknown;
    if (level === 1) {
      // A reviewed template is the only pre-submission help; no model sees the
      // task before the learner's first judgment is committed.
      candidate = { text: reflectionQuestion, source_ids: [], model_version: 'curated-template-v1' };
    } else {
      const feedback = this.db.prepare(`SELECT f.id, f.text, f.journey_stage FROM feedback_items f
        JOIN tasks t ON t.id = f.task_id WHERE f.task_id = ? AND f.source_type = t.source_type
        ORDER BY f.id`).all(input.taskId) as FeedbackForHint[];
      const saved = this.db.prepare('SELECT content_json FROM judgment_versions WHERE task_id = ? AND version_number = 1')
        .get(input.taskId) as { content_json: string } | undefined;
      if (!saved) throw new ApiError(409, 'invalid_transition', 'The first judgment must be saved before this help level');
      const modelInput: HintModelInput = { level, feedback, firstJudgment: JSON.parse(saved.content_json) };
      try { candidate = await this.model.generate(modelInput); } catch {
        throw new ApiError(502, 'model_unavailable', 'The hint model is unavailable');
      }
    }

    // The model call holds no SQLite write lock. Recheck access and task state
    // in the transaction so a concurrent revocation or submission wins safely.
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.assertEligible(input.taskId, input.actorId, input.expectedVersion, level);
      const raced = this.findRequest(input.taskId, input.actorId, input.requestId);
      if (raced) {
        // Resolve conflicts before committing; a rejected replay must roll back
        // the open transaction rather than attempt to roll back after commit.
        const replay = this.replay(raced, level);
        this.db.exec('COMMIT');
        return replay;
      }
      const content = this.validateCandidate(candidate, level, input.taskId);
      const modelVersion = (candidate as { model_version: string }).model_version;
      const id = randomUUID();
      const now = new Date().toISOString();
      this.db.prepare(`INSERT INTO hint_events
        (id, task_id, requester_id, level, content, model_version, created_at, request_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.taskId, input.actorId,
          level, JSON.stringify(content), modelVersion, now, input.requestId);
      // Hint requests do not change task status, but still belong in the audit trail.
      const task = this.db.prepare('SELECT status FROM tasks WHERE id = ?').get(input.taskId) as { status: string };
      this.db.prepare(`INSERT INTO audit_events
        (task_id, actor_id, event_type, from_status, to_status, occurred_at, details_json)
        VALUES (?, ?, 'hint_requested', ?, ?, ?, ?)`).run(input.taskId, input.actorId,
          task.status, task.status, now, JSON.stringify({ hint_id: id, level }));
      this.db.exec('COMMIT');
      return { created: true, hint: { id, level, ...content, model_version: modelVersion, created_at: now } };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  listHints(taskId: string, actorId: string): Record<string, unknown>[] {
    this.workflow.getTaskView(taskId, actorId);
    const status = this.db.prepare('SELECT status FROM tasks WHERE id = ?').get(taskId) as { status: string };
    const beforeFirst = status.status === 'assigned' || status.status === 'in_progress';
    const rows = this.db.prepare(`SELECT id, level, content, model_version, requester_id, created_at, request_id
      FROM hint_events WHERE task_id = ? ORDER BY created_at, id`).all(taskId) as HintRow[];
    // Even a future list route must not expose post-submission model content
    // while the task remains before the protected first-judgment boundary.
    return rows.filter((row) => !beforeFirst || row.level === 1).map((row) => this.toView(row));
  }

  private assertEligible(taskId: string, actorId: string, expectedVersion: number, level: HintLevel): void {
    const task = this.db.prepare('SELECT learner_id, status, version FROM tasks WHERE id = ?')
      .get(taskId) as { learner_id: string; status: string; version: number } | undefined;
    if (!task) throw new ApiError(404, 'not_found', 'Task not found');
    const actor = this.db.prepare('SELECT role FROM users WHERE id = ?').get(actorId) as { role: string } | undefined;
    if (!actor || actor.role !== 'learner' || task.learner_id !== actorId) {
      throw new ApiError(403, 'forbidden', 'Only the assigned learner can request help');
    }
    this.workflow.getTaskView(taskId, actorId);
    const owned = this.db.prepare(`SELECT COUNT(*) AS count FROM allocations a JOIN task_steps s ON s.id = a.step_id
      WHERE a.task_id = ? AND s.step_key IN ('identify_patterns', 'select_priorities')
        AND a.confirmed_owner = 'learner'`).get(taskId) as { count: number };
    if (owned.count !== 2) throw new ApiError(403, 'forbidden', 'The learner was not assigned both judgment steps');
    if (task.version !== expectedVersion) throw new ApiError(409, 'version_conflict', 'Task version has changed');
    const allowed = level === 1 ? task.status === 'in_progress' :
      ['first_submitted', 'revision_in_progress', 'changes_requested'].includes(task.status);
    if (!allowed) throw new ApiError(409, 'invalid_transition', 'This help level is unavailable in the current task state');
  }

  private validateCandidate(value: unknown, level: HintLevel, taskId: string): HintContent {
    if (!isRecord(value) || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 2000 ||
        typeof value.model_version !== 'string' || !value.model_version.trim() || value.model_version.length > 120 ||
        !Array.isArray(value.source_ids) || value.source_ids.some((id) => typeof id !== 'string') ||
        new Set(value.source_ids).size !== value.source_ids.length || value.source_ids.length > 5 ||
        (level === 1 ? value.source_ids.length !== 0 : value.source_ids.length === 0)) {
      throw new ApiError(502, 'invalid_model_output', 'The hint output did not match the required structure');
    }
    const ids = value.source_ids as string[];
    const allowed = new Set((this.db.prepare(`SELECT f.id FROM feedback_items f JOIN tasks t ON t.id = f.task_id
      WHERE f.task_id = ? AND f.source_type = t.source_type`).all(taskId) as { id: string }[]).map((row) => row.id));
    if (ids.some((id) => !allowed.has(id))) {
      throw new ApiError(502, 'invalid_model_output', 'The hint cited feedback outside the task');
    }
    // IDs mentioned in prose also require validated source references.
    const mentioned = value.text.match(/FB-[A-Za-z0-9-]+/g) ?? [];
    if (mentioned.some((id) => !allowed.has(id) || !ids.includes(id))) {
      throw new ApiError(502, 'invalid_model_output', 'The hint text contains an unverified feedback ID');
    }
    return { kind: level === 1 ? 'reflection_question' : level === 2 ? 'source_clue' : 'evidence_check',
      text: value.text.trim(), source_ids: ids };
  }

  private findRequest(taskId: string, actorId: string, requestId: string): HintRow | undefined {
    return this.db.prepare(`SELECT id, level, content, model_version, requester_id, created_at, request_id
      FROM hint_events WHERE task_id = ? AND requester_id = ? AND request_id = ?`)
      .get(taskId, actorId, requestId) as HintRow | undefined;
  }

  private replay(row: HintRow, level: HintLevel): { created: false; hint: Record<string, unknown> } {
    if (row.level !== level) throw new ApiError(409, 'request_conflict', 'request_id was used for a different help level');
    return { created: false, hint: this.toView(row) };
  }

  private toView(row: HintRow): Record<string, unknown> {
    const content = JSON.parse(row.content) as HintContent;
    return { id: row.id, level: row.level, kind: content.kind, text: content.text,
      source_ids: content.source_ids, model_version: row.model_version, created_at: row.created_at };
  }
}
