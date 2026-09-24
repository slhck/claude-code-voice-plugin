// Shared helpers: state file, .env loading, effective TTS config.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const STATE_DIR = path.join(os.homedir(), ".claude", "voice-plugin");
export const STATE_FILE = path.join(STATE_DIR, "state.json");

export const PROVIDERS = {
  openai: {
    label: "OpenAI",
    keyVars: ["OPENAI_API_KEY"],
    model: "gpt-4o-mini-tts",
    modelPrefixes: ["gpt-", "tts-"],
    voice: "marin",
    voices: [
      "alloy", "ash", "ballad", "coral", "echo", "fable", "nova",
      "onyx", "sage", "shimmer", "verse", "marin", "cedar",
    ],
  },
  google: {
    label: "Google Gemini",
    keyVars: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    model: "gemini-3.8-flash-tts",
    modelPrefixes: ["gemini-"],
    voice: "Kore",
    voices: [
      "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede",
      "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba",
      "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
      "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi",
      "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
    ],
  },
};

export const DEFAULT_PROVIDER = "openai";

/** All voice names of all providers, for tool schemas. */
export const ALL_VOICES = Object.values(PROVIDERS).flatMap((p) => p.voices);

export const DEFAULTS = {
  instructions: "Cheerful and curious, at a slightly faster than normal pace.",
  speed: 1.0,
};

/** Find the provider that offers a voice (case-insensitive). Returns { provider, voice } or null. */
export function findVoice(name) {
  const lower = String(name).toLowerCase();
  for (const [provider, p] of Object.entries(PROVIDERS)) {
    const voice = p.voices.find((v) => v.toLowerCase() === lower);
    if (voice) return { provider, voice };
  }
  return null;
}

/** API key of a provider, or undefined. */
export function apiKey(provider) {
  for (const v of PROVIDERS[provider].keyVars) if (process.env[v]) return process.env[v];
  return undefined;
}

function parseDotenv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    const q = value[0];
    if ((q === '"' || q === "'") && value.lastIndexOf(q) > 0) {
      value = value.slice(1, value.lastIndexOf(q)); // quoted; trailing comment ignored
    } else {
      value = value.replace(/\s+#.*$/, "").trim(); // strip unquoted inline comment
    }
    out[m[1]] = value;
  }
  return out;
}

/** Load .env files without overriding variables already set in the environment. */
export function loadEnv() {
  const candidates = [
    path.join(process.cwd(), ".env"),
    process.env.VOICE_PLUGIN_ROOT ? path.join(process.env.VOICE_PLUGIN_ROOT, ".env") : null,
    path.join(STATE_DIR, ".env"),
  ].filter(Boolean);
  const loaded = [];
  for (const file of candidates) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const [k, v] of Object.entries(parseDotenv(text))) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
    loaded.push(file);
  }
  return loaded;
}

export function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return { enabled: false, overrides: {}, ...s };
  } catch {
    return { enabled: false, overrides: {} };
  }
}

export function writeState(patch) {
  const next = { ...readState(), ...patch, updatedAt: new Date().toISOString() };
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2) + "\n");
  return next;
}

/**
 * Precedence: runtime overrides (state file) > environment > defaults.
 * A voice or model that does not belong to the selected provider is replaced
 * by that provider's default.
 */
export function effectiveConfig(state = readState()) {
  const env = {
    provider: process.env.VOICE_TTS_PROVIDER,
    model: process.env.VOICE_TTS_MODEL,
    voice: process.env.VOICE_TTS_VOICE,
    instructions: process.env.VOICE_TTS_INSTRUCTIONS,
    speed: process.env.VOICE_TTS_SPEED ? Number(process.env.VOICE_TTS_SPEED) : undefined,
  };
  const cfg = { ...DEFAULTS, provider: DEFAULT_PROVIDER };
  for (const src of [env, state.overrides || {}]) {
    for (const [k, v] of Object.entries(src)) {
      if (v !== undefined && v !== null && v !== "" && !(typeof v === "number" && Number.isNaN(v))) cfg[k] = v;
      // An empty VOICE_TTS_INSTRUCTIONS disables style instructions.
      if (k === "instructions" && v === "") cfg[k] = v;
    }
  }
  cfg.provider = String(cfg.provider).toLowerCase();
  if (cfg.provider === "gemini") cfg.provider = "google";
  if (!PROVIDERS[cfg.provider]) cfg.provider = DEFAULT_PROVIDER;
  const p = PROVIDERS[cfg.provider];
  const found = cfg.voice ? findVoice(cfg.voice) : null;
  cfg.voice = found && found.provider === cfg.provider ? found.voice : p.voice;
  if (!cfg.model || !p.modelPrefixes.some((prefix) => cfg.model.startsWith(prefix))) cfg.model = p.model;
  return cfg;
}
