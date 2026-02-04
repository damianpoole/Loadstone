import chalk from "chalk";
import { getCategoryMembers } from "@loadstone/wiki-client";
import { buildCacheOptions, type CacheCliOptions } from "./cache-options";

export async function category(
  name: string,
  options: { json?: boolean; limit?: string } & CacheCliOptions = {},
) {
  const limit = options.limit ? parseInt(options.limit, 10) : 50;
  const cacheOptions = buildCacheOptions(options);

  if (!options.json) {
    console.log(chalk.blue(`Fetching members for category: ${name}...`));
  }

  const members = await getCategoryMembers(name, {
    limit,
    cache: cacheOptions,
  });

  if (options.json) {
    console.log(JSON.stringify({ category: name, members }, null, 2));
    return;
  }

  if (members.length === 0) {
    console.log(chalk.yellow("No members found in this category."));
    return;
  }

  console.log(chalk.green(`Found ${members.length} members:`));
  members.forEach((member) => {
    console.log(`- ${member}`);
  });
}
