# The home lab

A project's real home, on made-up data with no runtime: `ProjectView` with its header, coordinator conversation, composer and board. It is for choosing how the panes' toggles at the end of the header are drawn: the layout map, one small drawing of the window whose halves are the toggles, five ways (the kit's `PaneToggles`, picked through `PaneTogglesDesignProvider`; the app keeps today's glyph buttons).

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/home/vite.config.ts
```

At `http://localhost:6141`. Keys 1–5, or the bar along the bottom, swap the look; `c` and `b` are the app's own keys for the panes; `w` switches between a wide window and the app's narrowest (880 px), `t` between light and dark. The address takes `talk=0`, `board=0`, `swapped=1`, `room=settings`, `zoom=3` and `shot=1` (no bar) for screenshots.

How much of the layout the header holds (the earlier passes of the map's look are in the history):

1. **Framed, swap beside (now).** The softer map, as tall as the views' switch, and swap beside it.
2. **Loose, swap in ⋯.** No frame: the two glyphs sit loose like the rest of the header; "Conversation on the right" is in the ⋯ menu.
3. **All in ⋯.** No layout in the header: the ⋯ menu has Conversation and Board as checks with their keys, and "Conversation on the right".
