# home/story

The home page after its first screen. Each scene tells one part of the product, and the pictures follow the scroll.

## Key files

- `Story.tsx` holds the scenes, in order:
  - the board (pinned, poured cobalt by the pointer)
  - the coordinator
  - the review (pinned, on dark)
  - flow (a sideways row of features)
  - connections
  - the notch
  - the screens (a sideways row)
  - the download on cobalt

  `Altitude.tsx` is the km pill in the corner.
- `scroll.ts` (`useScrolled`) measures a scene's progress (0–1), writes it to `--p` and hands it to a callback. `{ pin: n }` makes the scene `n` windows taller and holds its `[data-stick]` under the nav. `{ track: true }` runs its `[data-row]` sideways.
- `waterfall.ts` draws the board's cobalt pour on a canvas. The white heading is a second copy, clipped to the poured columns.
- `scenes.tsx` holds every scene's copy, moved here from the old `DesktopBody`.

## Conventions

- The scroll is the clock, so scrolling back plays a picture backwards.
  - `AtWork` takes `at` (ms) and scrubs its flights. It remembers where the card stood in each lane, so a backwards flight sets out from the right place.
  - `Review` takes `at` (s) and drives the fragment through its `rv-drive` and `rv-seek` events.
- Text sections never move on scroll (DESIGN.md). Only the pictures move.
- With reduced motion nothing pins or scrubs. Pictures show their still moment, and rows wrap.

## Gotchas

- The board seeks `p * 15400` and the review seeks at most 10.8 s. Both stop short of their loops' fade back to the start.
- `aurora.webp` is the cobalt light gradient from the social posts. The CTA's five "blocks" are copies of it, each masked to one light block and pulsing in saturation, not in white.
