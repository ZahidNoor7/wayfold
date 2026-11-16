import { describe, expect, it } from "vitest";
import { isAutomatedSubmission, MIN_HUMAN_FILL_MS } from "./spam-trap";

describe("isAutomatedSubmission", () => {
  it("lets through anything with an empty trap, however fast", () => {
    expect(isAutomatedSubmission({ trap: "", elapsedMs: 10 })).toBe(false);
    expect(isAutomatedSubmission({ trap: "   ", elapsedMs: 10 })).toBe(false);
    expect(isAutomatedSubmission({ trap: undefined })).toBe(false);
    expect(isAutomatedSubmission({ trap: null, elapsedMs: null })).toBe(false);
  });

  it("blocks a filled trap sent faster than a person could type", () => {
    expect(isAutomatedSubmission({ trap: "buy now", elapsedMs: 0 })).toBe(true);
    expect(isAutomatedSubmission({ trap: "buy now", elapsedMs: MIN_HUMAN_FILL_MS - 1 })).toBe(true);
  });

  it("blocks a filled trap with no timing, which only a script leaves out", () => {
    expect(isAutomatedSubmission({ trap: "buy now" })).toBe(true);
    expect(isAutomatedSubmission({ trap: "buy now", elapsedMs: null })).toBe(true);
    expect(isAutomatedSubmission({ trap: "buy now", elapsedMs: Number.NaN })).toBe(true);
  });

  it("keeps a filled trap from someone who took their time (autofill on a real visitor)", () => {
    expect(isAutomatedSubmission({ trap: "Anna", elapsedMs: MIN_HUMAN_FILL_MS })).toBe(false);
    expect(isAutomatedSubmission({ trap: "Anna", elapsedMs: 45_000 })).toBe(false);
  });
});
