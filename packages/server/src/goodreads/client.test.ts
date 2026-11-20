import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBestEditionId } from "./client.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Runs a throttled Goodreads call without waiting out its real delay. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return promise;
}

function stubGraphql(data: unknown) {
  const fetch = vi.fn(async () => Response.json({ data }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("fetchBestEditionId", () => {
  it("maps an edition to its work's best edition", async () => {
    vi.useFakeTimers();
    const fetch = stubGraphql({
      getBookByLegacyId: { work: { bestBook: { legacyId: 35519109 } } },
    });
    expect(await settle(fetchBestEditionId(37534905))).toBe(35519109);
    const body = JSON.parse(
      String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    );
    expect(body.variables).toEqual({ legacyBookId: 37534905 });
    expect(body.query).toContain("bestBook");
  });

  it("keeps the edition when the work names no best edition", async () => {
    vi.useFakeTimers();
    stubGraphql({ getBookByLegacyId: { work: { bestBook: null } } });
    expect(await settle(fetchBestEditionId(42))).toBe(42);
  });

  it("returns null for an unknown book and throws on GraphQL errors", async () => {
    vi.useFakeTimers();
    stubGraphql({ getBookByLegacyId: null });
    expect(await settle(fetchBestEditionId(1))).toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ errors: [{ message: "boom" }] })),
    );
    const failed = fetchBestEditionId(1);
    const assertion = expect(failed).rejects.toThrow("boom");
    await vi.runAllTimersAsync();
    await assertion;
  });
});
