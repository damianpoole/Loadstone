import { useState } from "react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { cleanup, render } from "ink-testing-library";
import { ChatInput, mouseReport } from "./chat-input";

afterEach(cleanup);
it("recognizes only complete SGR mouse reports", () => {
  expect(mouseReport("[<64;10;20M")).toEqual({ button: 64, pressed: true });
  expect(mouseReport("[<0;10;20m")).toEqual({ button: 0, pressed: false });
  expect(mouseReport("hello")).toBeUndefined();
  expect(mouseReport("[<64;10;")).toBeUndefined();
});
it("keeps cursor editing and Unicode intact while ignoring scroll and mouse events", async () => {
  const submit = vi.fn();
  function Editor() {
    const [value, setValue] = useState("");
    return <ChatInput value={value} onChange={setValue} onSubmit={submit} />;
  }
  const ui = render(<Editor />);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const key = async (input: string) => {
    ui.stdin.write(input);
    await new Promise((resolve) => setTimeout(resolve, 20));
  };
  await key("a😀c");
  await key("\x1b[D");
  for (const sequence of [
    "\x1b[<64;10;20M",
    "\x1b[<0;10;20M",
    "\x1b[<0;10;20m",
    "\x1b[5~",
    "\x1b[6~",
    "\x1b[H",
    "\x1b[F",
    "\x1b[A",
    "\x1b[B",
  ])
    await key(sequence);
  await key("\x7f");
  await key("b");
  await key("\r");
  expect(submit).toHaveBeenCalledWith("abc");
});
