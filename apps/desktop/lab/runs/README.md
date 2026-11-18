# The runs and terminal lab

Where a run lives and how you watch it, and where a terminal fits, on the whole desktop app in the browser: its router, tabs and real screens, on made-up data with no runtime. althar is a project of two repositories (althar and althar-mobile). Storybook runs, and **Mobile on iOS simulator** has just failed the way the person's did: `bun install --frozen-lockfile` stops on "lockfile had changes, but lockfile is frozen". Each direction lets you see why, open a terminal where it ran, `bun install`, and Run again until it runs.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/runs/vite.config.ts
```

At `http://localhost:6183`, and in Run's list as **Runs and terminal lab**. The bar along the bottom, or its keys, swaps the direction in place: `0` today's, `A`–`D`. `Q` `F` `M` start the world on a scene: nothing ran (a designer's day), a run failed, many running with terminals open. `N` narrows the window to the app's narrowest, and `T` turns it dark. Ctrl+` opens and closes the terminal in every direction. The address keeps it all: `?d=b&scene=many&theme=dark`.

The terminals answer a few commands, made up but true to life: `bun install` (brings althar-mobile's lockfile up to date, so the next iOS run gets past it), `bun run check` (finds a type error in althar-mobile), `git status`, `git diff`, `git log`, `ls`, `cd`, `pwd`, `cat package.json`, `bun run ios` (runs until Ctrl+C), `clear` and `exit`. ↑ ↓ go through what was typed.

## The same in every direction

- **Run's list stays the one way to start something**, in the project's header, where it is today. A press shows Starting… at once, and a failed run offers **Help me fix it**, which puts the run, how it ended and the end of its output in the composer, unsent. Both come from the task *A run shows it started; a failed one offers help* (#1054). The lab stands in for them here so the directions read whole.
- **A run's card stays in the conversation it was started from**, as today. What changes is where its console opens.
- **The terminal is reached from three places only:** the foot of Run's list (**Open a terminal**), a failed run (**Open a terminal here**, in the folder it ran in), and Ctrl+`. Nothing about it is in the header, the board or the composer at rest.
- **A terminal opens in a folder and says which:** its prompt and its head show the repository and branch. The folder menu lists the project's repositories and each task's worktree. In a task, it would open in the task's worktree. From the project, it opens where the last failed run ran, else the first repository.

## The directions

### 0 · Today

Run's list says how each one stands, and a run's card has its output in a console over the card, a popover that closes as soon as you look away. No terminal.

### A · Beside

A run opens on the conversation's workbench as it starts, where a file or the run's page already opens: beside the thread, or over the board from the conversation's edge. Its head says its name and state (Starting…, the address, Exited 1); then its output, following its end; a failed one ends in its ways out (Open a terminal here · Run again · **Help me fix it**). A terminal opens on the same workbench. The name at the head is a menu of every run and terminal, as the conversation's bar is of the asides. Closing the panel stops nothing, and Run's count still says what runs.

- **For:** no new surface. It is the workbench the conversation already has, said in its own comment as "later a page of what runs". You watch the run beside the conversation in which you'd ask about it, so Help me fix it lands next to it. Nothing shows until you run something.
- **Against:** one thing at a time, so a run and a terminal can't both be in view. In a narrow window it covers the board. A long build's output in a third of the window is cramped.

### B · Along the foot

A band along the window's foot, under the conversation and the board alike, there only while something runs or ran, or a terminal is open: each run with its mark and how it stands, each terminal by its folder, + at its end. A tab raises it over the lower part of the window, as an editor's panel; pressed again, it lowers.

- **For:** every engineer knows it. Every run's state is in sight at a glance, without opening Run. A run and the conversation are both in view.
- **Against:** a second band of chrome, in every project, for everyone, as soon as anything runs, including a designer who only ran Storybook. Raised, it takes height from the conversation and the board at once. It is the window's, not the conversation's, so Help me fix it reaches a composer the panel may be covering.

### C · In the thread

A run lives where it was started. Its output unfolds under its card in the thread while it starts and when it fails, and a press on its console folds it. The terminal is the composer's other face: `$` in an empty composer (or Ctrl+`) turns it into a prompt in a folder of the project. Each command and what it printed goes in the thread as the person's own, and Escape turns it back.

- **For:** the most Althar of the four. One place, nothing new to learn. The agent reads what you ran and what it printed on its next turn, so "it still fails" needs no pasting, and the rest of the team sees what was done and why. A designer meets the terminal only as someone's command in the thread, explained by what follows it.
- **Against:** not a real terminal: one line at a time, with nothing full-screen or interactive (vim, a REPL, `top`). The thread fills with output, and the coordinator's thread was for talking. `$` has to be learnt, and nothing on screen says it's there.

### D · A tab of its own

The project's runs and terminals live in a tab of their own after the projects', as a page docked there does. It joins the tabs once something runs, with how it stands in its name (Terminal · 1 failed), and it is as big as the window. Each run or terminal is one of the tab's own. A terminal opened from a run opens beside it, so the failure and the fix are side by side.

- **For:** room. A real terminal at full size, several at once, a run and its fix side by side. Out of everyone else's way entirely: it is a tab, and closing it closes it.
- **Against:** it takes you away from the conversation and the board to watch a run start, and Help me fix it has to take you back. A tab per project in the window's strip, beside the projects', is chrome the strip wasn't made for. It is the least like the rest of Althar and the most like a terminal app.

## The one I'd build: A, with D's dock and C's hand-off

**A.** A run is something you look at beside the conversation, as its page and its files are. That place already exists, with its width, its edge, how it covers the board in a narrow window, and Escape. A run opening there as it starts answers "did it start?" at once, and the failure, its output and Help me fix it are side by side with the composer that takes it. It is invisible until someone presses Run, and the terminal is reached only from Run, a failed run or a key, so it is present for engineers and absent for everyone else without a setting to hide it.

Two things from the others, on top:

- **From D, docking:** a terminal on the workbench can go to a tab of its own, as a page already docks (ADR-100), for when an engineer wants it big or wants several. It's the same move people already know, not a second place.
- **From C, the hand-off:** the agent doesn't read your terminal unless you hand it over. Help me fix it on a failed run, and a later "Ask about this" on a terminal's selection, put it in the composer. What you type stays yours, and the thread stays a conversation.

Left open:

- A fix typed in the copy a run runs in (the project's copy of main) mends that run, not the branch. The lasting fix (commit the lockfile) is a task's. Help me fix it leads there.
- Whether a terminal outlives the window: a reload here starts afresh.

## Built for the lab

Two optional props in the kit, used only here: `RunButton`'s `onTerminal` (**Open a terminal** at the foot of its list), and `PageTab`'s `icon` (the terminal's tab in D). The seams are in `vite.config.ts`: the project's screen, Run's list and the window's tabs take the kit through `ui.ts`; the project's screen takes its thread host from `host.tsx` (A's workbench) and its run cards from `RunOf.tsx`. The rest is the app's own.

## Screenshots

`shoot.mjs` shoots each direction in its states, the window only, at 1×, into `lab/runs/shots` (git ignores it), with the lab running. Chromium can't start in an agent's sandbox on a Mac; run it outside, from `apps/desktop`:

```bash
node lab/runs/shoot.mjs
node lab/runs/shoot.mjs a d   # only those
```

Delete the lab, and the two props, once a direction is picked to build, before building it.
