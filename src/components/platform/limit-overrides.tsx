"use client";

import { useState, type FormEvent } from "react";
import { FormError, SubmitButton } from "@/components/form";
import { Panel } from "@/components/overlays";
import { LimitField } from "@/components/platform/controls";
import { useAction } from "@/hooks/use-action";
import { formatLimit, LIMIT_KEYS, LIMIT_LABELS, limitDraft, overridesFromDrafts, type LimitDrafts, type LimitKey } from "@/lib/platform-display";
import { setLimitOverridesAction } from "@/app/platform/(console)/tenants/actions";

type Limits = Record<LimitKey, number | null>;
type Overrides = Partial<Record<LimitKey, number | null>>;

function draftsFrom(overrides: Overrides): LimitDrafts {
  return Object.fromEntries(LIMIT_KEYS.map((key) => [key, limitDraft(overrides[key])])) as LimitDrafts;
}

/** Per-workspace exceptions to the plan's limits. */
export function LimitOverridesButton({ tenantId, planName, planLimits, overrides }: { tenantId: string; planName: string; planLimits: Limits; overrides: Overrides }) {
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<LimitDrafts>(() => draftsFrom(overrides));
  const [errors, setErrors] = useState<Partial<Record<LimitKey, string>>>({});
  const action = useAction(setLimitOverridesAction, { toastError: false, success: "Limit overrides saved" });

  function change(next: boolean) {
    setOpen(next);
    if (next) {
      setDrafts(draftsFrom(overrides));
      setErrors({});
    } else action.reset();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = overridesFromDrafts(drafts);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    const result = await action.run({ tenantId, overrides: parsed.overrides });
    if (result.ok) setOpen(false);
  }

  return (
    <>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => change(true)}>
        Edit overrides
      </button>
      <Panel
        open={open}
        onOpenChange={change}
        title="Limit overrides"
        description={`Exceptions to the ${planName} plan for this workspace only. They stay in place when the plan changes.`}
      >
        <form onSubmit={submit} noValidate className="flex flex-col gap-6 p-5 sm:p-6">
          <FormError message={action.fieldErrors ? null : action.error} />
          {LIMIT_KEYS.map((key) => (
            <LimitField
              key={key}
              label={LIMIT_LABELS[key].label}
              hint={`In ${LIMIT_LABELS[key].unit}. The plan allows ${formatLimit(planLimits[key]).toLowerCase()}. Leave blank to follow the plan.`}
              placeholder={`Plan default: ${formatLimit(planLimits[key])}`}
              draft={drafts[key]}
              error={errors[key] ?? action.fieldErrors?.[key]?.[0]}
              onChange={(draft) => {
                setDrafts((previous) => ({ ...previous, [key]: draft }));
                if (errors[key]) setErrors((previous) => ({ ...previous, [key]: undefined }));
              }}
            />
          ))}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className="btn btn-outline" onClick={() => change(false)} disabled={action.pending}>
              Cancel
            </button>
            <SubmitButton pending={action.pending} pendingLabel="Saving">
              Save overrides
            </SubmitButton>
          </div>
        </form>
      </Panel>
    </>
  );
}
