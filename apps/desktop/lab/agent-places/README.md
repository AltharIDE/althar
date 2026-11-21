# The agent places lab

Where this computer's agents live once the board's banner over Up next ("2 of 5 agent places in use · Temporarily limited to 1") goes: in This Mac (the popover the CPU and MEM meter opens) and beside the Agents at once slider (the quick settings and Settings › Work on this Mac). On screen an agent place is an agent, as the slider already counts them.

Each take adds one thing to This Mac and draws it only with what the popover and the slider already use: the kit's `LoadPeek` styles and its real `AgentsAtOnce`, on the app's own board (`BoardView`), window bar (`ProjectTabs`, the meter's `Gauge`, `PlanGauge`), quick settings (`ControlCenter`, `QuickCards`) and Settings (`SettingsLayout`), from the tests' fixtures, with no runtime. Nothing changes in the bar, and Up next keeps nothing: its cards already say their place in line.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/agent-places/vite.config.ts
```

At `http://localhost:6161`. The bar along the bottom, or its keys, swaps in place:

- **0** as built; **A B C** the takes (below)
- **Q W E R** the scene: lowered to 1 until memory frees up (2 at work of 5, 3 tasks wait); all 5 at work (3 wait); lowered to 3 until the CPU frees up; room to spare (2 of 5, nothing waits)
- **K** crowded (a bigger Mac, 8 agents, long titles); **N** a narrow window; **S** Settings; **D** dark; **O** keeps This Mac open as the rest changes; **G** the quick settings

Every slider moves the number live. `?open=quick` opens the quick settings; `?shot=1` turns motion off for a headless shot.

## The takes

- **A · A reading.** Agents beside CPU and Memory, in their form: "Agents 2 of 5", the same thin bar in cobalt, and under it what is off, a line each ("1 at a time until memory frees up", "3 tasks waiting").
- **B · The slider.** The real Agents at once slider, as the quick settings draw it, between the readings and Running. Its one line says what is so now: "2 at work", "All 5 at work, 3 tasks waiting", or "1 at a time until memory frees up".
- **C · Only when it matters.** Nothing at rest. While tasks wait or the number is lowered, one sentence in the popover's own state line: "1 agent at a time until memory frees up. 3 tasks wait their turn." With every agent at work, it ends in "Allow more", which opens the slider in the quick settings.

Beside the slider, every take does the same: where the number is lowered for now, its note says so and until when, in Settings and in the quick settings. Otherwise the slider is as built.

## What the lab assumes

The runtime's `WorkPlaces` gives this computer's count, its number and the number lowered for now; `GetLoad` its CPU and memory by task. The lab makes up why the number is lowered (memory or the CPU; the pressure check knows, but doesn't say) and what waits in the other projects. A long This Mac scrolls in the lab, short of its own bar.
