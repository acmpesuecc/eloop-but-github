# Divergences from upstream

`README.md` is preserved exactly as the minimal fork version at `5c6fc75`, including fork attribution and the deployment target. This document records subsequent functional changes. Use the GitHub OAuth configuration below rather than the inherited Google OAuth instructions in the README.

## GitHub OAuth

- GitHub replaces Google as the sign-in provider in `src/lib/auth.ts` and the sign-in UI.
- Use `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`, not `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET`. `.env.example` and required-variable validation reflect this change.
- The provider requests `read:user user:email`, allowing private GitHub email addresses. Sign-in requires an email address; existing users retain their roles and registrations when that email matches their previous sign-in email.
- Set `ADMIN_EMAIL` to the initial admin's GitHub primary email. New users otherwise start as applicants, using the existing role system.
- Database lookup or user-creation failures reject sign-in rather than create a synthetic participant session.

### OAuth App setup

1. Open [GitHub Developer Settings → OAuth Apps](https://github.com/settings/developers) and select **New OAuth App**.
2. Set **Homepage URL** to your site URL, such as `https://your-site.vercel.app`.
3. Set **Authorization callback URL** to `https://your-site.vercel.app/api/auth/callback/github`. Use a separate OAuth App with `http://localhost:3000/api/auth/callback/github` for local development.
4. Register the application, generate a client secret, and configure `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. Keep `NEXTAUTH_URL` aligned with the site URL.

## Skipped-checkpoint approval

The scanner warns when a participant has skipped earlier checkpoints and presents **Approve** and **Cancel**. No check-in is recorded until approval. Approval retries the original QR, checkpoint, and event selection; skipped checkpoints remain unscanned.

Approval does not bypass authentication, scanner privileges, QR verification, registration approval, duplicate-check-in checks, or stopped checkpoints. Successful overrides are recorded in scan logs.

## Live event staffing

Open **Dashboard → Events → your event** as an admin. **Event Volunteers** lets you add applicants, participants, or existing volunteers before, during, or after the event, including when registration is closed.

- The existing `/api/volunteer/create` flow accepts an optional `eventId`, sets `users.role = 'volunteer'`, and assigns `users.organizer_id` to the event organizer.
- Promotion and organizer assignment use one atomic SQL update through `updateUserRole`. A rejected assignment cannot leave a partially promoted user. Legacy calls without an organizer preserve the existing association.
- `/api/volunteers?eventId=...` lists the event organizer's volunteers, shared across their events. Requests without `eventId` retain the existing admin/organizer listing behavior.
- There is no separate event volunteer role, roster table, or permission model. Newly promoted users should sign out and sign back in to refresh their session role.
- Volunteer creation does not overwrite admin, organizer, or mentor roles. Non-owner organizers cannot manage another organizer's event staffing.

## Manual checkpoint controls

In **Checkpoint Access Control**, use **Start** or **Stop** regardless of event start/end dates. This project has no automatic checkpoint scheduler.

- Controls reuse `events.unlocked_checkpoints`.
- Starting a non-`Checkin` checkpoint stops other non-`Checkin` checkpoints in one atomic database update. `Checkin` may remain active alongside it.
- Every scanner shows only started checkpoints and polls for changes every 3 seconds. Stopped checkpoints reject scans for all roles, including admins and skipped-checkpoint overrides.
- Checkpoint management requires an admin or the event's organizer.
- Scanner requests include the selected event, and the API rejects QR codes for a different event. Approval retries preserve the original selection. Legacy API callers without an event selector can still use the QR's event.

Live staffing and manual checkpoint controls reuse the existing schema; neither requires a new volunteer table or role.

## Authorization consistency fixes

- Admins can access event creation through the dashboard proxy, matching API permissions.
- Registration toggles require an admin or the event's organizer.
- The registration API enforces the same applicant-only restriction as the registration UI. Authentication and manual registration closure remain enforced.

## Schema compatibility changes

These repairs align `src/lib/db/client.ts` with fields already present in `scripts/check-and-init-db.js`; they do not introduce another role or volunteer model.

### Columns created or repaired when missing

| Table | Columns | Type and default |
| --- | --- | --- |
| `events` | `start_date`, `end_date`, `registration_close_date`, `image_url` | Nullable `TEXT`, default `NULL` |
| `events` | `checkpoints` | Nullable `TEXT` containing JSON, default `'["Checkin"]'` |
| `events` | `unlocked_checkpoints` | Nullable `TEXT` containing JSON, default `'[]'` |
| `events` | `is_registration_open` | Nullable `INTEGER`, default `1` |
| `events` | `is_team_formation_open` | Nullable `INTEGER`, default `0` |
| `registrations` | `checkpoint_checkins` | Nullable `TEXT` containing JSON, default `'[]'`; legacy repair only, already in the runtime table definition |
| `registrations` | `checked_in_by` | Nullable `TEXT`, default `NULL` |
| `registrations` | `checked_in_at` | Nullable `INTEGER`, default `NULL` |
| `registrations` | `approved_by`, `rejected_by` | Nullable `TEXT`, default `NULL`; legacy repair only, already in the runtime table definition |
| `registrations` | `approved_at`, `rejected_at` | Nullable `INTEGER`, default `NULL`; legacy repair only, already in the runtime table definition |
| `scoring_rounds` | `grading_form_schema` | Nullable `TEXT`, default `NULL` |

### Table, constraints, and indexes

- The runtime initializer also creates `scan_logs` when absent, matching deployment setup: `id TEXT PRIMARY KEY`; `event_id TEXT NOT NULL`; `volunteer_id TEXT NOT NULL`; nullable `qr_code`, `checkpoint`, `error_message`, `user_id`, and `registration_id` as `TEXT`; `scan_status TEXT NOT NULL`; `created_at INTEGER NOT NULL`. Foreign keys reference `events(id)` from `event_id` and `users(id)` from `volunteer_id`.
- Fresh runtime-created `registrations` tables include `FOREIGN KEY(checked_in_by) REFERENCES users(id)`. Repairing an existing table adds columns only; it does not retrofit foreign-key constraints.
- The runtime initializer also ensures the existing deployment indexes: `idx_users_role` on `users(role)`, `idx_scan_logs_event_id` on `scan_logs(event_id)`, `idx_scan_logs_volunteer_id` on `scan_logs(volunteer_id)`, and `idx_scan_logs_status` on `scan_logs(scan_status)`.

### Deployment and preservation

For existing databases, `scripts/check-and-init-db.js` invokes `initDatabase()` to create missing standard tables and repair missing columns. Repairs inspect `PRAGMA table_info`, use additive `ALTER TABLE ... ADD COLUMN`, and tolerate another initializer adding the same column concurrently. Repeated initialization is safe.

Existing column values, rows, user roles, organizer associations, and checkpoint state are not rewritten. Missing columns receive the defaults listed above. No columns or tables are dropped or renamed; no `event_volunteers` table is created or used. Rollback can leave added columns, tables, and indexes in place without removing data.

## Validation

```bash
bun test
bun tests/event-controls-db.ts
bun tests/auth-regression.ts
bun tests/schema-regression.ts
bunx tsc --noEmit
bun run build
```

The standalone database checks use temporary local databases, not the configured application database. Lint is currently blocked by the existing ESLint dependency incompatibility (`Class extends value undefined is not a constructor or null`).
