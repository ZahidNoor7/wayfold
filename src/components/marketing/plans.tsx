import { Check } from "lucide-react";
import { connection } from "next/server";
import { SUPPORT_EMAIL, supportMailto } from "@/components/auth/support";
import { listPublicPlans } from "@/server/billing/overview";
import { isFreePlan, planFeatures, planLimits, planPrice } from "./plan-format";
import { appUrl } from "./urls";

/**
 * The public plans, read from the database on each request so a price or
 * limit changed by the platform is never out of date here. Render inside a
 * `<Suspense>` boundary with `PlansSkeleton` as its fallback.
 */
export async function Plans() {
  await connection();
  const plans = await listPublicPlans();
  const register = appUrl("/register");

  if (plans.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center sm:p-14">
        <p className="font-display text-3xl text-primary">Plans are being updated</p>
        <p className="mx-auto mt-2 max-w-md text-muted-foreground">
          Write to{" "}
          <a href={supportMailto("Wayfold plans")} className="font-semibold text-eyebrow underline underline-offset-4">
            {SUPPORT_EMAIL}
          </a>{" "}
          and we will tell you what is available.
        </p>
      </div>
    );
  }

  const hasFree = plans.some(isFreePlan);

  return (
    <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {plans.map((plan) => {
        const price = planPrice(plan);
        const free = isFreePlan(plan);
        const features = planFeatures(plan);
        return (
          <li key={plan.id} className="card flex flex-col p-6 sm:p-7">
            <h3 className="font-display text-[28px] font-semibold leading-tight text-primary">{plan.name}</h3>
            {plan.description ? <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{plan.description}</p> : null}

            <p className="mt-6 flex flex-wrap items-baseline gap-x-2">
              <span className="font-display text-5xl leading-none text-primary">{price.amount}</span>
              {price.period ? <span className="text-sm text-muted-foreground">{price.period}</span> : null}
            </p>
            <p className="mt-1.5 min-h-5 text-[13px] text-muted-foreground">{price.yearly ?? (free ? "No card needed" : "")}</p>

            <ul className="mt-6 flex flex-col gap-2.5 border-t pt-6 text-sm">
              {planLimits(plan).map((line) => (
                <li key={line} className="flex gap-2.5">
                  <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-eyebrow" />
                  <span className="font-semibold">{line}</span>
                </li>
              ))}
              {features.map((line) => (
                <li key={line} className="flex gap-2.5">
                  <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-eyebrow" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>

            <div className="mt-auto flex flex-col gap-2 pt-7">
              {free ? (
                <a href={register} className="btn btn-default btn-lg w-full">
                  Start free
                </a>
              ) : hasFree ? (
                <>
                  <a href={register} className="btn btn-outline btn-lg w-full">
                    Start free, upgrade later
                  </a>
                  <p className="text-center text-[13px] text-muted-foreground">
                    or{" "}
                    <a href={supportMailto(`Wayfold ${plan.name} plan`)} className="font-semibold text-primary underline underline-offset-4">
                      contact us
                    </a>{" "}
                    about {plan.name}
                  </p>
                </>
              ) : (
                <a href={supportMailto(`Wayfold ${plan.name} plan`)} className="btn btn-outline btn-lg w-full">
                  Contact us
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function PlansSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading plans" className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="card flex flex-col gap-4 p-6 sm:p-7">
          <div className="skeleton h-8 w-32" />
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-12 w-28" />
          <div className="mt-4 flex flex-col gap-3 border-t pt-6">
            {Array.from({ length: 5 }, (_, row) => (
              <div key={row} className="skeleton h-4" />
            ))}
          </div>
          <div className="skeleton mt-4 h-12" />
        </div>
      ))}
    </div>
  );
}
