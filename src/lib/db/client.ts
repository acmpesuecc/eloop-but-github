import { createClient } from '@libsql/client';
import { config as loadDotenv } from 'dotenv';
import fs from 'fs';
import path from 'path';

// Ensure common .env files are read when running in environments where
// We try in order but do not override any already-present env vars.
const envFiles = ['.env', '.env.local', '.env.development', '.env.development.local'];
for (const f of envFiles) {
  const p = path.resolve(process.cwd(), f);
  if (fs.existsSync(p)) {
    try {
      loadDotenv({ path: p, override: false });
    } catch (e) {
    }
  }
}

// Read and validate Turso environment variables early but do not fail imports
const TURSO_URL = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL;
const TURSO_AUTH = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_URL) {
  console.warn('TURSO_DATABASE_URL (or DATABASE_URL) environment variable is not set. Database features will be disabled — running in limited local mode.');
}

if (!TURSO_AUTH) {
  console.warn('Warning: TURSO_AUTH_TOKEN is not set. Authenticated operations may fail.');
}

// Initialize Turso client (stub when not configured) so importing modules doesn't throw
export const turso = TURSO_URL
  ? createClient({ url: TURSO_URL, authToken: TURSO_AUTH || undefined })
  : ({
    execute: async () => {
      throw new Error('TURSO_DATABASE_URL is not configured. Database operations are disabled. Set TURSO_DATABASE_URL to enable DB features.');
    },
  } as any);


// NOTE: Do NOT run initialization on import. Initialization is handled
// explicitly by `scripts/check-and-init-db.js` during build or by calling
// `initDatabase()` from a controlled bootstrap path. Avoiding network calls
// during module import prevents unexpected behavior during builds.

// Create or get Turso tables
export async function initDatabase() {
  if (!TURSO_URL) {
    console.warn('initDatabase(): TURSO_DATABASE_URL not set — skipping database initialization.');
    return;
  }

  try {
    // User profiles table
    await turso.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        organizer_id TEXT,
        is_approved INTEGER NOT NULL DEFAULT 0,
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
        location TEXT,
        organizer_id TEXT NOT NULL,
        form_schema TEXT NOT NULL, -- JSON string of form schema
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
        responses TEXT NOT NULL, -- JSON string of form responses
        status TEXT NOT NULL,
        qr_code TEXT NOT NULL UNIQUE,
        checkpoint_checkins TEXT DEFAULT '[]', -- JSON array of checkpoint check-ins with status
        approved_by TEXT,
        approved_at INTEGER,
        rejected_by TEXT,
        rejected_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(event_id) REFERENCES events(id),
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(approved_by) REFERENCES users(id),
        FOREIGN KEY(rejected_by) REFERENCES users(id)
      )
    `);

    // Teams table - groups of participants with a team name
    await turso.execute(`
      CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        name TEXT NOT NULL,
        member_ids TEXT NOT NULL, -- JSON array of user IDs (team members)
        created_by TEXT NOT NULL, -- mentor who created the team
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(event_id) REFERENCES events(id),
        FOREIGN KEY(created_by) REFERENCES users(id)
      )
    `);

    // Scoring rounds table - defines review rounds (e.g., "Round 1 Review", "Round 2 Review")
    await turso.execute(`
      CREATE TABLE IF NOT EXISTS scoring_rounds (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        name TEXT NOT NULL, -- e.g., "Round 1 Review", "Round 2 Review"
        round_number INTEGER NOT NULL, -- ordering of rounds
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(event_id) REFERENCES events(id)
      )
    `);

    // Team scores table - stores scores for teams in each round
    await turso.execute(`
      CREATE TABLE IF NOT EXISTS team_scores (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        scoring_round_id TEXT NOT NULL,
        score REAL, -- numeric score (can be null if not yet graded)
        graded_by TEXT, -- mentor who graded the team
        graded_at INTEGER, -- when the team was graded
        notes TEXT, -- optional notes from mentor
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(team_id, scoring_round_id),
        FOREIGN KEY(team_id) REFERENCES teams(id),
        FOREIGN KEY(scoring_round_id) REFERENCES scoring_rounds(id),
        FOREIGN KEY(graded_by) REFERENCES users(id)
      )
    `);

    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Failed to initialize database:', error);
    throw error;
  }
}
