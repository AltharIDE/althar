# home/story

The home page after its first screen. Each scene tells one part of the product, and the pictures follow the scroll.

## Key files

- `Race.tsx` is the first scene: a pinned timeline of the labs taking turns at the top, which becomes Althar's branch and ends on the first screen's orrery (`Rings` with `notes`). Its `draw(p)` sets data attributes and styles straight on the DOM. On a phone it pins too, fitted to the width (shorter branches via `--reach`, a larger orrery cropped at the sides). With reduced motion it isn't pinned and stands whole. Pinned, its branches close up (`step`, 36px down to 16) to fit what the window leaves under the heading, so the last ones show on short screens; the names keep their size.
- `Story.tsx` holds the scenes, in order:
  - the board: three of the app's views at work in a row (`Views.tsx`: `AtWork`, `kit/HomeAtWork`, `kit/CanvasAtWork`), each the kit's real screens on their own clock (`kit/loop.ts`), under a heading poured cobalt by the pointer; the heading is the one for the view in front (`scenes.tsx` `VIEW_HEADS`, all three stacked in one place and crossfading, the white copy for the cobalt the same)
  - the community (`Community.tsx`): Althar's Discord drawn on the page's warm dark (servers, channels, #general), Niko and Balazs answering questions a message at a time on the kit's clock (`useMarks`, `data-fade`), and a Join on Discord button (`LINKS.discord`). The chat is in `scenes.tsx` `COMMUNITY`: the members are invented and only ask; every answer must be true of Althar (or the brand's stated next, Althar Cloud). Keep members' lines to questions, never praise, so it can't read as testimonials.
  - the review (pinned 4.6 windows, on dark), drawn as a patch (`Patch.tsx`): a file bar and line numbers; "Copy and pasting." the line taken out. It opens on today: the preview (the drawing, cropped to one side) shows "You, today", the answers pasted between two agents, and a red − line (`scenes.tsx` `REVIEW_TODAY`, under its own `//` comment) comes in as each paste lands. Then the crop pans to "With Althar" (`--pan`, 0 to 1, scroll-linked), the red lines fold away, "No more." the line put in types, the lead as the change's comment, and the facts (`REVIEW_FACTS`) come in as hunks, each typed in with a drawn check as Althar's side reaches its beat (`FACT_AT`). Hunks fold to their headers; the newest is open unless one was opened by hand. The two sides of the drawing are seeked apart: `Review`'s `after` prop sends `rv-seek` a `{ t, tr }` (`sides(at)` in `Patch.tsx`). As the section scrolls up into place (`useScrolled` `{ enter: true, bare: true }`, Patch's `enter` → `--in`), its parts fade and rise in turn, today's comment types, and the story is already `SETTLING` (1.2 s) in, today's first copy under way, by the time it pins. On a tablet or a phone it isn't pinned: one column, everything there, the drawing whole and both sides playing together.
  - flow (`Flow.tsx`, pinned 4.4 windows, its heading and lead held over it while pinned): its three acts (`scenes.tsx` `FLOW_ACTS`: many agents at once, one shared context, it keeps going while you're away) down the left, each opening on its two features with the board's bars filling as each is told; on the right each feature's drawing (Bento.tsx's tiles) large in a window, in its light tone (`piece('light')`; the skills drawing has a light tone of its own in Drawings.module.css), one fading out before the next fades in, by the scroll. A drawing out of its turn is moved out of the window (`data-off`) so its loop stops. Then the rest (`FLOW_REST`) drawn small, rising in with the scroll (`animation-timeline: view()`), and "And so, so much more." On a tablet or phone, or with motion reduced: each act stacked, each drawing under its words
  - connections (on white): laid out as the old home page's console (`bodies/desktop/Connections.tsx` `GROUPS`, with their marks): one hairline seaming the cells, the agents across the top five to a row, then code, issues and everything else; each name lights as the console comes up the window
  - the notch
  - the screens (a sideways row)
  - the download on cobalt

  `Altitude.tsx` is the km pill in the corner.
- `scroll.ts` (`useScrolled`) measures a scene's progress (0–1), writes it to `--p` and hands it to a callback. `{ pin: n }` makes the scene `n` windows taller and holds its `[data-stick]` under the nav. `{ track: true }` runs its `[data-row]` sideways.
- On touch screens there is no pointer: the board pours as it pins (from the last touch, or the screen's middle), and the hero's agents feed the download by themselves while the first screen is in view (`hero/feed.ts`).
- `waterfall.ts` draws the board's cobalt pour on one canvas, a window tall, held inside the board's pinned `.stick`. The white heading is a second copy, clipped to the poured columns. The pointer's dot is the eye of the race's orrery mark (`[data-eye]` in `hero/Rings.tsx`): taken below the mark, given back above the eye.
- `Views.tsx` is the board's carousel of three live app views (`bodies/kit`: board, home, canvas). Only the view in front plays.
  - The board view (`bodies/desktop/AtWork.tsx`) is a project's home with the coordinator's conversation beside the board (`Room.Both`). Its story starts in the conversation (`bodies/desktop/Planning.tsx`): the task is asked for, its plan drafted, counted down and started with Start now. The board's own story plays from `STARTED`, at 1.5×, while the conversation goes on to an unrelated question (work on many things at once). The pointer stays in the conversation until the board's task reaches Needs you, so the side questions must be answered by then.
  - The conversations share `bodies/kit/talk.tsx`: typing on the clock, streamed replies, and `useGlide` so the thread never jumps.
  - On a tablet or a phone (≤ 900px) the views fill what the pinned window has under the heading (`Views.tsx` measures `--views-top`), each view the same box (`[data-fit-box]`). Each picture shows its part of that box through `Shot`'s `fill` (and lays out narrower with `phoneW`/`tabletW`): the board follows the task, the conversation's foot first; the home is its list alone on a phone; the canvas alone on a phone, beside a narrower conversation on a tablet. The pointer is a tap ring there, no arrow.
  - `bodies/kit/Pointer.tsx` is the person's pointer. It glides only when its aim changes, then stays put while content moves under it. It is placed at once when it first shows, as it comes into sight and as a story starts over.
- `scenes.tsx` holds every scene's copy, moved here from the old `DesktopBody`.

## Conventions

- The scroll is the clock, so scrolling back plays a picture backwards.
  - `AtWork` follows a clock (ms) and scrubs its flights by it. It remembers where the card stood in each lane, so a backwards flight sets out from the right place.
  - `Review` takes `at` (s) and drives the fragment through its `rv-drive` and `rv-seek` events.
- Text sections never move on scroll (DESIGN.md). Only the pictures move.
- With reduced motion nothing pins or scrubs. Pictures show their still moment, and rows wrap.

## Gotchas

- Performance (measure with a CDP profile before and after; dev-mode React is ~5x the production cost):
  - Pass `bare: true` to `useScrolled` where no CSS reads `--p`. Writing a custom property on a section restyles its whole subtree every scroll frame.
  - A view redraws only when its picture changes: `useMarks` (`bodies/kit/loop.ts`) re-renders at the story's moments; text typed between them writes its own span (`Typed` in `kit/talk.tsx`). Avoid `useLoop` with a small step on a big tree.
  - Every rAF loop stops off screen (IntersectionObserver) and reads layout before it writes. The waterfall also sleeps while nothing moves and is woken by pointer, scroll and resize.

- Headings are in Instrument Sans (`--head`), with their bold second beat in Instrument Serif italic (`--beat`), both from fontsource and imported in `Home.tsx`.

- The board's story stops short of its round's own fade (`BOARD_STORY` in `AtWork.tsx`), and the review seeks at most 10.8 s. The carousel's clock fades each view out and in to start over (`kit/loop.ts`): while it fades in, transitions are off and animations are played out, so nothing glides back from the end.
- The plan card's countdown is anchored to the story when it is drawn (`startsAt`), not to the card's own clock. It is drawn anew when the view comes back to the front.
- `aurora.webp` is the cobalt light gradient from the social posts. The CTA's five "blocks" are copies of it, each masked to one light block and pulsing in saturation, not in white. Each copy is a background on a layer the scene's size, never an `<img>` the picture's size (1440px square): six of those were hundreds of MB of layers on a phone, and its browser closed the page as the scene came into sight.
- A phone's browser closes a page that asks for too much layer memory, with no error to catch. Anything that moves, fades or is filtered is a layer as large as its box times the screen's density squared: keep such boxes near what shows. The gallery's live canvas (1664 by 1144, shown 300px wide) is a still picture on a phone for the same reason.
- Scenes are sized by the small window (`smallWindow()` in `scroll.ts`, 100svh), never `innerHeight`, which changes as a phone's browser bar comes and goes.
