"use client";

import { useEffect } from "react";
import { toast } from "sonner";

/**
 * Registers the service worker and tells the user when a new version of the
 * app is ready, instead of swapping code under an open page.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;

    let refreshing = false;
    const onControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };

    const offerUpdate = (worker: ServiceWorker) => {
      toast("A new version of Wayfold is ready.", {
        duration: Infinity,
        action: { label: "Update", onClick: () => worker.postMessage({ type: "SKIP_WAITING" }) },
      });
    };

    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        // A worker already waiting means an update arrived while the tab was closed.
        if (registration.waiting && navigator.serviceWorker.controller) offerUpdate(registration.waiting);

        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            // `controller` is null on the very first install: nothing to update from.
            if (installing.state === "installed" && navigator.serviceWorker.controller) offerUpdate(installing);
          });
        });

        // Long-lived tabs (an installed dashboard) check hourly and on return.
        const check = () => void registration.update().catch(() => {});
        const interval = window.setInterval(check, 60 * 60 * 1000);
        const onVisible = () => document.visibilityState === "visible" && check();
        document.addEventListener("visibilitychange", onVisible);
        navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
        cleanup = () => {
          window.clearInterval(interval);
          document.removeEventListener("visibilitychange", onVisible);
          navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
        };
      })
      .catch(() => {
        // Registration failing must never break the page.
      });

    let cleanup = () => {};
    return () => cleanup();
  }, []);

  return null;
}

/**
 * Drops every runtime cache held by this origin's service worker. Call on
 * sign-out and when switching workspace, so nothing fetched for one account
 * or workspace is ever served to the next.
 */
export async function clearServiceWorkerCaches(): Promise<void> {
  try {
    if ("serviceWorker" in navigator) {
      // getRegistration (unlike `ready`) settles even when no worker exists.
      const registration = await navigator.serviceWorker.getRegistration();
      registration?.active?.postMessage({ type: "CLEAR_CACHES" });
    }
    if ("caches" in window) {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => !name.endsWith("-shell")).map((name) => caches.delete(name)));
    }
  } catch {
    // Best effort: the server-side session is already gone.
  }
}
