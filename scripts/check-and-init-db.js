// Database initialization script
// Usage: npx tsx scripts/check-and-init-db.js

import { config } from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load environment variables in this order (later entries override earlier):
// .env, .env.local, .env.development, .env.development.local
const envFiles = [
  '.env',
  '.env.local',
  '.env.development',
  '.env.development.local',
];

for (const file of envFiles) {
  const filePath = path.resolve(process.cwd(), file);
  if (fs.existsSync(filePath)) {
    config({ path: filePath, override: true, quiet: false });
    console.log(`Loaded env file: ${file}`);
  }
}

// Print environment for debugging
console.log('Checking database tables...');

async function checkAndInitDb() {
  const tursoUrl = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL;
  if (!tursoUrl) {
    const foundFiles = envFiles.filter((f) => fs.existsSync(path.resolve(process.cwd(), f)));
    console.warn('TURSO_DATABASE_URL is not set.');
    if (foundFiles.length > 0) {
      console.warn('Found these env files in the project root:');
      for (const f of foundFiles) console.warn('  -', f);
    } else {
      console.warn('No env files were found in the project root.');
    }
    console.warn('\nRun: vercel env pull .env.development.local');
    // Return false so callers know init was skipped; do NOT exit the process so `next dev` can continue.
    return false;
  }

  const { createClient } = await import('@libsql/client');
  const turso = createClient({
    url: tursoUrl,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  console.log('Turso client created');

  // Check if tables exist
  try {
    const checkEventsTable = await turso.execute(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='events'
    `);

    if (checkEventsTable.rows.length === 0) {
      console.log('Database tables not found. Initializing...');

      // Create tables
      await turso.execute(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          role TEXT NOT NULL,
          organizer_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);

      // Events table
      await turso.execute(`
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          date INTEGER NOT NULL,
          start_date TEXT,
          end_date TEXT,
          registration_close_date TEXT,
          location TEXT,
          image_url TEXT,
          organizer_id TEXT NOT NULL,
          checkpoints TEXT DEFAULT '["Checkin"]',
          unlocked_checkpoints TEXT DEFAULT '[]',
          is_registration_open INTEGER DEFAULT 1,
          is_team_formation_open INTEGER DEFAULT 0,
          form_schema TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY(organizer_id) REFERENCES users(id)
        )
      `);

      // Registrations table
      await turso.execute(`
        CREATE TABLE IF NOT EXISTS registrations (
          id TEXT PRIMARY KEY,
          event_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          responses TEXT NOT NULL,
          status TEXT NOT NULL,
          qr_code TEXT NOT NULL UNIQUE,
          checkpoint_checkins TEXT DEFAULT '[]',
          checked_in_by TEXT,
          checked_in_at INTEGER,
          approved_by TEXT,
          approved_at INTEGER,
          rejected_by TEXT,
          rejected_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY(event_id) REFERENCES events(id),
          FOREIGN KEY(user_id) REFERENCES users(id),
          FOREIGN KEY(checked_in_by) REFERENCES users(id),
          FOREIGN KEY(approved_by) REFERENCES users(id),
          FOREIGN KEY(rejected_by) REFERENCES users(id)
        )
      `);

      // Scan logs table
      await turso.execute(`
        CREATE TABLE IF NOT EXISTS scan_logs (
          id TEXT PRIMARY KEY,
          event_id TEXT NOT NULL,
          volunteer_id TEXT NOT NULL,
          qr_code TEXT,
          checkpoint TEXT,
          scan_status TEXT NOT NULL,
          error_message TEXT,
          user_id TEXT,
          registration_id TEXT,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (event_id) REFERENCES events(id),
          FOREIGN KEY (volunteer_id) REFERENCES users(id)
        )
      `);

      // Teams table
      await turso.execute(`
        CREATE TABLE IF NOT EXISTS teams (
          id TEXT PRIMARY KEY,
          event_id TEXT NOT NULL,
          name TEXT NOT NULL,
          member_ids TEXT NOT NULL,
          created_by TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (event_id) REFERENCES events(id),
          FOREIGN KEY (created_by) REFERENCES users(id)
        )
      `);

      // Scoring rounds table
      await turso.execute(`
        CREATE TABLE IF NOT EXISTS scoring_rounds (
          id TEXT PRIMARY KEY,
          event_id TEXT NOT NULL,
          name TEXT NOT NULL,
          round_number INTEGER NOT NULL,
          grading_form_schema TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (event_id) REFERENCES events(id)
        )
      `);

      // Team scores table
      await turso.execute(`
        CREATE TABLE IF NOT EXISTS team_scores (
          id TEXT PRIMARY KEY,
          team_id TEXT NOT NULL,
          scoring_round_id TEXT NOT NULL,
          score REAL,
          graded_by TEXT,
          graded_at INTEGER,
          notes TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (team_id) REFERENCES teams(id),
          FOREIGN KEY (scoring_round_id) REFERENCES scoring_rounds(id),
          FOREIGN KEY (graded_by) REFERENCES users(id)
        )
      `);

      // Create indexes
      await turso.execute(`
        CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)
      `);

      await turso.execute(`
        CREATE INDEX IF NOT EXISTS idx_scan_logs_event_id ON scan_logs(event_id)
      `);

      await turso.execute(`
        CREATE INDEX IF NOT EXISTS idx_scan_logs_volunteer_id ON scan_logs(volunteer_id)
      `);

      await turso.execute(`
        CREATE INDEX IF NOT EXISTS idx_scan_logs_status ON scan_logs(scan_status)
      `);

      console.log('Database tables and indexes created successfully');
    } else {
      console.log('Database tables already exist');
      // Repair schemas made by older runtime initializers without replacing their data.
      const { initDatabase } = await import('../src/lib/db/client.ts');
      await initDatabase();
    }

    return true;
  } catch (error) {
    console.error('Error checking/creating tables:', error);
    throw error;
  }
}

async function main() {
  console.log('Checking database status...');
  try {
    const result = await checkAndInitDb();
    if (result === false) {
      console.warn('Skipping DB initialization — continuing in development mode.');
      return;
    }
  } catch (error) {
    console.error('❌ Database check failed:', error);
    process.exit(1);
  }
}

main();
