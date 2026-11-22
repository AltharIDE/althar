# The agent places lab

Where the home's workers and their agents live once the board's banner over Up next ("2 of 5 agent places in use · Temporarily limited to 1") goes. A home runs work on several workers, this Mac among them: this Mac's CPU and memory come first, and the other workers' health (reachable or not, their load, their agents) comes second. On screen an agent place is an agent, as the slider already counts them ("Agents at once"), and a computer the home runs work on is a worker, as the plan card's "Run on" already says.

Every take draws only with the kit's real parts: This Mac as the `LoadPeek` styles draw it, the bar's own `Gauge`, the Homes chip's real `Menu` and styles, and the real `AgentsAtOnce`, on the app's own board (`BoardView`), window bar (`ProjectTabs`, `PlanGauge`), quick settings (`ControlCenter`, `QuickCards`) and Settings (`SettingsLayout`), from the tests' fixtures, with no runtime. Up next keeps nothing: its cards already say their place in line.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/agent-places/vite.config.ts
```

At `http://localhost:6161`. The bar along the bottom, or its keys, swaps in place:

- **0** as built; **A B C** the takes (below)
- **Q W E R** the scene: this Mac lowered to 1 until memory frees up and every worker full, 3 tasks wait; all at work everywhere, 3 wait; build-box offline for 12 minutes with 2 tasks waiting for it, and mac-mini lowered for its CPU; room to spare
- **K** crowded (a bigger Mac, two more workers, one with a long name, long titles); **M** only this Mac; **N** a narrow window; **S** Settings; **D** dark; **O** keeps what the take opens open as the rest changes; **G** the quick settings

Every slider moves its worker's number live. `?shot=1` turns motion off for a headless shot.

## The takes

In every take, This Mac (what the CPU and MEM meter opens) keeps its load as built and adds Agents beside CPU and Memory, in their form ("Agents 2 of 5", and under it "1 at a time until memory frees up", "3 tasks waiting"), and each worker has its own Agents at once in Settings under "Other workers", saying only what is off. They differ in where the other workers show.

- **A · Under This Mac.** In This Mac's popover, between its readings and what runs on it: each other worker a row with the bar's own CPU and MEM meters and how many of its agents work ("4 of 4"); what is off in a line ("Offline for 12 min · 2 tasks wait for it", in the danger colour; "1 at a time until the CPU frees up"). A row opens in place to what runs there and its number, with Change to its slider in Settings.
- **B · In Homes.** The Homes chip's menu lists the workers first, This Mac at the top, each with how many of its agents work and a line: what is off, or its CPU and memory. An offline worker shows on the chip itself, as a home whose connection dropped does. This Mac opens This Mac; another worker opens the same popover drawn for it, from the chip, with its own Agents at once slider at its foot.
- **C · At the slider.** The quick settings' Agents at once is this Mac's ("This Mac · 1 at a time until memory frees up"), and under it a line a worker, with how many of its agents work and what is off, then what waits; pressed, a worker's number in Settings, where each says what it runs now.

## What the lab assumes

The runtime gives this Mac's agents (`WorkPlaces`) and load (`GetLoad`), and of another worker only its id, its agents and whether it is busy (`ProjectWorker`). The lab makes up workers' names, systems, load, numbers and being out of reach; why a number is lowered (the pressure check knows, but doesn't say); and what waits in the other projects. A long popover scrolls in the lab, short of its own bar.
