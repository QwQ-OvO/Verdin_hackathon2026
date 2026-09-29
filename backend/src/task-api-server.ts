import http, { type Server } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { ApiError, TaskWorkflowService } from './services/task-workflow-service.ts';

function sendJson(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

/** Expose only approved reads; task-state changes remain internal workflow actions. */
export function createTaskApiServer(options: { db: DatabaseSync; tokens: Map<string, string> }): Server {
  const service = new TaskWorkflowService(options.db);
  return http.createServer((request, response) => {
    try {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (request.method === 'GET' && pathname === '/health') {
        sendJson(response, 200, { data: { status: 'ok' } });
        return;
      }
      const match = /^\/tasks\/([^/]+)$/.exec(pathname);
      if (!match || request.method !== 'GET') throw new ApiError(404, 'not_found', 'Route not found');
      const authorization = request.headers.authorization;
      const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
      // Resolve a server-owned identity. A browser-supplied role is never authority.
      const actorId = token ? options.tokens.get(token) : undefined;
      if (!actorId) throw new ApiError(401, 'unauthorized', 'Valid bearer token required');
      sendJson(response, 200, { data: service.getTaskView(decodeURIComponent(match[1]), actorId) });
    } catch (error) {
      if (error instanceof ApiError) {
        sendJson(response, error.statusCode, { error: { code: error.code, message: error.message } });
      } else {
        console.error(error);
        sendJson(response, 500, { error: { code: 'internal_error', message: 'Internal server error' } });
      }
    }
  });
}
