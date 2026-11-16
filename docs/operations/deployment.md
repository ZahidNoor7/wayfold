# Deploying Wayfold (Vercel + Neon)

One Vercel project serves every surface: the marketing site, the app host
(workspaces and the back office) and every tenant website. One Neon database
holds all data.

## 1. Database

1. Create a Neon project in the region closest to your users. Enable
   point-in-time restore with at least 7 days of history.
2. Follow [database.md](./database.md): run the migrations as the owner,
   create `wf_app` and `wf_platform` **with SQL**, then seed.
3. Use Neon's **pooled** connection strings for `DATABASE_URL` and
   `DATABASE_PLATFORM_URL`. Keep `DATABASE_MIGRATION_URL` out of Vercel; set
   it only where migrations run (CI or a trusted shell).

## 2. Domains

With `wayfold.com` as the example root domain:

| Record | Points to | Serves |
| --- | --- | --- |
| `wayfold.com`, `www.wayfold.com` | Vercel | marketing site |
| `app.wayfold.com` | Vercel | sign-in, workspaces, back office |
| `*.wayfold.com` | Vercel (wildcard) | tenant websites |

Wildcard domains on Vercel need the domain's nameservers to be Vercel's (or a
provider Vercel can issue wildcard certificates through). Add all three
entries to the project.

Before launch, apply to add the root domain to the
[Public Suffix List](https://publicsuffix.org/). Session cookies are already
host-only on the app host, so tenant sub-domains never receive them; the list
entry adds browser-level separation between tenant sites as well.

### Tenant custom domains

A business adds its domain in Settings → Website domain and publishes the TXT
record shown there (`_wayfold.<domain>`). After Wayfold verifies it, the
domain must also be added to the Vercel project (by the platform owner, or
through Vercel's domains API) and the business points it at Vercel with a
CNAME (sub-domains) or A record (apex). Until both are done the domain shows a
404; it never shows another business's site.

## 3. Environment variables (Vercel)

Set for Production (and Preview, with a separate database branch):

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | pooled URL for `wf_app` |
| `DATABASE_PLATFORM_URL` | pooled URL for `wf_platform` |
| `DATABASE_DRIVER` | `neon` |
| `DATABASE_POOL_MAX` | `5` |
| `ROOT_DOMAIN` | `wayfold.com` |
| `APP_HOST` | `app.wayfold.com` |
| `APP_URL` | `https://app.wayfold.com` |
| `SESSION_SECRET` | `openssl rand -base64 48` |
| `CREDENTIAL_ENCRYPTION_KEYS` | `v1:` + `openssl rand -base64 32` |
| `CREDENTIAL_ENCRYPTION_ACTIVE_KEY` | `v1` |
| `CRON_SECRET` | `openssl rand -base64 32` |

Mark every secret as sensitive. Never set `PLATFORM_MAIL_CAPTURE_FILE` in
production (it is ignored there in any case). Tenant provider credentials are
**not** environment variables.

Keep a copy of `CREDENTIAL_ENCRYPTION_KEYS` in a separate secret store: without
it, stored tenant credentials cannot be decrypted.

## 4. Scheduled jobs

`vercel.json` runs `GET /api/cron` every 10 minutes. Vercel sends
`Authorization: Bearer $CRON_SECRET`; without a matching secret the endpoint
answers 404 and does nothing. The run expires stale booking holds, delivers
queued customer and staff e-mails through each business's own e-mail
connection, and removes expired sessions. Results (counts only) are in the
platform audit log as `jobs.scheduled_run`.

## 5. After the first deploy

1. Sign in at `https://app.wayfold.com` with the platform owner from the seed.
2. Back office → Integrations: connect the platform e-mail (SMTP) so
   verification and password-reset e-mails are delivered. Optionally connect
   managed media storage (Cloudinary) for plans that include it.
3. Back office → Plans: review prices and limits.
4. Create a test workspace, publish a tour, open its website and make a
   booking request end to end.
5. Point an uptime monitor at `https://app.wayfold.com/api/health`.

## Updating

- Migrations run before the new code is promoted: `pnpm db:migrate` from CI
  with `DATABASE_MIGRATION_URL`, then deploy. Migrations are written to be
  backwards compatible with the code that is currently live.
- The service worker shows "A new version is ready" to open tabs; nothing is
  swapped under a user mid-task.
