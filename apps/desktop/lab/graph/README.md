# The graph lab

A big request planned with the coordinator, launched, and run as a live graph of the tasks it became (DEV-230, for DEV-223), over the whole desktop app: its router, tabs, board, coordinator's conversation and task pages, on a made-up runtime (`world.ts`, `data.ts`). The request is Althar Cloud's first slice (ADR-103's phase 1): twelve tasks, in the althar project beside the day's other work.

It has three parts, each with options to compare:

- **Chat:** where the plan is talked over with the coordinator before anything runs, and what it becomes once launched.
- **Board:** how the board keeps a launched request in sight while it runs.
- **Task:** how a task of the request shows the whole of it from inside.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/graph/vite.config.ts
```

At `http://localhost:6171`. The bar along the bottom:

- **Chat · Board · Task**, each with its options. **1–4** switch the options of the part picked: press its name, or **p** to go between Chat and Board. On a task's page, 1–4 always switch Task. Hover a letter for what it bets on.
- **Planning · Launched** (**l**). Planning is the talk before anything runs. Launch from the plan itself, or here.
- **2 tasks · 6 tasks · Althar Cloud** (**n**): which request.
- **Space** plays and pauses the run; the slider scrubs; Shift with ← → steps a minute; **0** starts again (planning: back to the coordinator's versions, nothing changed by hand); the speed button cycles 1×, 2×, 4×. A minute of work is a second at 1×.
- **“Mission”** cycles what the thing is called (Mission, Goal, Milestone, Constellation): nothing is named yet.
- **w** the app's narrowest window (880 px).

The address keeps all of it: `?chat=B&board=A&task=C&s=cloud&stage=run`; `&t=40&paused=1` holds the run at a minute.

## Planning

The coordinator answers the request with a plan and says why it's shaped as it is. Its first version is v1; for Althar Cloud the person has already asked for a change ("The Hosts screen is a design step: give it Opus at extra high, and use green for a host that's online. Codex can take Reconnect."), and the coordinator's answer made v2.

Every option lets the person:

- open a step to read what it does and why, who leads it and at what effort, what it waits for and what follows it, and the notes on it;
- change its lead or effort, add or take off a note, stop it waiting for one of what it waits for, or drop it (and put it back);
- tell the coordinator in the composer. It reads the message clause by clause and answers with a new version: "On step three, make sure the online dot is green. Runs should use Sonnet, and drop the guide" changes three steps. Steps are named by their name or by their number in the plan ("step three"); a clause naming no step is a note on every step.
- launch it: its latest version is what runs, the person's changes by hand included.

`plan.ts` holds the plan, its versions and the coordinator's reading of a message.

## The options

**Chat** (`chat/`)

- **A · The card moves.** One card, at the coordinator's latest answer, drawn as the graph top to bottom; each version takes its place there and the one before folds to a line. Launched, the same card runs, its last row what needs the person.
- **B · Written out.** The plan as a short brief: steps numbered in the order they can start, a wave at a time, what and why on each, its lead and what it waits for beside it; edited in place, notes and Drop on pointing. Each later answer is one line naming what changed, which shows it in the plan. The graph is a toggle away. Launched, the rows tick off.
- **C · Over the composer.** The plan docked over the composer for the whole talk, never scrolling away. Folded, one line with Launch; open, a wave a row, and pointing at a step keeps what it waits for and what waits for it while the rest steps back. Launched, the line follows the run and holds the one thing that needs the person.
- **D · Beside the talk.** While it's planned, the plan takes the board's half: every step whole, with what it does, top to bottom. Beside a narrow window, one step across. Launched, the board comes back and the conversation holds a small card that follows the run.

**Board** (`board/`), while it runs

- **A · One card.** The whole mission is one card in the lane of its loudest task: a segment a task, what runs now, how many merged. Its tasks leave the lanes, except what needs the person, which keeps its own card marked with the mission. Pressing it opens every task in place.
- **B · Its own row.** A band across the four lanes under their heads: running tasks and asks as the app's own cards, waiting and merged ones a line each. Everyone else's work sits below a rule.
- **C · Marked cards.** Cards stay where they'd be; each of the mission's carries its name and step. Pointing at one dims everything else and, after a moment, opens the mission's small graph with that task ringed.
- **D · Its own lane.** A lane before Up next lists the tasks top to bottom as stops on one line, solid through what merged and dashed ahead. Pointing at a stop lights what it waits for and what waits on it. With no room it becomes a rail.

**Task** (`task/`), from inside one of its tasks

- **A · In the header.** Beside the title, a strip: what it waits for, this step, what waits on it, and "step 6 of 12". Pressing it opens the step's what, why and note, its lead, and the mission drawn small.
- **B · In the thread.** The thread opens with the step's card where an issue's would be: the mission, what, why, the note, what it came after and its lead. Althar's line says what started it, and the thread ends on what merging starts.
- **C · Its own view.** A view beside Conversation and Outputs (key **r**): the request in a line, this step's brief, and the whole graph under it with this task ringed. A task in it goes to its page.
- **D · A path.** A slim line under the header: the steps before, the mission as a bead a task with this one ringed, the steps after. **[** and **]** walk it.

Each folder's `options.ts` names its options and what they bet on.

## Pictures

`shoot.ts` shoots it headless at 1×, into `lab/graph/shots` (git ignores it), with the lab running. Chromium can't start in an agent's sandbox on a Mac; run it outside.

```bash
node lab/graph/shoot.ts a-planned 'chat=A&s=cloud&stage=plan'
node lab/graph/shoot.ts a-detail 'chat=A&s=cloud&stage=plan' 'click=[data-node="hosts"] button'
node lab/graph/shoot.ts b-typed 'chat=B&s=cloud&stage=plan' 'click=textarea' 'type=Runs should use Sonnet'
node lab/graph/shoot.ts board-a 'board=A&part=board&s=cloud&stage=run&t=40&paused=1' 'click=text=All 12 tasks'
node lab/graph/shoot.ts board-c 'board=C&part=board&s=cloud&stage=run&t=70&paused=1' 'hover=[data-move="t_cloud-hosts"]'
node lab/graph/shoot.ts task-a 'task=A&s=cloud&stage=run&t=55&paused=1#/threads/th_cloud-hosts' 'click=button[aria-label^="Althar Cloud, step"]'
node lab/graph/shoot.ts task-c 'task=C&s=cloud&stage=run&t=55&paused=1&face=request#/threads/th_cloud-hosts'
node lab/graph/shoot.ts run-a 'chat=A&s=cloud&stage=run' 'frames=0,90,1.5'   # frames for a recording, into shots/run-a/
```

## How it's put together

`vite.config.ts` swaps two imports in `ProjectView` (the coordinator thread's card, for the plan; the board, for the board's options and for the plan beside the talk) and applies each part's `patches.ts`, lines patched into the app's own files at build time; nothing in `src` changes. `plan.ts` is the plan; `world.ts` the requests and the simulation of their run; `view.ts` turns the run into what every option says; `data.ts` the made-up runtime; `graph/parts.tsx` a task's mark, its detail and the lines between tasks, from the kit's own pieces. Each part's own pieces are in its folder.
