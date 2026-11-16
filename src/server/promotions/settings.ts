import "server-only";
import { recordAudit } from "../audit";
import { assertFeature } from "../billing/limits";
import type { TenantScope } from "../db/context";
import { getPromotionSettings, promotionSettingsSchema, updatePromotionSettings, type PromotionSettings } from "../settings/tenant-settings";
import { parse } from "./shared";

/** Any subset of the settings; fields left out keep their current value. */
export type PromotionSettingsPatch = Partial<PromotionSettings>;

/**
 * Changes the discount-request rules. Lowering the maximum does not reject
 * requests already waiting; they can then only be approved up to the new
 * maximum, which `approveDiscountRequest` enforces at decision time.
 */
export async function changePromotionSettings(scope: TenantScope, input: PromotionSettingsPatch): Promise<PromotionSettings> {
  await assertFeature(scope, "promotions");
  const before = await getPromotionSettings(scope);
  // Validated as a whole document: the schema's defaults would otherwise fill
  // in, and so silently reset, any field a patch left out or sent as undefined.
  const supplied = Object.fromEntries(Object.entries(input ?? {}).filter(([, value]) => value !== undefined));
  const next = parse(promotionSettingsSchema.strict(), { ...before, ...supplied });
  const after = await updatePromotionSettings(scope, next);

  const changed = (Object.keys(after) as (keyof PromotionSettings)[]).filter((key) => before[key] !== after[key]);
  if (changed.length > 0) {
    await recordAudit(scope, {
      action: "promotions.settings_changed",
      targetType: "promotion_settings",
      // Which settings changed, not their values: the request maximum is private.
      metadata: { changed },
    });
  }
  return after;
}
