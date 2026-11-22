# Agent places lab

Where the home's computers and their agents live: the home's popover from
the bar's CPU and MEM meter, the quick settings' Agents at once, and
Settings › Computers. Drawn on the app's own screens and the kit's own
components, with made-up computers.

Run it from `apps/desktop`:

```sh
../../node_modules/.bin/vp dev --config lab/agent-places/vite.config.ts
```

It answers at http://localhost:6161.

## What it shows

Computers is B of the last round, the one picked: the kit's modules, each
as large as it matters, the home wide with its trace, CPU, Memory and Agents,
the other computers under it, three across. A computer opens out in place.

The takes are how it tells the computers apart, the home above all:

- **A · Words:** a word over each name says what it is. The home's says
  Home, in ink, with a house; the rest say Linux server, Mac mini, GPU
  server, Althar Cloud.
- **B · Sections:** headings group them, as Settings groups its rows: Home,
  Your computers (with Add a computer at its end), Althar Cloud.
- **C · Pictures:** a round picture of what each is beside its name, as the
  quick settings' cards have; the home's is a house, in ink, and one out of
  reach is unlinked, in red.

The cloud, in every take:

- **Cloud runners (U):** any home can start runners in Althar Cloud, a
  runner a task, when a task would wait. They are one wide module: how many
  run of their number, what they run, this month's spend against its limit.
  Opened, their number, whether they start by themselves, and the limit.
- **A home hosted in Althar Cloud (3):** always on, and it runs no agents
  itself: its module says where it is, its agents across its runners and
  computers, and its storage. Its runners sit right under it; the computers
  that joined it, This Mac where lent, after.

The base: the popover lists the other computers under the home's readings,
each with a picture of what it is, the runners a row like them; the quick
settings' slider has the same rows under it. Hosted, the slider is the
runners'. Up next keeps nothing beyond its cards' own "Next in line".

## Keys

A B C the take · 1 2 3 the home (This Mac, studio, hosted in Althar Cloud) ·
U cloud runners · Q W E R the scene (lowered, busy, one offline, calm) ·
K crowded · M the home alone · N narrow · S the board · D dark · G the quick
settings · P the home's popover.

Pictures go in `shots/`, which git ignores.
