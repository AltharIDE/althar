# Phase 5, calmly: a design round on its cases

A prototype for
[a task is a conversation plus parts](https://github.com/AltharIDE/althar/pull/713)
(the proposed ADR on `althar/adr-a-task-is-a-conversation-plus-parts-changeab`,
as of `259de0e`). It shows how the window could handle every situation the
proposal adds, in three directions, on the real board, task bar, thread and
composer. It builds nothing of the feature, and goes once a direction is
picked.

Run it from `packages/ui`:
`./node_modules/.bin/vp dev --config prototypes/calm-parts/vite.config.mjs`,
then open `http://localhost:5374/`. The strip at the bottom switches
direction (1–3, ← →), the case (its list, or [ and ]), and the screen (Board,
Task). The URL keeps them: `?d=B&s=stack-held#/threads/th1`.

## The principles it was designed by

1. **One thing asks at a time.** A task has one fact on its card, in its bar
   and in Needs you: the change that most needs the person, worked out each
   time it's drawn.
2. **Defaults stay invisible.** A task that never splits looks as it does
   today. A part shows once it's there and matters: a workspace only as a
   copy, Local or a move; Access only for outside code; no "Unrestricted".
3. **Counts over lists.** "· 2 more", "3 commits not shipped", never a list of
   pull requests on a card.
4. **Everything names its change.** Every line, card and button names the
   pull request or branch it is about, never "your pull request".
5. **Copy never narrates the screen.** A line only where the person needs to
   know, or can act.
6. **Nothing fails quietly.** Every stop says what happened and offers the
   way out that fixes it, in place.
7. **The window stays still while agents work.** Things change in place, in
   places that don't move; what's under way is one line that updates.
8. **Act in place.** Ship, Merge, Call it off and Run it work from the card,
   the bar or the thread, never another screen.
9. **Lose nothing, ask only where something would be lost,** and before
   running a stranger's code.
10. **Colour has one meaning:** violet waits on you, cobalt is under way, red
    failed, green merged.

## Three directions

Each hides the model a different way: by summing it up, by giving it one
shape, or by putting it where and when it happens.

**A · One sentence.** The task is its one next step: a sentence and one
button, the same words on the card, in the bar's chip and in Needs you
("#714 checks failing · 2 more · Fix it"). Changes, Checked by, Reviewing and
Access stay behind the parts' marks, each a row there. The preset is a chip
in the bar, as the ADR has it. Every part change is one line in the thread.
Scratch is one chip at the board's foot.

**B · Change rows.** Everything hangs on the change, so the change is the
one shape to learn. Once a task has two, or one with something of its own
to say (commits waiting, held, moving, a helper, a new target), a strip
under the bar shows each, and each opens to the same card: branch, toward,
where, pull request, how far it was reviewed, its helper; Ship, Move, Stop,
Remove. The card's foot is a mark per change and how many. Each thread line
starts with its change's name, and each turn's line says which change its
commits went to. The preset is a row in the parts. Scratch is a shelf of Up
next, as Kept is of Settled.

**C · Outbox.** The bar and the card stay as they are today. What waits for
the person's word to go up gathers in one chip over the composer ("3 commits
not shipped, on #714 · Ship"), opening to each change's commits, what a reply
asked for, and what fails on what's up now. What's under way (a move waiting
on your edits, Ship's review, waiting for a place) is one live line at the
thread's end. The lead's own part changes fold into its work's line; a line
stands alone only where the person can act on it. A turn's line names where
its time went only when one part dominated. No preset chip: it's how a task
started. Scratch sits over the coordinator's composer.

## Every case, and how each direction handles it

Asks are answered in the thread in every direction (act in place); the
directions differ in what the card, the bar and the composer say about them.

| Case | A · One sentence | B · Change rows | C · Outbox |
|---|---|---|---|
| One change, as today | Chip "#714 ready to merge · Merge"; card as today | No strip; the change is a part, as today | As today |
| Siblings, waiting for checks | Card and chip: "Waiting for checks on #714, #715" | Strip: two segments, checks running; card: two cobalt marks, "2 changes" | Card: #714's chip, "Checks running · 1 more" |
| One needs you, two more | "#714 checks failing · 2 more", Fix it, on card, chip and Needs you | Strip of three, #714 red; card: "#714 checks failing", marks ✗ ↗ ↗, "3 changes" | Card: "#714 checks failing", "2 commits not shipped · 2 more"; outbox for the branch's 2 commits |
| A stack, ready | "#714 and #716 ready · Merge #714, then #716" | Both segments "Ready to merge"; the card's press is the stack's | Card's press "Merge #714, then #716"; bar as today |
| A hold reaching up a stack | Chip "Held: 2 commits waiting on #714 below · Ship"; the thread's card "Ship #716, and the 2 commits on #714 below it" | #716's segment "Held: 2 commits waiting on #714 below", Ship in its card | Outbox "2 commits not shipped, on #714"; the same thread card |
| One merged, the rest carry on | Line "#714 merged… the task carries on with #715 and althar/board-motion"; chip names what's next | #714 stays a green merged segment until its folder goes | The line; nothing else moves |
| A helper on one, you on another | Chip "1 commit not shipped · 1 more"; #716's part "A helper on it", Stop | #716's segment cobalt, "A helper on it", Stop in its card | Outbox for your commit; the hand-off folds into the lead's work |
| A second change starts | Line "Started a second change, althar/rename-later, toward main… · Keep them together" | The same line, led by the change's name; the strip grows | The line stands, as it offers Keep them together |
| A branch the lead made with git | Line "althar/try-virtual-lanes is a change of this task now… · Drop it" | Named line; a branch segment appears | The same line |
| A pull request opened elsewhere | Line "Found #717, from althar/rename-later into main, opened on GitHub"; chip "Waiting for checks on #717 · 1 more" | Named line; #715's segment becomes #717 | The line |
| One it won't guess | A quiet card: "#718 is from althar/board-still, but into release/0.8.0… · Attach it as its own change"; the chip doesn't change | The same | The same |
| A chat takes a worktree | Lines "Took a worktree, to write the fix." and "On the board now…"; chip "1 commit not shipped · Ship"; preset chip "Chat" | A one-segment strip; preset in the parts | "Took a worktree" folds into the lead's work; outbox "1 commit" |
| Into your checkout | Chip "Your checkout is on balazs/notes · Switch"; ask: Switch / Stay in the worktree | Segment "Moving to your checkout: it asks first"; the same ask | The ask only |
| Out of Local, waiting on your edits | Chip "Moves to a worktree once Board.tsx is committed · Call it off" | The segment says it; Call it off in its card | A live line at the thread's end, with Call it off |
| The move called off | Line "You called off the move. It stays in your checkout." | Named line | The line |
| "Run it" on outside code | Chip "How far to trust #702's code · Run safely"; ask: Run safely / Trust fully / Not now; Access part "Read only" | The same ask; Access a task-wide part | The ask; Access in the parts |
| Running safely, two didn't install | Line "electron and playwright didn't install… · Trust fully"; Access "Runs safely": Trust fully, Stop running it | The same | The same |
| Commits not shipped | Chip "3 commits not shipped · Ship" | Segment "3 commits not shipped"; Ship in its card | Outbox "3 commits not shipped, on #714 · Ship"; the card's foot says it |
| Fixes and replies waiting beside | Chip "3 commits not shipped · lint fails on #714 · Ship"; a line for each | The segment says all of it; its card the rest | Outbox: 3 commits, what a reply asked for, "lint fails on what's up now. Ship replaces it." |
| Ship under way | Chip "Shipping #714: reviewing"; line "Brought main in first…" | Segment "Shipping: the review", cobalt | Live line "Reviewing the 3 commits since #714's last review." |
| A new target while held | Card "→ release/0.8.0"; chip "3 commits not shipped · Ship"; line about althar/board-still-2 | Segment's card: Toward release/0.8.0, Branch althar/board-still-2 | Outbox; the line |
| Merge, with commits not shipped | Chip "2 commits on #714 not shipped · Review and merge"; ask: Review and merge / Merge now | The same ask | The same ask |
| Settling, with commits not shipped | Chip "4 commits not shipped · Ship"; ask: Ship, then settle / Leave them on the branch | The same | The same |
| Parts change, by anyone | Lines "The coordinator added a review of #698…", "You moved Checked by to after it merges." | The same, named | The lead's own fold in; the others stand |
| A part removed, and what stays | Line "You removed the worktree. althar/board-still stays, here and on GitHub."; ask: Post it first / Remove without posting / Keep it | The same | The same |
| Fixes checked only where needed | Review line "3 findings · 3 fixed", opening to "One fix checked again…; two were a line or two, not read again." | Named | The same |
| After the merge, it found something | Back in Needs you: "The review of #715 found 2 · Fix it"; ask: Fix it / Leave it | Card "Review found 2"; #715's segment marks it | The same ask; card word "Review found 2" |
| After the merge, nothing found | The review's line; stays Settled | The same | The same |
| A change reviewing a related PR | Chip "Review of #698 drafted · Post it"; Reviewing part "2 comments drafted, not posted" | Reviewing a task-wide part | Reviewing in the parts |
| Chats on Scratch | Chip "Scratch 4" at the board's foot, opening in place | Up next's shelf "Scratch 4", in its place | Chip over the coordinator's composer |
| Its preset, and one offered | Preset chip in the bar (switch, Save as preset…); the coordinator's offer card | Preset a row in the parts; the offer card | No chip; the offer card |
| Where each turn's time went | Opened, the line's first row: "3m 10s waiting for a place · 2m 33s the agent's own work · 1m 1s running tools · 35s starting the session" | Line adds "· 1 commit to #714" | Line adds the part that dominated: "Worked for 7m 19s · 3m 10s waiting for a place" |
| Out of usage | Chip "Claude is out of usage until 14:00 · Use another model"; ask: Use DeepSeek V4.1 Flash / Wait until 14:00 | Paused; the same ask | Paused; the same ask |
| No place for an agent | Chip "Fixing #715's checks waits for one of the 4 agents at work"; your question answered at once | Named live line | Live line at the end |
| A stuck step | Chip "The review for Ship stopped · Try again"; ask: Try again / Review with DeepSeek V4.1 Flash / Ship without it | The same | The same |
| The host refuses the push | Chip "GitHub refused the push · Sign and ship"; ask: Set up signing / Try again, "the 3 commits are still here, held" | The same | The same |

## Recommendation

**A, with C's thread.** A's sentence is the calmest answer to "several
changes": one fact and one button, the same everywhere, so the person reads
a task the same way on the board, in its bar and in Needs you. From C take
the thread: the lead's own part changes fold into its work's line (as
Althar's housekeeping already does), a line stands alone only where the
person can act, and whatever is under way is one live line at the thread's
end. From C too, a turn's line names its time only when one part dominated.
From B take only the turn line's "· 1 commit to #714", once a task has
several changes. Keep the preset out of the bar (see below), and Scratch as
Up next's shelf (B), which reuses Kept's pattern.

B is the right tool if tasks of three or more changes turn out common: it
shows each at a glance, at the cost of a second row of chrome. C's outbox is
the clearest model of the hold, but puts Ship in a second place beside the
card, which A doesn't need.

## What the ADR would need to match

- **The card's one fact needs an order.** "The pull request that most needs
  the person" should be defined: an ask, then a failure, a conflict, ready
  to merge, commits not shipped, a draft to post, a move waiting, a helper,
  checks running. "· N more" counts the task's other open changes; a stack's
  sentence names both, so it doesn't count them.
- **A line for every part change** (§ Changing parts) would crowd the
  thread. The lead's own, mid-turn, read as housekeeping inside its work
  (desktop-app § A thread reads in rounds); a line stands alone where
  someone else made it or it offers a way on (Keep them together, Drop it).
- **A chip naming the preset** (§ How a task starts, § What the board…
  show) can contradict the parts: "Chat" over a task with a worktree and a
  pull request. Name it on the plan card and in the parts, not in the bar.
- **A reply you haven't seen puts the task in Needs you,** but "a chat never
  waits in Needs you". Say which wins for a chat: the prototype shows an
  unseen chat reply as a dot on Scratch, not in Needs you.
- **Commits not shipped and Needs you.** The ADR doesn't say whether a held
  branch keeps a task in Needs you (today, commits to push do). Every tweak
  conversation would then sit there until shipped.
- **Each turn's line:** the total, plus the part that dominated where one
  did, and with several changes, which change its commits went to (the
  ADR's own risk, "a lead can lose track of which folder it's in").
- **Your words go first** (§ The person's words go first) needs its order
  within one task: a round of Althar's own (fixing checks) waiting for a
  place, overtaken by the person's message to the same lead.
- **After merge, back in Needs you:** say what the card says ("Review found
  2", naming the merged pull request).
- **Run it's prompt** offers Not now beside the two levels, and the setting
  that answers it is named on the card.

The ADR's lead is still settling three points. The text this follows already
has a hold reaching up a stack, and a merge settling only its change. If
those or the third (finding a pull request by its head branch without
matching the target) change again, these cases change with them: "A hold
reaching up a stack", "One merged, the rest carry on", "After the merge,
nothing found", "A pull request opened elsewhere" and "One it won't guess".

## Questions for the person

1. Which direction: A, B, C, or A with C's thread (recommended)?
2. The preset: a chip in the bar, as the ADR says, or only on the plan card
   and in the parts (recommended)?
3. Scratch: Up next's shelf (recommended), a chip at the board's foot, or
   over the coordinator's composer?
4. Commits not shipped: keep the task in Needs you until it ships, as today,
   or only say so on its card?
5. A chat's reply you haven't seen: Needs you, or a dot on Scratch
   (recommended)?
6. The lead's own part changes: fold into its work (recommended), or a line
   each, as the ADR says?
