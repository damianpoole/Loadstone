import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { getRSProfileSnapshot } from "./profile-snapshot";

afterEach(() => vi.unstubAllGlobals());
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
describe("fresh RuneMetrics snapshots", () => {
  it("fetches fresh validated skills and quests with request-start provenance", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          skillvalues: [
            { id: 15, level: 90 },
            { id: 28, level: 50 },
          ],
        }),
      )
      .mockResolvedValueOnce(json({ quests: [{ title: "Smoking Kills", status: "COMPLETED" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const start = Date.now();
    const result = await getRSProfileSnapshot("Iron Man");
    expect(result.observedAt).toBeGreaterThanOrEqual(start);
    expect(result.skills).toEqual({ status: "available", data: { Herblore: 90, Necromancy: 50 } });
    expect(result.quests.status).toBe("available");
    expect(fetchMock.mock.calls[0][0]).toContain("Iron%20Man");
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
  it("keeps skills when quests fail, rather than inventing an empty quest list", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json({ skillvalues: [{ id: 15, level: 90 }] }))
        .mockRejectedValueOnce(new Error("offline")),
    );
    const result = await getRSProfileSnapshot("Test");
    expect(result.skills.status).toBe("available");
    expect(result.quests).toEqual({ status: "unavailable", error: "offline" });
  });
  it("keeps public quests even when the profile is private", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json({ error: "PROFILE_PRIVATE" }))
        .mockResolvedValueOnce(json({ quests: [] })),
    );
    const result = await getRSProfileSnapshot("Test");
    expect(result.skills.status).toBe("unavailable");
    expect(result.quests).toEqual({ status: "available", data: [] });
  });
  it("rejects malformed payloads independently", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json({ skillvalues: [{ id: 15, level: "90" }] }))
        .mockResolvedValueOnce(json({ quests: [{ title: "Quest", status: "UNKNOWN" }] })),
    );
    const result = await getRSProfileSnapshot("Test");
    expect(result.skills.status).toBe("unavailable");
    expect(result.quests.status).toBe("unavailable");
  });
  it("propagates caller cancellation to fetch", async () => {
    const controller = new AbortController();
    controller.abort();
    const mock = vi.fn((_url: string, options: RequestInit) => {
      options.signal?.throwIfAborted();
      return Promise.resolve(json({}));
    });
    vi.stubGlobal("fetch", mock);
    const result = await getRSProfileSnapshot("Test", { signal: controller.signal });
    expect(result.skills.status).toBe("unavailable");
    expect(result.quests.status).toBe("unavailable");
    expect(mock.mock.calls.every((call) => call[1].signal?.aborted)).toBe(true);
  });
});
