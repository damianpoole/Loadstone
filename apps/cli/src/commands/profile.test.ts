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

    expect(wikiClient.getRSProfile).toHaveBeenCalledWith("TestUser", {
      cache: {},
    });
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

  it("should return only skills with skills-only option", async () => {
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
      quests: [
        {
          title: "Quest1",
          status: "COMPLETED" as const,
          questPoints: 5,
          members: true,
        },
      ],
      raw: { someData: "data" },
    };

    vi.mocked(wikiClient.getRSProfile).mockResolvedValueOnce(mockProfile);

    await profile("TestUser", { json: true, skillsOnly: true });

    const output = consoleSpy.mock.calls.flat().join(" ");
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("skills");
    expect(parsed.skills).toEqual({ Attack: 99, Defence: 80 });
    expect(parsed).not.toHaveProperty("quests");
    expect(parsed).not.toHaveProperty("name");
    expect(parsed).not.toHaveProperty("raw");
  });

  it("should return only quests with quests-only option", async () => {
    const mockProfile = {
      name: "TestUser",
      combatLevel: 138,
      totalSkill: 2595,
      totalXp: 5000000,
      questsComplete: 50,
      questsStarted: 5,
      questsNotStarted: 10,
      skills: { Attack: 99 },
      quests: [
        {
          title: "Quest1",
          status: "COMPLETED" as const,
          questPoints: 5,
          members: true,
        },
        {
          title: "Quest2",
          status: "STARTED" as const,
          questPoints: 3,
          members: true,
        },
      ],
    };

    vi.mocked(wikiClient.getRSProfile).mockResolvedValueOnce(mockProfile);

    await profile("TestUser", { json: true, questsOnly: true });

    const output = consoleSpy.mock.calls.flat().join(" ");
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("quests");
    expect(parsed.quests).toHaveLength(2);
    expect(parsed.quests[0]).toEqual({ title: "Quest1", status: "COMPLETED" });
    expect(parsed.quests[1]).toEqual({ title: "Quest2", status: "STARTED" });
    expect(parsed.quests[0]).not.toHaveProperty("questPoints");
    expect(parsed.quests[0]).not.toHaveProperty("members");
    expect(parsed).not.toHaveProperty("skills");
    expect(parsed).not.toHaveProperty("name");
  });

  it("should return only completed quests with completed-quests-only option", async () => {
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
          title: "CompletedQuest",
          status: "COMPLETED" as const,
          questPoints: 5,
          members: true,
        },
        {
          title: "StartedQuest",
          status: "STARTED" as const,
          questPoints: 3,
          members: true,
        },
        {
          title: "NotStartedQuest",
          status: "NOT_STARTED" as const,
          questPoints: 2,
          members: false,
        },
      ],
    };

    vi.mocked(wikiClient.getRSProfile).mockResolvedValueOnce(mockProfile);

    await profile("TestUser", { json: true, completedQuestsOnly: true });

    const output = consoleSpy.mock.calls.flat().join(" ");
    const parsed = JSON.parse(output);
    expect(parsed.quests).toHaveLength(1);
    expect(parsed.quests[0]).toEqual({
      title: "CompletedQuest",
      status: "COMPLETED",
    });
  });

  it("should return only started quests with started-quests-only option", async () => {
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
          title: "CompletedQuest",
          status: "COMPLETED" as const,
          questPoints: 5,
          members: true,
        },
        {
          title: "StartedQuest",
          status: "STARTED" as const,
          questPoints: 3,
          members: true,
        },
        {
          title: "NotStartedQuest",
          status: "NOT_STARTED" as const,
          questPoints: 2,
          members: false,
        },
      ],
    };

    vi.mocked(wikiClient.getRSProfile).mockResolvedValueOnce(mockProfile);

    await profile("TestUser", { json: true, startedQuestsOnly: true });

    const output = consoleSpy.mock.calls.flat().join(" ");
    const parsed = JSON.parse(output);
    expect(parsed.quests).toHaveLength(1);
    expect(parsed.quests[0]).toEqual({
      title: "StartedQuest",
      status: "STARTED",
    });
  });

  it("should return only not-started quests with not-started-quests-only option", async () => {
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
          title: "CompletedQuest",
          status: "COMPLETED" as const,
          questPoints: 5,
          members: true,
        },
        {
          title: "StartedQuest",
          status: "STARTED" as const,
          questPoints: 3,
          members: true,
        },
        {
          title: "NotStartedQuest",
          status: "NOT_STARTED" as const,
          questPoints: 2,
          members: false,
        },
      ],
    };

    vi.mocked(wikiClient.getRSProfile).mockResolvedValueOnce(mockProfile);

    await profile("TestUser", { json: true, notStartedQuestsOnly: true });

    const output = consoleSpy.mock.calls.flat().join(" ");
    const parsed = JSON.parse(output);
    expect(parsed.quests).toHaveLength(1);
    expect(parsed.quests[0]).toEqual({
      title: "NotStartedQuest",
      status: "NOT_STARTED",
    });
  });

  it("should exclude raw field by default in JSON mode", async () => {
    const mockProfile = {
      name: "TestUser",
      combatLevel: 138,
      totalSkill: 2595,
      totalXp: 5000000,
      questsComplete: 50,
      questsStarted: 5,
      questsNotStarted: 10,
      skills: { Attack: 99 },
      quests: [],
      raw: { someData: "data" },
    };

    vi.mocked(wikiClient.getRSProfile).mockResolvedValueOnce(mockProfile);

    await profile("TestUser", { json: true });

    const output = consoleSpy.mock.calls.flat().join(" ");
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("name");
    expect(parsed).not.toHaveProperty("raw");
  });

  it("should include raw field with include-raw option", async () => {
    const mockProfile = {
      name: "TestUser",
      combatLevel: 138,
      totalSkill: 2595,
      totalXp: 5000000,
      questsComplete: 50,
      questsStarted: 5,
      questsNotStarted: 10,
      skills: { Attack: 99 },
      quests: [],
      raw: { someData: "data" },
    };

    vi.mocked(wikiClient.getRSProfile).mockResolvedValueOnce(mockProfile);

    await profile("TestUser", { json: true, includeRaw: true });

    const output = consoleSpy.mock.calls.flat().join(" ");
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("raw");
    expect(parsed.raw).toEqual({ someData: "data" });
  });
});
