# The home lab

A project's real home, on made-up data with no runtime: `ProjectView` with its header, coordinator conversation, composer and board. It is for choosing how the panes' toggles at the end of the header are drawn: the layout map, one small drawing of the window whose halves are the toggles, five ways (the kit's `PaneToggles`, picked through `PaneTogglesDesignProvider`; the app keeps today's glyph buttons).

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/home/vite.config.ts
```

At `http://localhost:6141`. Keys 1–5, or the bar along the bottom, swap the look; `c` and `b` are the app's own keys for the panes; `w` switches between a wide window and the app's narrowest (880 px), `t` between light and dark. The address takes `talk=0`, `board=0`, `swapped=1`, `room=settings`, `zoom=3` and `shot=1` (no bar) for screenshots.

The third pass of looks (the first two are in the history):

1. **Words in the map.** The panes named, Conversation and Board, on a segmented track; a pane that shows is raised paper.
2. **Swap in the seam.** Swap is the divider between the halves, not a button beside them.
3. **Blue accent.** A pane that shows is washed in the app's blue.
4. **Window thumbnail.** A title bar over the panes, each drawn with what it holds while it shows; hidden, a dashed slot.
5. **Bare seam.** No frame or fill: two glyphs, ink while they show and faint while hidden, split by a hairline.
