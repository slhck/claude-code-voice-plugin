#!/usr/bin/env node
// Minimal zero-dependency MCP server (stdio, newline-delimited JSON-RPC)
// exposing OpenAI text-to-speech as tools for Claude Code.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import readline from "node:readline";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import {
  VOICES, loadEnv, readState, writeState, effectiveConfig, STATE_FILE,
} from "./state.js";

const SERVER_INFO = { name: "voice-plugin", version: "0.1.0" };
const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_CHUNK = 4000; // OpenAI input limit is 4096 chars

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

async function play(bodyStream) {
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
    await pipeline(Readable.fromWeb(bodyStream), child.stdin).catch(() => {});
    await exit;
    return;
  }
  const file = path.join(os.tmpdir(), `voice-plugin-${process.pid}-${Date.now()}.wav`);
  try {
    await pipeline(Readable.fromWeb(bodyStream), fs.createWriteStream(file));
    const args = player.args.map((a) => a.replace("{file}", file));
    const r = spawnSync(player.cmd, args, { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`${player.cmd} exited ${r.status}: ${(r.stderr || "").trim()}`);
  } finally {
    fs.rm(file, { force: true }, () => {});
  }
}

// ---------- OpenAI TTS ----------

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

async function synthesize(text, cfg) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set. Put it in .env (project root or plugin root) or the environment.");
  const body = { model: cfg.model, voice: cfg.voice, input: text, response_format: "wav" };
  if (cfg.instructions && cfg.model.startsWith("gpt-")) body.instructions = cfg.instructions;
  if (cfg.speed && cfg.speed !== 1) body.speed = cfg.speed;
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OpenAI TTS error ${res.status}: ${(await res.text()).slice(0, 500)}`);
  return res.body;
}

let speaking = Promise.resolve();
/** Serialize playback so overlapping speak calls don't talk over each other. */
function enqueueSpeech(fn) {
  const next = speaking.then(fn, fn);
  speaking = next.catch(() => {});
  return next;
}

// ---------- tools ----------

function validateOverrides(o) {
  const out = {};
  if (o.voice !== undefined) {
    if (!VOICES.includes(o.voice)) throw new Error(`Unknown voice "${o.voice}". Valid: ${VOICES.join(", ")}`);
    out.voice = o.voice;
  }
  if (o.model !== undefined) out.model = String(o.model);
  if (o.instructions !== undefined) out.instructions = String(o.instructions);
  if (o.speed !== undefined) {
    const s = Number(o.speed);
    if (!(s >= 0.25 && s <= 4)) throw new Error("speed must be between 0.25 and 4.0");
    out.speed = s;
  }
  return out;
}

function statusText(state = readState()) {
  const cfg = effectiveConfig(state);
  return [
    `Voice mode: ${state.enabled ? "ON" : "OFF"}`,
    `Model: ${cfg.model}`,
    `Voice: ${cfg.voice}`,
    `Instructions: ${cfg.instructions || "(none)"}`,
    `Speed: ${cfg.speed}`,
    `API key: ${process.env.OPENAI_API_KEY ? "set" : "MISSING"}`,
    `State file: ${STATE_FILE}`,
  ].join("\n");
}

const TOOLS = [
  {
    name: "speak",
    description:
      "Speak text aloud to the user through the computer's speakers using OpenAI text-to-speech. " +
      "Blocks until playback has finished. Use this for every reply while voice mode is enabled " +
      "(see /voice-plugin:enable), or when the user explicitly asks you to say something out loud. " +
      "Pass plain conversational prose: no markdown, code, lists, URLs or file paths.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "What to say. Plain prose, ideally 1-4 sentences." },
        voice: { type: "string", enum: VOICES, description: "Override the configured voice for this utterance only." },
        instructions: { type: "string", description: "Override the speaking style for this utterance only (tone, pace, emotion). Only supported by gpt-4o-* TTS models." },
      },
      required: ["text"],
    },
  },
  {
    name: "voice_enable",
    description: "Turn voice mode on. Optionally set voice, model, style instructions or speed at the same time. Returns the effective configuration.",
    inputSchema: {
      type: "object",
      properties: {
        voice: { type: "string", enum: VOICES },
        model: { type: "string", description: "e.g. gpt-4o-mini-tts, tts-1, tts-1-hd" },
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
    description: "Change the voice, model, style instructions or speed used by speak. Persists across sessions. Pass reset=true to clear all overrides and return to .env / defaults.",
    inputSchema: {
      type: "object",
      properties: {
        voice: { type: "string", enum: VOICES },
        model: { type: "string" },
        instructions: { type: "string" },
        speed: { type: "number", minimum: 0.25, maximum: 4 },
        reset: { type: "boolean" },
      },
    },
  },
  {
    name: "voice_status",
    description: "Show whether voice mode is on and the current TTS configuration (model, voice, instructions, speed).",
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
      const overrides = { ...readState().overrides, ...validateOverrides(args) };
      const state = writeState({ enabled: true, overrides });
      return "Voice mode enabled.\n" + statusText(state);
    }
    case "voice_disable": {
      const state = writeState({ enabled: false });
      return "Voice mode disabled.\n" + statusText(state);
    }
    case "voice_configure": {
      const overrides = args.reset ? {} : { ...readState().overrides, ...validateOverrides(args) };
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
