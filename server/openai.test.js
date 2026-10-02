import assert from "node:assert/strict";
import { test } from "node:test";
import { synthesizeOpenAI } from "./openai.js";
import { effectiveConfig, migrateModel } from "./state.js";

function mock(events) {
  const sent = [];
  let request;
  let socket;
  class Socket extends EventTarget {
    constructor(url, protocols) {
      super();
      socket = this;
      this.url = url;
      this.protocols = protocols;
      queueMicrotask(() => this.emit({ type: "session.created" }));
    }
    emit(event) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(event) })); }
    send(data) {
      sent.push(JSON.parse(data));
      queueMicrotask(() => {
        for (const event of events) {
          if (event === "close") this.dispatchEvent(new Event("close"));
          else this.emit(event);
        }
      });
    }
    close() { this.closed = true; }
  }
  return {
    deps: {
      WebSocketImpl: Socket,
      fetchImpl: async (url, options) => {
        request = { url, ...options, body: JSON.parse(options.body) };
        return { ok: true, json: async () => ({ value: "ephemeral-test-secret" }) };
      },
      timeoutMs: 20,
    },
    sent,
    get request() { return request; },
    get socket() { return socket; },
  };
}

const cfg = { model: "gpt-realtime-2.1-mini", voice: "marin", speed: 1.1, instructions: "Calm." };

test("Realtime requests supplied text and returns correctly framed WAV", async () => {
  const pcm = Buffer.from([0, 0, 1, 0]);
  const m = mock([
    { type: "response.output_audio.delta", delta: pcm.toString("base64") },
    { type: "response.done", response: { status: "completed" } },
  ]);
  const stream = await synthesizeOpenAI("What is two plus two?", cfg, "primary-test-key", m.deps);
  const parts = [];
  for await (const part of stream) parts.push(part);
  const bytes = Buffer.concat(parts);
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
  assert.equal(bytes.readUInt32LE(4), 40);
  assert.equal(bytes.readUInt32LE(24), 24000);
  assert.equal(bytes.readUInt32LE(40), pcm.length);
  assert.deepEqual(bytes.subarray(44), pcm);
  assert.equal(m.request.headers.Authorization, "Bearer primary-test-key");
  assert.equal(m.request.body.session.model, cfg.model);
  assert.equal(m.request.body.session.audio.input.turn_detection, null);
  assert.equal(m.request.body.session.audio.output.speed, 1.1);
  assert.match(m.request.body.session.instructions, /verbatim/);
  assert.deepEqual(m.socket.protocols, ["realtime", "openai-insecure-api-key.ephemeral-test-secret"]);
  assert.equal(m.sent[0].response.input[0].content[0].text, "What is two plus two?");
  assert.equal(m.socket.closed, true);
});

for (const [name, events, error] of [
  ["API errors", [{ type: "error", error: { message: "Rate limit" } }], /Rate limit/],
  ["failed responses", [{ type: "response.done", response: { status: "failed" } }], /failed/],
  ["empty audio", [{ type: "response.done", response: { status: "completed" } }], /no audio/],
  ["early disconnects", ["close"], /closed before/],
  ["timeouts", [], /timed out/],
]) {
  test(`Realtime rejects ${name} and closes the connection`, async () => {
    const m = mock(events);
    await assert.rejects(synthesizeOpenAI("Hello", cfg, "key", m.deps), error);
    assert.equal(m.socket.closed, true);
  });
}

test("retired models migrate in saved state and provider switching still works", () => {
  for (const model of ["tts-1", "tts-1-hd", "tts-hd", "gpt-4o-mini-tts", "gpt-4o-mini-tts-2025-12-15"]) {
    assert.equal(migrateModel(model), cfg.model);
    assert.equal(effectiveConfig({ overrides: { provider: "openai", model, voice: "nova" } }).model, cfg.model);
    assert.equal(effectiveConfig({ overrides: { provider: "openai", model, voice: "nova" } }).voice, "marin");
  }
  assert.equal(effectiveConfig({ overrides: { provider: "google", model: "gemini-3.8-flash-lite-tts", voice: "Puck" } }).model,
    "gemini-3.8-flash-lite-tts");
});

test("unsupported speed fails before contacting the API", async () => {
  const m = mock([]);
  await assert.rejects(synthesizeOpenAI("Hello", { ...cfg, speed: 4 }, "key", m.deps), /between 0.25 and 1.5/);
  assert.equal(m.request, undefined);
});
