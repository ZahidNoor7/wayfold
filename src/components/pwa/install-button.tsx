"use client";

import { Download } from "lucide-react";
import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * "Install app" button. Renders only when the browser says the app can be
 * installed, and disappears once it has been.
 */
export function InstallButton({ className = "btn btn-outline btn-sm", label = "Install app" }: { className?: string; label?: string }) {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setPrompt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!prompt) return null;
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        await prompt.prompt();
        await prompt.userChoice;
        setPrompt(null);
      }}
    >
      <Download aria-hidden="true" />
      {label}
    </button>
  );
}
