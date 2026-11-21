# The agent places lab

Where agents at once and the places in use live. The person picked the chip: in this computer's window the bar's home chip names it, This Mac, with its places as cells beside the name and no other words; Up next keeps nothing of today's banner ("2 of 5 agent places in use · Temporarily limited to 1"), its rows saying why they wait. The lab now tries what the chip opens. Drawn on the app's own board (`BoardView`), the kit's own window bar (`ProjectTabs`, `LoadMeter`), popover and menu, quick settings (`ControlCenter`, `QuickCards`) and Settings (`SettingsLayout`, the Agents at once row), from the tests' fixtures, with no runtime and no Electron.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/agent-places/vite.config.ts
```

At `http://localhost:6161`. The bar along the bottom, or its keys, swaps in place:

- **0** as built; **1–4** what the chip opens (below)
- **Q W E R** the scene: lowered for memory (the banner's own case: 2 of 5 at work, 1 at a time), lowered for CPU, all in use, room to spare
- **K** crowded (8 places across three projects, long titles); **N** a narrow window; **S** the Settings tab, at Work on this Mac; **D** dark
- **O** keeps the chip's popover open as the rest changes (on at first)

The gear opens the quick settings, and the slider in each moves the number live. `?open=quick` opens the quick settings; `?shot=1` turns motion off for a headless shot.

A place closed for now is a free place's step, faded: the words say the number is lowered and why. The slider's ink stops at the lowered number, a quiet mark there, the track bare to the person's own.

## What the chip opens

- **P1 · Homes.** Each home with its places. This Mac open: its cells and how many work, the lowered number and why, the work in the places a row a task, the number and Change. Then each other home with its cells, Connect a home…, Manage homes….
- **P2 · The number.** This Mac and how many work, then the Agents at once slider itself, to change the number right there, the lowered number as its line. Then the work in the places, and the other homes a line each.
- **P3 · A row a place.** Each place a numbered row: the agent in it (a task with a lead and a helper holds two), a place past a lowered number saying it closes when done, then the free ones and the closed ones a row each run ("3–5 Closed until memory frees up"). The number and Change under them.
- **P4 · The menu.** The chip's homes menu as it is today (the kit's `Menu`), each home with a line of places under its name; then the work as items, each opening its task; Agents at once… with its number, opening the quick settings; Connect a home…, Manage homes….

## What the lab assumes

The runtime's `WorkPlaces` gives the count, the configured and current number and each holder's task, role, agent and reason. The popovers also use each holder's project and why the number is lowered (memory or CPU, which `PressureAdmission` knows but doesn't say). Another home's places would come from that home's window.
