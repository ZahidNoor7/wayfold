# Wayfold architecture and implementation plan

Wayfold turns the "Aurelia Journeys" design (one tour guide's website and
admin) into a platform where many independent tour businesses each get that
website and that admin, isolated from one another.

Related documents:

- [Design analysis](../design/) — every screen, component, interaction and rule in the design
- [Engineering conventions](./conventions.md) — the rules all server code follows
- [Operations](../operations/) — database roles, deployment, key rotation, backups

## 1. From the design to a platform

The design contains three things. Each maps to one surface of the product:

| Design | Wayfold surface | Host |
| --- | --- | --- |
| Public website (Home, About, Experiences, Tour detail, Booking, Offers, Journey, Reviews, Contact) | **Tenant storefront**, rendered per tenant with that tenant's data and theme | `{slug}.wayfold.com` and verified custom domains |
| Admin dashboard (Overview, Bookings, Content, Discounts & offers, Settings & appearance) | **Tenant workspace** | `app.wayfold.com/workspace` |
| Mobile flows (390 px) | The same pages, responsive, with bottom sheets and sticky action bars | both |

The design's theme switcher (four themes, light/dark/system, corner style,
heading font) becomes each tenant's **branding**, stored on the tenant and
applied on the server so the first paint is already correct.

Screens the design does not contain, built in the same visual language:
registration and onboarding, workspace switcher, team and roles, integrations,
media library, plan and billing, activity log, the Wayfold marketing site, and
the platform owner's back office.

Where the design's sample logic was wrong or unsafe, the implementation
follows the intent rather than the bug. The notable cases:

- Promotion data (including the private maximum discount and audit log) was
  broadcast to public pages through `localStorage`. All pricing and discount
  decisions now happen on the server; the browser never receives private rules.
- The discount-request tracker looked requests up by reference alone and
  showed the requester's e-mail. It now needs a secret issued at submission
  and never returns the e-mail.
- "Declined" and "Cancelled" shared one status. The status stays `cancelled`
  with a recorded kind (declined, by customer, by business, expired).
- The design has no payment status; bookings carry one (unpaid, deposit paid,
  paid, refunded) because the brief requires it.
- Double-booking was a warning in the browser. It is now impossible: the
  booking transaction locks the bookable unit and re-checks capacity.

## 2. System shape

```
Browser
  │  Host header
  ▼
proxy.ts ── classifies host only (no database, no authorisation)
  ├─ app host      → /workspace, /platform, auth        session cookie (__Host-, host-only)
  ├─ root domain   → marketing site
  └─ tenant host   → rewritten to /s/{site}/…           public, no cookies
        │
        ▼
Server Components / Server Actions
  │  workspaceAction · siteAction · userAction · platformAction
  ▼
Services  (src/server/<domain>)   take a TenantScope, filter by tenant explicitly
  ▼
withTenant(tenantId) ── one transaction, SET LOCAL app.tenant_id
  ▼
PostgreSQL (Neon) ── forced row-level security on every tenant table
```

One Next.js deployment on Vercel, one Neon database. No queue, cache server or
separate API service: PostgreSQL also carries rate limits and the notification
outbox, which keeps the operational surface small.

**Stack** (versions verified against the registry at build time): Next.js
16.4 App Router with Cache Components, React 19.3, TypeScript 5.9 strict,
Tailwind CSS 4.3, shadcn/ui on Radix, Motion for React 14, Drizzle ORM 0.45,
`@neondatabase/serverless` 1.2, Zod 4, React Hook Form 7, Vitest 5,
Playwright 1.65.

## 3. Tenant isolation

Isolation is enforced four times, independently. Any one layer failing still
leaves the others.

1. **Resolution.** The tenant comes from the session row (dashboard) or the
   verified request host (storefront). A tenant id in a URL, form or JSON body
   is never used to choose a tenant.
2. **Application.** Tenant tables are only reachable through `withTenant`,
   which yields a `TenantScope`. Every query filters on `scope.tenantId`.
   Lint rules block the raw connection and the cross-tenant connection
   outside two folders.
3. **Database policy.** Every table with a `tenant_id` has forced row-level
   security. The runtime role sees rows only where
   `tenant_id = app_current_tenant()`; with no context set it sees nothing.
   A test fails the build if any tenant table lacks a policy.
4. **Database structure.** Parent/child links use composite foreign keys
   `(tenant_id, id)`, so a row cannot reference another tenant's row even
   through a privileged connection. Uniqueness is per tenant.

**Roles.** Two database roles, neither with `BYPASSRLS`:

- `wayfold_app` — the web application. Granted exactly what it needs. It
  cannot create tenants, change a tenant's plan, status, limits or slug,
  write plans, subscriptions or invoices, add platform admins, read
  platform-managed credentials, or edit/delete audit rows. These are
  privileges, not conventions: the statements fail in PostgreSQL.
- `wayfold_platform` — platform administration, with explicit all-tenant
  policies. Used only by `src/server/platform`.

On first use the app checks that its connection is not a superuser, has no
`BYPASSRLS`, is a member of `wayfold_app` and is not a member of
`wayfold_platform`, and refuses to serve tenant data otherwise.

**Connection pooling.** The tenant context is set with
`set_config(..., is_local => true)` inside a transaction, so it ends with the
transaction and cannot ride a pooled connection into another request. A test
interleaves two tenants across a small pool and then inspects every
connection.

**Caching.** Dashboard responses are never cached. Storefront data is cached
only by functions whose arguments include the tenant id, so the cache key
itself separates tenants. The service worker never caches HTML, API responses
or anything under `/workspace`.

**Future dedicated databases.** All access goes through
`withTenant(tenantId, …)`. Routing an enterprise tenant to its own database
means resolving a different pool inside that one function; services and
schema stay as they are.

## 4. Credentials and integrations

Tenants connect providers at runtime in **Settings → Integrations**. Nothing
tenant-specific is in an environment variable, and saving a credential takes
effect on the next request.

- **Encryption.** AES-256-GCM. A per-tenant key is derived from the platform
  master key with HKDF, so tenants never share key material.
- **Binding.** Tenant id, record id, provider and key version are fed to GCM
  as authenticated data. A ciphertext copied onto another tenant's row fails
  to decrypt instead of revealing a secret.
- **Rotation.** Master keys are versioned (`v1:…,v2:…`). New writes use the
  active version; reads re-encrypt old rows on the fly; a script re-encrypts
  everything; then the old key is removed.
- **Exposure.** Secrets are decrypted only on the server at the moment of
  use. The UI receives masked hints. When editing, a blank secret field keeps
  the stored value, so the old value is never sent to a browser.
- **No fallback.** `resolveIntegration` returns the current tenant's
  connection or throws. Platform-managed media storage exists only if the
  platform owner configures it and the tenant's plan includes it.
- **Adapters.** Each provider is one file implementing `ProviderAdapter`
  (fields, schemas, connection test). Cloudinary, SMTP, Stripe, Google Maps
  and WhatsApp click-to-chat ship first.
- **Failure handling.** Provider calls run under a timeout with retries for
  transient errors. Error text is scrubbed of secrets, URL credentials and
  query strings before it is stored or shown.
- **Audit.** Every create, update, rotation, test and delete is logged with
  field names, never values.

## 5. Authentication and authorisation

- Passwords: Argon2id. Sessions: 256-bit random token in a host-only,
  `HttpOnly`, `Secure`, `SameSite=Lax` cookie with the `__Host-` prefix; the
  database stores only a keyed hash. Because the cookie is host-only on the
  app host, tenant sub-domains never receive it and cannot set it.
- E-mail verification, password reset and invitations use single-use,
  expiring, hashed tokens. Login and registration do not reveal whether an
  address is registered and are rate-limited by address and by account.
- Membership and role are re-read on every request. Suspending a tenant or
  deactivating a member takes effect immediately.
- Permissions are a fixed catalogue; roles are per tenant and editable. A
  member cannot grant permissions they do not hold, cannot edit their own
  role, and the last owner cannot be removed. Platform administration is a
  separate table the runtime role cannot write, so no tenant role reaches it.
- Support access is explicit: a platform admin requests it with a reason, a
  tenant owner approves a time window, the session is view-only and shows a
  banner on every page, and every step is in the tenant's audit log.
- CSRF: Server Actions accept only same-origin POSTs (Next.js checks Origin
  against Host), and the session cookie is `SameSite=Lax`.

## 6. Risks and how they are handled

| Risk | Mitigation | Residual |
| --- | --- | --- |
| A query forgets its tenant filter | Forced RLS returns nothing without the right context; policy-coverage test; lint rules | Low |
| Runtime role is misconfigured with broad rights | Startup check refuses to run; documented role setup | Low; depends on following the setup guide |
| Tenant context leaks across pooled connections | Transaction-local settings only; interleaving test | Low |
| A new table ships without RLS | `app_enable_tenant_rls` helper; coverage test fails CI | Low |
| Platform code path used from tenant code | Separate connection and role; lint boundary; small reviewed module | Low |
| Credential ciphertext moved between tenants | Per-tenant keys plus AAD binding | Low |
| Master key compromise | Key lives only in the platform secret store; versioned rotation | Rotation is manual; schedule it |
| Secrets in logs or errors | Audit redaction; sanitised provider errors; driver errors never logged raw | Low |
| Storefront served for the wrong tenant | Tenant derived only from host; `/s/…` unreachable by path; custom domains must pass a DNS check; unknown hosts 404 | Low |
| Domain squatting | Unverified claims are not unique and never resolve | Low |
| Cookie theft via a tenant sub-domain | Host-only `__Host-` cookie on the app host; storefronts carry no session | Request listing on the Public Suffix List before launch for defence in depth |
| Cached page shown to another tenant | Cache keys include tenant id; no shared caching of private responses; service worker excludes HTML and private routes | Low |
| Double booking | Advisory lock per bookable unit and capacity re-check in the booking transaction; concurrency test | Low |
| Plan limits bypassed from the client | Limits checked in the write transaction; plan columns unwritable by the runtime role | Low |
| Content-Security-Policy allows inline scripts | Needed without per-request nonces; everything else is locked to self and Cloudinary | Medium; revisit with nonces if pages can be dynamic |
| Abuse of public forms | Per-visitor, per-tenant rate limits in PostgreSQL | Add a challenge (e.g. Turnstile) if abuse appears |

## 7. Decisions that need the owner's input

1. **Theme colours.** The design's shared stylesheet was not part of the
   export, so exact colour values for the four themes were reconstructed from
   their descriptions (and checked for 4.5:1 contrast). If the original
   stylesheet is available, its values replace `src/app/themes.css`.
2. **Tour photos.** The design's images were not exported. Tenants upload
   their own; the demo seed needs licensed images.
3. **Neon role setup.** Whether roles created in the Neon console carry
   `BYPASSRLS` could not be confirmed from Neon's documentation here. The
   setup guide creates the runtime users with SQL, and the startup check
   catches a wrong choice either way.
4. **Subscription payments.** Plans, limits, subscriptions and invoices are
   complete with a manual billing provider. Charging cards for subscriptions
   needs the platform's own payment account and a provider adapter.
5. **Customer payments.** Bookings are requests confirmed by the business,
   as in the design. Online payment at booking is not in the design.

## 8. Phases

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Design analysis | Done: `docs/design/` |
| 2 | Tenancy, isolation, auth, RBAC, integration architecture | Done |
| 3 | Core application: schema, auth flows, registration, workspaces | Done |
| 4 | Tours, bookings, customers, reviews, media, storefront | Done |
| 5 | Runtime integrations, adapters, storage | Done (real provider accounts not yet exercised) |
| 6 | Platform administration, plans, usage | Done |
| 7 | PWA, motion, responsive polish | Done |
| 8 | Security, isolation, integration and end-to-end tests; production build | Done |

Verification at completion: 2,896 unit, integration and isolation tests
(99.26% statement coverage of server and library code), 23 browser tests
across the real hosts, `tsc` and ESLint clean, production build passing.
