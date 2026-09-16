---
description: Turn off voice mode so Claude stops speaking replies aloud and goes back to text only.
---

# Disable voice mode

1. Speak one short closing sentence with the `speak` tool (for example "Okay, switching voice off."), unless the user asked for silence or the speak tool is failing.
2. Call the `voice_disable` tool of the voice MCP server.
3. Confirm in text that voice mode is off. From now on reply in text only and do not call `speak` unless the user explicitly asks you to say something aloud.
