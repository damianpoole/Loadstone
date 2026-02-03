import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { page } from "./page";
import * as wikiClient from "@loadstone/wiki-client";

vi.mock("@loadstone/wiki-client");
vi.mock("chalk", () => {
  const mockChalk = (str: string) => str;
  mockChalk.blue = mockChalk;
  mockChalk.green = mockChalk;
  mockChalk.yellow = mockChalk;
  mockChalk.red = mockChalk;
  mockChalk.bold = mockChalk;
  mockChalk.dim = mockChalk;
  return { default: mockChalk };
});

describe("page command", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn<typeof console, "log">>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should display page content in text mode", async () => {
    const mockData = {
      title: "Abyssal whip",
      pageid: 12345,
      revid: 67890,
      extract:
        '<div class="mw-parser-output"><h2>Stats</h2><p>Content</p></div>',
    };

    vi.mocked(wikiClient.getPage).mockResolvedValueOnce(mockData as any);
    vi.mocked(wikiClient.parseWikiContent).mockReturnValueOnce({
      Stats: "Content",
    });

    await page("Abyssal whip", {});

    expect(wikiClient.getPage).toHaveBeenCalledWith("Abyssal whip", {
      json: true,
      section: undefined,
      cache: {},
    });
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("should output JSON when json option is true", async () => {
    const mockData = {
      title: "Abyssal whip",
      pageid: 12345,
      revid: 67890,
      extract:
        '<div class="mw-parser-output"><h2>Stats</h2><p>Content</p></div>',
    };

    vi.mocked(wikiClient.getPage).mockResolvedValueOnce(mockData as any);
    vi.mocked(wikiClient.parseWikiContent).mockReturnValueOnce({
      Stats: "Content",
    });

    await page("Abyssal whip", { json: true });

    const output = consoleSpy.mock.calls.flat().join(" ");
    expect(output).toContain('"title"');
    expect(output).toContain('"Abyssal whip"');
  });

  it("should filter sections when section option is provided", async () => {
    const mockData = {
      title: "Test Page",
      pageid: 12345,
      revid: 67890,
      extract:
        '<div class="mw-parser-output"><h2>Drop sources</h2><p>Drops</p><h2>Stats</h2><p>Stats</p></div>',
    };

    vi.mocked(wikiClient.getPage).mockResolvedValueOnce(mockData as any);
    vi.mocked(wikiClient.parseWikiContent).mockReturnValueOnce({
      "Drop sources": "Drops",
      Stats: "Stats",
    });

    await page("Test Page", { section: "Drop" });

    expect(wikiClient.getPage).toHaveBeenCalledWith("Test Page", {
      json: true,
      section: "Drop",
      cache: {},
    });
  });

  it("should handle page not found", async () => {
    vi.mocked(wikiClient.getPage).mockResolvedValueOnce(null);

    await page("NonExistentPage", {});

    const output = consoleSpy.mock.calls.flat().join(" ");
    expect(output).toContain("Page not found");
  });

  it("should handle error response", async () => {
    vi.mocked(wikiClient.getPage).mockResolvedValueOnce({
      error: "missingtitle",
    } as any);

    await page("NonExistentPage", {});

    const output = consoleSpy.mock.calls.flat().join(" ");
    expect(output).toContain("Page not found");
  });
});
