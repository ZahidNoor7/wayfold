import "server-only";
import { z } from "zod";

/**
 * Infrastructure-level configuration only.
 *
 * Tenant integrations (Cloudinary, SMTP, Stripe, Maps, ...) are NEVER read from
 * the environment. They live encrypted in the `integrations` table and are
 * resolved per tenant at runtime by `src/server/integrations`.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  /** Runtime role: NOBYPASSRLS, not a table owner. Every tenant query uses it. */
  DATABASE_URL: z.string().min(1),
  /** Platform-admin role: BYPASSRLS. Only `src/server/platform` may use it. */
  DATABASE_PLATFORM_URL: z.string().min(1),
  /** `neon` = @neondatabase/serverless WebSocket pool, `pg` = node-postgres. */
  DATABASE_DRIVER: z.enum(["neon", "pg"]).default("neon"),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),

  /** Root domain tenants hang off, e.g. `wayfold.com` or `localhost:3000`. */
  ROOT_DOMAIN: z.string().min(1),
  /** Host that serves the dashboard, auth and platform admin. */
  APP_HOST: z.string().min(1),
  /** Public origin of the app host, e.g. `https://app.wayfold.com`. */
  APP_URL: z.url(),

  /** Pepper mixed into session/token hashes. 32+ random bytes, base64. */
  SESSION_SECRET: z.string().min(32),

  /**
   * Master keys for tenant credential encryption, as `v1:<base64 32 bytes>`
   * entries separated by commas. Old versions stay listed so existing
   * ciphertexts decrypt during rotation.
   */
  CREDENTIAL_ENCRYPTION_KEYS: z.string().min(1),
  /** Version used for new ciphertexts, e.g. `v2`. */
  CREDENTIAL_ENCRYPTION_ACTIVE_KEY: z.string().regex(/^v\d+$/),

  /** Bearer secret for scheduled jobs. Jobs are disabled when it is unset. */
  CRON_SECRET: z.string().min(24).optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    // Names only: values may be secrets and must not reach logs.
    const names = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid or missing environment configuration: ${names}`);
  }
  return result.data;
}

export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Test hook: forget the parsed environment. */
export function resetEnvCache(): void {
  cached = undefined;
}
