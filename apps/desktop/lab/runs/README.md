# The runs and terminal lab

Where a run lives and how you watch it, and where a terminal fits, on the whole desktop app in the browser: its router, tabs and real screens, on made-up data with no runtime. althar is a project of two repositories (althar and althar-mobile). Storybook runs, and **Mobile on iOS simulator** has just failed the way the person's did: `bun install --frozen-lockfile` stops on "lockfile had changes, but lockfile is frozen". Each direction lets you see why, open a terminal where it ran, `bun install`, and Run again until it runs.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/runs/vite.config.ts
```

At `http://localhost:6183`, and in Run's list as **Runs and terminal lab**. The bar along the bottom, or its keys, swaps the direction in place: `0` today's, `B` along the foot, `1`–`3` its spin-offs, `D` a tab of its own (A, beside the conversation, and C, in the thread, were dropped on 18 Nov). `Q` `F` `M` start the world on a scene: nothing ran (a designer's day), a run failed, many running with terminals open. `N` narrows the window to the app's narrowest, and `T` turns it dark. Ctrl+` opens and closes the terminal in every direction. The address keeps it all: `?d=b&scene=many&theme=dark`.

The terminals answer a few commands, made up but true to life: `bun install` (brings althar-mobile's lockfile up to date, so the next iOS run gets past it), `bun run check` (finds a type error in althar-mobile), `git status`, `git diff`, `git log`, `ls`, `cd`, `pwd`, `cat package.json`, `bun run ios` (runs until Ctrl+C), `clear` and `exit`. ↑ ↓ go through what was typed.

## The same in every direction

- **Run's list stays the one way to start something**, in the project's header, where it is today. A press shows Starting… at once, and a failed run offers **Help me fix it**, which puts the run, how it ended and the end of its output in the composer, unsent. Both come from the task *A run shows it started; a failed one offers help* (#1054). The lab stands in for them here so the directions read whole.
- **A run's card stays in the conversation it was started from**, as today. What changes is where its console opens.
- **The terminal is reached from three places only:** the foot of Run's list (**Open a terminal**), a failed run (**Open a terminal here**, in the folder it ran in), and Ctrl+`, plus the foot itself in B, 1 and 2 once something has run. Nothing about it is in the header, the board or the composer.
- **A terminal opens in a folder and says which:** its prompt and its head show the repository and branch. The folder menu lists the project's repositories and each task's worktree. In a task, it would open in the task's worktree. From the project, it opens where the last failed run ran, else the first repository.

## The directions

### 0 · Today

Run's list says how each one stands, and a run's card has its output in a console over the card, a popover that closes as soon as you look away. No terminal.

### B · Along the foot

A band along the window's foot, under the conversation and the board alike, there only while something runs or ran, or a terminal is open: each run with its mark and how it stands, each terminal by its folder, + at its end. A tab raises it over the lower part of the window, as an editor's panel; pressed again, it lowers. A run raises it as it starts.

- **For:** every engineer knows it. Every run's state is in sight at a glance, without opening Run. A run and the conversation are both in view.
- **Against:** a second band of chrome, in every project, for everyone, as soon as anything runs, including a designer who only ran Storybook. Raised, it takes height from the conversation and the board at once. One thing at a time.

### 1 · A status line

The foot is a line of words in the window's own chrome, an editor's status bar rather than a band of tabs: each run by its mark, name and state, each terminal by its folder, a terminal button at its end. A press raises a drawer that floats over the window's lower part, so nothing under it moves. Its top edge drags it taller; Escape, or the same press, lowers it. Help me fix it lowers it to reach the composer it covers.

- **For:** the least chrome of the foot's: 28px, quiet, and only once something has run. Nothing reflows as a run starts or the drawer rises, so the board and the thread stay where they were. The line is the at-a-glance state B has, in words a designer reads.
- **Against:** the drawer covers what it floats over, the composer included, so Help me fix it has to put it down first. Floating over everything, it's closer to today's popover than to a place, only bigger and steady. Still one thing at a time.

### 2 · Under the conversation

B's band as the conversation's own: under its composer, as wide as its column, holding what was run from it. Raised, it takes its height from the thread alone. The board keeps all of its own, and the composer stays just above the run, where Help me fix it puts the run. In a task, the band would sit under the task's conversation, and its terminals open in the task's worktree: where the foot is says which folder.

- **For:** a run belongs to the conversation it was started from, as its card already does, so it's watched next to where you'd ask about it. The board never shrinks. The folder question answers itself: the project's copy in the project, the task's worktree in a task.
- **Against:** a column's width (400–560px) for a build's output and a terminal: lines wrap, tabs shrink, and in the narrowest window it's cramped. It's still a band, in the conversation where a designer types. One thing at a time.

### 3 · Only when called

Nothing at the foot at rest: no band, no line. Run raises a panel there as the run starts, as a run card's console, Run's **Open a terminal** and Ctrl+` do. Its chevron, or Ctrl+` again, puts it away, and Run's count is what says something still runs. Up, it's a panel to work in: the project's runs and terminals listed down its side, the chosen one big, and a terminal opened from a run beside it, so the failure and the fix are side by side (and stay so through Run again). Its top edge drags it taller, and it can take the whole of the project's screen, which is D's room without leaving the project.

- **For:** no chrome at all for anyone who isn't using it, so a designer's screen is the same as today's until they press Run. "Did it start?" is answered by the panel rising with Starting… in it. Up, it's the best place to work of all of them: a run and its terminal together, several terminals listed, as big as you want.
- **Against:** put away, nothing at the foot says what runs. Run's count and the cards in the thread do, so a run an agent started, or one that fails while the panel is away, shows only there. Raised, it takes height from both panes, as B does.

### D · A tab of its own

The project's runs and terminals live in a tab of their own after the projects', as a page docked there does. It joins the tabs once something runs, with how it stands in its name (Terminal · 1 failed), and it is as big as the window. Each run or terminal is one of the tab's own. A terminal opened from a run opens beside it.

- **For:** room. A real terminal at full size, several at once, a run and its fix side by side. Out of everyone else's way entirely: it is a tab, and closing it closes it.
- **Against:** it takes you away from the conversation and the board to watch a run start, and Help me fix it has to take you back. A tab per project in the window's strip, beside the projects', is chrome the strip wasn't made for.

## The one I'd build: 3, only when called

It's the foot that's there only when someone asks for it. A designer who never presses Run sees nothing new, and one who runs Storybook sees the panel rise with it and can put it away for good. An engineer gets the most capable place of the lot: the run and the terminal they opened from it side by side, every terminal listed, and the whole screen when they want it, which makes D unnecessary.

Taken from the others:

- **From 2, the folder:** in a task, the panel holds that task's runs, and its terminals open in the task's worktree. On the project, the project's copy. It's the same panel, and where you are says which folder it's in.
- **From B and 1, the glance, where it's already kept:** what runs is said by Run's count in the header and by the run cards in the thread, which exist today. Neither needs a band of its own.

Left open:

- A fix typed in the copy a run runs in (the project's copy of main) mends that run, not the branch. The lasting fix (commit the lockfile) is a task's. Help me fix it leads there.
- Whether a run that fails while the panel is away should raise it again. As built, it doesn't (the card and Run's count say it). Raising it would be honest but could interrupt.
- Whether a terminal outlives the window: a reload here starts afresh.

## Built for the lab

Two optional props in the kit, used only here: `RunButton`'s `onTerminal` (**Open a terminal** at the foot of its list), and `PageTab`'s `icon` (the terminal's tab in D). The seams are in `vite.config.ts`: the project's screen, Run's list and the window's tabs take the kit through `ui.ts` (the conversation's face gains its foot in 2), and the project's screen takes its run cards from `RunOf.tsx`. B and its spin-offs share their pieces from `Below.tsx`; 1 is `StatusLine.tsx`, 2 `UnderConversation.tsx`, 3 `Called.tsx`. The rest is the app's own.

## Screenshots

`shoot.mjs` shoots each direction in its states, the window only, at 1×, into `lab/runs/shots` (git ignores it), with the lab running. Chromium can't start in an agent's sandbox on a Mac; run it outside, from `apps/desktop`:

```bash
node lab/runs/shoot.mjs
node lab/runs/shoot.mjs 3 d   # only those
```

Delete the lab, and the two props, once a direction is picked to build, before building it.
