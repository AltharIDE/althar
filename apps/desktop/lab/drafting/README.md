# The drafting lab

A task's card from the moment the coordinator starts drafting it, not 30 s later. A made-up draft plays at a real draft's pace (`timeline.ts`): the title, then the brief, then the sizing, the lead, the review, the ending and the estimate.

The direction picked from the first round is C, a team assembled: seats for the lead and the reviewer fill (marks go round, then the chosen one settles), and the steps fall into place. Of the ways it becomes the plan, C2, where the team card is the plan, is being explored further (`Takes.tsx`). In every take, a whole seat is its model's dropdown (the kit's ModelPick, its trigger stretched unseen over the seat), skipping the review is in the reviewer's dropdown, and the steps are tied to who does them:

- **1. C1, morph**: kept to compare, the team card morphing into the kit's plan card (`morph.css`).
- **2. C2, as before**: seats over a row of step slots.
- **3. Columns**: each seat over its step, tied to it by a line; the steps run as a chain with arrows to how the work ends.
- **4. Relay**: one row of pills, the step and who does it on each, arrows between, ending in how it ends.
- **5. Roster** (picked, the default): a list down a line, a node for each step, who does it at the row's end; the whole row is the dropdown, opening where it's clicked. `node lab/drafting/shoot-roster.ts` shoots it.
- **6. Map**: who hands to whom. Big marks for each seat, and arrows that say what happens between them (implements, reviews).

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/drafting/vite.config.ts
```

At `http://localhost:6133`. Keys 1–6, or the bar, swap the direction. R plays it again, S changes the speed (1× is real pace), N draws a narrow window, and T plays three tasks from one message, drafted one after another. Hold works from the first moment. `?at=9000` freezes it at a moment; `?from=26000` starts it there.

`node lab/drafting/shoot.ts [take…]` shoots each take's card while it assembles, as the plan and narrow, and a whole seat's dropdown open, into `lab/drafting/shots`, with the lab running, outside an agent's sandbox.
