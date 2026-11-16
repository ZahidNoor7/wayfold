# Wayfold

Wayfold is a multi-tenant platform for tour guides and travel businesses. Each
business that signs up gets:

- **its own website** at `{name}.wayfold.com` (or its own domain), in one of
  four themes, showing its tours, offers, journal, reviews and a booking form;
- **a workspace** to run the business: tours and availability, booking
  requests, customers, reviews, discounts, media, team and roles, and its own
  integrations (Cloudinary, SMTP, Stripe, Google Maps, WhatsApp).

The platform owner has a separate back office for tenants, plans, billing,
support access and system health.

Every business's data is isolated from every other's: by the application, by
PostgreSQL row-level security, and by the database's own keys.

## Documentation

| Topic | Where |
| --- | --- |
| Architecture, isolation model, risks, plan | [docs/architecture/overview.md](docs/architecture/overview.md) |
| Rules for writing server code and tests | [docs/architecture/conventions.md](docs/architecture/conventions.md) |
| The original design, screen by screen | [docs/design/](docs/design/) |
| Database roles and migrations | [docs/operations/database.md](docs/operations/database.md) |
| Deploying to Vercel and Neon | [docs/operations/deployment.md](docs/operations/deployment.md) |
| Rotating keys and secrets | [docs/operations/key-rotation.md](docs/operations/key-rotation.md) |
| Backups and recovery | [docs/operations/backup-recovery.md](docs/operations/backup-recovery.md) |

## Stack

Next.js 16 (App Router, Cache Components) · React 19 · TypeScript (strict) ·
Tailwind CSS 4 · shadcn/ui on Radix · Motion for React · PostgreSQL on Neon ·
Drizzle ORM · Zod · Vitest · Playwright. Hosted on Vercel; media on Cloudinary.

## Running it locally

Needs Node.js 24, pnpm 11 and a local PostgreSQL 17 install (only the
binaries: the project runs its own private cluster).

```bash
pnpm install
pnpm db:start     # private PostgreSQL in .local/pg on port 54329
pnpm db:setup     # creates and migrates wayfold_dev; prints the lines for .env.local
```

Create `.env.local` from the printed lines (see `.env.example` for what each
setting means). For local work use port 3210:

```dotenv
ROOT_DOMAIN=localhost:3210
APP_HOST=app.localhost:3210
APP_URL=http://app.localhost:3210
```

Then seed plans and your platform-owner account, and start the app:

```bash
pnpm db:seed -- --owner-email you@example.com --owner-name "Your Name" --owner-password '<password>'
pnpm dev -p 3210
```

| Open | For |
| --- | --- |
| <http://localhost:3210> | the Wayfold marketing site |
| <http://app.localhost:3210> | sign up, the workspace, the platform back office (`/platform`) |
| `http://{slug}.localhost:3210` | a business's website, once its workspace exists |

Browsers resolve every `*.localhost` name to your machine, so no hosts-file
changes are needed.

Verification and password-reset e-mails are sent through the platform e-mail
connection (Back office → Integrations). Until one is configured, outside
production the app logs the recipient and subject instead of sending.

## Commands

| Command | Does |
| --- | --- |
| `pnpm dev` | development server |
| `pnpm build` / `pnpm start` | production build and server |
| `pnpm typecheck` | TypeScript, no emit |
| `pnpm lint` | ESLint, including the tenant-isolation import rules |
| `pnpm test` | unit, integration and isolation tests against a real PostgreSQL |
| `pnpm test:coverage` | the same with coverage (fails under 90% statements) |
| `pnpm test:e2e` | browser tests across the real hosts (see below) |
| `pnpm db:generate` | new migration from schema changes |
| `pnpm db:migrate` | apply migrations (uses `DATABASE_MIGRATION_URL`) |
| `pnpm db:start` / `pnpm db:stop` | the private local database |

## Tests

`pnpm test` needs the local database running (`pnpm db:start`). Each run
creates its own throw-away database, migrates it exactly like production,
connects as the real restricted runtime role, and drops it afterwards. Nothing
is mocked at the database level.

- `tests/isolation/` — one file per area, each trying to read, change,
  delete or link another business's data, by id and by tampered input.
  `core-rls.test.ts` also fails if any table holding business data lacks
  row-level security.
- `tests/integration/` — every service against the real database, including
  races (double booking, plan limits, single-use discounts).
- `tests/unit/` — pure logic: encryption, host parsing, dates, redaction.
- `e2e/` — Playwright. `pnpm test:e2e` builds a separate database, starts the
  app on port 3310 and drives it across the app host and tenant hosts.
  Needs the local database running and the Playwright browser
  (`pnpm exec playwright install chromium`).

## Deploying

See [docs/operations/deployment.md](docs/operations/deployment.md). In short:
a Neon database with the roles from
[database.md](docs/operations/database.md), a Vercel project with the
environment variables from `.env.example`, a wildcard domain for tenant
websites, and the scheduled job in `vercel.json`.

Only infrastructure settings live in environment variables. Each business
connects its own providers in its workspace; those credentials are encrypted
in the database and take effect immediately.
