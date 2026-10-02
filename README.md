# Claude Code Voice Plugin

A completely vibe-coded Claude Code plugin that lets Claude talk to you out loud using OpenAI's Realtime API (`gpt-realtime-2.1-mini`, the `marin` voice and a cheerful, curious, slightly faster speaking style by default). Google's Gemini 3.8 TTS models are available as a second provider. Turn it on with `/voice-plugin:enable`, and Claude will speak every reply and interview you conversationally, one question at a time. You answer by typing as usual (use your own speech-to-text if you like). Turn it off with `/voice-plugin:disable`.

## Requirements

- Claude Code
- Node.js 22.4 or newer (required for built-in WebSocket support)
- An audio player: `ffplay` (part of ffmpeg, streams audio for lowest latency), `mpv`, `afplay` (built into macOS), `aplay` or `paplay`
- An OpenAI API key, or a Gemini API key if you use the Google provider

## Setup

Put your OpenAI API key (or Gemini API key) in a `.env` file (see [Configuration](#configuration) for where).

### Install from GitHub (recommended)

Inside a Claude Code session, add this repo as a marketplace and install the plugin from it:

```
/plugin marketplace add slhck/claude-code-voice-plugin
/plugin install voice-plugin@voice-plugin-marketplace
```

This installs it permanently; it stays available in future sessions. To update later, run `/plugin marketplace update voice-plugin-marketplace` followed by `/plugin update voice-plugin`.

### Local development

To try it out without installing, point Claude Code at a local checkout:

```bash
claude --plugin-dir /path/to/claude-code-voice-plugin
```

Or add the local directory as a marketplace and install from it, the same way as the GitHub install above:

```
/plugin marketplace add /path/to/claude-code-voice-plugin
/plugin install voice-plugin@voice-plugin-marketplace
```

To avoid a permission prompt on every spoken sentence, allow the plugin's tools in your settings (`~/.claude/settings.json` or the project's `.claude/settings.json`):

```json
{
  "permissions": {
    "allow": ["mcp__plugin_voice-plugin_voice__*"]
  }
}
```

## Configuration

Everything is configured through environment variables. You can set them in your shell before starting Claude Code, or put them in a `.env` file.

| Variable                 | Default           | Meaning                                                                                                  |
| ------------------------ | ----------------- | -------------------------------------------------------------------------------------------------------- |
| `VOICE_TTS_PROVIDER`     | `openai`          | `openai` or `google`. See [Providers](#providers).                                                       |
| `OPENAI_API_KEY`         | (required for OpenAI) | Your OpenAI API key.                                                                                 |
| `GEMINI_API_KEY`         | (required for Google) | Your Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey). `GOOGLE_API_KEY` also works. |
| `VOICE_TTS_VOICE`        | `marin` / `Kore`  | A voice of the selected provider. See [Providers](#providers) for the list.                              |
| `VOICE_TTS_MODEL`        | `gpt-realtime-2.1-mini` / `gemini-3.8-flash-tts` | A model of the selected provider. See [Providers](#providers).                  |
| `VOICE_TTS_INSTRUCTIONS` | cheerful, curious, slightly faster | Speaking style. Used by OpenAI Realtime and all Gemini models. Set to an empty string to disable.  |
| `VOICE_TTS_SPEED`        | `1.0`             | Playback speed between 0.25 and 1.5. OpenAI only; for Gemini, ask for a faster pace in the instructions. |
| `VOICE_PLAYER`           | (auto)            | Audio player command. Auto-detection order: ffplay, mpv, afplay, aplay, paplay. See below.               |

To find a voice and test its malleability, you can use [openai.fm](https://www.openai.fm/) for OpenAI or [Google AI Studio](https://aistudio.google.com/generate-speech) for Gemini.

If the voice or model does not belong to the selected provider (for example `VOICE_TTS_VOICE=cedar` with `VOICE_TTS_PROVIDER=google`), the plugin uses that provider's default voice or model instead.

### Providers

OpenAI is the default. To use Google instead, set `VOICE_TTS_PROVIDER=google` and `GEMINI_API_KEY`, or tell Claude "switch to the Google voice" during a session.

OpenAI models:

- `gpt-realtime-2.1-mini` (default) supports style instructions.

Version 0.3.0 migrates OpenAI speech to the Realtime API. OpenAI retires `tts-1`, `tts-1-hd`, and `gpt-4o-mini-tts` on January 6, 2027 and [recommends migrating to `gpt-realtime-2.1-mini`](https://developers.openai.com/api/docs/deprecations#2026-10-01-text-to-speech-models). Legacy model names (including dated TTS snapshots) in environment variables or runtime overrides automatically resolve to the new default. Unsupported legacy voices (`fable`, `nova`, `onyx`) in existing configuration fall back to `marin`. Saved speeds above 1.5 must be reduced with `voice_configure` or in `.env`.

OpenAI voices: alloy, ash, ballad, coral, echo, sage, shimmer, verse, marin (default), cedar.

Google models ([announcement](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-8-text-to-speech/)):

- `gemini-3.8-flash-tts` (default) has the best voice quality and acting.
- `gemini-3.8-flash-lite-tts` has lower latency and is cheaper.

Google voices: Kore (default), Puck, Zephyr, Charon, Fenrir, Leda, Orus, Aoede, Callirrhoe, Autonoe, Enceladus, Iapetus, Umbriel, Algieba, Despina, Erinome, Algenib, Rasalgethi, Laomedeia, Achernar, Alnilam, Schedar, Gacrux, Pulcherrima, Achird, Zubenelgenubi, Vindemiatrix, Sadachbia, Sadaltager, Sulafat. Google's extended voice library and custom (designed or cloned) voices are not supported.

Price comparison as of October 2026 (check [OpenAI pricing](https://openai.com/api/pricing/) and [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) for current numbers). Costs per minute are estimates for spoken audio; the text input cost is negligible in comparison.

| Model                       | Text input      | Audio output     | Approx. per minute of speech |
| --------------------------- | --------------- | ---------------- | ---------------------------- |
| `gpt-realtime-2.1-mini`    | $0.60 / 1M tokens | $20.00 / 1M tokens | depends on generated tokens |
| `gemini-3.8-flash-tts`      | $0.50 / 1M tokens | $9.00 / 1M tokens | $0.0135                   |
| `gemini-3.8-flash-lite-tts` | $0.50 / 1M tokens | $6.00 / 1M tokens | $0.009                    |

The Gemini prices are introductory: from January 1, 2027, they double (text $1.00, audio $18.00 for Flash and $12.00 for Flash-Lite per 1M tokens). Gemini bills 25 audio tokens per second of speech. The Gemini API also has a free tier with rate limits, which is enough for trying it out. Other differences:

- Gemini adds an invisible SynthID watermark to all audio.
- Gemini has no speed setting; ask for a faster or slower pace in the instructions.
- Gemini returns the complete audio file at once, so playback starts only after the whole chunk has been generated. The OpenAI adapter collects Realtime PCM audio into a WAV file before playback too.
- Gemini understands inline vocal events such as `<laugh>`, `<sigh>` or `<short pause>`. When Google is the active provider, Claude is told it may use them sparingly.

### Via the shell

Export the variables before starting Claude Code. The MCP server inherits the environment:

```bash
export VOICE_TTS_VOICE=cedar
export VOICE_TTS_INSTRUCTIONS="Calm, curious, conversational."
claude
```

Put the exports in your `~/.zshrc` or `~/.bashrc` to make them permanent.

### Via a .env file

The plugin reads these files, in this order, and never overrides a variable that is already set:

1. `.env` in the current project directory (the directory where you started Claude Code)
2. `.env` in the plugin directory
3. `~/.claude/voice-plugin/.env` (good for a global, per-user config)

Example `~/.claude/voice-plugin/.env`:

```bash
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
VOICE_TTS_PROVIDER=openai
VOICE_TTS_VOICE=cedar
VOICE_TTS_MODEL=gpt-realtime-2.1-mini
VOICE_TTS_INSTRUCTIONS="Calm, curious, conversational."
VOICE_TTS_SPEED=1.1
```

A copy of all options with comments is in `.env.example`. The `.env` files are read every time a tool is called, so edits take effect on the next spoken sentence without restarting Claude Code. Shell variables are only read when the MCP server starts, so those need a restart.

### Via Claude (runtime overrides)

While in a session you can also say "use the cedar voice", "switch to Google" or "talk faster", or pass a provider, voice and style to the enable command, e.g. `/voice-plugin:enable coral warm and a bit slower` or `/voice-plugin:enable google Puck calm`. Choosing a voice of the other provider switches the provider, and switching the provider without naming a voice or model uses that provider's defaults. Claude then calls the `voice_configure` tool, which stores the override in `~/.claude/voice-plugin/state.json`.

Runtime overrides take precedence over the shell and `.env` values. If you change your `.env` and the change does not seem to apply, an override is probably set. Check with `voice_status` (ask Claude "show voice status") and clear all overrides by asking Claude to reset the voice configuration (it calls `voice_configure` with `reset: true`), or delete the `overrides` entry from the state file.

Precedence is: runtime overrides, then shell environment, then `.env` files in the order listed above, then built-in defaults.

### Audio player

By default the plugin uses the first available of `ffplay`, `mpv`, `afplay`, `aplay`, `paplay`. To force a specific one, set `VOICE_PLAYER` to a full command. Use `{file}` as a placeholder for a temporary WAV file; without `{file}` the audio is streamed to the player's stdin:

```bash
VOICE_PLAYER="afplay {file}"
VOICE_PLAYER="mpv --no-video --really-quiet -"
```

## Usage

- `/voice-plugin:enable` turns voice mode on. Optional arguments: a provider (`openai` or `google`), a voice name and/or style instructions, for example `/voice-plugin:enable coral warm and a bit slower`.
- `/voice-plugin:disable` turns it off.

While voice mode is on, Claude speaks each reply before ending its turn, keeps spoken text short and plain, asks at most one question per turn, and puts long or technical content into the text reply only. The mode persists across sessions and context compaction until you disable it, because a `UserPromptSubmit` hook re-injects the instruction on every turn.

You can also ask Claude to change the provider, voice, speaking style, model or speed at any time; see [Configuration](#configuration).

## Tools provided by the MCP server

- `speak` speaks text aloud and blocks until playback has finished. Accepts per-call `voice` and `instructions` overrides.
- `voice_enable` and `voice_disable` toggle voice mode.
- `voice_configure` changes provider, voice, model, instructions or speed persistently (`reset: true` clears overrides).
- `voice_status` shows the current state and configuration.

State lives in `~/.claude/voice-plugin/state.json` and is shared by all Claude Code sessions of your user.

## How it works

- `.mcp.json` registers a zero-dependency MCP server (`server/mcp.js`) that calls the OpenAI Realtime API over WebSocket (or the Gemini Interactions API) and pipes the WAV audio to a local player. The OpenAI adapter creates a short-lived client secret, requests an audio reading of the supplied text, and converts the returned 24 kHz PCM into WAV. Realtime is a conversational model, so verbatim reading is instructed but cannot be guaranteed as strictly as with the former TTS endpoint. Long texts are split into chunks of at most 4000 characters. Concurrent `speak` calls are queued so they never overlap.
- `hooks/hooks.json` runs `server/hook.js` on every prompt. When voice mode is on, it adds a short reminder to Claude's context to speak the reply.
- `skills/enable` and `skills/disable` are the two slash commands.

## Note on AI voices

OpenAI's usage policies require disclosing to listeners that the voice is AI generated, and Gemini marks its audio with a SynthID watermark. This plugin is meant for you talking to your own assistant, so keep that in mind if you play it to others.
