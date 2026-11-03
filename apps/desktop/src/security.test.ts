import { describe, expect, it } from "vite-plus/test";
import { contentSecurityPolicy, trustedFrame } from "./security";

describe("desktop security policy", () => {
  const expected = "file:///app/renderer/index.html";
  it("accepts only the exact bundled renderer document", () => {
    expect(trustedFrame(expected, expected)).toBe(true);
    for (const url of [
      undefined,
      "https://example.com",
      `${expected}?injected=1`,
      `${expected}/other`,
      "file:///tmp/index.html",
    ])
      expect(trustedFrame(url, expected)).toBe(false);
  });
  it("disallows renderer network access, inline scripts, forms and frames", () => {
    expect(contentSecurityPolicy).toContain("connect-src 'none'");
    expect(contentSecurityPolicy).toContain("script-src 'self'");
    expect(contentSecurityPolicy).toContain("form-action 'none'");
    expect(contentSecurityPolicy).toContain("frame-src 'none'");
    expect(contentSecurityPolicy).not.toContain("unsafe-inline");
    expect(contentSecurityPolicy).not.toContain("unsafe-eval");
  });
});
