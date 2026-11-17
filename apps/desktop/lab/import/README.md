# The import lab

Moving to Althar from another tool, as one experience: a project's worktrees, setup and conversations, from wherever Conductor, Orca, Paradev, T3 Code, Cursor or a person left them, and Claude Code's and Codex's conversations ([DEV-211](https://linear.app/althar/issue/DEV-211), [DEV-37](https://linear.app/althar/issue/DEV-37)). It's the whole desktop app in the browser (its router, tabs, board, threads and both Settings pages) on made-up data with no runtime. Read only throughout: nothing in another tool's folders changes.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/import/vite.config.ts
```

At `http://localhost:6178`. The bar along the bottom, or its keys, swaps the direction. Two sets:

- **Arriving (A–C), and Shortcuts (D–J):** althar is being added, on the first run's welcome (`W`) or in a New project tab (`P`), then its board. Nothing's brought in yet. D–J are variants of one idea, shortcuts, for someone who wants all of one tool (all of Claude Code, say) or all of it in a press.
- **Later (1–3), from Settings:** weeks on. Most of it came in on the way, and a little is new since: a Conductor workspace made yesterday, and three conversations.

`R` starts over and `T` toggles dark. The address opens a state for a screenshot, for example `?d=b&place=welcome&step=bring`, `?d=a&place=app#/threads/th_wt_lima`, `?d=1&place=app#/projects/p_althar?room=settings&section=import` or `?d=2&place=app#/settings/other-tools`. The page then keeps its state in the tab's session and gives the address back to the app.

## What's found

Seven worktrees: two of Conductor's (one with a draft PR, a failing check, work not committed and two commits not pushed; one merged), Orca's, T3 Code's (an open PR, all green), Cursor's, Paradev's, and one made by hand to review someone's PR. There's Conductor's setup script and Cursor's. And 33 conversations from Claude Code and Codex: some ran in those worktrees, some in althar's own folder, some older than a month.

Ticked at first: work not finished (not merged, not someone else's PR), Conductor's setup, and conversations from the last month.

## Arriving

- **A · A step of its own.** The welcome gets a Bring in step once the project is made (`Already under way`). The New project tab lists the same things beside its folder. It's grouped by kind: worktrees, setup, then conversations, each with All and None. One button says what it brings in. *For:* the move is a moment you see and decide, all of it at once. *Against:* one more step and a long list for everyone who had other tools, and conversations sit apart from the work they were about.
- **B · By place.** The same step, with every worktree shown as the task it becomes. The conversations that ran in a worktree sit under it as its history, and come with it. Conversations from althar's own folder are a list of their own and become chats on Scratch. Setup comes first, as what runs before each task. *For:* says what each thing becomes, and nothing comes in detached from its work. *Against:* longer still, and a conversation can't come in without its worktree.
- **C · On the board.** No step, and nothing in the New project tab but a line in its foot. The project opens with a "Found in other tools" card at the top of Up next: each worktree with its most urgent fact, a press to bring it in or leave it, the conversations in one row with Choose…, and Bring in all as its last row. *For:* nothing in the way on day one, and each thing is decided where it will live. *Against:* the first board starts busy, and things nobody decides on wait there.

- **D · One question.** The step is one question with a few answers, the kit's `Choices`: What's under way (the defaults, picked at first), Everything, or Everything from…, which opens a row of tool chips with Claude Code pressed. Each answer says what it brings, counted. "Nothing for now" and "Pick one by one" are links at its foot; the second opens A's list under it, from the answer picked. A tick, "The same for projects I add later", makes the answer the standing one. *For:* the commonest wishes are one or two presses, and nobody reads a list they don't need. *Against:* an answer hides what it brings until you open the list. And "the same for later" needs a home in Settings to be changed.
- **E · By tool.** A row a tool, in two groups: agents' conversations (Claude Code, Codex) and other tools' worktrees (Conductor, Orca, T3 Code, Cursor, Paradev, by hand). A row's tick is all of that tool, half-ticked where some is picked. Its name opens what it has, to pick inside. *For:* it's how people think of what they used ("everything from Claude Code, and Conductor's worktrees"), and a list of 8 rows stays short. *Against:* a conversation belongs to two rows (Claude Code's, and the Conductor worktree it ran in), so unticking one row can half-untick another.
- **F · Shortcuts over the list.** A's list under two rows of chips: Bring in (Everything, What's under way, Nothing), and Only from (a chip a tool, with its count). A tool's chip picks only that tool; pressing more adds them. The list below shows what a press picked. *For:* A as it was, plus one press for the common cases. *Against:* the list is still long, and two kinds of chips (replace or add) take a moment to learn.

- **G · One press.** Ranked actions, each a card that brings in and opens the project at once: What's under way, Everything, then Everything from each of the three tools with the most here (Claude Code, Codex, Conductor). The step's own button only opens the project. Pick one by one opens A's list, and then the button brings in what's ticked. *For:* the fastest there is, one press for the common case, with no confirming. *Against:* no second look before it acts, and only the top three tools get an action.
- **H · Tiles.** A tile a tool, in a grid: its mark, its count, and its most pressing fact (Conductor's failing check, Orca's work not committed). A press takes all of it, and nothing is pressed at first. Look inside opens A's list. *For:* the whole move at a glance, and each tool's state is visible before you take it. *Against:* starting from nothing means the unfinished work isn't suggested, and a half-taken tool is only a line on its tile.
- **I · A sentence.** "Bring in [what isn't finished] from [every tool], [from the last month]." Each bracketed word is a kit menu: what (everything, what isn't finished, only conversations, only worktrees), from whom (any tools), how old. Under it, what that comes to, counted. A line offers "everything from Claude Code" and "everything" as one-press sentences. *For:* it reads as what will happen, and it combines (Claude Code's from the last week) without a list. *Against:* menus inside a sentence are less obvious to press than buttons, and editing the list by hand breaks the sentence ("Changed by hand").
- **J · Filters.** A's list under two filters: tools (chips) and age (the kit's `Segmented`). What's shown is what comes in, with finished work shown but not ticked. A press on Claude Code leaves only its 23 conversations. *For:* you see exactly what comes, and the filters are familiar from any search. *Against:* hidden means left out, which is easy to forget when you scroll.

A conversation brought in without the worktree it ran in comes as a chat on Scratch, like one from the project's own folder, so "only Claude Code" loses none of its conversations.

Afterwards, in every direction: an adopted worktree is a task in place. Its folder stays where the other tool made it, and its branch and pull request are its own. Its card says "From Conductor" where a stopped one says "Stopped", with Resume. One whose PR is green waits in Needs you. The coordinator's first word says what came in, and the one thing that needs a look. Conversations from althar's own folder are asides, which is today's conversation list, at their own dates. A thread brought in says where it came from at its top (the tool's folder, each conversation's agent, length and date). Over its composer is how it goes on: Claude Code continues from a copy of its own session, so the one in `~/.claude` stays as it was. Codex starts a new session from a brief, the DEV-37 fallback for an agent that can't load one here.

## Later, from Settings

- **1 · Project settings › Other tools.** What's new since the last look, ticked, with its Bring in. Then what came in from each tool, with Left out… for what was passed over on the way in. Then whose setup the project uses. A foot line says it's read only, with Look again. *For:* one place per project, and importing twice can't duplicate. *Against:* someone moving many projects does it project by project.
- **2 · Althar's settings › Other tools.** Every tool on this Mac, and each repository it knows, projects or not yet. Bring in… where there's new work, and Add as a project where it isn't one. A switch decides whether a new project offers other tools' work on the way in. *For:* the whole move in one place, across projects, and it finds repositories Althar doesn't have yet. *Against:* far from where the work is, and per-item picks still need the dialog.
- **3 · Keep in step.** In the project's settings, a switch for each tool. A tool kept in step has what it makes come in by itself: its new worktrees as tasks, its conversations as history or chats. Below is what came in since. Opened with Conductor and Claude Code kept. *For:* someone still using both tools side by side never imports again. *Against:* things appear on the board that nobody asked for, and turning a tool off doesn't say what happens to what came in.

The board offers what's new in every Later direction (but 3, for the tools it keeps), in the same found card as C, titled "New in other tools".

## How it's built

`world.ts` holds what's found and what was brought in. `data.ts` is the fake runtime that turns it into the board, threads and the coordinator. `Found.tsx` has the lists to pick from (A by kind, B by place) and the picks, with their shortcuts; `Shortcuts.tsx` has D, E and F, and `Variants.tsx` G–J; `Arrival.tsx` the kit's `Welcome` and `NewProject` screens with them, and `Later.tsx` the found card and the Settings sections. The seams in `vite.config.ts` work like this: the kit imports of the board, both Settings pages and the task view come through `ui.ts` (`Seams.tsx`: Up next's found card, the adopted card's word, the Other tools section, Continue over the composer); both pages' section lists are the lab's (`projectSections.ts`, `settingsSections.ts`); and so is a thread's blocks (`ThreadBlocks.tsx`: where it came from).

One change outside the lab: the kit's `Welcome` takes an optional `bring` step after the project's, left out without it (`packages/ui/src/screens/Welcome/Welcome.tsx`).

## Not covered

- The welcome's Code and Issues steps are left out here: the lab gives the welcome no hosts or trackers.
- No separate "bring in" from the conversation bar. Conversations brought in are asides, and the found card offers more.
- The task header of an adopted worktree still says Stopped (its board card says where it came from).
- What happens when a worktree brought in is cleaned up. Althar must never remove a folder it didn't make (ADR-056); here the card only says where the folder is.

Delete the lab once a direction is picked to build, before building it.
