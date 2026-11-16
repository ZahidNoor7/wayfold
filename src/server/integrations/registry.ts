import "server-only";
import type { IntegrationCategory, ProviderAdapter } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- adapters are heterogeneous by design
type AnyAdapter = ProviderAdapter<any, any>;

const adapters = new Map<string, AnyAdapter>();

export function registerAdapter(adapter: AnyAdapter): void {
  if (!/^[a-z][a-z0-9_]{1,30}$/.test(adapter.id)) throw new Error(`Invalid adapter id: ${adapter.id}`);
  if (adapters.has(adapter.id)) throw new Error(`Adapter ${adapter.id} is already registered`);
  for (const field of adapter.fields) {
    if (field.type === "password" && !field.secret) {
      throw new Error(`Adapter ${adapter.id}: password field ${field.key} must be marked secret`);
    }
  }
  adapters.set(adapter.id, adapter);
}

export function getAdapter(id: string): AnyAdapter | undefined {
  return adapters.get(id);
}

export function listAdapters(category?: IntegrationCategory): AnyAdapter[] {
  const all = [...adapters.values()];
  return category ? all.filter((adapter) => adapter.category === category) : all;
}

/** Test hook. */
export function clearAdapters(): void {
  adapters.clear();
}
