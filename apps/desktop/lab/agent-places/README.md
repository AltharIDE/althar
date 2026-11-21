# The agent places lab

Where agents at once and the places in use live, now that a home's agents work on several workers (ADR-103): This Mac itself, the person's own machines (a Linux build-box, a Mac mini) and Althar Cloud. Each worker has its own places, its own number and its own reason to have fewer for a while: memory or CPU on a computer, a spent month on the cloud, or the worker out of reach.

The person picked the chip: in this computer's window the bar's home chip names it, This Mac, with places beside the name and no other words. Up next keeps nothing of today's banner ("2 of 5 agent places in use · Temporarily limited to 1"). Its rows say why they wait, and, where a task can start on one worker alone, which worker it waits for ("Waits for This Mac"). The lab tries what the chip draws and what it opens. It's drawn on the app's own board (`BoardView`), the kit's own window bar (`ProjectTabs`, `LoadMeter`), popover and menu, quick settings (`ControlCenter`, `QuickCards`) and Settings (`SettingsLayout`, the Agents at once row), from the tests' fixtures, with no runtime and no Electron.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/agent-places/vite.config.ts
```

At `http://localhost:6161`. The bar along the bottom, or its keys, swaps in place:

- **0** as built; **1–4** what the chip opens (below)
- **Z X C** what the chip draws beside This Mac: this computer's places alone; every worker's places, a group of cells each; every worker as a short bar, one under another
- **Q W E R T** the scene: This Mac lowered for memory (build-box and the cloud have room, so only Dark mode for Settings, which needs its local checkout, waits, for This Mac); every worker full (the whole line waits); build-box out of reach (a Linux-only task waits for it); the cloud's month spent (closed until 1 Dec, the rest full); room to spare
- **M** only this Mac: no other worker, as for someone who never added one; every take falls back to This Mac alone
- **K** crowded (a bigger Mac, a Mac mini besides, long titles); **N** a narrow window; **S** the Settings tab, at Work on this Mac, with each other worker's number under it; **D** dark
- **O** keeps the chip's popover open as the rest changes (on at first)

The gear opens the quick settings, and every slider moves its worker's number live. `?open=quick` opens the quick settings; `?shot=1` turns motion off for a headless shot.

A place closed for now is a free place's step, faded. On a worker out of reach, its work as last seen is faded cobalt and the rest faded. The words say why.

## What the chip opens

- **W1 · Each worker.** A section a worker: its cells and how many work, what is off with it (lowered and why, out of reach since when, the month spent), the work in its places, a row a task, and its number with Change (Raise the cap on a spent cloud). A long list scrolls above the foot.
- **W2 · The work, and where.** The count across every worker at the top, then the workers a line each (cells, and what is off, the month, or the count). Then the work wherever it runs, each row saying where, and what waits for one worker alone, saying why only there (its local checkout, needs Linux).
- **W3 · A row a worker.** Quiet rows, one a worker, with cells and a count. A worker with something off opens first, else This Mac. Open, it shows its work and its own Agents at once slider, to change that worker's number right there.
- **W4 · The menu.** The chip's homes menu (the kit's `Menu`), with a Workers group, each worker with a line of places under its name, Add a worker…, then the work as items, each with its worker, Agents at once on This Mac…, then the homes.

Each ends with Add a worker…, studio-vps (another home, in its own window), Connect a home… and Manage homes and workers….

## What the lab assumes

The runtime's `WorkPlaces` gives this computer's count, its configured and current number and each holder's task, role, agent and reason. Workers aren't built yet (ADR-103 is proposed; the native worker is decided, not built). The lab makes up each worker's places, number and state; a cloud's spending and cap; each holder's project; why a number is lowered (memory or CPU, which `PressureAdmission` knows but doesn't say); and which tasks can start on one worker alone and why. The Up next row that names a worker is the board's own row with its words swapped by the lab: `NextRow` has no way to say which worker a task waits for.
