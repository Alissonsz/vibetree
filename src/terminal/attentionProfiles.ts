export type AttentionMode = "off" | "attention" | "attention+notification";

export type AttentionProfile = {
  id: string;
  name: string;
  prompt_regex: string | null;
  attention_mode: AttentionMode;
  debounce_ms: number;
};

const KNOWN_PROFILE_IDS = ["opencode", "claude", "codex", "gemini", "custom"];
const CLI_PROMPT_REGEX_DEFAULT = "(>|›|❯)\\s*$";
const LEGACY_CLI_PROMPT_REGEX_DEFAULT = "(^|\\r?\\n)(>|›|❯)\\s*$";

export const DEFAULT_ATTENTION_PROFILES: AttentionProfile[] = [
  {
    id: "opencode",
    name: "OpenCode",
    prompt_regex: "(^|\\r?\\n)>\\s*$",
    attention_mode: "attention",
    debounce_ms: 300
  },
  {
    id: "claude",
    name: "Claude Code",
    prompt_regex: CLI_PROMPT_REGEX_DEFAULT,
    attention_mode: "attention",
    debounce_ms: 300
  },
  {
    id: "codex",
    name: "Codex",
    prompt_regex: CLI_PROMPT_REGEX_DEFAULT,
    attention_mode: "attention",
    debounce_ms: 300
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    prompt_regex: CLI_PROMPT_REGEX_DEFAULT,
    attention_mode: "attention",
    debounce_ms: 300
  },
  {
    id: "custom",
    name: "Custom",
    prompt_regex: null,
    attention_mode: "attention",
    debounce_ms: 300
  }
];

function isAttentionMode(value: unknown): value is AttentionMode {
  return value === "off" || value === "attention" || value === "attention+notification";
}

export function getProfileById(profiles: AttentionProfile[], id: string | null | undefined): AttentionProfile | null {
  if (!id) {
    return null;
  }
  return profiles.find((profile) => profile.id === id) ?? null;
}

export function normalizeAttentionProfiles(
  loaded: AttentionProfile[] | null | undefined,
  defaults: AttentionProfile[] = DEFAULT_ATTENTION_PROFILES
): AttentionProfile[] {
  const loadedById = new Map((loaded ?? []).map((profile) => [profile.id, profile]));

  return defaults
    .filter((defaultProfile) => KNOWN_PROFILE_IDS.includes(defaultProfile.id))
    .map((defaultProfile) => {
      const candidate = loadedById.get(defaultProfile.id);
      if (!candidate) {
        return { ...defaultProfile };
      }

      const name = (candidate.name ?? "").trim() || defaultProfile.name;
      const promptRegexRaw = candidate.prompt_regex;
      const promptRegex = typeof promptRegexRaw === "string"
        ? (
            promptRegexRaw === LEGACY_CLI_PROMPT_REGEX_DEFAULT
              ? defaultProfile.prompt_regex
              : promptRegexRaw
          )
        : defaultProfile.prompt_regex;
      const attentionMode = isAttentionMode(candidate.attention_mode)
        ? candidate.attention_mode
        : defaultProfile.attention_mode;

      const debounce = Number(candidate.debounce_ms);
      const debounceMs = Number.isFinite(debounce) && debounce >= 50 && debounce <= 2000
        ? Math.round(debounce)
        : defaultProfile.debounce_ms;

      return {
        id: defaultProfile.id,
        name,
        prompt_regex: promptRegex,
        attention_mode: attentionMode,
        debounce_ms: debounceMs
      };
    });
}
