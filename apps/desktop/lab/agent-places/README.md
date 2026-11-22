# Agent places lab

Where the home's computers and their agents live: the home's popover from
the bar's CPU and MEM meter, the quick settings' Agents at once, and Settings
for the home and the computers it runs work on. Drawn on the app's own
screens and the kit's own components, with made-up computers.

Run it from `apps/desktop`:

```sh
../../node_modules/.bin/vp dev --config lab/agent-places/vite.config.ts
```

It answers at http://localhost:6161.

## What it shows

The base is what was picked (A + C of the workers round): the home's popover
lists the other computers under its readings, a row each in the popover's
own form; the quick settings' slider has the same rows under it. Up next
keeps nothing beyond its cards' own "Next in line".

The takes are Settings › Computers. A computer opens out in place, the same
sheet in all three: its readings beside what it is, its Agents at once, and
removing it at the foot. Work on this Mac keeps this Mac's own.

- **A · Tiles:** a tile per computer, three across, as MCP servers are. Its
  round switch takes new tasks or not; its name opens it.
- **B · Modules:** as the quick settings are, each as large as it matters:
  the home wide with its trace, CPU, Memory and Agents; the others under it
  with their agents, CPU and memory.
- **C · Home first:** the home is a card at the top of Settings' side and a
  page of its own; Computers lists the others as rows. On studio, This Mac's
  own sit apart under its name.

## Keys

A B C the take · H the window on studio · Q W E R the scene (lowered, all at
work, one offline, room to spare) · K crowded · M the home alone · N narrow ·
S the board · D dark · G the quick settings · P the home's popover.

Pictures go in `shots/`, which git ignores.
