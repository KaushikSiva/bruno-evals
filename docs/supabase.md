# Saving Reality Check runs in Supabase

Supabase holds a private cloud archive of run instructions, evaluation criteria, AI results, human reviews, evidence timestamps, source hashes, and Agent Relay receipts. Videos and JPEG evidence go in Storage; the review and its object references go in Postgres.

Terse still owns active live-session state and evaluation leases. SQLite still owns the local whole-video queue. Uploads happen in the background, so a storage outage does not block an evaluation. The current UI reads local/Terse state; connecting Supabase does not turn this local app into a hosted multi-user service.

## Connect a project

1. Create or select your Supabase project. `reality-check` is a suitable project name.
2. Run [the migration](../supabase/migrations/202610310001_bruno_archive.sql) in its SQL editor. It creates `bruno_runs`, a version-aware write function, and the private `bruno-evidence` bucket. Existing internal names remain stable across the Reality Check rename.
3. Add these values to the ignored `.env.local` file:

   ```dotenv
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SECRET_KEY=your-server-secret-key
   ```

   A legacy `SUPABASE_SERVICE_ROLE_KEY` also works. A publishable key cannot write this archive. Keep the server secret out of source control, screenshots, and browser code. See [Supabase's API key guide](https://supabase.com/docs/guides/getting-started/api-keys).

4. Restart `npm start`. The server scans local jobs and live snapshots every ten seconds and queues changed records for upload. It imports older runs too.

A server key can use the installed tables and Storage API. Creating tables requires the SQL editor, a database connection, or authorized Supabase management access. The runtime does not attempt to execute arbitrary SQL.

## Import and check existing runs

Inspect the inventory without making cloud requests:

```sh
npm run storage:sync -- --dry-run
```

Upload existing data, or retry pending uploads immediately:

```sh
npm run storage:sync
```

When the local app is running, this command includes its latest Terse snapshots. Otherwise it reads saved `session.json` exports, which can lag active actor state. Run one importer at a time. No evaluation/model calls are made by this command.

The command exits unsuccessfully when records remain pending. Check its error and rerun after fixing credentials, a missing local file, a project upload limit, or connectivity. Media retained on the Mac is never deleted by synchronization.

## What gets saved

| Location | Contents |
| --- | --- |
| `public.bruno_runs` | One row per job or live session; task, status, final verdict, original timestamps, complete review document, and media references |
| Private `bruno-evidence` bucket | Original uploaded/downloaded videos, normalized replay MP4s, and sampled JPEG frames |
| Local `data/supabase-sync.sqlite` | Durable upload queue, acknowledged versions, retry state, and uploaded-object receipts |

Each object path includes a SHA-256 digest. The archived row is written only after all its referenced local media has uploaded. A partial failure stays pending; retrying reuses successful uploads. Pending revisions survive server restarts. Videos larger than 6 MiB use chunked TUS uploads; an interrupted process restarts the unfinished file while retaining receipts for completed files. See [Supabase's upload guidance](https://supabase.com/docs/guides/storage/uploads/resumable-uploads).

A browser-capture session can reference its separate recording job by `recordingJobId`. That job owns the full video, and the live session owns its sampled frames. Empty recordings are saved as metadata without fabricated evidence.

The database rejects older snapshots that would overwrite newer data. Local absolute source paths are omitted from cloud documents. Only files inside the matching run directory can upload; symlinks that escape that directory are rejected.

## Read the archive

These endpoints inherit the app's localhost and same-origin restrictions:

```text
GET /api/storage/status
GET /api/storage/runs?offset=0&limit=50
GET /api/storage/runs/job/<id>
GET /api/storage/runs/live/<id>
```

The list is paginated (at most 100 rows per request). Detail responses include five-minute signed URLs for the stored media. No public bucket URLs or server keys are exposed. The ordinary `/api/status` response also includes storage status. `configured: true` means credentials were supplied; `pending`, `failed`, `synced`, and `error` tell you whether uploads actually succeeded.

Tables have Row Level Security enabled and no anonymous/authenticated grants. The write function is executable only by the server role. Storage is private; the app refuses to use a public bucket. This follows [Supabase's Storage access model](https://supabase.com/docs/guides/storage/security/access-control).

## Recovery boundaries

This is an additional archive, not automatic restoration of a runnable Terse instance. Preserve `data/` and `integrations/terse/.durable-actors/` to resume active work after a machine failure. The cloud archive can be read through the API, but automatic reconstruction of local jobs and actor state is not implemented.

Do not delete uploaded objects manually while keeping their local upload receipts: receipts assume the private archive is retained. Deleted local records are not deleted from Supabase automatically. Account-specific Storage size limits still apply; a rejected file remains pending with an error.

Tests exercise restart/retry recovery, updates arriving mid-upload, private file boundaries, project separation, and actual PostgreSQL migration permissions and stale-write protection using PGlite. Cloud verification additionally requires a connected project and the migration.
