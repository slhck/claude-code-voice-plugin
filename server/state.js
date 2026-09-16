// Shared helpers: state file, .env loading, effective TTS config.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const STATE_DIR = path.join(os.homedir(), ".claude", "voice-plugin");
export const STATE_FILE = path.join(STATE_DIR, "state.json");

export const VOICES = [
  "alloy", "ash", "ballad", "coral", "echo", "fable", "nova",
  "onyx", "sage", "shimmer", "verse", "marin", "cedar",
];

export const DEFAULTS = {
  model: "gpt-4o-mini-tts",
  voice: "marin",
  instructions: "Cheerful and curious, at a slightly faster than normal pace.",
  speed: 1.0,
};

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

/** Precedence: runtime overrides (state file) > environment > defaults. */
export function effectiveConfig(state = readState()) {
  const env = {
    model: process.env.VOICE_TTS_MODEL,
    voice: process.env.VOICE_TTS_VOICE,
    instructions: process.env.VOICE_TTS_INSTRUCTIONS,
    speed: process.env.VOICE_TTS_SPEED ? Number(process.env.VOICE_TTS_SPEED) : undefined,
  };
  const cfg = { ...DEFAULTS };
  for (const src of [env, state.overrides || {}]) {
    for (const [k, v] of Object.entries(src)) {
      if (v !== undefined && v !== null && !(typeof v === "number" && Number.isNaN(v))) cfg[k] = v;
    }
  }
  return cfg;
}
