# Prototype: plan usage and steering, ninemate's and three others (second round)

Throwaway. One live page: the real desktop app (its router, tabs, home, board, Talk room, task, Settings › Agents, the model picker) on the tests' fake client. A bar at the bottom swaps the direction in place, picks the scenario and the screen. Ninemate's is the kit's and the app's own parts as built. A to C draw the real screens with a few new pieces of their own (`parts/`), put in by seams for this server alone.

## Run it

From `apps/desktop` (it polls for edits, so it works inside the agent sandbox too):

```bash
bunx vp dev --config prototypes/plan-usage/vite.config.mjs
```

Then open **http://localhost:5441/**. The port is fixed (`strictPort`): if it's taken, `lsof -i :5441` says by what. A server started from an agent's background call stops after a while and when Althar restarts: run the command again.

## The bar

- **Direction** (keys 1 to 4, ← and →): Ninemate's · as built, A · A third gauge, B · In the load meter, C · Tightest first.
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

The person's brief for this round: more hierarchy, usage shown quietly only where it matters, and two places fixed: **beside CPU and memory** in the bar, and **beside each model in the pickers** (the composer's list and All models). A to C all do both; they differ in how each place ranks what it shows. Ninemate's stays as key 1, to compare.

Every direction ranks the same way. **The figure that counts** is the agent closest to running out, judged by the account Althar would start it on, which is the one steering uses. With Codex Work at 3% and Codex Side at 79%, Codex has 79%. **Then a line per agent.** **Then, opened in place, each account and every window.** Once an agent is under a tenth, the bar says who and until when beside it ("Codex 3% · 14:00"), as the load meter says memory running short. There are no notices, no badge and no modal. The agents with no reading are one quiet line at the foot of the peek, each name giving the runtime's reason on hover.

**Ninemate's, as built.** The bar's Usage button with a count of warnings not seen; ⌘U opens the usage view, a modal of every account and window; warnings are notices at the foot of the Talk room.

**A · A third gauge.**
- **The bar**: PLAN, a gauge of its own right after CPU and MEM, in their exact manner: five steps lit as the tightest route is used, full ink once under a tenth.
- **Its peek** (click or ⌘U): "Plan usage" and its level ("Plenty left", "Codex is nearly out"); a row per agent, least room first: name, "% left", a bar, and what the figure is of ("Side · Weekly limit · until Tue 20:00"). A press opens the agent in place.
- **The pickers**: every row ends in its route's figure, "65%", or "Side · 79%" where the agent has several accounts; from a quarter down, "until 14:00" too. Opus counts its own week (19% here, where Sonnet has 56%). In All models, each row has the figure alone, so the name keeps its room, and the reset time is in its tooltip. "no reading" in faint ink. The composer's chip says "3% left until 14:00" beside itself once under a tenth.

**B · In the load meter.**
- **The bar**: one meter, CPU · MEM · PLAN, one button.
- **Its peek** (click or ⌘U): the load peek as it is, then a Plan section in the machine's own manner. One place for what limits Althar's work. The plan sits under the running work, so it's the furthest down. The peek's "Show in the bar" switch is left out here.
- **The pickers**: the same five steps, small, and the figure on every row; the composer's chip always has the steps beside it.

**C · Tightest first.**
- **The bar**: a figure, not steps: "PLAN 65%" in the meter's own type. Once under a tenth it names who: "CODEX 3% · 14:00".
- **Its peek**: the tightest limit leads, big ("3%", Codex, Five-hour limit · until 14:00); then the other agents a line each (name, figure, reset). The lead and each line open in place to every account and window.
- **The pickers**: quiet unless it matters. A row says nothing above half, "40% left" from half down, and adds "until 14:00" from a quarter. The chip speaks only under a tenth.

## What each costs to build

- **All three**: the runtime sends each model's route (account, tightest window, reset) with the models (`AgentModels`), as `usableModels` already works it out for the coordinator's `list_models`, so the window never guesses. Drop `UsageNotices`, the Usage button and the usage view.
- **A**: about a day. Kit: a `PlanGauge` on `Popover` beside `LoadMeter` (sharing its gauge), and its peek. `ModelPick`'s `note` takes a node, so a figure can sit at the row's right edge; `ModelBrowser` shows it beside each runtime.
- **B**: a little more. `LoadMeter` takes a third gauge and `LoadPeek` a section, and the meter's own switch ("Show in the bar") must decide whether it hides the plan too.
- **C**: about a day, like A, with a figure in place of the gauge.

## Pictures

With the server up, outside the agent sandbox (Chromium can't start in it):

```bash
node shoot.mjs        # every shot in shots.json, 1280×800 at 1x, into shots/ (with a captioned list)
sh sheets.sh          # one sheet per direction: shots/sheet-ninemate.png, sheet-a.png, sheet-b.png, sheet-c.png
node peek.mjs '?d=B&v=picker' shots/peek.png   # one look, with what the page logged
node check.mjs       # A to C as used: All models' readings per model (shots/a-browser.png…), C's lead opening, peeks closing on Escape and a click outside, switching direction with a peek open
```

`shots/` is ignored by git.

## How it's built

- `vite.config.mjs`: the seams, each swapping one import of a real screen for the prototype's:
  - the bar's load meter, Usage button and what ⌘U opens (`TabsFrame`);
  - the Talk room's notices (`ProjectView`);
  - every model picker and All models (`ModelChoice`).

  Two patches, each leaving its file alone, saying so, if the text changed: `shared/agents.ts` `waitsWords`, and the kit's `ModelBrowser`, which has no slot for a row's note, so each row calls `browserNote(model)` (`browserNote.ts`) after its model's name.
- `data.ts`: the scenario: agents and accounts, models, plan usage and ninemate's warnings, and what steering did (`steerOf`). `runtime.ts`: the snapshots the fake client answers with. `usage.ts`: tightest window, route, agents ranked, words. `clock.ts`: the page's 11:20.
- `parts/`: `Plan.tsx` (the gauge, an agent's row, the three peeks), `Bar.tsx` (A's gauge, B's meter, C's figure), `Models.tsx` (the pickers' notes and the chip).
- **Another agent works in this worktree.** The page runs the files as they are on disk, so a change to the app or the kit shows here at once, and one half made can break it for a moment.
