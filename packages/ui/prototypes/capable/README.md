# Capable agents, optional coordinator

A prototype, to be deleted once directions are picked. It is the real desktop app (router, project screen, board, task threads, settings, kit) on the tests' fake client, in a browser, as althar stands on 6 November: five tasks at work or waiting, a task the ADR's lead started, and a design review that used the person's own MCP servers. Seams in `vite.config.mjs` swap a few imports of the real screens for this page alone; nothing in the app changes.

From the repository's root:

```bash
cd packages/ui && ./node_modules/.bin/vp dev --config prototypes/capable/vite.config.mjs
```

Then <http://localhost:5367/>. The strip under the window picks the surface (keys 1 to 6) and its direction (A to C, and T for today; `[` and `]` step through them). Its links go to where the surface shows, and Start over puts back what was answered. `?s=rules&d=B` opens on a surface and direction, `week` a week after sync was turned on, `bare` leaves the strip out, and `node shoot.mjs` takes every state into `test-results/capable`.

What the person decided on 6 November, and what each surface draws from it. Then, looking at the page:

- **New task without the coordinator: set aside.** The person starts tasks with the coordinator for now. Its code is gone from here; it is in the history up to 7274e40, and its notes are at the end.
- **What asks: A**, the four kinds in Rules. Open: whether they live in the person's own Settings instead (2 · B).
- **MCP servers and skills:** the role table, a card for each act in the thread, and **one switch** that keeps the person's agents the same. Open: how it says what it writes to their files and what it leaves alone (3 · A, B).
- **Settings an agent changed: A**, a line each.
- **A task's parts: one Parts button** just before the faces; the faces, Run and the menu never move. The rail beside the thread is out, as DESIGN.md rules out side panels. Open: how the button and what it opens look (5 · A to C).
- Not yet decided: a lead-started task (1).
- The directions not picked are gone from the code too; the history has them.

The flow, as it stands:

```mermaid
flowchart LR
  P[The person] -->|says it| C[Coordinator]
  C -->|plans, starts, directs| S[The task starts]
  L[A lead] -->|in a turn the person started| S
  L -->|in a turn news started| K[A card: Start it?]
  K -->|their word| S
  S --> A{Can it be undone?}
  A -->|yes| G[Goes ahead]
  A -->|no, and they asked for it in the thread| G
  A -->|no, and they didn't| Q[One ask card]
```

## 1 · A task a lead started, and the coordinator in a task

Seen on the board, in the ADR's thread (its lead split the Codex network change out), in the child's thread, and with the coordinator pushing on the person's word and passing on what they said.

| Direction | On the board | In the parent's thread | The coordinator | A turn the person didn't start |
| --- | --- | --- | --- | --- |
| A · A line of lineage | The child's card: "From ADR: agents work…" at its foot, opening the parent | Its card, under way at once, with Stop | One line per act: "Coordinator  Pushed 4 commits, on your word." | A card: Start *Reviewers… run its tests*? Not now / Start it |
| B · Under its parent | The child's card under its parent's, a line joining them; the parent's foot says "Started 1 task" | Its plan card, counting down two minutes, with Hold | A turn of its own, named Coordinator, what it said and its acts as rows | The same card |
| Today | Leads can't start tasks | | The coordinator relays to the lead (From the coordinator); it doesn't act in the thread | |

**Recommendation: A, with one rule for the countdown.** A lead's start goes ahead at once when the person's own turn led to it (their words covered the work, as they did for the ADR), and becomes a card when news woke the lead (dana's comment): the same line the rules draw for what can't be undone, by who started the turn. Under-its-parent breaks as soon as parent and child are in different lanes (the parent ready, the child running), which is most of the time. The coordinator's acts as single lines keep a task's thread the lead's; its longer words to the lead stay in today's From the coordinator bubble.

What the runtime needs:
- **`start_task` for leads**, the coordinator's own tool set (the 6 Nov note). Its task records `parent` (task id) and `startedBy` (person, lead with its task and turn, coordinator, automation); `BoardTask` and `TaskCard` carry `parent: { taskId, title }` for the card's line.
- **Who started a turn**: the person's message, or news (a comment, checks, a review). A lead's `start_task` in a news turn is a `task_ask` with a new move, `start`, holding the plan it would start; in the person's turn it starts. The same field decides asked-for tools (ADR-081).
- **The coordinator's acts in a task's thread**: a notice role (`coordinator`) with what it did and, where it acted on the person's word, the message id that said so. Today it can push, stop, hold and settle; its acts aren't written into the task's thread.

## 2 · What asks

Seen in the project's Rules, in the person's own Settings (B), and in the Runs task, whose lead (woken by its checks passing, not by the person) wants to merge #635 with the person's GitHub MCP server and to comment on dana's #640. The ask card is A's in both directions: "Can't be undone", the action, what can't be taken back in one line, the words it would post, the server and tool; Not now / Merge #635. No "Unrestricted" anywhere (16 Oct note): nothing says what is allowed, only what still asks.

| Direction | Your Settings | The project's Rules |
| --- | --- | --- |
| A · In the project (chosen) | Nothing | "What asks": Lost work and history, Publishing and merging, Speaking for you, Secrets, each with what it catches and a word to make it Never; then "Your own" Never and Ask me commands; then today's sandbox, last 14 days, finished and limits |
| B · In your Settings | A section, What asks, after Agents: the four kinds, your own Never and Ask me for every project, and "Where a project differs", a line per project with Open | One line: "The same in every project: …", Change in Settings. Then "This project's own": the branches that ask as main does (`next`, `release/*`), its Never and Ask me commands, and a kind that works differently here (Asks you / Never / Goes ahead here), only once one is added; then the same sandbox and the rest |
| Today | | A mode, Allow everything as a switch, six kinds |

**On the person's question (should limits live in the account?): yes, B.** The four kinds are about the person, not the code: their name on GitHub, their secrets, history that can't be taken back. They read the same in every project, and in A each project repeats them, so a change to one is made five times or forgotten in one. What a project has of its own is narrower and stays there: which branches count as main, commands only that repository has (`fly deploy`, `db:reset`), and now and then a kind that works differently, such as merging going ahead in a scratch repository or posting being Never in a client's. Settings lists every project that differs, so nothing hides in one project's Rules.

What the runtime needs:
- The rules shrink to the four kinds, each `ask` or `never`, plus Never and Ask commands. In B these are the person's, kept with Althar's own settings, and a project adds its protected branches, its own commands, and an exception per kind (`ask`, `never` or `allow`), which the project's Rules and Settings' list both read. `permissions` (the mode), `allowEverything` and the coordinator's judge go; the tally stays, for a kind agents keep working around.
- An **MCP call classified** before it runs: which server, from which config, and whether it reads or acts. The MCP spec's tool annotations (`readOnlyHint`, `destructiveHint`, `openWorldHint`) are the first source; a table for the servers people use (GitHub, Linear) fills in where they say nothing. A merge, a publish or a post on someone else's thread is one of the four kinds.
- The `AttentionRequest` gains what the card says: the kind, the action as a verb ("Merge #635"), what can't be taken back, the words it would post (read from the call's input), and the server and tool.
- Asked-for on the person's word (ADR-081) reaches MCP calls: a merge the person asked for in this turn goes ahead without a card.


## 3 · MCP servers and skills

Settings' Skills becomes **MCP servers and skills**: the role table (chosen), a row each, a column each for leads, reviewers and the coordinator; above, Every project or althar. In a thread, each MCP call says its server, and what acted on the outside world is a card: the server, what it did, what it said, Open. The "could see" line from #596 counts both: "Claude Code could see 6 skills and 7 MCP servers", opening by whose. Seen there and in a design review the person's own skill ran on dana's #612.

Inside Althar nothing needs syncing: each role gets what's ticked, whichever agent's settings it was found in. Syncing is for the person's agents on their own: Claude Code, Codex and OpenCode each keep their own list, and here they disagree (github runs with npx in Claude Code and in Docker in Codex; linear, figma and sentry are only in Claude Code; context7 only in Codex; playwright only in OpenCode). The person chose **one switch**, "Keep your agents' servers the same". It writes into files that are theirs, so it has to say what it writes, to which file, and what it won't touch. Two ways to say it:

| Direction | While it's off | Turning it on | Turning it off |
| --- | --- | --- | --- |
| A · Before it starts | The switch and one line: Althar writes each server into each agent's own settings | A dialog: what it adds to each agent, by file and server; github waiting until the person picks how it runs; what it leaves alone; that it keeps a copy of each file and can take back what it added. Turn on | A dialog: Leave them in, or Take them out |
| B · On the card | All of A's dialog, on the card | It just turns on | The same choice, in the card |
| Today | Althar's skills only; none of the person's MCP servers | | |

The same in both once it's on:
- **To settle**, problems first: a file it couldn't read (OpenCode's, a week on), github's two ways (pick one, which changes the other agent's, or leave github out of syncing), and each sign-in, a button per agent.
- **Since**, a week on: "You added notion to Claude Code. Copied to Codex", with Undo; "You took context7 out of Claude Code. It stays out there", with Put it back.
- **Added**, a row per agent's file, each server a chip: pressing it takes it back out of that agent, and keeps it out. While it's off, the same chips leave a server out before it starts.
- **A server's marks** in the table open a menu: which agents have it; untick one to keep it out of that agent.

What it leaves alone, as the card says it: a server already in an agent, set up as the person set it, on or off; one they take out of an agent; sign-ins and tokens (a token goes across as the name of its variable, never its value).

**Recommendation: A.** The explanation matters once, at the moment Althar first writes to the person's files; after that the card stays short, and nobody who never turns it on reads a block of text in Settings. B is the better reference later, but "Added" and the chips give that back once it's on.

How it works:

```mermaid
flowchart LR
  CC["Claude Code<br/>~/.claude.json"] --> R[Althar reads each agent's servers]
  CX["Codex<br/>~/.codex/config.toml"] --> R
  OC["OpenCode<br/>opencode.json"] --> R
  R --> M{"The same server<br/>everywhere?"}
  M -->|"missing in one, and not kept out"| W["Written there through<br/>that agent's own command"]
  M -->|"set up two ways"| S["To settle: the person picks"]
  M -->|"needs a sign-in"| I["To settle: Sign in to …"]
  W --> L["A record of each change:<br/>Undo, Take them out"]
```

**Can it be built reliably? Yes, for the servers here, with a few limits it shows rather than hides.**
- **Writes go through each agent's own command:** `claude mcp add-json --scope user` and `claude mcp remove`, `codex mcp add` and `codex mcp remove`, `opencode mcp add --global` (all three are on this computer: Claude Code 2.1.263, Codex 0.166.0). OpenCode has no remove, so taking a server back out edits its JSON with a comment-keeping editor. Althar never writes `~/.claude.json` by hand: Claude Code rewrites that file all the time, and a running session would write over a change made beside it.
- **Formats:** a local command (command, arguments, environment) and a plain URL carry across all three. Codex takes streamable HTTP but not SSE, so an SSE-only server can't go there; it would show as such.
- **Secrets:** a token goes across as a reference, `${VAR}` for Claude Code, `{env:VAR}` for OpenCode, `--bearer-token-env-var` for a URL in Codex. For a local command in Codex this needs checking: its `--env` takes values, not names. A token written out in a file isn't copied; it becomes something to settle, as secrets are one of the four kinds that ask.
- **Sign-ins can't be copied:** each agent keeps its own, so each needs one sign-in per server; Althar can start each from its button (`claude mcp login`, `codex mcp login`, `opencode mcp auth`).
- **Undo:** a copy of each file before Althar first writes to it, and a record of each change (file, server, before, after), so Undo and Take them out remove only what Althar added, never what the person did since.
- **Their decisions hold:** a server they take out of an agent is recorded as kept out and never added back; one turned off in an agent stays off; one set up two ways is never overwritten without their pick; nothing is removed on its own.
- **Watching:** the three files, comparing only their server lists (`~/.claude.json` changes all the time for other reasons). A file it can't read is left alone, and said so.
- **When it takes effect:** each agent reads its servers as it starts, so a change reaches a session already running on its next start.
- **The risk:** the formats change between versions, as Codex's MCP keys have. Going through each agent's own command absorbs most of that; a file in a shape Althar doesn't know is left alone.

What the runtime needs:
- **Discovery** of servers from Claude Code (user and project scopes in `~/.claude.json`, `.mcp.json`), Codex (`[mcp_servers]` in `~/.codex/config.toml`), OpenCode (`mcp` in `opencode.json`), merged by name and command or URL, with each source kept. Skills from `~/.claude/skills`, plugins, `.claude/skills` and the catalog.
- **Settings per server and skill**: on or off, roles, projects; passed to every agent whatever found it (Claude without `strictMcpConfig`, Codex's and OpenCode's config without the names switched off).
- **Tool call items** carry `mcp: { server, tool, reads | acts }` and, for an act, where to see it (the review's or comment's URL from the call's result).
- #596's skills notice also lists the servers each session got.
- **Syncing**, as above: reading each agent's servers, matching them by name, then command or URL ("differs" where the name matches and the rest doesn't), writing through each agent's own command, a record of each change for Undo, a kept-out list per agent, and watching the three files while it's on.
- **Each agent's sign-in to a remote server** (OAuth), readable per agent, and a way to start it from the window.
- Skills could sync the same way where an agent reads them from a folder; left out here.

## 4 · Settings an agent changed

The coordinator, and leads too, tune the project's settings with Althar's own tools: works in, work toward, tracker, branch and pull request names, setup, review rounds, rules, and the MCP and skills switches. Seen in the coordinator's thread, where the person asked for two changes and news later woke it, and in Settings, where a lead had changed one row an hour before.

| Direction | The coordinator's thread | Settings |
| --- | --- | --- |
| A · A line each | A line per change under its words: the row's name, from → to, Undo | The changed row says "Changed by the coordinator, 8 min ago · Undo"; who opens the thread it was changed from |
| Today | Only the person changes settings | No note |

A change that **loosens what asks** (here: let leads merge their own once checks pass and the review is clean) is a card that waits for the person, "Loosens what asks", with Keep asking and the action on its button. It waits even when the person asked for it in words: a single irreversible act asked for in the thread goes ahead, but a rule outlasts the turn. Once allowed, Rules says what goes ahead now under its kind, with who changed it, "on your word", and Undo.

**Chosen: A** (a line each). One card for a turn's changes was the other direction, now off the strip; it may still earn its place when a turn changes three rows or more. Keep the note in Settings: it's where the person finds a change they didn't watch happen. With What asks in Settings (2 · B), letting leads merge their own in althar is one of althar's exceptions.

What the runtime needs:
- **Settings tools** for leads and the coordinator, one per setting the window changes, writing through the same commands the window uses.
- **A change record per setting**: who (person, coordinator, a lead with its task), when, the value before, and the turn and message it came from. Settings reads the latest per row; Undo writes the value before back, as a change by the person.
- **Loosening is a kind**: a change to rules, or to switches that decide what asks (merging, posting as the person, secrets), is a `task_ask` holding the change, whoever's turn it came from; tightening goes ahead.
- Today's notice for a setup a lead re-recorded becomes one of these lines.

## 5 · A task's parts

A task's parts are its worktree, its pull requests, its reviews, the issues it came from, what it runs, what it made and the access it was given; Add takes on another any time (a worktree, a pull request, a review, an issue, a browser, access). They replace Fix these and make-it-a-change. The person's rule: **the faces (Conversation, Outputs), Run and the menu never move.** So the faces sit just before Run, the files button goes into the worktree part ("6 files changed"), and one Parts button sits just before the faces. Three looks for the button and what it opens, seen on the ADR's task (three parts), on the Runs task (ten), and on a review (two):

| Direction | The button | What it opens |
| --- | --- | --- |
| A · List | Parts, its count, a dot when something waits on the person | Every part by group, each with where it stands |
| B · Tiles | The same | A tile each, two to a row, what waits first: its group, its name, where it stands, and its button (Merge, See the check, Post it) |
| C · Waits first | The parts' own icons, the first four, then +6; one that waits in its colour | What waits on the person, each with its button; what runs; the rest, a chip each |
| Today | Files, Run and the menu; a pull request is attached from the menu | |

**Recommendation: A's button with C's popover.** C answers what the person opens it for: what wants them, and the one click that settles it, with the rest out of the way but one press off. Its row of icons in the bar reads poorly, though: two pull request icons and a folder say less than "Parts 10" with a dot. B's tiles are the easiest to read one at a time, but ten of them are a tall wall for a popover. The earlier D, the rail beside the thread, is a side panel, which DESIGN.md rules out.

What the runtime needs:
- **A task's parts as one list** (the plan's phase 5, the task-as-parts ADR): each with its kind, name, where it stands in a few words, and whether it waits on the person or failed. Today these are separate fields (`worktree`, `changes`, `review`, `launches`), read by separate pieces of the window.
- **An Add command per kind**, for any task, any time: attach a worktree, open or attach a pull request (AttachPullRequest exists), add a review of a pull request, link an issue, open a browser, give access.
- The worktree part carries the files count the bar's Files button shows today.

## 6 · Sketches

- **A review's header** says whether it runs the code: an outside author's is read only, with Run it; a member's runs in a worktree.
- **A push the lead made itself**, with `gh` as the person: Althar shows it once it sees it on GitHub, the commits and Compare, and that nothing held it.
- **Where a lead-started task came from**, as its thread opens: "Started by the lead of ADR: agents work…, from your words there."

What the runtime needs: a review's `outside` from the host's author association, and a Run it command that gives it a worktree; pushes seen on the host that Althar didn't make, attributed to the task by branch, as a thread item.

## Set aside: New task without the coordinator

The person keeps starting tasks with the coordinator for now (6 Nov). The three directions (a dialog, the composer, a card on the board) are gone from the page; their code is in the history up to 7274e40. If it comes back, it needs a StartTask command from the window (words or issue keys, the lead or Auto, effort, review, `toward`, `worksIn`, started at once), and Auto as routing the coordinator shares.

## What else needs prototyping

For these decisions to work, and not yet drawn:

1. **A small change, fast, through the coordinator.** With New task set aside, the one-line fix that took 40 minutes has to get fast on the coordinator's path: what it starts for "fix the typo in X" (no plan to approve, no countdown, a lighter model and effort, review after rather than before), and how that task reads on the board as it goes by in a few minutes.
2. **The first time, for someone already using Althar.** Allow everything becomes the default where it was off, and their own servers load in every role. One notice that says what changed in which project, and where to change it back.
3. **What agents did, afterwards.** With fewer asks, the person learns of pushes, posts, merges, issue changes and settings changes after they happen, each in its own thread today. A view across the project, or a "while you were away", with Undo where it can be undone.
4. **A server that fails in a task:** signed out, down, or switched off. What the lead and the person see in the thread, and the one click that fixes it.
5. **Leads (1)**, still open, and a lead that starts many tasks at once.
