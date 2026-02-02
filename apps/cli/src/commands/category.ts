import chalk from "chalk";
import { getCategoryMembers } from "@loadstone/wiki-client";

export async function category(name: string, options: { json?: boolean; limit?: string }) {
  const limit = options.limit ? parseInt(options.limit, 10) : 50;

  if (!options.json) {
    console.log(chalk.blue(`Fetching members for category: ${name}...`));
  }
  
  const members = await getCategoryMembers(name, { limit });

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
