# The home lab

A project's real home, on made-up data with no runtime: `ProjectView` with its header, coordinator conversation, composer and board. It is for choosing how the panes' toggles at the end of the header are drawn: the layout map, one small drawing of the window whose halves are the toggles, five ways (the kit's `PaneToggles`, picked through `PaneTogglesDesignProvider`; the app keeps today's glyph buttons).

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/home/vite.config.ts
```

At `http://localhost:6141`. Keys 1–5, or the bar along the bottom, swap the look; `c` and `b` are the app's own keys for the panes; `w` switches between a wide window and the app's narrowest (880 px), `t` between light and dark. The address takes `talk=0`, `board=0`, `swapped=1`, `room=settings`, `zoom=3` and `shot=1` (no bar) for screenshots.

1. **Grey tiles (first).** A grey tile on each half that shows, in a frame.
2. **Raised paper.** On a segmented control's track, like the views beside it; a half that shows is raised paper.
3. **Paper window.** One framed window split by a hairline; a half that shows is paper, a hidden one empty.
4. **Ink drawing.** Drawn in lines like an icon, nothing filled; a half that shows has its glyph in ink, a hidden one faint.
5. **Miniature.** No icons: each half draws what its pane holds, lines of talk and lanes of cards, while it shows; hidden, an empty pane.
