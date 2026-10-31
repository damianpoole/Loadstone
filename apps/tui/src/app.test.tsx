import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { render, cleanup } from "ink-testing-library";
import { App, plainText, screenLines } from "./app";
import type { AppState, Controller } from "./controller";

afterEach(cleanup);
const state: AppState = {
  facts: [],
  view: {
    messages: [{ id: "1", role: "Assistant", text: "Welcome Ironman" }],
    partial: "Streaming advice",
    busy: true,
    activity: ["search_wiki: running"],
    hasEarlier: false,
  },
  notice: "",
  processing: false,
  pending: 1,
};
it("strips terminal escape sequences while preserving readable text", () => {
  expect(plainText("\x1b[31mRed\x1b[0m\x1b]52;c;secret\x07\nText\x00")).toBe("Red\nText");
});
it("wraps chat for small terminals and labels item memory as last observed", () => {
  expect(screenLines(state, "chat", 20).every((line) => line.length <= 20)).toBe(true);
  const facts: AppState["facts"] = [
    {
      kind: "item",
      key: "whip",
      value: { owned: true },
      source: "user",
      observedAt: 1000,
      recordedAt: 1000,
      evidence: "reported",
      operationId: "one",
    },
  ];
  expect(screenLines({ ...state, facts }, "memory", 100).join("\n")).toContain("last observed");
});
describe("Ink screen", () => {
  it("renders streaming/tool state and handles chat, tabs, cancellation and quit", async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const cancel = vi.fn().mockResolvedValue(undefined);
    const quit = vi.fn();
    const controller = {
      snapshot: () => state,
      subscribe: () => () => {},
      execute,
      cancel,
      report: vi.fn(),
    } as unknown as Controller;
    const ui = render(<App controller={controller} onQuit={quit} />);
    await vi.waitFor(() => expect(ui.lastFrame()).toContain("Streaming advice"));
    expect(ui.lastFrame()).toContain("search_wiki: running");
    expect(ui.lastFrame()).toContain("1 pending");
    ui.stdin.write("hello");
    await new Promise((resolve) => setTimeout(resolve, 30));
    ui.stdin.write("\r");
    await vi.waitFor(() => expect(execute).toHaveBeenCalledWith("hello"));
    ui.stdin.write("\t");
    await vi.waitFor(() => expect(ui.lastFrame()).toContain("No memory yet"));
    ui.stdin.write("\x1b");
    await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
    ui.stdin.write("\x03");
    await vi.waitFor(() => expect(quit).toHaveBeenCalled());
  });
});
