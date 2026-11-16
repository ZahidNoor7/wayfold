import { clearServiceWorkerCaches } from "@/components/pwa/service-worker";

/**
 * Clears this origin's service-worker caches on sign-in, sign-out and
 * workspace switch, without ever holding the person up.
 *
 * `clearServiceWorkerCaches` waits for an active worker, and that wait never
 * ends where none is registered (development, a first visit, browsers without
 * support). So: no active worker means nothing was cached and there is
 * nothing to wait for; with one, the clear gets a short head start.
 */
export async function clearCachesBriefly(limitMs = 400): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  let active = false;
  try {
    active = Boolean((await navigator.serviceWorker.getRegistration())?.active);
  } catch {
    active = false;
  }
  if (!active) return;
  await Promise.race([clearServiceWorkerCaches(), new Promise<void>((resolve) => window.setTimeout(resolve, limitMs))]);
}

/**
 * Leaves for `path` with a full page load after an account or workspace
 * change, so nothing rendered or cached for the previous one is reused.
 */
export async function leaveTo(path: string): Promise<void> {
  await clearCachesBriefly();
  window.location.assign(path);
}
