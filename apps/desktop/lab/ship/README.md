# The ship lab

What Ship, Push, Mark ready and Merge mean on a task with a pull request, at each moment from Ship to merged: the app's own task screen (`TaskView`, on its Outputs, with the real Change card), drawn from snapshots of #820's path as the runtime on main describes them (`moments.ts`), with no runtime behind it. Three directions change only the Change card's buttons and lines (`directions.tsx`); the task's Outputs import the kit through `ui.tsx`, which `vite.config.ts` points them at. Today is main, untouched.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/ship/vite.config.ts
```

At `http://localhost:6133`. Keys 1–4, or the bar along the bottom, swap the direction (Today, A, B, C); ← and → step along the path; H holds every hover open; N narrows the window. `?d=a&m=readyChecks&hover=1&narrow=1` opens on one.

`shoot.ts` shoots it headless at 1× into `lab/ship/shots` (git ignores it), with the lab running (Chromium can't start in an agent's sandbox on a Mac; run it outside):

```bash
node lab/ship/shoot.ts cards                         # every direction at every moment: header and Change card, hovers open
node lab/ship/shoot.ts whole c requiredPassed narrow # the whole window
```

Delete the lab once a direction is picked to build.

## B′ · Onto main

Key 4. The Ship button names every stop (review, push, ready, merge), the ones it skips faded; its arrow turns stops on and off, from the person's own default, which Althar bends where main needs someone else's approval. **S** swaps how the button shows its route, **E** how Ship explains itself the first time (a legend under the button, on the first press, a pointer, a quiet link, or the earlier box), **T** the project between shared and solo. `?look=`, `?intro=`, `?route=review-merge`, `?solo=1`, `?explained=1` and `?pressed=1` open on one. `node lab/ship/shoot.ts two` and `intros` take their pictures.
