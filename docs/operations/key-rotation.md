# Rotating secrets

## Credential-encryption master key

Tenant integration secrets are encrypted with AES-256-GCM under per-tenant
keys derived from a master key. Master keys are versioned so rotation needs no
downtime.

1. Generate a key: `openssl rand -base64 32`.
2. Add it as the next version and make it active, keeping the old one listed:

   ```
   CREDENTIAL_ENCRYPTION_KEYS=v1:<old>,v2:<new>
   CREDENTIAL_ENCRYPTION_ACTIVE_KEY=v2
   ```

3. Deploy. From now on new and updated credentials use `v2`; `v1` rows still
   decrypt, and each is re-encrypted the next time it is used.
4. Re-encrypt everything else:
   `pnpm exec tsx scripts/rotate-credential-keys.ts`
   (needs `DATABASE_URL`, `DATABASE_PLATFORM_URL` and both keys). It prints
   counts only, never secrets.
5. Confirm nothing is left on the old version:
   `SELECT key_version, count(*) FROM integrations GROUP BY 1;` (platform
   connection), and the same for `platform_integrations`.
6. Remove `v1` from `CREDENTIAL_ENCRYPTION_KEYS` and deploy.

If a master key is believed compromised, do steps 1–6 immediately and then ask
tenants to rotate their provider credentials in Settings → Integrations: a
leaked key means stored secrets may have been read.

Losing every listed master key makes stored credentials unrecoverable. Tenants
would re-enter them. Keep the keys in the platform secret manager with its own
backup, separate from database backups.

## Session secret

`SESSION_SECRET` keys the hashes of session and one-time tokens. Changing it
signs everyone out and invalidates pending verification, reset and invitation
links. Rotate it after any suspected exposure; no migration is needed.

## Database passwords

Change with `ALTER ROLE wf_app PASSWORD '…'` (and `wf_platform`), update the
connection strings, deploy. Role membership and grants are unaffected.

## A tenant's provider credentials

Tenants rotate their own in Settings → Integrations (edit, enter the new
secret, save, test). The change is immediate and is recorded in the audit log
as `integration.credentials_rotated`.
