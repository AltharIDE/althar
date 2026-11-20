# The agent places lab

Where agents at once and the places in use live: by This Mac, beside the Settings slider, and what Up next keeps of the banner it has today ("2 of 5 agent places in use · Temporarily limited to 1"). Drawn on the app's own board (`BoardView`), the kit's own window bar (`ProjectTabs`, `LoadMeter`, `LoadPeek`), quick settings (`ControlCenter`, `QuickCards`) and Settings (`SettingsLayout`, `AgentsAtOnce`), from the tests' fixtures, with no runtime and no Electron.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/agent-places/vite.config.ts
```

At `http://localhost:6161`. The bar along the bottom, or its keys, swaps in place:

- **0** as built; **A** This Mac; **B** the slider; **C** the computer
- **1–4** the scene: lowered for memory (the banner's own case: 2 of 5 at work, 1 at a time), lowered for CPU, all in use, room to spare
- **K** crowded (8 places across three projects, long titles); **N** a narrow window; **S** the Settings tab, at Work on this Mac; **D** dark

The gear opens the quick settings, and the slider in each moves the number live. `?open=mac|upnext|quick` opens This Mac's view from the bar, what Up next opens, or the quick settings; `?shot=1` turns motion off for a headless shot.

## The directions

- **A · This Mac.** The places are part of how hard this computer works: a third meter in the window's bar after CPU and memory, a cell a place, cobalt in use, outlined warm where closed for now. Its peek, This Mac, adds Agents at once (how many work, the cells, the lowered number and why) and the work in the places with what each takes of the computer; what needs no place (coordinators, Althar) follows. Up next keeps only the small meter at the end of its heading, opening the same peek. Settings stays calm; the slider's line says only when its number is lowered.
- **B · The slider.** Agents at once is the meter: a cell under each number on its track, filled where an agent works. Settings lists the work in the places under it. Up next keeps one row, the cells and a count, shown only while something waits or the number is lowered; it opens the same slider, so the number changes where the wait shows. The bar and This Mac's peek stay as they are.
- **C · The computer.** Places belong to the computer the agents run on, so they live on the window's home chip, which names it: This Mac and its cells. It opens to each home with its places, this one with the work in them and its number. The slider marks a lowered number on its track. Up next keeps nothing while work waits as usual (each row says why); only a lowered number gets a banner, with the way to This Mac.

## What the lab assumes

The runtime's `WorkPlaces` gives the count, the configured and current number and each holder's task, role, agent and reason. The directions also use each holder's project (A, B, C), why the number is lowered (memory or CPU, which `PressureAdmission` knows but doesn't say), and in A each holder's CPU and memory, which the load meter's rows have by task. A home's places in C would come from that home's window.
