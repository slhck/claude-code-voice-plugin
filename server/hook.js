// UserPromptSubmit hook: if voice mode is on, remind Claude to speak this turn.
import { readState, effectiveConfig, loadEnv } from "./state.js";

// Drain stdin (hook input JSON); we don't need its contents.
process.stdin.resume();
process.stdin.on("data", () => {});
process.stdin.on("end", main);
process.stdin.on("error", main);
setTimeout(main, 500).unref();

let done = false;
function main() {
  if (done) return;
  done = true;
  loadEnv();
  const state = readState();
  if (!state.enabled) return process.exit(0);
  const cfg = effectiveConfig(state);
  process.stdout.write(
    `[voice-plugin] Voice mode is ON (provider: ${cfg.provider}, voice: ${cfg.voice}, model: ${cfg.model}). ` +
      `Before ending this turn, speak your reply to the user with the \`speak\` tool of the voice MCP server. ` +
      `Spoken text: plain conversational sentences, no markdown, code, lists, URLs or file paths; usually 1-4 sentences; ` +
      `ask at most one question, then end your turn and wait for the typed answer. ` +
      `Put long or technical content in your text reply and only summarize it aloud. ` +
      `Also include what you said in your text reply so the transcript is complete. ` +
      (cfg.provider === "google"
        ? `You may add sparse inline vocal events to the spoken text where they fit naturally: <laugh>, <sigh>, <breath>, <gasp>, <cough>, <short pause>. `
        : "") +
      `The user turns this off with /voice-plugin:disable.\n`
  );
  process.exit(0);
}
