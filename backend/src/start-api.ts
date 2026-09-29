import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { openSqliteDatabase, applyDatabaseMigrations } from './db/sqlite-database.ts';
import { seedOnboardingDemo } from './db/seed-demo-data.ts';
import { createTaskApiServer } from './task-api-server.ts';

// Map private demo tokens to fixed database identities; the client cannot choose a role.
const managerToken = process.env.DEMO_MANAGER_TOKEN;
const learnerToken = process.env.DEMO_LEARNER_TOKEN;
if (!managerToken || !learnerToken || managerToken === learnerToken) {
  throw new Error('Set distinct DEMO_MANAGER_TOKEN and DEMO_LEARNER_TOKEN values before starting the demo API');
}

const databasePath = path.resolve(process.env.DB_PATH ?? 'data/demo.sqlite');
mkdirSync(path.dirname(databasePath), { recursive: true });
const db = openSqliteDatabase(databasePath);
// Startup is repeatable: completed migrations and an existing task are preserved.
applyDatabaseMigrations(db);
seedOnboardingDemo(db);

const tokens = new Map([
  [managerToken, 'USER-MANAGER-001'],
  [learnerToken, 'USER-LEARNER-001'],
]);
const server = createTaskApiServer({ db, tokens });
const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer from 0 to 65535');
server.listen(port, '127.0.0.1', () => {
  console.log(`Apprentice demo API listening on http://127.0.0.1:${port}`);
});

function shutdown(): void {
  server.close(() => {
    db.close();
  });
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
