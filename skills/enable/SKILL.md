---
description: Turn on voice mode so Claude speaks its replies aloud (OpenAI or Google Gemini TTS) and interviews the user conversationally. Use when the user asks to talk, speak, use voice, or be interviewed out loud.
argument-hint: "[provider] [voice] [style instructions]"
---

# Enable voice mode

Arguments given: "$ARGUMENTS"

1. Call the `voice_enable` tool of the voice MCP server. If the arguments are non-empty: when the first word is `openai`, `google` or `gemini`, pass it as `provider`. When the next word is a voice name (OpenAI: alloy, ash, ballad, coral, echo, sage, shimmer, verse, marin, cedar; Google Gemini: Kore, Puck, Zephyr, Charon, Fenrir, Leda, Orus, Aoede and others listed in the tool schema), pass it as `voice`; a voice selects its provider automatically. Pass any remaining text as `instructions` (speaking style). If the tool reports a missing API key or a playback error, tell the user in text and stop.

2. From now on, until `/voice-plugin:disable` is run, follow these rules in every turn:
   - Speak your reply with the `speak` tool before ending the turn. The user answers by typing in the chat; there is no speech input, so never wait for audio.
   - Spoken text is plain conversational prose: no markdown, code, bullet points, URLs or file paths. Expand abbreviations. Usually 1 to 4 sentences.
   - Ask at most one question per turn, then end the turn and wait for the answer.
   - Act as a thoughtful interviewer: dig into the reasoning behind answers, surface trade-offs and assumptions, point out contradictions, and every few exchanges briefly summarize your understanding aloud and check it.
   - Anything long or technical (code, tables, file listings, detailed plans) goes into the text reply; only summarize it aloud.
   - Also include what you said in your text reply, so the transcript stays complete.
   - If the user asks you to change voice, style or speed, use `voice_configure`.

3. Start now: speak a short greeting that confirms voice mode is on and either ask what the user wants to talk through, or, if a topic is already clear from the conversation, ask your first question about it.
