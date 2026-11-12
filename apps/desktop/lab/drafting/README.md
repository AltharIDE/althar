# The drafting lab

A task's card from the moment the coordinator starts drafting it, not 30 s later. A made-up draft plays at a real draft's pace (`timeline.ts`): the title, then the brief, then the sizing, the lead, the review, the ending and the estimate. Four directions (`Directions.tsx`) show it filling in, and each becomes the kit's real plan card (`TaskLaunch`) once the plan is proposed. The drafting card uses `TaskLaunch`'s own styles, so the swap doesn't move anything.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/drafting/vite.config.ts
```

At `http://localhost:6133`. Keys A–D, or the bar along the bottom, swap the direction:

- **A. Quiet**: the plan's shape in shade, each part replacing its place as it's known.
- **B. Written as it goes**: the title and brief stream in as the coordinator writes them, the brief folds away, and each step arrives as it's chosen.
- **C. Team assembling**: seats for the lead and the reviewer fill (marks go round, then the chosen one settles), and the steps drop into their slots.
- **D. A line first**: one quiet line while it's drafted, opening into the plan.

R plays it again, S changes the speed (1× is real pace), N draws a narrow window, and T plays three tasks from one message, drafted one after another. Hold works from the first moment, so a draft never starts unseen. `?at=9000` freezes it at a moment.

`node lab/drafting/shoot.ts` shoots each direction at four moments into `lab/drafting/shots`, with the lab running, outside an agent's sandbox.
