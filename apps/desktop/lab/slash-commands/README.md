# The slash commands lab

What the composer does from the moment "/" is typed, with `/goal` the first command and more to come: four directions on the whole desktop app in the browser (its router, tabs and real screens), on made-up data with no runtime (`data.ts`: althar's board, an aside, the coordinator's conversation, and a task whose lead has just said its spec fails on CI, which is what a goal is for).

The composer is the kit's own. Import seams in `vite.config.ts` give the app's `DraftComposer` the lab's `Composer` (`kit.ts` → `SlashComposer.tsx`), which draws each direction round the real one; tell it which composer it is (`draft.tsx`); hide the goal's line over the composer while the composer shows the goal itself (`screens.tsx`); draw a sent command in the thread as it read in the field (`thread.tsx`); and let the bar open an aside or the coordinator (`asides.tsx`). What is sent is still the words TaskView reads (`/goal …`), so the goal is set, changed, paused, resumed and cleared through the task's own handling; the fake runtime keeps it, and says it in the thread as each direction would.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/slash-commands/vite.config.ts
```

At `http://localhost:6188`. The bar along the bottom, or its keys (outside a field), swaps in place:

- `0` today's composer, `A`–`D` the four directions;
- `1`–`3` the composer of a task, an aside, or the coordinator;
- `G` the goal as it stands: none, at work, paused;
- `M` the commands to come listed beside /goal (only listed: picking one says so), for the crowded case;
- `N` the app's narrowest window; `T` dark.

The address keeps it all: `?d=a&goal=active&more=1&theme=dark&place=aside`.

In the composer: `/` opens what there is, typing narrows it, `↑` `↓` move, `Tab` takes the command (or what it takes) into the field, `Enter` takes it, or does it where it is whole (pause, resume, clear), `Esc` closes what opened. Backspace after A's token takes it off whole; Escape or Backspace in an empty field leaves B's mode.

## The directions

- **A · Menu and token.** A menu over the composer as "/" is typed, each command with what it does and where it stands. Picked, the command is a cobalt token at the start of the field, and what it takes is written ahead in grey. With a goal set, the menu shows the goal over what can be done to it (pause or resume, edit, clear); typing a new objective, it shows the one it replaces. Sent, it is what the person said, the token in their bubble.
- **B · Command mode.** The list opens inside the composer, over the field. Picking /goal turns the composer into the goal's: a row with its state and its Pause or Resume, Edit and Clear, the field its objective, a cobalt edge. Sent, it is Althar's line in the thread ("You set a goal: …"), not a message.
- **C · In the field.** Nothing opens. The best match is written ahead in grey (Tab takes it), the command reads in cobalt, and the composer's own lower row says what it does and lists the others, or what /goal takes now: its state, pause, edit, clear. Sent, it is what the person said, the command in cobalt.
- **D · Controls panel.** A panel joined to the composer's top edge, as dictation's tray is: each command with where it stands (the goal, the model, how full the context is). /goal opens into the goal itself: its objective, its turns, its last progress, then what can be done to it, and the last row is what Enter does. Sent, it is Althar's line.

Goals belong to a task's conversation, so an aside and an artifact's chat offer /goal and the coordinator doesn't: there, "/goal" says where goals are set, and with "More" it offers its own (/task, /aside, /compact).

## Screenshots

`shoot.ts` shoots each direction through the same moments (finding it, the crowded list, picked, written, sent, a goal already set, paused, dark, the coordinator, an aside, the narrow window), the window only, at 1×, into `lab/slash-commands/shots` (git ignores it), with the lab running; `today` shoots today's composer for comparison. Chromium can't start in an agent's sandbox on a Mac; run it outside:

```bash
node lab/slash-commands/shoot.ts a b c d today
node lab/slash-commands/shoot.ts b --only 6-set 8-dark
```

Delete the lab once a direction is picked to build, before building it.
