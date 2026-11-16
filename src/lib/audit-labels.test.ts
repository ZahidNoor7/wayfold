import { describe, expect, it } from "vitest";
import {
  AUDIT_AREAS,
  auditActionLabel,
  auditTargetLabel,
  formatMetadataValue,
  humaniseKey,
  isAuditArea,
  isSupportActivity,
  metadataRows,
} from "./audit-labels";

describe("auditActionLabel", () => {
  it("turns known codes into sentences", () => {
    expect(auditActionLabel("integration.credentials_rotated")).toBe("Replaced an integration's credentials");
    expect(auditActionLabel("booking.confirmed")).toBe("Confirmed a booking");
    expect(auditActionLabel("support.session_started")).toBe("Started a support session");
  });

  it("falls back to the raw code", () => {
    expect(auditActionLabel("something.brand_new")).toBe("something.brand_new");
    // Not fooled by properties every object has.
    expect(auditActionLabel("constructor")).toBe("constructor");
  });
});

describe("areas", () => {
  it("are unique prefixes without dots", () => {
    const values = AUDIT_AREAS.map((area) => area.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values.every((value) => /^[a-z_]+$/.test(value))).toBe(true);
  });

  it("recognises only listed areas", () => {
    expect(isAuditArea("booking")).toBe(true);
    expect(isAuditArea("bookings")).toBe(false);
    expect(isAuditArea(undefined)).toBe(false);
  });
});

describe("isSupportActivity", () => {
  it("marks support sessions and support-access events", () => {
    expect(isSupportActivity({ action: "tour.updated", actorType: "support_session" })).toBe(true);
    expect(isSupportActivity({ action: "support.access_approved", actorType: "user" })).toBe(true);
    expect(isSupportActivity({ action: "tour.updated", actorType: "user" })).toBe(false);
  });
});

describe("auditTargetLabel", () => {
  it("is null without a target", () => {
    expect(auditTargetLabel({ targetType: null, metadata: { reference: "X" } })).toBeNull();
  });

  it("names the target from its metadata when it can", () => {
    expect(auditTargetLabel({ targetType: "booking", metadata: { reference: "AB-4821" } })).toBe("Booking AB-4821");
    expect(auditTargetLabel({ targetType: "tour", metadata: { title: "  Old City Walk " } })).toBe("Tour Old City Walk");
    expect(auditTargetLabel({ targetType: "invoice", metadata: { number: 42 } })).toBe("Invoice 42");
    expect(auditTargetLabel({ targetType: "membership", metadata: { userId: "u" } })).toBe("Team member");
  });

  it("humanises unknown target types", () => {
    expect(auditTargetLabel({ targetType: "gift_card", metadata: { name: "" } })).toBe("Gift card");
  });
});

describe("humaniseKey", () => {
  it("splits camelCase, snake_case and dotted keys", () => {
    expect(humaniseKey("fromRole")).toBe("From role");
    expect(humaniseKey("role_id")).toBe("Role ID");
    expect(humaniseKey("toRoleId")).toBe("To role ID");
    expect(humaniseKey("callback.url")).toBe("Callback URL");
    expect(humaniseKey("ip")).toBe("IP");
  });

  it("keeps a key it cannot split", () => {
    expect(humaniseKey("__")).toBe("__");
  });
});

describe("formatMetadataValue", () => {
  it("formats every kind of value", () => {
    expect(formatMetadataValue(null)).toBe("—");
    expect(formatMetadataValue(undefined)).toBe("—");
    expect(formatMetadataValue("")).toBe("—");
    expect(formatMetadataValue(true)).toBe("Yes");
    expect(formatMetadataValue(false)).toBe("No");
    expect(formatMetadataValue("[redacted]")).toBe("[redacted]");
    expect(formatMetadataValue(3)).toBe("3");
    expect(formatMetadataValue([])).toBe("None");
    expect(formatMetadataValue(["tours.view", "tours.manage"])).toBe("tours.view, tours.manage");
    expect(formatMetadataValue([{ a: 1 }])).toBe('[{"a":1}]');
    expect(formatMetadataValue({ a: 1 })).toBe('{"a":1}');
  });
});

describe("metadataRows", () => {
  it("lists key/value rows in order", () => {
    expect(metadataRows({ fromRole: "Staff", secret: "[redacted]" })).toEqual([
      { key: "fromRole", label: "From role", value: "Staff" },
      { key: "secret", label: "Secret", value: "[redacted]" },
    ]);
  });

  it("is empty without metadata", () => {
    expect(metadataRows(null)).toEqual([]);
    expect(metadataRows(undefined)).toEqual([]);
    expect(metadataRows({})).toEqual([]);
  });
});
