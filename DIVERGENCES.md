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

## Lint tooling compatibility

ESLint uses the supported 9.x release line instead of 10.x because the installed React, import, and accessibility plugins do not support ESLint 10. `eslint.config.mjs` imports Next.js 16's native flat configs directly instead of passing them through the legacy `FlatCompat` adapter. The direct `typescript-eslint` dependency replaces the separate parser/plugin declarations and keeps Next's lint configuration on a release supporting TypeScript 6. The unused direct `@eslint/eslintrc` dependency is removed.

Lint rules remain enabled. The configuration crash is fixed, but the existing application code still reports 58 errors and 47 warnings at the time of the tooling repair. `bun run lint` exits with code 1 for these findings, not an initialization error; application-wide lint cleanup is separate from this compatibility fix.

## Compatible dependency upgrades

The dependency audit on 2026-10-11 selects the next published, non-deprecated stable major where its peers are compatible. If no compatible next major exists, it selects the latest stable release within the current major. Prereleases and forced peer overrides are excluded. For pre-1.0 packages, minor updates can be breaking and are validated as migrations too.

| Package | Previous version | Selected version |
| --- | --- | --- |
| `dotenv` | 17.4.2 | 18.0.7 |
| `react-dropzone` | 15.0.0 | 16.0.0 |
| `@libsql/client` | 0.17.4 | 0.18.0 |
| `@zxing/browser` | 0.2.0 | 0.2.1 |
| `jose` | 6.2.3 | 6.2.12 |
| `lucide-react` | 1.21.0 | 1.55.0 |
| `next`, `eslint-config-next` | 16.2.9 | 16.4.0 |
| `next-auth` | 4.24.14 | 4.24.15 |
| `posthog-js` | 1.393.5 | 1.438.7 |
| `posthog-node` | 5.38.5 | 5.55.2 |
| `react`, `react-dom` | 19.2.7 | 19.3.0 |
| `react-hook-form` | 7.80.0 | 7.90.0 |
| `zod` | 4.4.3 | 4.6.6 |
| `tailwindcss`, `@tailwindcss/postcss` | 4.3.1 | 4.3.3 |
| `@types/bun` | 1.3.14 | 1.4.2 |
| `@types/node` | 26.0.1 | 26.6.5 |
| `@types/react` | 19.2.17 | 19.3.0 |
| `@types/react-dom` | 19.2.3 | 19.3.0 |

The DnD packages, Heroicons, Vercel analytics/speed insights, QR scanner, QRCode packages/types, ESLint React/Hooks plugins, `ignore-loader`, and `typescript-eslint` already have the newest compatible stable release in their selected major. The manifest raises the `typescript-eslint` minimum to the already installed 8.71.1. React and React DOM, their types, Next.js and its lint config, and Tailwind and its PostCSS integration are updated together.

### Deferred incompatible or unavailable majors

- ESLint 10.12.0 is stable, but `eslint-plugin-react` requires ESLint through 9.x; the import and accessibility plugins also exclude ESLint 10. Keep ESLint 9.39.5 and native flat configs.
- TypeScript 7.0.2 is stable, but `typescript-eslint` 8.71.1 requires TypeScript `>=4.8.4 <6.1.0`. Keep TypeScript 6.0.3 until the parser and rules support 7.x.
- NextAuth 5 is prerelease-only. Keep stable 4.x; GitHub OAuth, JWT/session callbacks, and the existing user-role system remain unchanged.
- Other packages without a published next stable major remain on their current major. Dropzone stops at 16, the requested next major, rather than skipping directly from 15 to 20.

### Migration and compatibility

- Dotenv 18 changes its default to quiet logging. Both existing environment readers explicitly pass `quiet: false` to preserve 17.x output. Runtime loading still uses `override: false` to preserve deployment variables; the initializer still uses `override: true` for later-file precedence. No environment variable names change. Regression checks use isolated environment objects and temporary files, not deployment credentials.
- Dropzone 16 removes the UMD build and old `dist/es/` paths, replacing them with package-root ESM/CJS exports. The application has no Dropzone imports or CDN/script-tag usage to migrate. A regression check imports from the package root and renders its file input with React 19.3. [Release notes](https://github.com/react-dropzone/react-dropzone/releases/tag/v16.0.0).
- ZXing Browser 0.2.1 declares `@zxing/library: ^0.23.0`. Add that explicit dependency at 0.23.0, repairing the previously resolved incompatible 0.21.3 peer without forced overrides.
- LibSQL 0.18 uses the existing client API. Database checks verify fresh initialization, legacy repair, row/role preservation, repeated initialization, and atomic volunteer assignment. No schema or data migration is introduced by these dependency upgrades. QR token format and signing configuration remain unchanged.
- Preserve the existing Bun workflow. Next.js requires Node >=20.9.0; Dropzone 16 requires Node >=20. Dependency verification used Bun 1.3.14 and Node 26.5.0. Blocked dependency lifecycle scripts remain blocked; no blanket trust is added.
- The resolved dependency graph passes 63 peer-range checks. Frozen-lockfile installation, 28 API tests, standalone auth/database/schema/lint/migration checks, TypeScript, and the production build pass. Full lint still reports 58 existing errors; Next.js 16.4 introduces 3 additional navigation warnings, for 50 warnings total. Rules remain enabled.

Deploy `package.json`, `bun.lock`, and the two environment-reader changes together using `bun install --frozen-lockfile`, then build. No mixed-version database transition is needed: persistent data, roles, sessions, and checkpoint state retain their existing formats. Rollback uses the previous manifest/lockfile and environment-reader versions from commit `163d116`, followed by frozen-lockfile installation and a rebuild; no database rollback or data deletion is required. Older in-flight application instances can continue reading the unchanged schema.

## Vercel database client

When `VERCEL=1`, the runtime database module and build initializer select `@libsql/client/web` rather than the native Node entry point. Other environments retain `@libsql/client` so local `file:` databases and integration checks continue to work. Vercel requires a remote Turso/LibSQL URL; the web client does not support local SQLite files. Existing URL/token configuration, schema, and user roles are unchanged.

## Validation

```bash
bun test
bun tests/event-controls-db.ts
bun tests/auth-regression.ts
bun tests/schema-regression.ts
bun tests/lint-config.ts
bun tests/dependency-migration.tsx
bun tests/vercel-db-client.ts
bunx tsc --noEmit
bun run build
```

The standalone database checks use temporary local databases, not the configured application database. `bun tests/lint-config.ts` checks that the installed linter loads the native configs, parses TypeScript, enforces rules, and ignores generated files. Run `bun run lint` to review the remaining source findings.
