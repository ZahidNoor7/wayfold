"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Field, firstError, FormError, SubmitButton } from "@/components/form";
import { Panel } from "@/components/overlays";
import { useAction } from "@/hooks/use-action";
import { slugProblem } from "@/lib/platform-display";
import { createTenantAction } from "@/app/platform/(console)/tenants/actions";

const schema = z.object({
  name: z.string().trim().min(2, "Enter the business name.").max(80, "Keep the name under 80 characters."),
  slug: z
    .string()
    .trim()
    .superRefine((value, context) => {
      const problem = slugProblem(value);
      if (problem) context.addIssue({ code: "custom", message: problem });
    }),
  ownerEmail: z.string().trim().pipe(z.email("Enter a valid e-mail address.")),
  ownerName: z
    .string()
    .trim()
    .max(80, "Keep the name under 80 characters.")
    .refine((value) => value === "" || value.length >= 2, "Enter at least 2 characters, or leave it blank."),
  planCode: z.string(),
});
type FormValues = z.infer<typeof schema>;

interface CreateTenantProps {
  plans: { code: string; name: string; isDefault: boolean }[];
  /** Shown after the address, e.g. `wayfold.com`. */
  rootDomain: string;
  /** Open straight away, for links that mean "create one now". */
  defaultOpen?: boolean;
}

interface Created {
  tenantId: string;
  name: string;
  setupUrl: string;
}

export function CreateTenant({ plans, rootDomain, defaultOpen = false }: CreateTenantProps) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  /** Set only when the owner's setup e-mail could not be sent and the link must be handed over. */
  const [created, setCreated] = useState<Created | null>(null);

  const defaultPlan = plans.find((plan) => plan.isDefault)?.code ?? "";
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", slug: "", ownerEmail: "", ownerName: "", planCode: defaultPlan },
  });
  const { errors } = form.formState;
  const action = useAction(createTenantAction, { toastError: false });
  const slug = useWatch({ control: form.control, name: "slug" }).trim().toLowerCase();

  function close(next: boolean) {
    setOpen(next);
    if (next) return;
    setCreated(null);
    form.reset();
    action.reset();
    // Drop ?new=1 so a refresh does not reopen the panel.
    if (defaultOpen) router.replace("/platform/tenants");
  }

  const submit = form.handleSubmit(async (values) => {
    const result = await action.run({
      name: values.name,
      slug: values.slug || undefined,
      ownerEmail: values.ownerEmail,
      ownerName: values.ownerName || undefined,
      planCode: values.planCode || undefined,
    });
    if (!result.ok) return;
    if (result.data.setupUrl) {
      setCreated({ tenantId: result.data.tenantId, name: values.name, setupUrl: result.data.setupUrl });
      return;
    }
    toast.success(
      result.data.ownerCreated ? "Tenant created. The owner has been e-mailed a link to choose a password." : "Tenant created. The existing account is now its owner.",
    );
    setOpen(false);
    router.push(`/platform/tenants/${result.data.tenantId}`);
  });

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Setup link copied");
    } catch {
      toast.error("Copying is blocked in this browser. Select the link and copy it by hand.");
    }
  }

  return (
    <>
      <button type="button" className="btn btn-default" onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" />
        Create tenant
      </button>

      <Panel
        open={open}
        onOpenChange={close}
        title={created ? "Tenant created" : "Create tenant"}
        description={created ? undefined : "Sets up a workspace for a business and makes one person its owner."}
      >
        {created ? (
          <div className="flex flex-col gap-5 p-5 sm:p-6">
            <div role="alert" className="alert alert-warning">
              <p className="font-semibold">The setup e-mail could not be delivered.</p>
              <p className="mt-1">
                {created.name} exists, but its owner has not received a link to choose a password. Send them the link below another way. It works once, expires
                in 72 hours, and is not shown again after you close this panel.
              </p>
            </div>
            <Field label="Owner setup link">
              {(control) => <input {...control} className="input font-mono text-[13px]" readOnly value={created.setupUrl} onFocus={(event) => event.currentTarget.select()} />}
            </Field>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-default" onClick={() => copyLink(created.setupUrl)}>
                Copy link
              </button>
              <Link href={`/platform/tenants/${created.tenantId}`} className="btn btn-outline">
                Open tenant
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="flex flex-col gap-5 p-5 sm:p-6">
            <FormError message={action.fieldErrors ? null : action.error} />

            <Field label="Business name" error={errors.name?.message ?? firstError(action.fieldErrors, "name")}>
              {(control) => <input {...control} {...form.register("name")} className="input" autoComplete="off" />}
            </Field>

            <Field
              label="Workspace address"
              note="optional"
              error={errors.slug?.message ?? firstError(action.fieldErrors, "slug")}
              hint={slug && !errors.slug ? `The storefront will be at ${slug}.${rootDomain}` : `Leave blank to derive it from the name. It becomes the first part of the storefront address, before .${rootDomain}.`}
            >
              {(control) => (
                <input
                  {...control}
                  {...form.register("slug", { onChange: () => void form.trigger("slug") })}
                  className="input"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="caspian-trails"
                />
              )}
            </Field>

            <div className="separator" />

            <Field
              label="Owner e-mail"
              error={errors.ownerEmail?.message ?? firstError(action.fieldErrors, "ownerEmail")}
              hint="An existing account becomes the owner as it is. Otherwise an account is created and e-mailed a link to choose a password."
            >
              {(control) => <input {...control} {...form.register("ownerEmail")} className="input" type="email" autoComplete="off" spellCheck={false} />}
            </Field>

            <Field
              label="Owner name"
              note="optional"
              error={errors.ownerName?.message ?? firstError(action.fieldErrors, "ownerName")}
              hint="Used only when a new account is created."
            >
              {(control) => <input {...control} {...form.register("ownerName")} className="input" autoComplete="off" />}
            </Field>

            <Field label="Plan" error={firstError(action.fieldErrors, "planCode")}>
              {(control) => (
                <select {...control} {...form.register("planCode")} className="select">
                  {plans.map((plan) => (
                    <option key={plan.code} value={plan.code}>
                      {plan.name}
                      {plan.isDefault ? " (default)" : ""}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className="btn btn-outline" onClick={() => close(false)} disabled={action.pending}>
                Cancel
              </button>
              <SubmitButton pending={action.pending} pendingLabel="Creating">
                Create tenant
              </SubmitButton>
            </div>
          </form>
        )}
      </Panel>
    </>
  );
}
