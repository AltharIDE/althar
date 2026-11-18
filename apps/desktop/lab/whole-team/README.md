# The whole-team lab

Althar as the IDE for the whole team: designers, product and QA change the real repository, and an engineer approves what merges, from evidence. Five explorations, on the whole desktop app in the browser: its router, tabs and real screens, on made-up data with no runtime (`data.ts`: althar, worked on by Ana, an engineer, Maya, a designer, Sam, in product, and Lee, in QA). There is no multiplayer, so the page is one person's Althar at a time, and everything it shows about a teammate is something git or GitHub already knows.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/whole-team/vite.config.ts
```

At `http://localhost:6181`. The bar along the bottom, or its keys, swaps the exploration in place (`A`–`E`) and steps through its moments (`1`, `2`, `3`, or `←` `→`); in C, `P` puts it on Ana's phone. Its end says whose Althar it is. The address keeps it all: `?d=c&m=1&phone=1`.

The running app the explorations preview is the lab itself, at `?app=1`: the app's own window on an empty project, and with `&after=1` the same with Maya's change in (`preview.ts`: the board's four empty lanes in warmer words, set on the kit's and the board's own copy).

## How it's put together

A few import seams in `vite.config.ts` give the app's files the lab's parts (`seams/`); everything else is the app's own.

| The app's file | Takes from the lab | For |
| --- | --- | --- |
| `shared/ThreadHost.tsx` | `PageView` | The page beside a conversation: the running app in the kit's `PagePanel`, pointed at with the kit's `CommentBox`, the comment going into the composer through the app's own `shared/comments` (A, B) |
| `features/project/ProjectView.tsx` | `ProjectHeader` | The team in the project's row (E); no branch or Run for Maya (A) |
| `features/board/BoardView.tsx` | `BoardCard`, `NextRow` | Whose work a card is (C, E) |
| `features/task/TaskView.tsx` | `Outputs`, `TaskHeader`, `TaskFace` | The evidence Ana approves from (C); Send to Ana, and where it is once sent (B); the guardrail (D) |
| `features/projectSettings/ProjectSettingsPage.tsx` | `sections`, `RulesSection` | People and rules (D) |

## The explorations

- **A · First ten minutes** (Maya). The project opens on the coordinator with the app running beside it, from a copy of its own, not on the board, and with no branch or Run in the row. Comment, then a part of the app, opens a comment there; it goes into the composer as a page's comment does today. Then her change runs beside the conversation.
- **B · Polish and hand off** (Maya). Her task's conversation, with her copy of the app beside it and On main / With this change over it. Ship, merge and pull requests give way to one way on, Send to Ana: who approves (from `CODEOWNERS`), before and after, her copy, the checks and the review, and a note. Once sent, the task says With Ana, and the composer says where it is, with Take it back.
- **C · Approve from evidence** (Ana). Maya's change waits in Needs you as her ask, with one way on, Look and approve. It opens on what Ana approves from: Maya's note, the app on main and with the change in one place, flipped between, and a few facts: what it changes in words, Maya's role, the checks, the review, Maya's copy to run here. The code is a press away. Approve and merge, or Ask Maya for changes. `P`: the same on a phone.
- **D · Roles and guardrails** (Ana, then Maya). Settings' Rules becomes People and rules: the team from git, each with a role kept in the repository, what each role changes before an engineer signs off on the code, and what always takes an engineer (merging into main is held by GitHub's branch rule, not by Althar). Then Maya's lead meets the line: keeping lanes open changes behaviour, so it asks: keep it to the words, or ask Ana to sign off.
- **E · The team, from git** (Ana). Teammates' work on Ana's board, each card saying whose it is: Lee's regression pass, Sam's intent up next, Maya's ask. The team as one chip of faces in the project's row, opening who is on what, from althar's branches and pull requests.

## Screenshots

`shoot.mjs` shoots each moment, the page whole at 1×, into `lab/whole-team/shots` (git ignores it), with the lab running. It waits for the running apps inside the page to draw, and does A's pointing for real. Chromium can't start in an agent's sandbox on a Mac; run it outside:

```bash
node lab/whole-team/shoot.mjs        # every moment
node lab/whole-team/shoot.mjs c d1   # those whose names start so
```

Delete the lab once a direction is picked to build, before building it.
