import { fetchJsonWithCache } from "./cache";

const RUNEMETRICS_URL = "https://apps.runescape.com/runemetrics";
const SKILLS = [
  "Attack",
  "Defence",
  "Strength",
  "Constitution",
  "Ranged",
  "Prayer",
  "Magic",
  "Cooking",
  "Woodcutting",
  "Fletching",
  "Fishing",
  "Firemaking",
  "Crafting",
  "Smithing",
  "Mining",
  "Herblore",
  "Agility",
  "Thieving",
  "Slayer",
  "Farming",
  "Runecrafting",
  "Hunter",
  "Construction",
  "Summoning",
  "Dungeoneering",
  "Divination",
  "Invention",
  "Archaeology",
  "Necromancy",
];
export type ProfilePart<T> =
  | { status: "available"; data: T }
  | { status: "unavailable"; error: string };
export interface RSProfileSnapshot {
  username: string;
  /** Request start, not response time: a user report during a slow sync stays newer. */
  observedAt: number;
  skills: ProfilePart<Record<string, number>>;
  quests: ProfilePart<{ title: string; status: "COMPLETED" | "STARTED" | "NOT_STARTED" }[]>;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Malformed RuneMetrics response.");
  return value as Record<string, unknown>;
}
async function part<T>(
  url: string,
  parse: (value: Record<string, unknown>) => T,
  signal?: AbortSignal,
): Promise<ProfilePart<T>> {
  try {
    const value = object(
      await fetchJsonWithCache<unknown>(url, {
        cache: { enabled: false },
        fetchOptions: { signal },
      }),
    );
    if (value.error) throw new Error(`RuneMetrics unavailable: ${String(value.error)}`);
    return { status: "available", data: parse(value) };
  } catch (error) {
    return { status: "unavailable", error: error instanceof Error ? error.message : String(error) };
  }
}
/** Fresh, independently validated API parts. Never substitutes a failed quest fetch with an empty list. */
export async function getRSProfileSnapshot(
  username: string,
  options: { signal?: AbortSignal } = {},
): Promise<RSProfileSnapshot> {
  const observedAt = Date.now();
  const user = encodeURIComponent(username);
  const [skills, quests] = await Promise.all([
    part(
      `${RUNEMETRICS_URL}/profile/profile?user=${user}&skillvalues`,
      (data) => {
        if (!Array.isArray(data.skillvalues)) throw new Error("Skill data missing or private.");
        const skills: Record<string, number> = {};
        for (const raw of data.skillvalues) {
          const skill = object(raw);
          if (
            typeof skill.id !== "number" ||
            !Number.isInteger(skill.id) ||
            typeof skill.level !== "number" ||
            !Number.isInteger(skill.level) ||
            skill.level < 1 ||
            skill.level > 120
          )
            throw new Error("Malformed skill value.");
          const name = SKILLS[skill.id];
          if (name) skills[name] = skill.level;
        }
        return skills;
      },
      options.signal,
    ),
    part(
      `${RUNEMETRICS_URL}/quests?user=${user}`,
      (data) => {
        if (!Array.isArray(data.quests)) throw new Error("Quest data missing or private.");
        return data.quests.map((raw) => {
          const quest = object(raw);
          if (
            typeof quest.title !== "string" ||
            !quest.title.trim() ||
            !["COMPLETED", "STARTED", "NOT_STARTED"].includes(String(quest.status))
          )
            throw new Error("Malformed quest value.");
          return {
            title: quest.title,
            status: quest.status as "COMPLETED" | "STARTED" | "NOT_STARTED",
          };
        });
      },
      options.signal,
    ),
  ]);
  return { username, observedAt, skills, quests };
}
