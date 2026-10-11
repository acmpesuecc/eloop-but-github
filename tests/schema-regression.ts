// Compare bootstrap paths and repair a legacy schema using isolated temporary databases.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { createClient, type Client } from '@libsql/client';

const directory = mkdtempSync('/tmp/opencode/schema-regression-');
const runtimeUrl = `file:${join(directory, 'runtime.db')}`;
process.env.TURSO_DATABASE_URL = runtimeUrl;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.DATABASE_URL;
const { turso, initDatabase } = await import('../src/lib/db/client');
const scriptUrl = `file:${join(directory, 'script.db')}`;
const legacyUrl = `file:${join(directory, 'legacy.db')}`;
const scriptDb = createClient({ url: scriptUrl });
const legacyDb = createClient({ url: legacyUrl });
const script = join(process.cwd(), 'scripts/check-and-init-db.js');
const bootstrap = (url: string) => {
  const result = Bun.spawnSync([process.execPath, script], {
    cwd: directory, env: { ...process.env, TURSO_DATABASE_URL: url }
  });
  assert.equal(result.exitCode, 0, result.stderr.toString());
};
const columns = async (db: Client, table: string) => (await db.execute(`PRAGMA table_info(${table})`)).rows.map(row => String(row.name));

try {
  await initDatabase();
  await initDatabase();
  bootstrap(scriptUrl);
  const tables = ['users', 'events', 'registrations', 'scan_logs', 'teams', 'scoring_rounds', 'team_scores'];
  for (const table of tables) {
    const runtimeColumns = await columns(turso, table);
    for (const column of await columns(scriptDb, table)) {
      assert.ok(runtimeColumns.includes(column), `Runtime initializer missing ${table}.${column}`);
    }
  }

  await legacyDb.execute(`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    role TEXT NOT NULL, organizer_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
  await legacyDb.execute(`CREATE TABLE events (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, date INTEGER NOT NULL,
    location TEXT, organizer_id TEXT NOT NULL, form_schema TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
  await legacyDb.execute(`CREATE TABLE registrations (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, user_id TEXT NOT NULL,
    responses TEXT NOT NULL, status TEXT NOT NULL, qr_code TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
  await legacyDb.execute(`INSERT INTO users VALUES ('admin', 'admin@example.com', 'Admin', 'admin', NULL, 1, 1)`);
  await legacyDb.execute(`INSERT INTO events VALUES ('legacy', 'Legacy event', 'Description', 1, 'Venue', 'admin', '{"fields":[]}', 1, 1)`);
  await legacyDb.execute(`INSERT INTO registrations VALUES ('registration', 'legacy', 'admin', '{}', 'approved', 'qr', 1, 1)`);
  const usersBefore = (await legacyDb.execute('SELECT * FROM users')).rows;
  const eventBefore = (await legacyDb.execute('SELECT id, name, date, organizer_id, form_schema, updated_at FROM events')).rows;
  bootstrap(legacyUrl);
  bootstrap(legacyUrl);
  assert.deepEqual((await legacyDb.execute('SELECT * FROM users')).rows, usersBefore);
  assert.deepEqual((await legacyDb.execute('SELECT id, name, date, organizer_id, form_schema, updated_at FROM events')).rows, eventBefore);
  assert.equal((await legacyDb.execute(`SELECT status FROM registrations WHERE id = 'registration'`)).rows[0].status, 'approved');
  for (const table of tables) {
    const legacyColumns = await columns(legacyDb, table);
    for (const column of await columns(scriptDb, table)) {
      assert.ok(legacyColumns.includes(column), `Legacy bootstrap missing ${table}.${column}`);
    }
  }
  console.log('Schema checks passed: bootstrap parity, repeatability, legacy repair, data preservation.');
} finally {
  turso.close();
  scriptDb.close();
  legacyDb.close();
  for (const file of readdirSync(directory)) unlinkSync(join(directory, file));
  rmdirSync(directory);
}
