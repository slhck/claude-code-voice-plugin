#!/usr/bin/env node
// Minimal zero-dependency MCP server (stdio, newline-delimited JSON-RPC)
// exposing OpenAI or Google Gemini text-to-speech as tools for Claude Code.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import readline from "node:readline";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import {
  PROVIDERS, ALL_VOICES, findVoice, apiKey, loadEnv, readState, writeState, effectiveConfig, STATE_FILE,
} from "./state.js";

const SERVER_INFO = { name: "voice-plugin", version: "0.2.0" };
const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_CHUNK = 4000; // OpenAI input limit is 4096 chars; Gemini allows 8192 tokens

loadEnv();

// ---------- audio playback ----------

function which(bin) {
  const r = spawnSync("which", [bin], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** Returns { cmd, args, streams } where args may contain "{file}". */
function pickPlayer() {
  const custom = process.env.VOICE_PLAYER;
  if (custom) {
    const parts = custom.match(/(?:[^\s"]+|"[^"]*")+/g).map((p) => p.replace(/^"|"$/g, ""));
    return { cmd: parts[0], args: parts.slice(1), streams: !custom.includes("{file}") };
  }
  const candidates = [
    { cmd: "ffplay", args: ["-nodisp", "-autoexit", "-loglevel", "quiet", "-i", "-"], streams: true },
    { cmd: "mpv", args: ["--no-video", "--really-quiet", "-"], streams: true },
    { cmd: "afplay", args: ["{file}"], streams: false },
    { cmd: "aplay", args: ["-q", "{file}"], streams: false },
    { cmd: "paplay", args: ["{file}"], streams: false },
  ];
  for (const c of candidates) if (which(c.cmd)) return c;
  throw new Error("No audio player found. Install ffmpeg (ffplay) or mpv, or set VOICE_PLAYER in .env.");
}

/** Play audio from a Node.js readable stream. */
async function play(audio) {
  const player = pickPlayer();
  if (player.streams) {
    const child = spawn(player.cmd, player.args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    const exit = new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${player.cmd} exited ${code}: ${stderr.trim()}`))));
    });
    child.stdin.on("error", () => {}); // player may close early
    await pipeline(audio, child.stdin).catch(() => {});
    await exit;
    return;
  }
  const file = path.join(os.tmpdir(), `voice-plugin-${process.pid}-${Date.now()}.wav`);
  try {
    await pipeline(audio, fs.createWriteStream(file));
    const args = player.args.map((a) => a.replace("{file}", file));
    const r = spawnSync(player.cmd, args, { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`${player.cmd} exited ${r.status}: ${(r.stderr || "").trim()}`);
  } finally {
    fs.rm(file, { force: true }, () => {});
  }
}

// ---------- TTS providers ----------

function chunkText(text) {
  const chunks = [];
  let rest = text.trim();
  while (rest.length > MAX_CHUNK) {
    let cut = rest.lastIndexOf(". ", MAX_CHUNK);
    if (cut < MAX_CHUNK / 2) cut = rest.lastIndexOf(" ", MAX_CHUNK);
    if (cut <= 0) cut = MAX_CHUNK;
    chunks.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function requireKey(provider) {
  const key = apiKey(provider);
  if (!key) {
    const vars = PROVIDERS[provider].keyVars.join(" or ");
    throw new Error(`${vars} is not set. Put it in .env (project root or plugin root) or the environment.`);
  }
  return key;
}

/** Return a readable stream of WAV audio for the text. */
async function synthesize(text, cfg) {
  return cfg.provider === "google" ? synthesizeGoogle(text, cfg) : synthesizeOpenAI(text, cfg);
}

async function synthesizeOpenAI(text, cfg) {
  const key = requireKey("openai");
  const body = { model: cfg.model, voice: cfg.voice, input: text, response_format: "wav" };
  if (cfg.instructions && cfg.model.startsWith("gpt-")) body.instructions = cfg.instructions;
  if (cfg.speed && cfg.speed !== 1) body.speed = cfg.speed;
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OpenAI TTS error ${res.status}: ${(await res.text()).slice(0, 500)}`);
  return Readable.fromWeb(res.body);
}

/** Find the base64 audio data in a Gemini Interactions API response (usually steps[].content[] with type "audio"). */
function findAudioData(node) {
  if (!node || typeof node !== "object") return null;
  const audio = node.output_audio ?? node.outputAudio;
  if (typeof audio?.data === "string") return audio.data;
  const mime = node.mime_type ?? node.mimeType;
  if (typeof node.data === "string" && (node.type === "audio" || String(mime).startsWith("audio/"))) return node.data;
  for (const v of Object.values(node)) {
    const found = findAudioData(v);
    if (found) return found;
  }
  return null;
}

/** Gemini TTS via the Interactions API. The default response is a 24 kHz mono WAV file. */
async function synthesizeGoogle(text, cfg) {
  const key = requireKey("google");
  const content = { type: "text", text };
  if (cfg.instructions) content.annotations = [{ type: "speech_metadata", style: cfg.instructions }];
  const body = {
    model: cfg.model,
    input: [{ type: "user_input", content: [content] }],
    response_format: { type: "audio", mime_type: "audio/wav" },
    generation_config: { speech_config: [{ voice: cfg.voice }] },
  };
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini TTS error ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const data = findAudioData(await res.json());
  if (!data) throw new Error("Gemini TTS response contained no audio.");
  return Readable.from([Buffer.from(data, "base64")]);
}

let speaking = Promise.resolve();
/** Serialize playback so overlapping speak calls don't talk over each other. */
function enqueueSpeech(fn) {
  const next = speaking.then(fn, fn);
  speaking = next.catch(() => {});
  return next;
}

// ---------- tools ----------

/**
 * Validate tool arguments. A voice or model from another provider switches the
 * provider; switching the provider without a voice or model drops the old ones.
 */
function validateOverrides(o) {
  const out = {};
  if (o.provider !== undefined) {
    let provider = String(o.provider).toLowerCase();
    if (provider === "gemini") provider = "google";
    if (!PROVIDERS[provider]) throw new Error(`Unknown provider "${o.provider}". Valid: ${Object.keys(PROVIDERS).join(", ")}`);
    out.provider = provider;
  }
  if (o.voice !== undefined) {
    const found = findVoice(o.voice);
    if (!found) throw new Error(`Unknown voice "${o.voice}". Valid: ${ALL_VOICES.join(", ")}`);
    if (out.provider && out.provider !== found.provider) {
      throw new Error(`Voice "${found.voice}" belongs to ${PROVIDERS[found.provider].label}, not ${PROVIDERS[out.provider].label}.`);
    }
    out.provider = found.provider;
    out.voice = found.voice;
  }
  if (o.model !== undefined) {
    out.model = String(o.model);
    const provider = Object.keys(PROVIDERS).find((k) => PROVIDERS[k].modelPrefixes.some((p) => out.model.startsWith(p)));
    if (!provider) throw new Error(`Unknown model "${out.model}".`);
    if (out.provider && out.provider !== provider) {
      throw new Error(`Model "${out.model}" belongs to ${PROVIDERS[provider].label}, not ${PROVIDERS[out.provider].label}.`);
    }
    out.provider = provider;
  }
  if (o.instructions !== undefined) out.instructions = String(o.instructions);
  if (o.speed !== undefined) {
    const s = Number(o.speed);
    if (!(s >= 0.25 && s <= 4)) throw new Error("speed must be between 0.25 and 4.0");
    out.speed = s;
  }
  return out;
}

/** Merge new overrides into the stored ones, dropping voice and model of a previous provider. */
function mergeOverrides(current, next) {
  const merged = { ...current, ...next };
  if (next.provider && next.provider !== effectiveConfig({ overrides: current }).provider) {
    if (next.voice === undefined) delete merged.voice;
    if (next.model === undefined) delete merged.model;
  }
  return merged;
}

function statusText(state = readState()) {
  const cfg = effectiveConfig(state);
  const p = PROVIDERS[cfg.provider];
  return [
    `Voice mode: ${state.enabled ? "ON" : "OFF"}`,
    `Provider: ${cfg.provider} (${p.label})`,
    `Model: ${cfg.model}`,
    `Voice: ${cfg.voice}`,
    `Instructions: ${cfg.instructions || "(none)"}`,
    `Speed: ${cfg.speed}${cfg.provider === "google" ? " (ignored by Gemini; ask for a faster pace in the instructions instead)" : ""}`,
    `API key (${p.keyVars.join(" or ")}): ${apiKey(cfg.provider) ? "set" : "MISSING"}`,
    `State file: ${STATE_FILE}`,
  ].join("\n");
}

const TOOLS = [
  {
    name: "speak",
    description:
      "Speak text aloud to the user through the computer's speakers using OpenAI or Google Gemini text-to-speech. " +
      "Blocks until playback has finished. Use this for every reply while voice mode is enabled " +
      "(see /voice-plugin:enable), or when the user explicitly asks you to say something out loud. " +
      "Pass plain conversational prose: no markdown, code, lists, URLs or file paths.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description:
            "What to say. Plain prose, ideally 1-4 sentences. Only when the provider is google (see voice_status), " +
            "you may add sparse inline vocal events: <laugh>, <sigh>, <breath>, <gasp>, <cough>, <short pause>. " +
            "Never use them with openai, which would read them aloud.",
        },
        voice: { type: "string", description: "Override the configured voice for this utterance only. Must belong to the configured provider." },
        instructions: { type: "string", description: "Override the speaking style for this utterance only (tone, pace, emotion). Supported by gpt-4o-* and Gemini TTS models." },
      },
      required: ["text"],
    },
  },
  {
    name: "voice_enable",
    description: "Turn voice mode on. Optionally set provider, voice, model, style instructions or speed at the same time. Returns the effective configuration.",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string", enum: Object.keys(PROVIDERS), description: "TTS provider. Default: openai." },
        voice: { type: "string", enum: ALL_VOICES, description: "A voice of either provider; selects that provider." },
        model: { type: "string", description: "e.g. gpt-4o-mini-tts, tts-1, tts-1-hd, gemini-3.8-flash-tts, gemini-3.8-flash-lite-tts" },
        instructions: { type: "string", description: "Speaking style, e.g. 'warm, curious, slightly faster than normal'." },
        speed: { type: "number", minimum: 0.25, maximum: 4 },
      },
    },
  },
  {
    name: "voice_disable",
    description: "Turn voice mode off. Claude stops speaking replies aloud.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "voice_configure",
    description: "Change the provider, voice, model, style instructions or speed used by speak. Persists across sessions. Pass reset=true to clear all overrides and return to .env / defaults.",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string", enum: Object.keys(PROVIDERS), description: "openai or google. Switching resets voice and model to the provider's defaults unless given." },
        voice: { type: "string", enum: ALL_VOICES, description: "A voice of either provider; selects that provider." },
        model: { type: "string", description: "e.g. gpt-4o-mini-tts, tts-1, tts-1-hd, gemini-3.8-flash-tts, gemini-3.8-flash-lite-tts" },
        instructions: { type: "string" },
        speed: { type: "number", minimum: 0.25, maximum: 4 },
        reset: { type: "boolean" },
      },
    },
  },
  {
    name: "voice_status",
    description: "Show whether voice mode is on and the current TTS configuration (provider, model, voice, instructions, speed).",
    inputSchema: { type: "object", properties: {} },
  },
];

async function callTool(name, args = {}) {
  switch (name) {
    case "speak": {
      const text = String(args.text ?? "").trim();
      if (!text) throw new Error("text is required");
      const state = readState();
      const cfg = { ...effectiveConfig(state), ...validateOverrides({ voice: args.voice, instructions: args.instructions }) };
      if (args.voice !== undefined && cfg.provider !== effectiveConfig(state).provider) {
        throw new Error(`Voice "${cfg.voice}" belongs to ${PROVIDERS[cfg.provider].label}. Switch providers with voice_configure first.`);
      }
      const chunks = chunkText(text);
      const t0 = Date.now();
      await enqueueSpeech(async () => {
        for (const chunk of chunks) await play(await synthesize(chunk, cfg));
      });
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      return `Spoke ${text.length} characters (${chunks.length} chunk${chunks.length === 1 ? "" : "s"}) with voice "${cfg.voice}" in ${secs}s.` +
        (state.enabled ? "" : "\nNote: voice mode is OFF; run /voice-plugin:enable to speak every turn.");
    }
    case "voice_enable": {
      const overrides = mergeOverrides(readState().overrides, validateOverrides(args));
      const state = writeState({ enabled: true, overrides });
      return "Voice mode enabled.\n" + statusText(state);
    }
    case "voice_disable": {
      const state = writeState({ enabled: false });
      return "Voice mode disabled.\n" + statusText(state);
    }
    case "voice_configure": {
      const overrides = args.reset ? {} : mergeOverrides(readState().overrides, validateOverrides(args));
      const state = writeState({ overrides });
      return "Configuration updated.\n" + statusText(state);
    }
    case "voice_status":
      return statusText();
    default:
      throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
  }
}

// ---------- JSON-RPC over stdio ----------

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function handle(msg) {
  const { id, method, params = {} } = msg;
  const isRequest = id !== undefined && id !== null;
  try {
    let result;
    switch (method) {
      case "initialize":
        result = {
          protocolVersion: SUPPORTED_PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : SUPPORTED_PROTOCOLS[0],
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        };
        break;
      case "notifications/initialized":
      case "notifications/cancelled":
        return;
      case "ping":
        result = {};
        break;
      case "tools/list":
        result = { tools: TOOLS };
        break;
      case "tools/call": {
        try {
          const text = await callTool(params.name, params.arguments);
          result = { content: [{ type: "text", text }], isError: false };
        } catch (err) {
          if (err.code === -32602) throw err;
          result = { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
        }
        break;
      }
      default:
        if (!isRequest) return;
        throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
    }
    if (isRequest) send({ jsonrpc: "2.0", id, result });
  } catch (err) {
    if (isRequest) send({ jsonrpc: "2.0", id, error: { code: err.code ?? -32603, message: err.message } });
  }
}

let pending = 0;
let closed = false;
function maybeExit() {
  if (closed && pending === 0) process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  line = line.trim();
  if (!line) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  }
  pending++;
  handle(msg).finally(() => {
    pending--;
    maybeExit();
  });
});
rl.on("close", () => {
  closed = true;
  maybeExit();
});
process.on("uncaughtException", (err) => process.stderr.write(`voice-plugin: ${err.stack}\n`));
