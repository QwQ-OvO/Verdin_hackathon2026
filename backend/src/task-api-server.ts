import http, { type Server } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { ApiError, TaskWorkflowService } from './services/task-workflow-service.ts';
import { TaskAllocationService } from './services/task-allocation-service.ts';
import type { AllocationOwner } from './services/allocation-rule-engine.ts';

function sendJson(response: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  response.end(JSON.stringify(body));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reject malformed or oversized JSON before it reaches workflow services. */
async function readJsonObject(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  let body = '';
  for await (const chunk of request) {
    body += chunk.toString();
    if (body.length > 65_536) throw new ApiError(413, 'payload_too_large', 'Request body is too large');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new ApiError(400, 'invalid_json', 'Request body must be valid JSON');
  }
  if (!isRecord(parsed)) throw new ApiError(422, 'validation_error', 'Request body must be an object');
  return parsed;
}

function expectedVersion(body: Record<string, unknown>): number {
  if (!Number.isInteger(body.expected_version) || (body.expected_version as number) < 0) {
    throw new ApiError(422, 'validation_error', 'expected_version must be a non-negative integer');
  }
  return body.expected_version as number;
}

/** Expose manager allocation commands without exposing a generic status setter. */
export function createTaskApiServer(options: { db: DatabaseSync; tokens: Map<string, string> }): Server {
  const workflow = new TaskWorkflowService(options.db);
  const allocation = new TaskAllocationService(options.db);
  return http.createServer((request, response) => {
    const handleRequest = async () => {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (request.method === 'GET' && pathname === '/health') {
        sendJson(response, 200, { data: { status: 'ok' } });
        return;
      }
      const match = /^\/tasks\/([^/]+)(?:\/(proposal|assignment))?$/.exec(pathname);
      if (!match) throw new ApiError(404, 'not_found', 'Route not found');
      const authorization = request.headers.authorization;
      const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
      // Resolve a server-owned identity. A browser-supplied role is never authority.
      const actorId = token ? options.tokens.get(token) : undefined;
      if (!actorId) throw new ApiError(401, 'unauthorized', 'Valid bearer token required');
      const taskId = decodeURIComponent(match[1]);

      if (request.method === 'GET' && !match[2]) {
        sendJson(response, 200, { data: workflow.getTaskView(taskId, actorId) });
        return;
      }
      if (request.method === 'POST' && match[2] === 'proposal') {
        const body = await readJsonObject(request);
        const result = allocation.generateProposal({ taskId, actorId, expectedVersion: expectedVersion(body) });
        sendJson(response, 201, { data: {
          task_id: result.taskId, status: result.status, version: result.version,
          steps: result.steps.map((step) => ({
            step_id: step.stepId, suggested_owner: step.suggestedOwner,
            rule_ids: step.ruleIds, hard_blockers: step.hardBlockers,
            reason: step.reason, requires_manager_approval: step.requiresManagerApproval,
          })),
        } }, { location: `/tasks/${encodeURIComponent(taskId)}` });
        return;
      }
      if (request.method === 'POST' && match[2] === 'assignment') {
        const body = await readJsonObject(request);
        if (!Array.isArray(body.decisions)) throw new ApiError(422, 'validation_error', 'decisions must be an array');
        const decisions = body.decisions.map((value: unknown) => {
          if (!isRecord(value) || typeof value.step_id !== 'string' || typeof value.owner !== 'string' ||
              (value.override_reason !== undefined && typeof value.override_reason !== 'string')) {
            throw new ApiError(422, 'validation_error', 'Each decision needs a step_id and owner');
          }
          return { stepId: value.step_id, owner: value.owner as AllocationOwner, overrideReason: value.override_reason as string | undefined };
        });
        const result = allocation.confirmAssignment({ taskId, actorId, expectedVersion: expectedVersion(body), decisions });
        sendJson(response, 200, { data: { task_id: result.taskId, status: result.status, version: result.version } });
        return;
      }
      throw new ApiError(404, 'not_found', 'Route not found');
    };
    void handleRequest().catch((error: unknown) => {
      if (error instanceof ApiError) {
        sendJson(response, error.statusCode, { error: { code: error.code, message: error.message } });
      } else {
        console.error(error);
        sendJson(response, 500, { error: { code: 'internal_error', message: 'Internal server error' } });
      }
    });
  });
}
