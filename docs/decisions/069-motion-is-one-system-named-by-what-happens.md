# ADR-069: Motion is one system, named by what happens, in CSS and the browser's own animations

- **Status:** Accepted
- **Date:** 2026-10-28
- **Amends:** [ADR-065](065-running-is-what-an-agent-works-on-and-up-next-is-everything-that-waits.md) (its line "The board has no move animation")
- **Owner:** Repository maintainers
- **Context:** The person wanted Althar's animations right, and found
  barely any: a popover dropped 3 px, a dialog rose 4 px, buttons sank half
  a pixel, and everything else snapped, cards jumping between lanes and
  rows into place. The motion that was there used `--fast`, `--base` and
  `--slow` with one curve, so nothing told an entrance from an exit or a
  move. They asked for Emil Kowalski's principles and Linear's restraint
  as the baseline: motion with a purpose, fast, ease-out, springs for what
  moves, transform and opacity only, popovers from their trigger, exits
  quicker than entrances, and nothing that slows what is done often. A
  prototype offered four directions (today; Linear-restrained; crafted, with
  springs; crafted with small celebrations). They picked crafted, across
  the whole app.
- **Decision:** one motion system, named by what happens.
  - **Tokens** (`tokens.css`): `--enter` 200 ms and `--exit` 140 ms on
    `--ease-out` (`cubic-bezier(0.23, 1, 0.32, 1)`), for what arrives or
    answers and what goes; `--move` with `--ease-move`, a spring (damping
    0.85, a response of 0.314 s) that passes its place by half a percent,
    for what is on screen and goes elsewhere; `--slide` with `--ease-slide`,
    a quicker spring, for a selection moving between choices;
    `--scale-pop` 0.96, where overlays grow from; `--scale-press` 0.97 over
    `--press`, a pressed button. Hover and colour keep `--fast`. The springs
    are `lib/spring.ts`'s, sampled as CSS `linear()` curves; `lib/motion.ts`
    holds the same values for script, and a test keeps the two equal.
  - **Overlays grow from what opened them** (Radix's transform origin),
    from 0.96 with a fade, and go back quicker than they came; dialogs grow
    from their middle and the scrim fades. The first tooltip waits, and the
    next, while the pointer moves along, shows at once without moving: one
    tooltip provider for the window. The command menu, opened by key many
    times a day, is there at once.
  - **Lists move as a whole** (`ListMotion`): an item keyed by `data-move`
    (a task's id, a tab's, an attachment's) slides when its place changes,
    and a card that changes lanes travels there as a copy drawn above the
    board, which no lane's edge cuts off. New items come in, gone ones fade
    where they stood. The board, Home's calls, the window's tabs and the
    composer's attachments use it. The board's hold (ADR-065) still keeps a
    card in its lane while the pointer is in Up next or Running; it travels
    once the pointer leaves. A list with an order of its own, Up next's
    line, has a `ListMotion` of its own that hands its moves to the board's,
    so a row moved by its menu or by key slides. A drag owns what it drags
    (`still`): nothing of ours moves a tab or a row while it is held. When a
    screen goes or hides, what it set moving is put away at once.
  - **What lands in a thread rises into its place** (`useArrivals`): a
    message, a round, a card, a step of a turn. Not as the thread opens,
    not many at once, not a placeholder taken by what it held, and not the
    words of a message as they stream.
  - **Still, on purpose:** switching tabs, projects and rooms, opening Home
    or a task, and anything else that happens many times a day or by key;
    words as they stream; what repeats.
  - **Reduced motion:** nothing travels, grows or slides. Lists' arrivals
    and departures only fade, and the stylesheet's own animations end at
    once, as before.
- **Alternatives considered:**
  - **A library (Motion).** Springs, layout animations and exit animations
    in one, but ~30 kB more in every window, a second way to animate beside
    the kit's CSS, and its layout animations measure every frame. The
    overlays already say when they open and close (`data-state`), Electron's
    Chromium draws springs as `linear()` curves, and the Web Animations API
    runs moves on the compositor: a few hundred lines of our own cover it.
  - **View transitions for cards between lanes.** The browser draws the
    copy above the page itself, but the whole window is frozen while it
    runs, and every update to the board would have to go through it.
  - **Moving cards inside their lanes.** The lane a card lands in cuts it
    off at its edge; a copy above the board isn't cut off.
  - **The fourth direction, small celebrations** (a glow on a merge, a ring
    as dictation starts, an empty board's lanes in turn). Not picked; the
    system leaves room for them.
- **Trade-off:** a card travelling between lanes is a copy for 400 ms: it
  shows what the card shows as it lands, and the card itself can't be
  clicked until it has. Each board update measures its cards once before
  and once after (about 30 rectangles); a thread doesn't measure at all.
  Context-dependent styles don't follow a copy above the page, so a card
  styled by its lane would travel in its own style.
- **Revisit when:** a celebration is wanted, an item needs to move with its
  size (only position moves now), or a list grows past a few hundred items
  that move together.
