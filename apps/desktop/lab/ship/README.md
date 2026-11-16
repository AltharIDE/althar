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

Key 4. The Ship button names every stop (review, push, ready, merge), the ones it skips faded; its arrow turns stops on and off, from the person's own default, which Althar bends where main needs someone else's approval. How Ship works is a friendly modal: each stop a step on a path in plain words for this route, a click on a stop's icon turning it on or off for this Ship (the button behind following), and, once the route changes, its end is the press that route makes, named for what it does ("Push and mark ready", "Push 2 commits"). While Ship runs, the same button greys and keeps its route, the stop it is at in bold.

**E** swaps the way into How Ship works: a question under Ship ("What does Ship do?"), in the arrow's menu (a dot on the arrow until opened), a ? beside Ship, hovering Ship, Ship's first press (the modal once, ending on Ship), or the ⓘ link it replaces. Those under or beside Ship can be hidden from the modal; the arrow's menu keeps it then. **T** swaps the project between shared and solo. `?entry=`, `?route=review-merge`, `?solo=1`, `?explained=1`, `?modal=1` and `?hidden=1` open on one. `node lab/ship/shoot.ts onto`, `entries` and `guide` take its pictures.
