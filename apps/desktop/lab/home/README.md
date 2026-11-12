# The home lab

A project's real home, on made-up data with no runtime: `ProjectView` with its header, coordinator conversation, composer and board. It is for choosing how the panes' toggles at the end of the header are drawn: the layout map, one small drawing of the window whose halves are the toggles, five ways (the kit's `PaneToggles`, picked through `PaneTogglesDesignProvider`; the app keeps today's glyph buttons).

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/home/vite.config.ts
```

At `http://localhost:6141`. Keys 1–5, or the bar along the bottom, swap the look; `c` and `b` are the app's own keys for the panes; `w` switches between a wide window and the app's narrowest (880 px), `t` between light and dark. The address takes `talk=0`, `board=0`, `swapped=1`, `room=settings`, `zoom=3` and `shot=1` (no bar) for screenshots.

The fourth pass of looks, each the first map's shape drawn another way (the earlier passes are in the history):

1. **First, softer.** The first map with a hairline frame, a pane that shows tinted in ink rather than filled grey.
2. **Hatched when closed.** A pane that shows is plain with its glyph; one closed is hatched.
3. **White window.** A white window on the chrome; a pane closed is greyed out of it.
4. **System icon.** No glyphs, one stroke like a system icon; a pane that shows is filled.
5. **Frameless.** A pane that shows has the header's pressed wash; one closed is a dashed outline.
