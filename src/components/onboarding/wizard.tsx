"use client";

import { ArrowLeft, ArrowRight, Check, Map as MapIcon, Plug, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ComponentType, type SVGProps } from "react";
import { finishOnboardingAction } from "@/app/onboarding/actions";
import { FormError } from "@/components/form";
import { SwapIn } from "@/components/motion";
import { Spinner } from "@/components/overlays";
import { useAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import { themeName, type AppearanceChoice } from "./appearance-options";
import { LookStep } from "./look-step";
import { ProfileStep, type ProfileValues } from "./profile-step";

const STEPS = [
  { title: "Business profile", lead: "What guests should know about you, and how they reach you." },
  { title: "Look and feel", lead: "Pick a theme for your website and this workspace. Nothing here is permanent." },
  { title: "First steps", lead: "Choose where to begin. Each one finishes setup and takes you straight there." },
  { title: "Finish", lead: "Check what you have set up, then open your workspace." },
] as const;

interface FirstStep {
  key: "tours" | "integrations" | "team";
  href: string;
  title: string;
  detail: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}

const FIRST_STEPS: readonly FirstStep[] = [
  {
    key: "tours",
    href: "/workspace/tours/new",
    title: "Add your first tour",
    detail: "Write the itinerary, set a price and publish it to your website.",
    Icon: MapIcon,
  },
  {
    key: "integrations",
    href: "/workspace/settings/integrations",
    title: "Connect your services",
    detail: "Your own e-mail for notifications, photo storage, maps and payments.",
    Icon: Plug,
  },
  {
    key: "team",
    href: "/workspace/team",
    title: "Invite your team",
    detail: "Give colleagues their own sign-in and a role that fits their job.",
    Icon: Users,
  },
];

interface OnboardingWizardProps {
  workspaceName: string;
  /** The website address, e.g. `sunrise-tours.wayfold.com`. */
  address: string;
  profile: ProfileValues;
  ownerEmail: string;
  appearance: AppearanceChoice;
  currencies: { code: string; name: string }[];
  timezones: string[];
  access: { branding: boolean; tours: boolean; integrations: boolean; team: boolean };
}

export function OnboardingWizard({ workspaceName, address, profile, ownerEmail, appearance, currencies, timezones, access }: OnboardingWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  // What has been saved so far, so going back shows it and the last step can list it.
  const [savedProfile, setSavedProfile] = useState<ProfileValues | null>(null);
  const [savedLook, setSavedLook] = useState<AppearanceChoice | null>(null);
  const [destination, setDestination] = useState<string | null>(null);
  const { run, pending, error } = useAction(finishOnboardingAction, { toastError: false, success: "Setup finished" });
  const heading = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);

  // Each step is new content in the same place: move focus to its heading.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    heading.current?.focus();
  }, [step]);

  const busy = pending || destination !== null;

  async function finish(href: string) {
    if (busy) return;
    setDestination(href);
    const result = await run({});
    if (result.ok) {
      router.push(href);
      return;
    }
    setDestination(null);
  }

  const current = STEPS[step]!;
  const firstSteps = FIRST_STEPS.filter((item) => access[item.key]);
  const profileInitial: ProfileValues = savedProfile ?? { ...profile, email: profile.email || ownerEmail };

  return (
    <div className={cn("mx-auto flex flex-col gap-8", step === 1 ? "max-w-5xl" : "max-w-3xl")}>
      <header>
        <p className="text-sm font-semibold text-eyebrow">
          Step {step + 1} of {STEPS.length}
        </p>
        <h1 className="mt-1 break-words font-display text-3xl font-semibold leading-tight text-primary sm:text-4xl">Set up {workspaceName}</h1>
        <div
          className="progress mt-5"
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
          aria-valuenow={step + 1}
          aria-valuetext={`Step ${step + 1} of ${STEPS.length}: ${current.title}`}
        >
          <div
            className="h-full origin-left rounded-full bg-primary transition-transform duration-500 ease-out-soft"
            style={{ transform: `scaleX(${(step + 1) / STEPS.length})` }}
          />
        </div>
        <ol className="mt-3 hidden grid-cols-4 gap-2 text-xs font-semibold text-muted-foreground sm:grid">
          {STEPS.map((item, index) => (
            <li key={item.title} aria-current={index === step ? "step" : undefined} className={cn("flex items-center gap-1.5", index <= step ? "text-primary" : null)}>
              {index < step ? <Check aria-hidden="true" className="size-3.5" /> : null}
              {item.title}
            </li>
          ))}
        </ol>
      </header>

      <SwapIn key={step} className="card p-6 sm:p-9">
        <div className="mb-7">
          <h2 ref={heading} tabIndex={-1} className="font-display text-2xl font-semibold leading-tight text-primary outline-none sm:text-3xl">
            {current.title}
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground sm:text-[15px]">{current.lead}</p>
        </div>

        {step === 0 ? (
          <ProfileStep
            initial={profileInitial}
            currencies={currencies}
            timezones={timezones}
            detectTimezone={savedProfile === null && profile.timezone === "UTC"}
            onSaved={(values) => {
              setSavedProfile(values);
              setStep(1);
            }}
            onSkip={() => setStep(1)}
          />
        ) : null}

        {step === 1 ? (
          <LookStep
            initial={savedLook ?? appearance}
            workspaceName={workspaceName}
            address={address}
            canSave={access.branding}
            onSaved={(choice) => {
              setSavedLook(choice);
              setStep(2);
            }}
            onSkip={() => setStep(2)}
            onBack={() => setStep(0)}
          />
        ) : null}

        {step === 2 ? (
          <div className="flex flex-col gap-6">
            <FormError message={error} />
            {firstSteps.length > 0 ? (
              <ul className="flex flex-col gap-3">
                {firstSteps.map(({ key, href, title, detail, Icon }) => {
                  const going = destination === href;
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        className="group flex w-full items-center gap-4 rounded-xl border-2 border-border bg-card p-4 text-left transition-[border-color,transform] duration-150 hover:border-ring active:scale-[0.99] disabled:pointer-events-none disabled:opacity-60 sm:p-5"
                        disabled={busy}
                        aria-busy={going || undefined}
                        onClick={() => finish(href)}
                      >
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
                          <Icon aria-hidden="true" className="size-5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-bold">{title}</span>
                          <span className="mt-0.5 block text-sm leading-relaxed text-muted-foreground">{detail}</span>
                        </span>
                        {going ? <Spinner className="size-5 shrink-0 text-primary" /> : <ArrowRight aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm leading-relaxed text-muted-foreground">Your workspace is ready to open. Continue to finish setup.</p>
            )}
            <p className="text-sm leading-relaxed text-muted-foreground">Not sure yet? Continue, and find all of these in your workspace menu whenever you are ready.</p>
            <div className="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
              <button type="button" className="btn btn-ghost btn-lg" onClick={() => setStep(1)} disabled={busy}>
                <ArrowLeft aria-hidden="true" />
                Back
              </button>
              <button type="button" className="btn btn-default btn-lg" onClick={() => setStep(3)} disabled={busy}>
                Continue
              </button>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="flex flex-col gap-6">
            <FormError message={error} />
            <dl className="divide-y rounded-lg border text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3.5">
                <dt className="text-muted-foreground">Website address</dt>
                <dd className="break-all font-semibold">{address}</dd>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3.5">
                <dt className="text-muted-foreground">Business profile</dt>
                <dd className="font-semibold">
                  {savedProfile ? `Saved · ${savedProfile.currency}, ${savedProfile.timezone.replaceAll("_", " ")}` : "Skipped. Add it in Settings."}
                </dd>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3.5">
                <dt className="text-muted-foreground">Look and feel</dt>
                <dd className="font-semibold">{savedLook ? `Saved · ${themeName(savedLook.theme)}` : `${themeName(appearance.theme)} theme. Change it in Settings.`}</dd>
              </div>
            </dl>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Finishing also adds a starter set of tour categories, which you can rename or remove.
            </p>
            <div className="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
              <button type="button" className="btn btn-ghost btn-lg" onClick={() => setStep(2)} disabled={busy}>
                <ArrowLeft aria-hidden="true" />
                Back
              </button>
              <button type="button" className="btn btn-default btn-lg" disabled={busy} aria-busy={busy || undefined} onClick={() => finish("/workspace")}>
                {busy ? <Spinner /> : null}
                Finish and open workspace
              </button>
            </div>
          </div>
        ) : null}
      </SwapIn>
    </div>
  );
}
