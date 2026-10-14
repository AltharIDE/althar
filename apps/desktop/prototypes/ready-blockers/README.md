# Prototype: what blocks a ready card, at a glance

Throwaway. How a ready change's card on the board, and its line on the home,
could say what still stands between the person and merging: checks, a
conflict with main (and the lead resolving it), commits not on the PR, a
draft, changes requested, being behind main. Direction A (a status line,
and the one next thing to do) is the one chosen; the others stay to compare.

The pages render the app's own `BoardView` and `HomeView`, fed a morning of
Althar's own tasks (`scenario.ts`). `@althar/ui` resolves to `kit.ts`, the kit
with `BoardCard`, `BoardColumn` and `NeedLine` wrapped (`swap.tsx`), so a
direction (`directions.tsx`) changes only what a ready change's card and line
are given. What stands is read in `standing.ts`, which also says what the
card's data lacks today; the words are in `words.ts`.

## See it

From `apps/desktop`:

```bash
./node_modules/.bin/vp dev --config prototypes/ready-blockers/vite.config.ts
```

Then <http://localhost:5371/>: one screen of the app under one direction,
A (the one chosen) on the board to begin with. The bar at the foot switches
the direction in place (Today, A to E; keys 1–6, or ← →) and the screen
(Board, Home, Every state; keys B, H, S). The URL keeps both, as
`?d=A&s=board`. `compare.html` sets every direction's cards side by side.
The server doesn't always see files change; after an edit, start it again.

## Shots

With the server running, from `apps/desktop`, outside the sandbox:

```bash
node prototypes/ready-blockers/shoot.mjs        # or: … shoot.mjs c, or … shoot.mjs switch
```

They go in `shots/`, which git ignores, each taken from the live page: `T1`
to `T3` today, then `A1` to `E3` (1: every state on its card, 2: the board,
3: the home), then `X1`, every state across every direction. Then it checks
switching: keys and the bar change the direction and the URL, and the home's
lines stay where they are rather than being drawn again.
