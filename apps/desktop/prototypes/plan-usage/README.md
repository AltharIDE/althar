# Prototype: plan usage and steering, ninemate's and three others

Throwaway. One live page: the real desktop app (its router, tabs, home, board, Talk room, task, Settings › Agents, the model picker) on the tests' fake client. A bar at the bottom swaps the direction in place, picks the scenario and the screen. Ninemate's is the kit's and the app's own parts as built. A to C draw the real screens with a few new pieces of their own (`parts/`), put in by seams for this server alone.

## Run it

From `apps/desktop` (it polls for edits, so it works inside the agent sandbox too):

```bash
bunx vp dev --config prototypes/plan-usage/vite.config.mjs
```

Then open **http://localhost:5441/**. The port is fixed (`strictPort`): if it's taken, `lsof -i :5441` says by what. A server started from an agent's background call stops after a while and when Althar restarts: run the command again.

## The bar

- **Direction** (keys 1 to 4, ← and →): Ninemate's · as built, A · Quiet chip in the bar, B · Beside the models, C · Home and Accounts.
- **Screen**: Home, Board, Talk (the coordinator), Task (the task steering touched), Model picker (that task, its composer's picker open), Accounts (Settings › Agents). Going somewhere in the app moves it too.
- **Scenario**: Plenty left (every account above half), One window nearly out (Codex's five hours at 3%, until 14:00 today), An account out (Claude Code Work at 0% of its week, until Monday 09:00; its work moved).
  - **Several accounts** layers on any of them: Claude Code Work and Personal, Codex Work and Side, each with a different amount of room.
  - **Agents with no reading** adds GitHub Copilot, Junie and Mistral Vibe, signed in, with no usage to read.
- **When an account is nearly out**: the project's usage-limit rule, Move, Wait or Ask (the same as Project settings › Rules, which sets it too).

The address keeps all of it: `?d=A&s=nearly&several=1&silent=1&rule=wait&v=board`. `&u=1` presses ⌘U as the page opens, and `&bare=1` hides the bar (for pictures). The page's clock reads 11:20 this morning and runs on, so "until 14:00 today" holds whenever it's opened.

## What every direction shares: steering

Steering itself is the runtime's (committed on this branch, 923e0df2), so its words are the same in every direction. Before a step starts, Althar takes the agent's account with most room. When the planned one is under 5% of its tightest window, it follows the rule:

- **Move**: the task's thread says, as Althar's own line, *"Codex has 3% of its five-hour limit left, until 14:00, so the review goes to Claude Code, on Sonnet 5.5."*
- **Wait**: *"…, so the review waits until 14:00. To carry on now, pick another model on the task."* The held card (`HeldLimit`) and the header say it too. The card's word is patched for every direction: *"Waiting for Codex until 14:00"*, not the app's *"Codex is out of usage until 14:00"*, which is wrong while 3% is left.
- **Ask**: the step is a call in Needs you (`LimitCall`), and the thread says nothing more, since the call says it all.
- **With several accounts**, another account of the same agent with room takes the step (*"…, so the review goes to Codex Side."*), whatever the rule.
- A step already running is never stopped (the dock-flicker task stays on Codex Work at 3%).

## The directions

**Ninemate's, as built.** The bar's **Usage** button with a count of warnings not seen, and ⌘U opens the usage view, a modal: every account, every window as a green-to-red meter, its source and age, Read again. Warnings are red or amber notices at the foot of the open coordinator's Talk room, with Open usage and Seen. They say the threshold crossed (5%), not what's left (3%). An agent with no reading is an account with a fault, "No usage source", once per agent. (This branch is changing that to a calm line, `noReading`, not committed as this was written. The page sends the committed runtime's fault, and shows whatever the view on disk does with it.) Steering shows only as the plain runtime line in the task's thread.

**A · A quiet chip in the bar.**
- **While every account has more than half left**: a faint glyph. It's needed, because the click and ⌘U need a place to open from, and an empty bar can't tell plenty from not read. It's as faint as the load meter's unlit steps, with no number and no count.
- **Otherwise**: a chip with only the tightest limit, *"Codex · 3% · until 14:00"*, its ink deeper the less is left (ink, not a new colour, as the load meter does).
- **The popover** (chip or ⌘U): agents, then their accounts, tightest first. Each window is a slim bar with % left and until when. The agents with no reading share one calm line at the end.
- **Warnings**: no notices anywhere. The chip is the warning.
- **Steering**: one quiet line on the card, on the board and in the Talk room: *"Review went to Claude Code · Codex has 3% left"*.

**B · Beside the models.**
- **Usage lives where a model is chosen.** Each model in a picker (task, coordinator, each step of a plan) says what its route has left: the account Althar would start it on, its tightest window, Opus counting its own week. That reads *"3% left · until 14:00"*, *"Side · 94% left"*, *"out · until Mon 09:00"*, or *"no reading"*.
- **Nothing in the bar.** ⌘U opens the picker of the composer on screen.
- **Warnings**: a model chip whose route is under a tenth says so beside it, on the coordinator's composer (it runs on GPT-5.5) and on the plan's Review step.
- **Steering**: the card shows the model the step went to, marked *moved*, with the thread's words on hover.

**C · Home and Settings › Accounts.**
- **The home** ends with a quiet Plan usage section: a line per agent, each account by its tightest window, and the agents with no reading in one line.
- **Settings › Agents** shows, under each account, every window, the source and its age, and a fault in words.
- **Warnings**: none while nothing is out. When an account is out and work waits for it (the rule waits or asks), that work is in Needs you, on the home and the board. Nothing in the bar; ⌘U goes to Settings › Agents.
- **Steering**: the thread's line. A held card says *"Waiting for Codex until 14:00"*.
- **C adds no sidebar.** Settings keeps the one it has.

## What each costs to build

- **Ninemate's**: built (#218). To keep it, still to do:
  - the notice should say what's left, not the threshold;
  - no-reading should go calm (under way on this branch);
  - the red notices should be weighed against the person's "calm" rule.
- **A**: about a day or two.
  - **Kit**: a `UsageChip` on `Popover` (as `LoadMeter` is), with the usage view's account and meter rows moved out of `Usage.tsx` to fill it, in ink tones.
  - **Desktop**: swap `UsageButton` for it in `TabsFrame` (⌘U already toggles), and drop `UsageNotices`. Warnings and their acknowledgement become unused.
  - **The card line needs steering on the card's contract.** Today it is only in the thread's notice: add `TaskCard.steered: { step, from, to, left, resetsAt }` from the runtime.
- **B**: about two or three days.
  - **Kit**: `ModelPick`'s `note` takes a reading, not a string, and gets a `warn` beside its chip. `ModelBrowser` (All models) has no row slot and needs a column.
  - **Runtime**: the window must not guess a model's route. `Limits.pick` and `usableModels` know which account a model would start on, so send each route's left and reset with the models (`AgentModels`). Then the coordinator's `list_models` can say the same, so plans steer too.
  - **The board card has no model at all**: it needs the same `steered` field, and a chip lifted above the card's own link.
- **C**: about two days.
  - **Kit**: `Home` needs a `usage` slot (busy and at rest), and `Accounts`' row needs one (`AccountEntry.usage`). The prototype puts both in from outside.
  - **Held work in Needs you**: today a held task is "Paused" (`lanesOf`, `needsOf`, `homeGlanceOf`). The runtime raises a usage-limit call when the account is *out* and work waits for it, or the window derives one from `waits` and `outUntil`. Its words today ("ran out of usage while working on the task") assume it ran out mid-step.

## Pictures

With the server up, outside the agent sandbox (Chromium can't start in it):

```bash
node shoot.mjs        # every shot in shots.json, 1280×800 at 1x, into shots/ (with a captioned list)
sh sheets.sh          # one sheet per direction: shots/sheet-ninemate.png, sheet-a.png, sheet-b.png, sheet-c.png
node peek.mjs '?d=B&v=picker' shots/peek.png   # one look, with what the page logged
```

`shots/` is ignored by git.

## How it's built

- `vite.config.mjs`: the seams, each swapping one import of a real screen for the prototype's:
  - the bar's Usage button and what ⌘U opens (`TabsFrame`);
  - the Talk room's notices (`ProjectView`);
  - the board's and the Talk room's cards (`BoardView`, `Card`);
  - every model picker (`ModelChoice`);
  - the home (`HomeView`);
  - an agent's accounts (`AgentAccounts`).

  One patch, to `shared/agents.ts` `waitsWords`: it leaves the file alone, saying so, if the text changed.
- `data.ts`: the scenario: agents and accounts, models, plan usage and ninemate's warnings, and what steering did (`steerOf`). `runtime.ts`: the snapshots the fake client answers with. `usage.ts`: tightest window, route, words. `clock.ts`: the page's 11:20.
- `parts/`: A's chip and popover, B's notes and chip warning, C's home section and account readings, the card lines.
- **Another agent works in this worktree.** The page runs the files as they are on disk, so a change to the app or the kit shows here at once, and one half made can break it for a moment.
