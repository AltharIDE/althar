# The home lab

A project's real home, on made-up data with no runtime: `ProjectView` with its header, coordinator conversation, composer and board. It is for choosing how the panes' toggles at the end of the header are drawn: the layout map, one small drawing of the window whose halves are the toggles, five ways (the kit's `PaneToggles`, picked through `PaneTogglesDesignProvider`; the app keeps today's glyph buttons).

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/home/vite.config.ts
```

At `http://localhost:6141`. Keys 1–5, or the bar along the bottom, swap the look; `c` and `b` are the app's own keys for the panes; `w` switches between a wide window and the app's narrowest (880 px), `t` between light and dark. The address takes `talk=0`, `board=0`, `swapped=1`, `room=settings`, `zoom=3` and `shot=1` (no bar) for screenshots.

The second pass of looks (the first pass, grey tiles to miniature, is in the history):

1. **Solid shape.** An icon's size, no glyphs: a pane that shows is a solid block of ink, a hidden one an outline.
2. **Header wash.** The header's own buttons joined into the map: a pane that shows has their pressed wash.
3. **Ink filled.** A pane that shows is filled with ink, its glyph in paper; a hidden one is an outline.
4. **Underline.** Glyphs always drawn, in a frame; a pane that shows has a bar of ink along its foot.
5. **Dashed slot.** A pane that shows is a sheet of paper on the chrome; a hidden one, a dashed slot where it goes.
