# Backup and recovery

## What holds state

| Data | Where | Backed up by |
| --- | --- | --- |
| All application data, including encrypted credentials | Neon PostgreSQL | Neon point-in-time restore; scheduled logical dumps |
| Media files | Each tenant's Cloudinary account (or the platform-managed account) | The storage provider; Wayfold stores only the catalogue |
| Master encryption keys, session secret | Platform secret manager (Vercel environment variables) | A separate, access-controlled copy |

The application servers are stateless.

## Targets

- Recovery point objective: 5 minutes (Neon point-in-time restore window; set
  the history retention on the Neon project to at least 7 days).
- Recovery time objective: 1 hour.

## Routine

1. Neon point-in-time restore enabled with ≥ 7 days of history.
2. A nightly logical dump (`pg_dump --format=custom`) to object storage in a
   different provider or region, kept 30 days. Run it with the schema-owner
   connection from a scheduled job outside the application.
3. A quarterly restore drill: restore last night's dump into a scratch
   database, run `pnpm db:migrate` (should be a no-op) and the isolation test
   suite against it.
4. The encryption keys are backed up separately from the database. A database
   backup without the keys cannot reveal tenant credentials; with the keys
   lost, credentials cannot be recovered and tenants must re-enter them.

## Restoring

**Whole database (corruption, bad migration).** Create a Neon branch at a
timestamp just before the incident, point the three connection strings at it,
verify, then promote. Roles are cluster-level in PostgreSQL: on a different
server re-create `wf_app` and `wf_platform` as in `database.md`.

**One tenant (accidental deletion by the tenant).** Restore to a branch, then
copy that tenant's rows back through the platform connection, filtering every
table by `tenant_id`. Composite foreign keys keep the copy consistent; copy
parents before children. Record the action in the platform audit log.

**Media.** Deleting an asset in Wayfold deletes it at the provider. Recovery
depends on the provider's own backups; Cloudinary offers optional backups per
account, which tenants should enable.

## After any restore

- Run the isolation tests against the restored database.
- Sessions and tokens older than the restore point may be valid again:
  rotate `SESSION_SECRET` if the incident involved exposure.
- Check `SELECT key_version, count(*) FROM integrations GROUP BY 1` matches
  the keys currently configured.
