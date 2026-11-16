import { describe, expect, it } from "vitest";
import { z } from "zod";
import { guardedWrite, likePattern, parseInput, pgErrorOf, plainText, requireId, slugify, toFieldErrors } from "@/server/content/shared";
import { reviews, roles } from "@/server/db/schema";
import { createTenant, randomId } from "../../helpers/fixtures";
import { asOwner, failure } from "./seed";

describe("plainText", () => {
  it("collapses whitespace on single-line fields and keeps paragraphs on multi-line ones", () => {
    expect(plainText(50).parse("  Private \t tours\nin   Baku ")).toBe("Private tours in Baku");
    expect(plainText(50, { multiline: true }).parse("  One\r\nTwo\rThree\n\nFour  ")).toBe("One\nTwo\nThree\n\nFour");
  });

  it("drops control characters", () => {
    expect(plainText(50).parse("Ba\u0000ku\u001b[31m")).toBe("Baku[31m");
    expect(plainText(50, { multiline: true }).parse("Ba\u0000ku\u0007\n\tTabbed")).toBe("Baku\n\tTabbed");
  });

  it("refuses markup but allows ordinary angle brackets", () => {
    for (const value of ["<b>bold</b>", "<img src=x onerror=alert(1)>", "</div>", "<!-- note -->", "<A HREF='x'>"]) {
      expect(plainText(200).safeParse(value).success, value).toBe(false);
    }
    for (const value of ["2 < 3", "a > b", "I <3 Baku", "x <- y", "5<6"]) {
      expect(plainText(200).safeParse(value).success, value).toBe(true);
    }
  });

  it("enforces length after cleaning, with readable messages", () => {
    expect(plainText(5).safeParse("  abcde  ").success).toBe(true);
    expect(plainText(5).safeParse("abcdef").error?.issues[0]?.message).toBe("Keep this under 5 characters.");
    expect(plainText(20, { min: 3 }).safeParse(" a ").error?.issues[0]?.message).toBe("Use at least 3 characters.");
    expect(plainText(20, { min: 3, minMessage: "Add a name." }).safeParse("").error?.issues[0]?.message).toBe("Add a name.");
    expect(plainText(20).safeParse(42).success).toBe(false);
  });
});

describe("validation helpers", () => {
  it("keys field errors by dotted path and form-level errors by `form`", () => {
    const schema = z.object({ seo: z.object({ home: z.object({ title: z.string().max(3, "Too long.") }) }), list: z.array(z.number("Not a number.")) });
    const result = schema.safeParse({ seo: { home: { title: "abcd" } }, list: [1, "two"] });
    expect(toFieldErrors(result.error!)).toEqual({ "seo.home.title": ["Too long."], "list.1": ["Not a number."] });

    const whole = z.object({ a: z.number() }).refine(() => false, "Whole form is wrong.").safeParse({ a: 1 });
    expect(toFieldErrors(whole.error!)).toEqual({ form: ["Whole form is wrong."] });
  });

  it("throws a ValidationError from parseInput and returns parsed data otherwise", async () => {
    expect(parseInput(z.object({ n: z.number() }), { n: 1, extra: true })).toEqual({ n: 1 });
    expect(await failure(async () => parseInput(z.object({ n: z.number("Number, please.") }), { n: "1" }))).toEqual({
      name: "ValidationError",
      code: "validation",
      fieldErrors: { n: ["Number, please."] },
    });
  });

  it("treats anything that is not a UUID as an id that names nothing", async () => {
    const id = randomId();
    expect(requireId(id, "Review")).toBe(id);
    for (const value of ["42", "", "not-a-uuid", `${id}x`, null, undefined, 7, { id }]) {
      expect(await failure(async () => requireId(value, "Review"))).toMatchObject({ name: "NotFoundError", code: "not_found" });
    }
  });

  it("slugifies titles", () => {
    expect(slugify("  Fire & Stone: Gobustan & Yanar Dağ ")).toBe("fire-stone-gobustan-yanar-dag");
    expect(slugify("Crème brûlée")).toBe("creme-brulee");
    expect(slugify("日本語")).toBe("");
    expect(slugify("a".repeat(100), 10)).toBe("aaaaaaaaaa");
    expect(slugify("abc def ghi", 8)).toBe("abc-def");
  });

  it("escapes LIKE wildcards", () => {
    expect(likePattern("50%_off\\now")).toBe("%50\\%\\_off\\\\now%");
  });

  it("finds the PostgreSQL code on the error or anywhere in its cause chain", () => {
    expect(pgErrorOf({ code: "23503", constraint: "reviews_tour_fk" })).toEqual({ code: "23503", constraint: "reviews_tour_fk" });
    expect(pgErrorOf(new Error("wrapped", { cause: { code: "23505", constraint: "x_key" } }))).toEqual({ code: "23505", constraint: "x_key" });
    expect(pgErrorOf({ code: "42501" })).toEqual({ code: "42501", constraint: undefined });
    // Node error codes such as ENOTFOUND are not SQLSTATEs.
    expect(pgErrorOf({ code: "ENOTFOUND" })).toEqual({});
    expect(pgErrorOf(new Error("plain"))).toEqual({});
    expect(pgErrorOf(undefined)).toEqual({});
    expect(pgErrorOf("text")).toEqual({});
  });
});

describe("guardedWrite", () => {
  it("returns the write's result", async () => {
    const tenant = await createTenant();
    const value = await asOwner(tenant)((scope) => guardedWrite(scope, {}, async () => "done"));
    expect(value).toBe("done");
  });

  it("maps a foreign-key violation to its field and leaves the transaction usable", async () => {
    const tenant = await createTenant();
    const outcome = await asOwner(tenant)(async (scope) => {
      const error = await failure(() =>
        guardedWrite(scope, { foreignKeys: { reviews_tour_fk: { field: "tourId", message: "Not yours." } } }, (tx) =>
          tx.insert(reviews).values({ customerName: "Guest", rating: 5, body: "Wonderful day out.", tourId: randomId() }),
        ),
      );
      const after = await scope.tx.select({ id: reviews.id }).from(reviews);
      return { error, after };
    });
    expect(outcome.error).toEqual({ name: "ValidationError", code: "validation", fieldErrors: { tourId: ["Not yours."] } });
    expect(outcome.after).toEqual([]);
  });

  it("maps a unique violation to a conflict", async () => {
    const tenant = await createTenant();
    const error = await failure(() =>
      asOwner(tenant)((scope) =>
        guardedWrite(scope, { unique: { roles_tenant_name_key: "That role name is taken." } }, (tx) =>
          tx.insert(roles).values([
            { name: "Twin", permissions: [] },
            { name: "Twin", permissions: [] },
          ]),
        ),
      ),
    );
    expect(error).toMatchObject({ name: "ConflictError", code: "conflict" });
  });

  it("rethrows violations it was not told about, and any other error, unchanged", async () => {
    const tenant = await createTenant();

    const unmappedForeignKey = await asOwner(tenant)((scope) =>
      guardedWrite(scope, { foreignKeys: {} }, (tx) =>
        tx.insert(reviews).values({ customerName: "Guest", rating: 5, body: "Wonderful day out.", tourId: randomId() }),
      ).then(
        () => "resolved",
        (error: unknown) => pgErrorOf(error),
      ),
    );
    expect(unmappedForeignKey).toEqual({ code: "23503", constraint: "reviews_tour_fk" });

    const unmappedUnique = await asOwner(tenant)((scope) =>
      guardedWrite(scope, {}, (tx) =>
        tx.insert(roles).values([
          { name: "Twin", permissions: [] },
          { name: "Twin", permissions: [] },
        ]),
      ).then(
        () => "resolved",
        (error: unknown) => pgErrorOf(error).code,
      ),
    );
    expect(unmappedUnique).toBe("23505");

    await expect(
      asOwner(tenant)((scope) =>
        guardedWrite(scope, {}, async () => {
          throw new Error("not a database error");
        }),
      ),
    ).rejects.toThrow("not a database error");
  });
});
