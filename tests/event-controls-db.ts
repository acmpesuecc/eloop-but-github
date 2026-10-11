// Standalone integration check: a separate process keeps real database modules
// isolated from the API tests' module mocks. No configured database is touched.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';

const directory = mkdtempSync('/tmp/opencode/event-controls-');
process.env.TURSO_DATABASE_URL = `file:${join(directory, 'test.db')}`;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.DATABASE_URL;

const { turso, initDatabase } = await import('../src/lib/db/client');
const { getEventById, unlockCheckpoint, lockCheckpoint } = await import('../src/lib/db/event');
const { getOrganizerVolunteers, hasVolunteerPrivileges, updateUserRole } = await import('../src/lib/db/user');

try {
  await initDatabase();
  // The alternative bootstrap creates the legacy event schema. Supply the
  // existing checkpoint columns so this check can exercise live controls.
  await turso.execute(`ALTER TABLE events ADD COLUMN checkpoints TEXT DEFAULT '["Checkin"]'`);
  await turso.execute(`ALTER TABLE events ADD COLUMN unlocked_checkpoints TEXT DEFAULT '[]'`);
  await turso.execute(`INSERT INTO users (id, email, name, role, organizer_id, created_at, updated_at) VALUES
    ('admin', 'admin@example.com', 'Admin', 'admin', NULL, 1, 1),
    ('person', 'person@example.com', 'Person', 'participant', NULL, 1, 1),
    ('applicant', 'applicant@example.com', 'Applicant', 'applicant', NULL, 1, 1),
    ('organizer', 'organizer@example.com', 'Organizer', 'organizer', NULL, 1, 1),
    ('mentor', 'mentor@example.com', 'Mentor', 'mentor', NULL, 1, 1),
    ('volunteer', 'volunteer@example.com', 'Volunteer', 'volunteer', 'organizer', 1, 1),
    ('unassigned', 'unassigned@example.com', 'Unassigned', 'volunteer', 'admin', 1, 1)`);
  await turso.execute(`INSERT INTO events (id, name, date, organizer_id, form_schema, created_at, updated_at, checkpoints, unlocked_checkpoints)
    VALUES ('event', 'Existing event', 1, 'admin', '{"fields":[]}', 1, 1, '["Checkin","Lunch","Dinner"]', '["Checkin","Lunch"]')`);

  // Apply the primary bootstrap twice to an existing database. Run from a clean
  // directory so project .env files cannot redirect it to a configured database.
  const script = join(process.cwd(), 'scripts/check-and-init-db.js');
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = Bun.spawnSync([process.execPath, script], { cwd: directory, env: process.env });
    assert.equal(result.exitCode, 0, result.stderr.toString());
  }
  await initDatabase();
  assert.equal((await getEventById('event'))?.name, 'Existing event');
  assert.deepEqual((await getEventById('event'))?.unlockedCheckpoints, ['Checkin', 'Lunch']);
  assert.equal((await turso.execute(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'event_volunteers'`)).rows.length, 0);

  // Simulate an organizer assignment rejected by the database. Neither field may change.
  await turso.execute(`CREATE TRIGGER reject_organizer_assignment
    BEFORE UPDATE OF organizer_id ON users WHEN NEW.organizer_id = 'reject-owner'
    BEGIN SELECT RAISE(ABORT, 'Organizer assignment rejected'); END`);
  const applicantBefore = (await turso.execute(`SELECT * FROM users WHERE id = 'applicant'`)).rows;
  await assert.rejects(updateUserRole('applicant', 'volunteer', 'reject-owner'), /Organizer assignment rejected/);
  assert.deepEqual((await turso.execute(`SELECT * FROM users WHERE id = 'applicant'`)).rows, applicantBefore);

  const usersBefore = (await turso.execute('SELECT * FROM users ORDER BY id')).rows;
  const organizerVolunteersBefore = await getOrganizerVolunteers('organizer');
  assert.equal(await hasVolunteerPrivileges('volunteer'), true);
  // Event-page additions call the same role and organizer helpers as the legacy flow.
  await updateUserRole('person', 'volunteer', 'admin');
  assert.equal(await hasVolunteerPrivileges('person'), true);
  assert.equal((await getOrganizerVolunteers('admin')).some(user => user.id === 'person'), true);
  assert.deepEqual(await getOrganizerVolunteers('organizer'), organizerVolunteersBefore);
  const unchangedUsers = (await turso.execute(`SELECT * FROM users WHERE id != 'person' ORDER BY id`)).rows;
  assert.deepEqual(unchangedUsers, usersBefore.filter((user: Record<string, unknown>) => user.id !== 'person'));
  await updateUserRole('person', 'volunteer', 'admin');
  assert.equal((await getOrganizerVolunteers('admin')).filter(user => user.id === 'person').length, 1);
  assert.equal(await hasVolunteerPrivileges('volunteer'), true);
  assert.equal(await hasVolunteerPrivileges('unassigned'), true);

  // Legacy two-argument calls and non-volunteer role changes keep organizer associations.
  await updateUserRole('person', 'volunteer');
  assert.equal((await turso.execute(`SELECT organizer_id FROM users WHERE id = 'person'`)).rows[0].organizer_id, 'admin');
  await updateUserRole('person', 'participant', 'reject-owner');
  assert.equal((await turso.execute(`SELECT organizer_id FROM users WHERE id = 'person'`)).rows[0].organizer_id, 'admin');
  assert.equal(await hasVolunteerPrivileges('person'), false);

  // Existing role management remains authoritative after assignment too.
  await turso.execute(`UPDATE users SET role = 'participant' WHERE id = 'volunteer'`);
  assert.equal((await getOrganizerVolunteers('organizer')).length, 0);
  assert.equal(await hasVolunteerPrivileges('volunteer'), false);

  const started = await unlockCheckpoint('event', 'Dinner');
  assert.deepEqual(started?.unlockedCheckpoints?.sort(), ['Checkin', 'Dinner']);
  assert.deepEqual((await unlockCheckpoint('event', 'Dinner'))?.unlockedCheckpoints?.sort(), ['Checkin', 'Dinner']);
  assert.deepEqual((await lockCheckpoint('event', 'Dinner'))?.unlockedCheckpoints, ['Checkin']);
  assert.deepEqual((await lockCheckpoint('event', 'Checkin'))?.unlockedCheckpoints, []);
  assert.deepEqual((await unlockCheckpoint('event', 'Lunch'))?.unlockedCheckpoints, ['Lunch']);
  assert.deepEqual((await unlockCheckpoint('event', 'Checkin'))?.unlockedCheckpoints?.sort(), ['Checkin', 'Lunch']);
  await assert.rejects(lockCheckpoint('event', 'Unknown'));
  await assert.rejects(unlockCheckpoint('event', 'Unknown'));
  console.log('Database checks passed: existing schema, volunteer role and organizer integration, retries, role-based authorization, checkpoint start/stop.');
} finally {
  turso.close();
  for (const file of readdirSync(directory)) unlinkSync(join(directory, file));
  rmdirSync(directory);
}
