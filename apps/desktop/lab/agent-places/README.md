# The agent places lab

One meter in the window's bar for how much work can run and how much does: every computer this home's agents work on (ADR-103: This Mac itself, the person's own machines, Althar Cloud), each with its own places, its own number and its own reason to have fewer for a while, and this computer's CPU and memory, which were a meter of their own and said much the same. Homes stays as it is: which home this window is, and the others to open. Plan usage stays after the meter, as it is: the model's quota, apart from the computers' work.

Where work any computer could take has waited a while with no room for it, what the meter opens offers Althar Cloud quietly at its foot, as ADR-103's Run in cloud has it: to set up where none is linked, to raise its cap once the month is spent, or to run more at once where it is full too. Up next keeps nothing of today's banner ("2 of 5 agent places in use · Temporarily limited to 1"); a row that can start on one computer alone says which ("Waits for This Mac").

It's drawn on the app's own board (`BoardView`), the kit's own window bar (`ProjectTabs`, `ChromeButton`, the meters' `Gauge` and styles, `PlanGauge`), popover, quick settings (`ControlCenter`, `QuickCards`) and Settings (`SettingsLayout`, the Agents at once row), from the tests' fixtures, with no runtime and no Electron.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/agent-places/vite.config.ts
```

At `http://localhost:6161`. The bar along the bottom, or its keys, swaps in place:

- **0** as built; **1–3** what the meter opens (below)
- **Z X C** what the meter draws: an AGENTS gauge before CPU and MEM, in their manner, one button (full ink while work waits, as a full CPU is); a cell a place, a group a computer, then how many wait; one track, a part a computer, as wide whatever the numbers, then how many wait
- **Q W E R T Y** the scene: This Mac lowered for memory (only Dark mode for Settings, which needs its local checkout, waits, for This Mac); every computer full, the cloud too (every line waits; more cloud offered); build-box out of reach (a Linux-only task waits for it); the cloud's month spent (closed until 1 Dec; its cap offered); room to spare; work waits with no cloud linked, This Mac short of CPU and build-box of memory (the cloud offered)
- **M** only this Mac: no other computer and no cloud, as for someone who never added one
- **K** crowded (a bigger Mac, a Mac mini besides, long titles); **N** a narrow window; **S** the Settings tab, at Work on this Mac, with each other computer's number under it; **D** dark
- **O** keeps the meter's peek open as the rest changes (on at first)

The gear opens the quick settings, and every slider moves its computer's number live. `?open=quick` opens the quick settings; `?shot=1` turns motion off for a headless shot.

A place closed for now is a free place's step, faded. On a computer out of reach, its work as last seen is faded cobalt and the rest faded. The words say why. The count says what is at work and what is free, so places lowered for now aren't counted as room.

## What the meter opens

- **1 · How much can run.** Every place as one track and a count ("6 at work · 10 free"); what waits in a line that opens to the list; then a row a computer, with what is off with it (lowered and why, out of reach since when, the month spent) and how hard it works (its CPU and memory, or the cloud's month).
- **2 · This Mac first.** As the load's peek is today, with this computer's places at the top: its cells and count, what is off, the trace, CPU and memory; then the other computers a line each; then what runs on This Mac, by CPU.
- **3 · The work first.** The computers a line each; then what waits, the longest first, each that any computer could take able to go to the cloud from its row; then what runs and where.

Each ends with Althar Cloud where it is offered, Agents at once… and Add a computer….

## What the lab assumes

The runtime's `WorkPlaces` gives this computer's count, its configured and current number and each holder's task, role, agent and reason; `GetLoad` its CPU and memory. Workers aren't built yet (ADR-103 is proposed; the native worker is decided, not built). The lab makes up each computer's places, number, state and load; the cloud's spending and cap; each holder's project; why a number is lowered (memory or CPU, which `PressureAdmission` knows but doesn't say); what waits in the other projects and for how long; and which tasks can start on one computer alone and why. ADR-103 leaves prices and plans open, so the offers name none. The Up next row that names a computer is the board's own row with its words swapped by the lab: `NextRow` has no way to say which computer a task waits for. On screen a worker is a computer, or Althar Cloud: the glossary keeps "worker" off the screen.
