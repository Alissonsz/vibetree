import { describe, expect, it } from "vitest";

import { DEFAULT_ATTENTION_PROFILES, normalizeAttentionProfiles } from "../terminal/attentionProfiles";

describe("attentionProfiles", () => {
  it("loads defaults deterministically", () => {
    const normalized = normalizeAttentionProfiles(undefined, DEFAULT_ATTENTION_PROFILES);
    expect(normalized).toEqual(DEFAULT_ATTENTION_PROFILES);
  });

  it("ignores unknown profile ids and sanitizes invalid fields", () => {
    const normalized = normalizeAttentionProfiles([
      {
        id: "opencode",
        name: "  ",
        prompt_regex: "(^|\\r?\\n)>\\s*$",
        attention_mode: "bad-mode" as "attention",
        debounce_ms: 9999
      },
      {
        id: "unknown",
        name: "Unknown",
        prompt_regex: "x$",
        attention_mode: "attention",
        debounce_ms: 100
      }
    ]);

    const opencode = normalized.find((profile) => profile.id === "opencode");
    expect(opencode).toBeTruthy();
    expect(opencode?.name).toBe("OpenCode");
    expect(opencode?.attention_mode).toBe("attention");
    expect(opencode?.debounce_ms).toBe(300);
    expect(normalized.some((profile) => profile.id === "unknown")).toBe(false);
  });

  it("falls back to built-in regex when saved profile regex is null", () => {
    const normalized = normalizeAttentionProfiles([
      {
        id: "codex",
        name: "Codex",
        prompt_regex: null,
        attention_mode: "attention+notification",
        debounce_ms: 300
      }
    ]);

    const codex = normalized.find((profile) => profile.id === "codex");
    expect(codex).toBeTruthy();
    expect(codex?.prompt_regex).toBe("(^|\\r?\\n)(>|›|❯)\\s*$");
  });
});
