# The blockers lab

Tasks that wait for other tasks (DEV-228, for DEV-223), over the whole desktop app: its router, board, coordinator's conversation and task pages, on a made-up runtime (`world.ts`, `data.ts`). The day is seven of Althar Cloud's tasks in the althar project, some waiting for others:

- Pairing waits for the host service.
- SSH setup waits for the host service and Sealing.
- The Hosts screen waits for Pairing.
- The guide waits for SSH setup and the Hosts screen.
- Reconnect is held by you.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/blockers/vite.config.ts
```

At `http://localhost:6174`. The bar along the bottom:

- **A · B · C** (**1–3**) switch the direction.
- **Space** plays and pauses the day; the slider scrubs; Shift with ← → steps a minute; **0** starts the day again without what you did; the speed button cycles 1×, 2×, 4×. A minute of work is a second at 1×.
- **w** the app's narrowest window (880 px).

The address keeps it: `?d=B`; `&t=24&paused=1` holds the day at a minute; `&story=0` leaves out the day's own abandonment.

## The rules it plays

As DEV-228 has them:

- **Starting:** a task starts by itself once every blocker has merged. A cleared blocker stays cleared.
- **Holds:** your hold is kept apart from the wait. Reconnect, held, still waits for your word once what it waits for has merged.
- **Asking:** only an abandoned blocker asks you. A stuck one leaves what waits on it waiting, saying why.
- **The question settles itself:** it's read from where things stand, so it goes as soon as the blocker is reopened or what waited is decided.
- **The choices:**
  - Start anyway, or "Wait only for…" where it waits for others too.
  - Start with a word to its lead.
  - Wait for another task instead. One that would make it wait for itself is offered greyed, with why.
  - Abandon it too, with what waits on it.
  - Reopen the blocker.
- **Starting after merges:** a task that started because its blockers merged opens with Althar's line saying so ("Host service merged as #610, so this started"), and its lead says what it read of their work.

The day on its own:
- **Minute 8:** the host service merges, and Pairing starts by itself.
- **Minute 13:** Sealing gets stuck on its checks.
- **Minute 20:** you abandon it.
- **Minute 31:** Pairing merges, and the Hosts screen starts.

Everything is live. The app's own Start, Hold, Abandon, Reopen, Accept and merge, and Try again buttons act on the day, and so do the directions' own controls and anything you tell the coordinator.

## The directions

- **A · Its own place in Up next.**
  - Up next lists waiting tasks under their own heading, "Waiting for other tasks". Each row says what it waits for, with the kit's after glyph. At its foot, each blocker and how it stands.
  - Its menu, and a line under the task's header, set what it waits for: "Wait for…", and a ✕ on each blocker.
  - An abandoned blocker is a card in Needs you: "Sealing was abandoned", what waits on it, and the choices on its strip.
- **B · Under its blocker.**
  - Waiting tasks leave Up next. They ride at the foot of the card they wait for, wherever that card is, with what waits on them a step in, so a chain reads at a glance.
  - You add what comes after from the blocker: "Then…" under its header.
  - An abandoned blocker keeps its own card in Needs you, with its chain and the choices.
- **C · In words.**
  - Nothing new on the board. A waiting task is a planned row in the kit's own words: "Starts when Pairing merges".
  - You set blockers by telling the coordinator ("Start Reconnect after Pairing", "SSH setup doesn't need to wait for Sealing").
  - An abandoned blocker is the coordinator's question, in its conversation and in Needs you, with what it would do and why.

In all three, the coordinator's card for a waiting task says what it waits for where its countdown was, and the task's header says it too.

## Pictures

`shoot.ts` shoots it headless at 1×, into `lab/blockers/shots` (git ignores it), with the lab running. Chromium can't start in an agent's sandbox on a Mac; run it outside.

```bash
node lab/blockers/shoot.ts a24 'd=A&t=24&paused=1'
node lab/blockers/shoot.ts menu 'd=A&t=24&paused=1' 'click=[aria-label="More choices"]'
node lab/blockers/shoot.ts chain 'd=B&t=15&paused=1' 'hash=#/threads/th_pair'
node lab/blockers/shoot.ts typed 'd=C&t=15&paused=1' 'click=textarea' 'type=Start Reconnect after Pairing'
node lab/blockers/shoot.ts rec 'd=A&paused=1' 'frames=0,36,1'   # frames for a recording, into shots/rec/
```

## How it's put together

`vite.config.ts` applies each part's `patches.ts`, lines patched into the app's own files at build time; nothing in `src` changes:
- `board/` handles the rows, cards and Needs you in `BoardView`.
- `task/` handles the header and the line under it in `TaskView`.
- `project/` handles the coordinator's card.

The rest:
- `world.ts`: the day and its simulation.
- `talk.ts`: the coordinator's side (reading a message, and its question in C).
- `pieces.tsx`: what the directions share, from the kit's own parts (CallCard, BoardCard, NextStep with its menu, Menu, NoteForm).
- `data.ts`: the made-up runtime.
