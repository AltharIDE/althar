# The agent places lab

Where this computer's agents live once the board's banner over Up next ("2 of 5 agent places in use · Temporarily limited to 1") goes: by This Mac (the CPU and MEM meter in the window's bar, and the popover it opens, which the kit titles This Mac) and beside the Agents at once slider (the quick settings and Settings › Work on this Mac). How many work and for what, the number, and the number lowered for now and why. Homes and plan usage stay as they are. On screen an agent place is an agent, as the slider already counts them.

It's drawn on the app's own board (`BoardView`), the kit's own window bar (`ProjectTabs`, `ChromeButton`, the meter's `Gauge` and styles, `PlanGauge`), popover, quick settings (`ControlCenter`, `QuickCards`) and Settings (`SettingsLayout`, the slider's own row and styles), from the tests' fixtures, with no runtime and no Electron.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/agent-places/vite.config.ts
```

At `http://localhost:6161`. The bar along the bottom, or its keys, swaps in place:

- **0** as built; **A B C** the takes (below)
- **Q W E R** the scene: lowered to 1 while memory is short (2 at work of 5, 3 tasks wait); all 5 at work (3 wait); lowered to 3 while the CPU is busy; room to spare (2 of 5, nothing waits)
- **U** Up next keeps one line at the end of its heading ("1 at a time for now · memory is short", "All 5 agents at work"; nothing with room), which opens the meter's popover
- **K** crowded (a bigger Mac, 8 agents, long titles); **N** a narrow window; **S** Settings; **D** dark; **O** keeps the meter's popover open as the rest changes; **G** the quick settings

Every slider moves the number live. `?open=quick` opens the quick settings; `?shot=1` turns motion off for a headless shot.

## The takes

- **A · In the bar.** An AGENTS gauge before CPU and MEM, in the same button: a cell an agent, at work in cobalt, free bare, closed for now hollow; then how many tasks wait (+3). What it opens leads with the agents (a cell each, "2 of 5 at work", why it is lowered and what happens next, how many wait, Agents at once…), then the load as today; each running task says its agents' parts and what they do. The slider marks a lowered number on its track and says why in place of its note.
- **B · A list in This Mac.** The bar as it is. This Mac lists its agents: "2 of 5 agents" by its name; the tasks at work, each with its agents' parts; the rest of the number as empty slots, free or closed for now and why; then what waits for one, in every project; then the load, smaller; and Agents at once with its number, lowered or default, and Change. The slider as in A.
- **C · On the slider.** The bar as it is. Wherever Agents at once is (at the top of This Mac, in the quick settings, in Settings) its track shows each agent at work as a cobalt dot on its step, the number lowered for now marked, and a line of what works and waits over the number's own. Settings is no longer calm: the kit's slider says nothing of what runs, on purpose.

## What the lab assumes

The runtime's `WorkPlaces` gives this computer's count, its number and the number lowered for now, and each agent's task, role and reason; `GetLoad` its CPU and memory by task. The lab makes up why the number is lowered (memory or the CPU; the pressure check knows, but doesn't say), each task's project on the popover's rows, and what waits in the other projects. The Up next line is the lab's, put in the board's heading from outside: `BoardColumn` has no place for it.
