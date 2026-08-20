# Copilot Instructions

## Project Guidelines
- In the plugin options UI, only top-level sections should be expandable/collapsible and they should default to expanded; nested subsections should not be collapsible.

## Terminal UI Guidelines
- In the serial terminal UI, do not tint the terminal background; keep the context menu background white.
- Place a Hex checkbox before the Send button; when Hex is checked, the input must accept only 16 hex characters and send them as corresponding hex bytes.
- HandShake over Serial: When the user clicks the HandShake button, send a predefined handshake sequence "[MLAstroRPA-TC]" to the connected serial device and wait for "OK!" response. 
  If the response matches the expected handshake response "OK!", display a "HandShake: OK!"; otherwise, display "HandShake: NO ANSWER".