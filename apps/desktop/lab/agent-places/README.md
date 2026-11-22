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

Computers as picked: sections, Settings' own groups with a fainter rule
between them (Home, Workers, Cloud), the kit's modules in each, each with a
round picture of what it is. The home's is a house, in ink; every worker
has the same computer (H pictures headless ones as servers instead), red
where it is out of reach; the cloud is a cloud. A worker opens out in place.

Althar Cloud is a control panel, not a computer: what runs there now, this
month's spend against the monthly limit (and where it ends at this pace),
hours, tasks, each day's spend, whether it takes tasks that would wait, and
the limit. No runner count to set, no sizes, regions or versions. The takes
are where that lives:

- **A · Module:** a wide module under Cloud, like the home's: this month's
  spend against the limit, what runs now, hours and tasks. It opens out to
  its figures and its two controls.
- **B · Panel:** the control panel on the page, nothing to open: the month's
  figures, each day's spend, what runs now, its controls, leaving it at the
  foot.
- **C · Own page** (picked): Althar Cloud a section of Settings of its own,
  after Computers; Computers keeps a line for it with this month's spend.
  Opened from that line, the page has a way back to Computers at its top;
  from the side, it is a section like any other. The lab opens on C.

Hosted in Althar Cloud (3), the home is the cloud: the take's form of it
stands under Home, always on, with pausing all where leaving would be; the
workers that joined it, This Mac where lent, under Workers. The bar's meter
reads This Mac there, and the quick settings show this month's use where
the slider was. Busy (W) has reached the $40 limit, so tasks wait.

The base: the popover lists the workers under the home's readings, Althar
Cloud a row like them with this month's spend; the quick settings' slider
has the same rows under it. Up next keeps nothing beyond its cards' own
"Next in line".

## Keys

A B C the take · 1 2 3 the home (This Mac, studio, hosted in Althar Cloud) ·
U Althar Cloud in use · H headless workers pictured apart · Q W E R the
scene (lowered, busy, one offline, calm) · K crowded · M the home alone ·
N narrow · S the board · D dark · G the quick settings · P the home's
popover.

`still=1` in the address turns transitions and animations off, for pictures.
Pictures go in `shots/`, which git ignores.
