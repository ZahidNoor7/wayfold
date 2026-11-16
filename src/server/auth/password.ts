import "server-only";
import { hash, verify } from "@node-rs/argon2";

// Argon2id (the library default algorithm) with OWASP's recommended minimums.
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    // Malformed or placeholder hash: treat as a failed login, not an error.
    return false;
  }
}

let decoy: Promise<string> | undefined;

/**
 * Spends the same work as a real verification when the account does not
 * exist, so response time does not reveal which e-mails are registered.
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  decoy ??= hashPassword("wayfold-decoy-password");
  await verifyPassword(await decoy, password);
}
