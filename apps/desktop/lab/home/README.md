# The home lab

A project's real home, on made-up data with no runtime: `ProjectView` with its header, coordinator conversation, composer and board. It is for choosing how the panes' toggles at the end of the header are drawn (the kit's `PaneToggles`, picked through `PaneTogglesDesignProvider`; the app keeps A).

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/home/vite.config.ts
```

At `http://localhost:6141`. Keys 1–5, or the bar along the bottom, swap the design (A–E); `c` and `b` are the app's own keys for the panes; `w` switches between a wide window and the app's narrowest (880 px), `t` between light and dark. The address takes `talk=0`, `board=0`, `swapped=1`, `room=settings`, `zoom=3` and `shot=1` (no bar) for screenshots.

- **A, glyph buttons (today).** Conversation, Board and Swap sides as three glyphs, washed while on.
- **B, panel glyphs.** Each toggle draws the window with its pane where it sits, filled while it shows, dashed while hidden; in the panes' order, so they mirror when swapped.
- **C, word toggles.** "Conversation" and "Board" on a segmented control's track, each raised by itself while it shows; swap between them, and the words change places with the panes.
- **D, layout map.** One small drawing of the window, its two halves the toggles, filled while they show; swap beside it.
- **E, one layout menu.** One button drawn as the layout it is on; its menu has each pane as a check (with its key) and "Conversation on the right".
