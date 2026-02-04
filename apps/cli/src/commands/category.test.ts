import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { category } from "./category";
import * as wikiClient from "@loadstone/wiki-client";

vi.mock("@loadstone/wiki-client");
vi.mock("chalk", () => ({
  default: {
    blue: (str: string) => str,
    green: (str: string) => str,
    yellow: (str: string) => str,
  },
}));

describe("category command", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn<typeof console, "log">>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should display category members", async () => {
    const mockMembers = ["Quest 1", "Quest 2", "Quest 3"];

    vi.mocked(wikiClient.getCategoryMembers).mockResolvedValueOnce(mockMembers);

    await category("Novice quests", {});

    expect(wikiClient.getCategoryMembers).toHaveBeenCalledWith(
      "Novice quests",
      {
        limit: 50,
        cache: {},
      },
    );
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("should output JSON when json option is true", async () => {
    const mockMembers = ["Quest 1", "Quest 2"];

    vi.mocked(wikiClient.getCategoryMembers).mockResolvedValueOnce(mockMembers);

    await category("Novice quests", { json: true });

    const output = consoleSpy.mock.calls.flat().join(" ");
    expect(output).toContain('"category"');
    expect(output).toContain('"Novice quests"');
    expect(output).toContain('"members"');
  });

  it("should respect limit option", async () => {
    const mockMembers = ["Quest 1"];

    vi.mocked(wikiClient.getCategoryMembers).mockResolvedValueOnce(mockMembers);

    await category("Novice quests", { limit: "10" });

    expect(wikiClient.getCategoryMembers).toHaveBeenCalledWith(
      "Novice quests",
      {
        limit: 10,
        cache: {},
      },
    );
  });

  it("should handle empty categories", async () => {
    vi.mocked(wikiClient.getCategoryMembers).mockResolvedValueOnce([]);

    await category("Empty Category", {});

    const output = consoleSpy.mock.calls.flat().join(" ");
    expect(output).toContain("No members found");
  });
});
