# Pinned merge line lab

The merge line ("Merging ✓ #1232 ● #1168 ○ #1270") held above the composer as a pill, beside what else floats there, so it stays in view while the thread scrolls on. Opened, it grows into a card of its pull requests. Built from the kit's real TaskFace, Thread, Composer, Behind, Goal, MergingLine and MergeLine; nothing behind it.

Run it from Althar's Run list ("Pinned merge line lab"), or from `apps/desktop`:
`../../node_modules/.bin/vp dev --config lab/pinned-merge/vite.config.ts`, then open http://localhost:6143/.

- **Pill** (A): the pill on the composer's edge. Pressed, it morphs into a card the composer's width: its surface reshapes from the pill into the card, each pull request's mark and number travel up into their row, and the titles, where each stands and why one came back fade in once they've landed. Its head, or Escape, folds it back the same way; a press mid-way turns it back from where it is (morph.ts). What came back says why on the composer's notice line while it's folded. One thing is open on the composer's edge at a time: opening the run chip's list, or a task's goal, folds the card back into its pill, and opening the pill closes them.
- **Pill, first pass** (F): the chip as first shown, swapped for the line's card when opened.
- **Today** (0): the line at the thread's foot, scrolled away with it.

The bar and sticky-line directions of the first round are in this folder's history.

Keys: A/F/0 what's shown, 1–4 the moment (one, several, sent back, all merged), T coordinator/task, O opened, U scrolled up, N narrow, D dark, R replays how it leaves. The address keeps what is chosen.

`node shoot.mjs` (with `SHOTS` as JSON `[[name, query, width?, height?, waitMs?]]`) takes shots into `shots/`, git-ignored; `node record.mjs <name> <query>` records the pill opening, folding and turning back mid-way as a video there.
