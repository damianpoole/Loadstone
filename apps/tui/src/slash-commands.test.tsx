import { afterEach, describe, expect, it } from "vite-plus/test";
import { cleanup, render } from "ink-testing-library";
import { Box } from "ink";
import {
  CommandMenu,
  matchingCommands,
  matchingSessions,
  sessionQuery,
  slashCommands,
} from "./slash-commands";
import { HELP } from "./controller";

afterEach(cleanup);

describe("slash commands", () => {
  it("lists every documented command, including help, without duplicates", () => {
    const documented = new Set(HELP.match(/(?<=^|\s)\/[a-z]+/gm));
    documented.add("/help");
    expect(new Set(slashCommands.map((command) => command.name))).toEqual(documented);
    expect(new Set(slashCommands.map((command) => command.name)).size).toBe(slashCommands.length);
  });

  it("filters command prefixes but not chat or arguments", () => {
    expect(matchingCommands("/")).toEqual(slashCommands);
    expect(matchingCommands("/mo").map((command) => command.name)).toEqual(["/model", "/models"]);
    expect(matchingCommands("/SY")[0]?.name).toBe("/sync");
    for (const input of ["", "hello /sync", "/missing", "/sync ", "/character Name"])
      expect(matchingCommands(input)).toEqual([]);
  });

  it("searches session titles and IDs with multiple unordered case-insensitive terms", () => {
    const sessions = [
      { id: "first-id", characterId: "iron", createdAt: 1, title: "Plan: unlock Invention" },
      { id: "second-id", characterId: "iron", createdAt: 2, title: "Slayer training" },
      { id: "third-id", characterId: "iron", createdAt: 3, title: "" },
    ];
    expect(matchingSessions("/resume INVENT plan", sessions, "first-id")).toEqual([
      expect.objectContaining({
        value: "/resume first-id",
        submit: true,
        description: expect.stringContaining("active"),
      }),
    ]);
    expect(matchingSessions("/sessions second", sessions)[0].name).toContain("Slayer training");
    expect(matchingSessions("/session", sessions)).toHaveLength(3);
    expect(matchingSessions("/resume third", sessions)[0].name).toContain("Untitled session");
    expect(matchingSessions("/resume missing", sessions)).toEqual([]);
    expect(matchingSessions("/res", sessions)).toEqual([]);
    expect(sessionQuery("/resume")).toBe("");
    expect(sessionQuery("/resume ")).toBe("");
    expect(sessionQuery("hello /resume")).toBeUndefined();
  });

  it("keeps the selected item visible in a bounded overlay", () => {
    const ui = render(
      <Box width={80} height={6}>
        <CommandMenu
          completion={{
            matches: slashCommands,
            selected: slashCommands.length - 1,
            select: () => {},
            dismiss: () => {},
          }}
          height={6}
        />
      </Box>,
    );
    expect(ui.lastFrame()).toContain("› /quit");
    expect(ui.lastFrame()).toContain(`${slashCommands.length}/${slashCommands.length}`);
    expect(ui.lastFrame()).not.toContain("/help");
    expect(ui.lastFrame()!.split("\n").length).toBeLessThanOrEqual(6);
  });
});
