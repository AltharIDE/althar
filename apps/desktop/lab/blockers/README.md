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

At `http://localhost:6174`. The board is settled at C, in words (16 Nov); the bar now switches the two parts still open: how a waiting task's own page shows it (**Task**, A–D) and how the coordinator's plan card does (**Plan card**, 1–5).

The bar along the bottom:

- **1–5** switch the part on screen: on a task's page its ways, elsewhere the plan card's looks; with **Shift**, the other. A way for the task picked off a task's page opens SSH setup's.
- **Space** plays and pauses the day; the slider scrubs; Shift with ← → steps a minute; **0** starts the day again without what you did; the speed button cycles 1×, 2×, 4×. A minute of work is a second at 1×.
- **w** the app's narrowest window (880 px).

The address keeps it: `?task=B&card=3`; `&t=24&paused=1` holds the day at a minute; `&story=0` leaves out the day's own abandonment; `&d=A` or `&d=B` brings back the board's other directions.

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

## The board: C, in words

- Nothing new on the board. A waiting task is a planned row in the kit's own words: "Starts when Pairing merges". The row's words take a second line before they're cut (the lab patches NextRow's style for it). Once a task it waits for is abandoned, the row says so, as waiting for you: "Sealing was abandoned".
- You set blockers by telling the coordinator ("Start Reconnect after Pairing", "SSH setup doesn't need to wait for Sealing").
- An abandoned blocker is the coordinator's question, in its conversation and in Needs you, with what it would do and why.

The board's A (its own place in Up next) and B (under its blocker) stay in the code, at `?d=A` and `?d=B`.

## The task's page (Task, A–D)

In every way the header's chip says what the board's row says ("Starts when Sealing merges"), and "Needs you" once a task it waits for is abandoned.

- **A · On the composer.** A chip on the composer's edge, the kit's Behind chip where a task waiting for a place says so: how what it waits for stands ("Sealing stuck"). It opens what it waits for, each with how it stands (merged ones quiet), Stop waiting and Reopen on hover, Start now without waiting, and what waits for this task. On a blocker's page the chip says what waits for it.
- **B · In the thread.** Althar's plain lines, each at its minute: set waiting, a blocker merged ("Still waits for Sealing"), stuck, tried again, abandoned (with the coordinator's question in the thread too, the same one), reopened. Where its lead's first words will land, a live line for each still running. A blocker's own thread says who waits for it. These are what take the place of errand lines on hold.
- **C · Its plan in the thread.** Under the brief, the coordinator's own plan card, in the plan card look picked, live; the header only says "Waiting". Once it starts, the card gives way to its lead.
- **D · From the header.** Nothing in the thread or on the composer: the header's chip opens what it waits for and what waits for it, as A's list. On a blocker's page, a part of its chip says what waits for it.

## The plan card (Plan card, 1–5)

The coordinator's card for a task that waits for others, patched into the kit's TaskLaunch (`plan/`). Any other plan, and this one once nothing holds it, is drawn as always: its countdown, then its running card.

- **1 · In its foot.** As now: where the countdown was, "Starts when Sealing merges", and Hold.
- **2 · A stop on its line.** Each task it waits for is a row before its lead's, "Sealing merges", its node live (an arc going round while it runs, red once stuck, struck through once abandoned) and how it stands at the row's end. The row is a menu: open it, reopen it, stop waiting for it, start now without it.
- **3 · Under its title.** "After ● Pairing in review", each a link to its task, as where it works is said.
- **4 · Its foot follows it.** The countdown's ring and the bar along the foot fill as what it waits for goes through its steps, and the foot says where it is: "Host service is in review"; red once it's stuck.
- **5 · Folded until it starts.** Its title, its team in a line ("Claude Opus 5.5, then gpt-5.2-codex reviews"), which unfolds it, and its foot.

## Pictures

`shoot.ts` shoots it headless at 1×, into `lab/blockers/shots` (git ignores it), with the lab running. Chromium can't start in an agent's sandbox on a Mac; run it outside.

```bash
node lab/blockers/shoot.ts card2 't=15&paused=1&card=2' 'scroll=text=Set a host up over SSH'
node lab/blockers/shoot.ts taskA 't=15&paused=1&task=A' 'hash=#/threads/th_ssh'
node lab/blockers/shoot.ts typed 't=15&paused=1' 'click=textarea' 'type=Start Reconnect after Pairing'
node lab/blockers/shoot.ts rec4 't=0&paused=1&card=4' 'scroll=text=Pair a device with the host' 'frames=0,10,0.5'   # frames for a recording, into shots/rec4/
```

## How it's put together

`vite.config.ts` applies each part's `patches.ts`, lines patched into the app's and the kit's own files at build time; nothing in `src` changes:
- `board/` handles the rows, cards and Needs you in `BoardView`, and lets a row's words wrap.
- `task/` handles the task's page in `TaskView`: its header (`header.tsx`), the composer's chip (`composer.tsx`), the thread's lines (`lines.ts`) and its end (`end.tsx`), and the list both A and D open (`chain.tsx`).
- `project/` handles the coordinator's card in `Card`.
- `plan/` handles the plan card itself, in the kit's `TaskLaunch`: the line under its title, rows before its lead's, its roster folded, and its foot.

The rest:
- `world.ts`: the day and its simulation.
- `talk.ts`: the coordinator's side (reading a message, and its question in C).
- `pieces.tsx`: what the directions share, from the kit's own parts (CallCard, BoardCard, NextStep with its menu, Menu, NoteForm).
- `data.ts`: the made-up runtime.
