# Pinned merge line lab

The merge line ("Merging #1232 ✓ #1168 ●") held above the composer, so it stays in view while the thread scrolls on. Built from the kit's real TaskFace, Thread, Composer, Behind, Goal, MergingLine and MergeLine; nothing behind it.

Run it from Althar's Run list ("Pinned merge line lab"), or from `apps/desktop`:
`../../node_modules/.bin/vp dev --config lab/pinned-merge/vite.config.ts`, then open http://localhost:6143/.

- **0 Today**: the line at the thread's foot, scrolled away with it.
- **A A chip on the edge**: a chip beside the run chip; opened, it grows into the line's card; what came back says why on the composer's notice line.
- **B A bar on the edge**: the line itself in a bar the composer's width, opening in place like the goal bar.
- **C The line sticks**: the line stays at the thread's foot and sticks above the composer once the thread scrolls away.

Keys: A/B/C/0 direction, 1–4 moment (one, several, sent back, all merged), T coordinator/task, O opened, U scrolled up, N narrow, D dark, R replays how it leaves. The address keeps what is chosen.

`node shoot.mjs` (with `SHOTS` as JSON `[[name, query, width?, height?, waitMs?]]`) takes shots into `shots/`, git-ignored.
