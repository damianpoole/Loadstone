# TUI screenshots

The root README embeds these PNG terminal captures:

- `tui-commands.png`: slash-command autocomplete and the character sidebar.
- `tui-memory.png`: the memory tab with sample facts and provenance.

Both show the real application running in a 120-column, 32-row pseudo-terminal.
The terminal output was interpreted with pyte and rasterized with Pillow using
Menlo, a dark palette, and a decorative terminal title bar. The UI text and layout
come from the running app, not a hand-written mockup. No model calls or RuneMetrics
requests were made.

## Recreating the demo

Use a fresh temporary `LOADSTONE_HOME` so captures never expose real character
memory or sessions. Set `LOADSTONE_AUTH=env` and unset provider API keys to avoid
using personal credentials. Do not run `/auth`, `/sync`, or send chat for this demo.

From the repository root, launch `pnpm run tui` in a terminal at least 100 columns
wide (120 × 32 matches these captures). Enter these commands, submitting each:

```text
/character Demo Iron
/set skill Herblore = 75
/set skill Crafting = 72
/set quest Druidic Ritual = "COMPLETED"
/set goal Unlock Invention = "active"
/set goal Unlock Prifddinas = "active"
/set preference Training = "Prefer AFK methods"
/character Demo Iron
```

Type `/` to capture the command menu. Press **Esc**, remove the slash with
**Backspace**, then press **Tab** to capture the memory view. Dates reflect the
capture time. Quit with **Ctrl+C** and remove the temporary demo home afterward.

When replacing images, preserve the filenames and check that README alt text and
captions still match. Review every image for private data before committing it.
