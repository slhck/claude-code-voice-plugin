# Claude Code Voice Plugin

A completely vibe-coded Claude Code plugin that lets Claude talk to you out loud using OpenAI's text-to-speech API (`gpt-4o-mini-tts`, the `marin` voice and a cheerful, curious, slightly faster speaking style by default). Turn it on with `/voice-plugin:enable`, and Claude will speak every reply and interview you conversationally, one question at a time. You answer by typing as usual (use your own speech-to-text if you like). Turn it off with `/voice-plugin:disable`.

## Requirements

- Claude Code
- Node.js 18 or newer (already required by Claude Code)
- An audio player: `ffplay` (part of ffmpeg, streams audio for lowest latency), `mpv`, `afplay` (built into macOS), `aplay` or `paplay`
- An OpenAI API key

## Setup

Put your OpenAI API key in a `.env` file (see [Configuration](#configuration) for where) and load the plugin. For development or one-off use:

```bash
claude --plugin-dir /path/to/claude-code-voice-plugin
```

To install it permanently, add this directory as a local marketplace and install from it:

```bash
claude plugin marketplace add /path/to/claude-code-voice-plugin
claude plugin install voice-plugin@voice-plugin-marketplace
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
| `OPENAI_API_KEY`         | (required)        | Your OpenAI API key.                                                                                     |
| `VOICE_TTS_VOICE`        | `marin`           | One of: alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer, verse, marin, cedar.           |
| `VOICE_TTS_MODEL`        | `gpt-4o-mini-tts` | Also `tts-1` or `tts-1-hd`. Only the `gpt-4o-*` models support style instructions.                        |
| `VOICE_TTS_INSTRUCTIONS` | cheerful, curious, slightly faster | Speaking style. Only used with `gpt-4o-*` models. Set to an empty string to disable.                     |
| `VOICE_TTS_SPEED`        | `1.0`             | Playback speed between 0.25 and 4.0.                                                                     |
| `VOICE_PLAYER`           | (auto)            | Audio player command. Auto-detection order: ffplay, mpv, afplay, aplay, paplay. See below.               |

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
VOICE_TTS_VOICE=cedar
VOICE_TTS_MODEL=gpt-4o-mini-tts
VOICE_TTS_INSTRUCTIONS="Calm, curious, conversational."
VOICE_TTS_SPEED=1.1
```

A copy of all options with comments is in `.env.example`. The `.env` files are read every time a tool is called, so edits take effect on the next spoken sentence without restarting Claude Code. Shell variables are only read when the MCP server starts, so those need a restart.

### Via Claude (runtime overrides)

While in a session you can also say "use the cedar voice" or "talk faster", or pass a voice and style to the enable command, e.g. `/voice-plugin:enable nova warm and a bit slower`. Claude then calls the `voice_configure` tool, which stores the override in `~/.claude/voice-plugin/state.json`.

Runtime overrides take precedence over the shell and `.env` values. If you change your `.env` and the change does not seem to apply, an override is probably set. Check with `voice_status` (ask Claude "show voice status") and clear all overrides by asking Claude to reset the voice configuration (it calls `voice_configure` with `reset: true`), or delete the `overrides` entry from the state file.

Precedence, highest first: runtime overrides, then shell environment, then `.env` files in the order listed above, then built-in defaults.

### Audio player

By default the plugin uses the first available of `ffplay`, `mpv`, `afplay`, `aplay`, `paplay`. To force a specific one, set `VOICE_PLAYER` to a full command. Use `{file}` as a placeholder for a temporary WAV file; without `{file}` the audio is streamed to the player's stdin:

```bash
VOICE_PLAYER="afplay {file}"
VOICE_PLAYER="mpv --no-video --really-quiet -"
```

## Usage

- `/voice-plugin:enable` turns voice mode on. Optional arguments: a voice name and/or style instructions, for example `/voice-plugin:enable nova warm and a bit slower`.
- `/voice-plugin:disable` turns it off.

While voice mode is on, Claude speaks each reply before ending its turn, keeps spoken text short and plain, asks at most one question per turn, and puts long or technical content into the text reply only. The mode persists across sessions and context compaction until you disable it, because a `UserPromptSubmit` hook re-injects the instruction on every turn.

You can also ask Claude to change the voice, speaking style, model or speed at any time; see [Configuration](#configuration).

## Tools provided by the MCP server

- `speak` speaks text aloud and blocks until playback has finished. Accepts per-call `voice` and `instructions` overrides.
- `voice_enable` and `voice_disable` toggle voice mode.
- `voice_configure` changes voice, model, instructions or speed persistently (`reset: true` clears overrides).
- `voice_status` shows the current state and configuration.

State lives in `~/.claude/voice-plugin/state.json` and is shared by all Claude Code sessions of your user.

## How it works

- `.mcp.json` registers a zero-dependency MCP server (`server/mcp.js`) that calls the OpenAI speech endpoint and pipes the WAV audio to a local player. Long texts are split into chunks of at most 4000 characters. Concurrent `speak` calls are queued so they never overlap.
- `hooks/hooks.json` runs `server/hook.js` on every prompt. When voice mode is on, it adds a short reminder to Claude's context to speak the reply.
- `skills/enable` and `skills/disable` are the two slash commands.

## Note on AI voices

OpenAI's usage policies require disclosing to listeners that the voice is AI generated. This plugin is meant for you talking to your own assistant, so keep that in mind if you play it to others.
