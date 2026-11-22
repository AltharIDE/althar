# Agent places lab

Where the home's workers and their agents live, once the board's banner over Up next ("2 of 5 agent places in use ·
Temporarily limited to 1") goes. Drawn on the app's own board, the kit's own window bar and its own Settings, with
made-up workers and no runtime. Lab only: nothing here ships.

Run it from `apps/desktop`: `../../node_modules/.bin/vp dev --config lab/agent-places/vite.config.ts`, then open
<http://localhost:6161>.

## The base, as picked

From the last round, A + C:

- The bar's CPU and MEM meter opens the home's popover: its load, its Agents beside CPU and Memory, and the other
  workers under its readings, each with the bar's own meters, opening in place to what runs there.
- The quick settings: the home's Agents at once, saying what is so now, and a line a worker under it.

Up next keeps nothing.

## This round: Settings for the home and its workers

Work on this Mac holds this Mac only. Each take shows Settings from this computer's own home, and from studio, a home
on a server the window is connected to (H).

- **A · Workers section.** One new section: the home first, then each worker, a row with its health at the end that
  opens in place to what it is (computer, address, agents signed in, Althar's version) and its settings (Agents at
  once, Take new tasks, Remove). On studio, studio's row has its update and the devices it's opened from, and This
  Mac can be lent to it.
- **B · A page each.** The side lists the computers, the home first and This Mac last; each is a page with its
  readings beside what it is, then its settings. Work on this Mac becomes This Mac's page.
- **C · Home and This Mac.** The side splits in two: the home's settings (Agents, MCP servers, Skills, Code hosts,
  Tasks, Pull requests, Workers) under its name, and This Mac's own (This Mac, Notifications, Appearance, Editor and
  browser) under it. Connected to studio, what's under studio's name is studio's.

## Keys

A B C the take · H the window on studio · Q W E R the scene (the home lowered, all at work, a worker offline, room to
spare) · K crowded · M the home alone · N narrow · S the board · D dark · G the quick settings · P the home's popover.

The address keeps where you are (`?d=b&h=1&sec=w:studio`); `open=peek`, `open=quick` or `open=add` opens one as the
page loads, and `shot=1` stills motion for a screenshot.

## Made up

Workers' names, systems, addresses, load and versions; studio; a worker taking no new tasks; lending This Mac to
another home; the line that adds a worker; why a number is lowered. The runtime knows this Mac's agents and load, and
only a worker's id, the agents it can run and whether it is busy.
