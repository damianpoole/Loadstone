import chalk from "chalk";
import { getRSProfile } from "@loadstone/wiki-client";
import { buildCacheOptions, type CacheCliOptions } from "./cache-options";

export async function profile(
  username: string,
  options: { json?: boolean; quests?: boolean } & CacheCliOptions = {},
) {
  if (!options.json) {
    console.log(chalk.blue(`Fetching RuneMetrics profile for: ${username}...`));
  }
  const cacheOptions = buildCacheOptions(options);
  const data = await getRSProfile(username, { cache: cacheOptions });

  if (!data) {
    if (options.json) {
      console.log(
        JSON.stringify({ error: "Profile not found or private" }, null, 2),
      );
    } else {
      console.log(chalk.red("Profile not found or private."));
    }
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log(chalk.bold.green(`\n=== Profile: ${data.name} ===`));
  console.log(`${chalk.bold("Combat Level:")} ${data.combatLevel}`);
  console.log(`${chalk.bold("Total Skill:")} ${data.totalSkill}`);
  console.log(`${chalk.bold("Total XP:")} ${data.totalXp.toLocaleString()}`);
  console.log(
    `${chalk.bold("Quests:")} ${data.questsComplete} complete, ${data.questsStarted} started, ${data.questsNotStarted} not started`,
  );

  console.log(chalk.bold.green("\n--- Skills ---"));

  // Sort skills by name for readability
  const sortedSkills = Object.keys(data.skills).sort();

  // Print in 2 columns
  for (let i = 0; i < sortedSkills.length; i += 2) {
    const s1 = sortedSkills[i];
    const s2 = sortedSkills[i + 1];
    const line = `${s1.padEnd(15)}: ${data.skills[s1].toString().padEnd(3)} ${s2 ? ` | ${s2.padEnd(15)}: ${data.skills[s2]}` : ""}`;
    console.log(line);
  }

  if (options.quests) {
    console.log(chalk.bold.green("\n--- Quests ---"));
    // Show started quests first, then completed, then not started
    const sortedQuests = [...data.quests].sort((a, b) => {
      if (a.status === b.status) return a.title.localeCompare(b.title);
      if (a.status === "STARTED") return -1;
      if (b.status === "STARTED") return 1;
      if (a.status === "COMPLETED") return -1;
      return 1;
    });

    sortedQuests.forEach((q) => {
      let statusColor = chalk.gray;
      if (q.status === "COMPLETED") statusColor = chalk.green;
      if (q.status === "STARTED") statusColor = chalk.yellow;

      console.log(`${statusColor(q.status.padEnd(12))} ${q.title}`);
    });
  }
}
