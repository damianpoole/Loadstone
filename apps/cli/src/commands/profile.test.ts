import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { profile } from "./profile";
import * as wikiClient from "@loadstone/wiki-client";

vi.mock("@loadstone/wiki-client");
vi.mock("chalk", () => {
  const mockChalk = (str: string) => str;
  mockChalk.blue = mockChalk;
  mockChalk.green = mockChalk;
  mockChalk.yellow = mockChalk;
  mockChalk.red = mockChalk;
  mockChalk.gray = mockChalk;
  mockChalk.bold = mockChalk;
  return { default: mockChalk };
});

describe("profile command", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn<typeof console, "log">>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should display profile data", async () => {
    const mockProfile = {
      name: "TestUser",
      combatLevel: 138,
      totalSkill: 2595,
      totalXp: 5000000,
      questsComplete: 50,
      questsStarted: 5,
      questsNotStarted: 10,
      skills: {
        Attack: 99,
        Defence: 80,
      },
      quests: [],
    };

    vi.mocked(wikiClient.getRSProfile).mockResolvedValueOnce(mockProfile);

    await profile("TestUser", {});

    expect(wikiClient.getRSProfile).toHaveBeenCalledWith("TestUser");
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("should output JSON when json option is true", async () => {
    const mockProfile = {
      name: "TestUser",
      combatLevel: 138,
      totalSkill: 2595,
      totalXp: 5000000,
      questsComplete: 50,
      questsStarted: 5,
      questsNotStarted: 10,
      skills: {},
      quests: [],
    };

    vi.mocked(wikiClient.getRSProfile).mockResolvedValueOnce(mockProfile);

    await profile("TestUser", { json: true });

    const output = consoleSpy.mock.calls.flat().join(" ");
    expect(output).toContain('"name"');
    expect(output).toContain('"TestUser"');
  });

  it("should display quests when quests option is true", async () => {
    const mockProfile = {
      name: "TestUser",
      combatLevel: 138,
      totalSkill: 2595,
      totalXp: 5000000,
      questsComplete: 1,
      questsStarted: 1,
      questsNotStarted: 1,
      skills: {},
      quests: [
        {
          title: "Test Quest",
          status: "COMPLETED" as const,
          questPoints: 5,
          members: true,
        },
      ],
    };

    vi.mocked(wikiClient.getRSProfile).mockResolvedValueOnce(mockProfile);

    await profile("TestUser", { quests: true });

    const output = consoleSpy.mock.calls.flat().join(" ");
    expect(output).toContain("Quests");
    expect(output).toContain("Test Quest");
  });

  it("should handle profile not found", async () => {
    vi.mocked(wikiClient.getRSProfile).mockResolvedValueOnce(null);

    await profile("NonExistentUser", {});

    const output = consoleSpy.mock.calls.flat().join(" ");
    expect(output).toContain("Profile not found");
  });

  it("should handle profile not found in JSON mode", async () => {
    vi.mocked(wikiClient.getRSProfile).mockResolvedValueOnce(null);

    await profile("NonExistentUser", { json: true });

    const output = consoleSpy.mock.calls.flat().join(" ");
    expect(output).toContain('"error"');
    expect(output).toContain("Profile not found");
  });
});
