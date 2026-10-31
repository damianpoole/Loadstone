import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { fetchJsonWithCache } from "./cache";

afterEach(() => vi.unstubAllGlobals());
describe("bounded wiki HTTP requests", () => {
  it("adds a 20-second timeout without losing caller options", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(
        fetchJsonWithCache("https://example.test", {
          cache: { enabled: false },
          fetchOptions: { headers: { "X-Test": "yes" } },
        }),
      ).resolves.toEqual({ ok: true });
      expect(timeout).toHaveBeenCalledWith(20_000);
      expect(fetchMock.mock.calls[0][1].headers).toEqual({ "X-Test": "yes" });
      expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    } finally {
      timeout.mockRestore();
    }
  });
  it("combines timeout with caller cancellation", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            options.signal!.addEventListener("abort", () => reject(options.signal!.reason), {
              once: true,
            });
          }),
      ),
    );
    const request = fetchJsonWithCache("https://example.test", {
      cache: { enabled: false },
      fetchOptions: { signal: controller.signal },
    });
    controller.abort(new Error("cancelled"));
    await expect(request).rejects.toThrow("cancelled");
  });
});
