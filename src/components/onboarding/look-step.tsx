"use client";

import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { saveOnboardingLookAction } from "@/app/onboarding/actions";
import { FormError, SubmitButton } from "@/components/form";
import { StorefrontPreview } from "@/components/marketing/storefront-preview";
import { useAction } from "@/hooks/use-action";
import type { AppearanceChoice } from "./appearance-options";
import { FontPicker, ModePicker, RadiusPicker, ThemePicker } from "./appearance-pickers";

interface LookStepProps {
  initial: AppearanceChoice;
  workspaceName: string;
  address: string;
  /** False when the member's role cannot change branding: preview only. */
  canSave: boolean;
  onSaved: (choice: AppearanceChoice) => void;
  onSkip: () => void;
  onBack: () => void;
}

/** Two words for the theme cards' miniature hero, taken from the business name. */
function brandWords(name: string): readonly [string, string] {
  const words = name.trim().split(/\s+/);
  if (words.length < 2) return [words[0] || "Your", "Tours"];
  return [words[0]!, words.slice(1).join(" ")];
}

export function LookStep({ initial, workspaceName, address, canSave, onSaved, onSkip, onBack }: LookStepProps) {
  const [choice, setChoice] = useState<AppearanceChoice>(initial);
  const { run, pending, error } = useAction(saveOnboardingLookAction, { toastError: false, success: "Look and feel saved" });

  async function save() {
    const result = await run(choice);
    if (result.ok) onSaved(choice);
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <FormError message={error} />
      {canSave ? null : (
        <p className="alert alert-warning">Your role cannot change the look of this workspace. You can try the options here; an owner or administrator can save them.</p>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-7">
          <ThemePicker
            value={choice.theme}
            mode={choice.mode}
            brand={brandWords(workspaceName)}
            onChange={(theme) => setChoice((current) => ({ ...current, theme }))}
          />
          <ModePicker value={choice.mode} onChange={(mode) => setChoice((current) => ({ ...current, mode }))} />
          <div className="grid gap-7 md:grid-cols-2">
            <RadiusPicker value={choice.radius} onChange={(radius) => setChoice((current) => ({ ...current, radius }))} />
            <FontPicker value={choice.font} onChange={(font) => setChoice((current) => ({ ...current, font }))} />
          </div>
        </div>

        <aside aria-label="Live preview" className="min-w-0 lg:sticky lg:top-8">
          <p className="label mb-3">Live preview</p>
          <StorefrontPreview appearance={choice} name={workspaceName} address={address} />
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Example content. Your own tours, photos and words appear here once you add them.</p>
        </aside>
      </div>

      <div className="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:items-center">
        <button type="button" className="btn btn-ghost btn-lg sm:mr-auto" onClick={onBack} disabled={pending}>
          <ArrowLeft aria-hidden="true" />
          Back
        </button>
        <button type="button" className="btn btn-ghost btn-lg" onClick={onSkip} disabled={pending}>
          {canSave ? "Skip for now" : "Continue"}
        </button>
        {canSave ? (
          <SubmitButton pending={pending} pendingLabel="Saving…" className="btn-lg">
            Save and continue
          </SubmitButton>
        ) : null}
      </div>
    </form>
  );
}
