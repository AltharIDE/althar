# The drafting lab

A task's card from the moment the coordinator starts drafting it, not 30 s later. A made-up draft plays at a real draft's pace (`timeline.ts`): the title, then the brief, then the sizing, the lead, the review, the ending and the estimate.

The direction picked from the first round is C, a team assembled: seats for the lead and the reviewer fill (marks go round, then the chosen one settles), and the steps drop into their slots. The lab now shows three ways it becomes the plan (`Directions.tsx`):

- **1. C, swaps to the plan**: the kit's plan card (`TaskLaunch`) fades in in its place, as in the first round.
- **2. C1, morphs into the plan**: one motion. Each seat travels into its step's model picker, each slot into its step, and the card into the plan's shape. It's a same-document view transition (`morph.css`), which the app's Chromium has.
- **3. C2, is the plan**: no second card. The seats become the model pickers, the slots the steps (Skip on the review, a menu on the ending), and the countdown takes the foot.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/drafting/vite.config.ts
```

At `http://localhost:6133`. Keys 1–3, or the bar, swap the direction. R plays it again, S changes the speed (1× is real pace), N draws a narrow window, and T plays three tasks from one message, drafted one after another. Hold works from the first moment. `?at=9000` freezes it at a moment; `?from=26000` starts it there.

`node lab/drafting/shoot.ts` shoots it into `lab/drafting/shots`, with the lab running, outside an agent's sandbox: C assembling, frames through each hand-over, C2 as the plan, and videos of the C1 and C2 hand-overs.
