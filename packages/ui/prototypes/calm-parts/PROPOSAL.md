# Phase 5, calmly: a design round on its cases

A prototype for
[a task is a conversation plus parts](https://github.com/AltharIDE/althar/pull/713)
(the proposed ADR on `althar/adr-a-task-is-a-conversation-plus-parts-changeab`,
still at `259de0e`). It shows how the window handles every situation the
proposal adds, on the real board, task bar, thread, composer, Outputs and the
coordinator's plan card. It builds nothing of the feature, and goes once a
direction is picked.

Run it from `packages/ui`:
`./node_modules/.bin/vp dev --config prototypes/calm-parts/vite.config.mjs`,
then open `http://localhost:5374/`. The strip at the bottom switches
direction (1–3, ← →), the case (its list, or [ and ]), and the screen (Board,
Task, Outputs, Plan). The URL keeps them: `?d=B&s=stack-held#/threads/th1`.

Every press changes the case it is pressed in: Ship, Merge, Fix it, Add,
Remove, Run safely, Trust fully, Move, Call it off and every ask's buttons do
what they say, and Undo takes an answer back. Start over, in the strip, puts
the case back. `node flows.mjs` clicks through 74 of these headless.

## Decided so far

- **A's base.** A task is one sentence and one button, the same on its card,
  in its bar's chip and in Needs you. All three directions below keep it; they
  differ only in where a task's several changes show.
- **The lead's own part changes fold into its work.** A line stands alone
  only where someone else made the change or it offers a way on.
- **The preset shows only on the plan card,** as a word in the card's kicker
  ("Change · Task board-still"), in the kicker's own type, underlined on hover
  and a menu on a press. No pill. Settled (9 November): quiet enough as it is.
- **Commits not shipped keep a task in Needs you,** as commits to push do
  today. Its card's word is "Not shipped".
- **Out of usage and a stuck step use the kit's own cards,** with the models
  free to take the work over.
- **Outputs is one page for every change** (this round): each change one
  under another, a settled one folded to a line.
- **Scratch is set aside** (9 November), a topic of its own for later. This
  round keeps only where a chat meets the rest: a chat is a task with no
  parts, kept off the board, and once it takes a worktree or makes something
  it is on the board like any task. The "Scratch 4" chip on the board is a
  placeholder, not a proposal.

## The principles it was designed by

1. **One thing asks at a time.** A task has one fact and one violet button,
   on its card, in its bar and in Needs you, worked out each time it's drawn.
   On Outputs, only the change that fact is about has a violet button.
2. **Defaults stay invisible.** A task that never splits looks as it does
   today. A part shows once it's there and matters. No "Unrestricted".
3. **Counts over lists.** "Both ready to merge", "3 changes", "· 2 more".
4. **Changes have names.** Once a task has two, each goes by a few words
   ("Lane heights", "Rename"), as tasks do. The pull request's number stays in
   lines of record: "Lane heights (#714) merged."
5. **Copy never narrates the screen.** A line only where the person needs to
   know, or can act.
6. **Nothing fails quietly.** Every stop says what happened and offers the
   way out that fixes it, in place.
7. **The window stays still while agents work.** Things change in place.
   Outputs keeps the task's order, and a settled change folds where it was.
8. **Act in place.** Ship, Merge, Call it off and Run it work from the card,
   the bar or the thread.
9. **Lose nothing; ask only where something would be lost,** and before
   running a stranger's code.
10. **Colour has one meaning:** violet waits on you, cobalt is under way, red
    failed, green merged.

## Three ways to hold several changes

Each hides the task's changes a different way: as one piece of work, as one
change at a time, or as a choice made where you talk. A task with one change
reads the same in all three, as today.

**A · As one.** The changes are one piece of work. A small mark for each
sits inside the task's chip, before one sentence about the whole. The sentence
names a change only where it's the exception ("Lane heights: checks
failing"), and counts what's alike ("Both ready to merge", "Waiting for checks
on both"). The button does it for every change it can: Merge both merges the
bottom of a stack first, and Ship ships each held change, bottom up, each with
its own review. The marks open to a row for each change: its name, pull
request, branch, where it stands and its own quiet button. The board card has
the sentence, with the marks and "3 changes" at its foot. The parts row keeps
what the task has as a whole. You don't pick a change to talk to: the lead
works out which one from what you say, and each turn's line says where its
commits went ("· 1 commit to Lane heights").

**B · One at a time.** The window is about one change, named after the
task's title: "/ ✕ Lane heights 1 of 3 •", the dot violet when another needs
you. The chip, the parts and the composer ("Tell Claude Code something about
Lane heights") are that change's. A change's name in a thread line is a link
that turns the window to it. Needs you opens on the change that needs you.
The board card is A's base: "Lane heights: checks failing · 2 more", naming
#714. The cost: the bar shows only the change in view, so a wait on another
change shows only on the card. With no agent free for Rename, the bar on Lane
heights reads "Open · checks pass".

**C · Where you talk.** The changes are tabs over the composer, where
today's chip of the pull requests it listens to sits. The tab you pick is
where what you say next goes, and it says where it stands ("Lane heights e2e
(board.spec.ts) failing"). Press it again and its card opens, with Ship,
Merge or Fix it. The bar keeps one sentence for the task ("Lane heights:
checks failing · 2 more"), and the card is A's base.

Outputs is the same in all three.

## Every case, and how each direction handles it

### Cases with several changes

| Case | A · As one | B · One at a time | C · Where you talk |
|---|---|---|---|
| One change, as today | Chip "#714 ready to merge · Merge"; card names #714 | The same; no switch | The same; no tabs |
| Siblings, waiting for checks | Chip ●● "Waiting for checks on both"; card says it, "2 changes" | "/ Rename 1 of 2"; chip "Checks running"; card "Waiting for checks on Lane heights and Rename" | Tabs Lane heights, Rename "Checks running"; bar "Waiting for checks on Lane heights and Rename" |
| One needs you, two more | Chip ✕ ✓ ⑂ "Lane heights: checks failing · Fix it"; the marks open to three rows, each with its button (Fix it, Merge, Ship); card "3 changes" | "/ ✕ Lane heights 1 of 3 •"; chip "Checks failing · Fix it"; card "Lane heights: checks failing · 2 more" | Tab "Lane heights e2e (board.spec.ts) failing", then Rename, Card slide; bar "Lane heights: checks failing · 2 more · Fix it" |
| A stack, ready | "Both ready to merge · Merge both", the bottom first | "/ Lane heights"; chip "Lane heights and Card slide ready · Merge Lane heights, then Card slide" | The same chip; tabs |
| A hold reaching up a stack | Chip "Held: 2 commits waiting on Lane heights below · Ship": ships Lane heights, then Card slide | Opens on Card slide; switched to Lane heights, its Ship ships it alone | Card slide's tab; Lane heights' tab card ships it alone |
| (its ask, in all three) | "Ship Card slide, and the 2 commits on Lane heights below it" | | |
| One merged, the rest carry on | Line "Lane heights (#714) merged. The task carries on with Rename and Card slide."; its mark turns green | The switch lists the two open ones, "Lane heights merged." under them | Tabs Rename and Card slide, "Lane heights merged" after them |
| A helper on one, you on another | "Lane heights: 1 commit not shipped · Ship"; Card slide's row says "A helper on it" | On Lane heights: "1 commit not shipped · Ship" | "1 commit not shipped · 1 more"; Card slide's tab says the helper |
| A second change starts | Line "Started a second change, Rename, on althar/rename-later toward main, to keep it apart · Keep them together"; a second mark | The switch appears, "1 of 2" | A second tab appears |
| A branch the lead made with git | Line "Virtual lanes, the lead's althar/try-virtual-lanes, is a change of this task now… · Drop it"; a mark appears | The window opens on Virtual lanes | Tab "Virtual lanes · Made with git, no pull request" |
| A pull request opened elsewhere | Line "Found #717, from althar/rename-later into main, opened on GitHub. It's Rename's now."; chip "Waiting for checks on Rename" | "/ Rename"; chip "Checks running" | Rename's tab |
| One it won't guess | A quiet card: "#718 is from althar/board-still, but into release/0.8.0… · Attach it as its own change"; the chip doesn't change. Attached, it becomes a mark | Attached, a second entry in the switch | Attached, a second tab |
| Out of usage | "Claude is out of usage until 14:00 · Use another model" (it is the task's, not a change's) | The same | The same |
| No place for an agent | "Fixing Rename's checks waits for one of the 4 agents at work" | Bar on Lane heights: "Open · checks pass"; only the card says it | The same as A |
| Where the commits went | Each turn's line: "Worked for 1m 11s · 1 commit to Lane heights" | The same | The same |
| Outputs | Every change one under another, in the task's order. A settled change folds to a line ("Lane heights #714 merged · 3 files · +84 −31") that opens to all it made. One whose after-merge review found something stays open. Violet only on the change the chip names | The same | The same |

### Every other case: the same in all three

| Case | Card, bar and Needs you | Thread |
|---|---|---|
| A chat takes a worktree | Card on the board: "1 commit not shipped · Ship", naming its branch | "Took a worktree, to write the fix." folds into the lead's work; "On the board now, as it has a branch of its own." |
| Into your checkout | "Your checkout is on balazs/notes · Switch" | Ask: Switch / Stay in the worktree |
| Out of Local, waiting on your edits | "Moves to a worktree once Board.tsx is committed · Call it off"; the card says Local | A live line at the end, with Call it off |
| The move called off | "1 commit not shipped · Ship" | "You called off the move. It stays in your checkout." |
| "Run it" on outside code | "How far to trust #702's code · Run safely"; Access "Read only" | Ask: Run safely / Trust fully / Not now |
| Running safely, two didn't install | "Review of #702 drafted · Post it"; Access "Runs safely" | "electron and playwright didn't install… · Trust fully" |
| Trusted fully | Access "Trusted"; Stop running it puts it back to Read only | "You trusted #702 fully: install scripts and the network." |
| Commits not shipped | "3 commits not shipped · Ship", in Needs you | — |
| Fixes and replies waiting beside | "3 commits not shipped · lint fails on #714 · Ship" | A line for each |
| Ship under way | "Shipping #714: reviewing" | "Brought main in first…" |
| A new target while held | "3 commits not shipped · Ship"; card "althar/board-still-2 → release/0.8.0" | Ship opens #719 into release/0.8.0, then asks about #714 |
| Merge, with commits not shipped | "2 commits on #714 not shipped · Review and merge" | Ask: Review and merge / Merge now |
| Settling, with commits not shipped | "4 commits not shipped · Ship" | Ask: Ship, then settle / Leave them on the branch |
| Parts change, by anyone | Nothing changes on the card | "The coordinator added a review of #698…", "You moved Checked by to after it merges." |
| A part removed, and what stays | "Your review of #698 isn't posted · Post it" | "You removed the worktree. althar/board-still stays, here and on GitHub."; ask: Post it first / Remove without posting / Keep it |
| Fixes checked only where needed | "#714 ready to merge · Merge" | Review line "3 findings · 3 fixed", opening to "One fix checked again…; two were a line or two, not read again." |
| After the merge, it found something | Back in Needs you: "The review of #715 found 2 · Fix it"; card word "Review found 2" | Ask: Fix it / Leave it |
| After the merge, nothing found | Stays Settled | The review's line |
| A change reviewing a related PR | "Review of #698 drafted · Post it"; Reviewing part "2 comments drafted, not posted" | — |
| Chats on Scratch | Set aside for now; the chip is a placeholder | — |
| Its preset, and one offered | The preset is the plan card's kicker word, a menu on a press; never in the bar | The coordinator's offer card: save it as a preset |
| Where each turn's time went | — | The turn's line opens first to "3m 10s waiting for a place · 2m 33s the agent's own work · 1m 1s running tools · 35s starting the session" |
| A stuck step | "The review for Ship stopped · Try again" | The kit's Stuck card: Try again / Review with another model (its picker) / Ship without the review |
| Out of usage | "Claude is out of usage until 14:00 · Use another model" | The kit's RateLimit card: the models free now, each with how it's reached, or Wait |
| The host refuses the push | "GitHub refused the push · Sign and ship" | Ask: Set up signing / Try again; "the 3 commits are still here, held" |

## Recommendation

**A · As one.** It is the only one of the three that adds no new place.
The chip is already there; the marks sit inside it. You read a task the same
way whether it holds one change or four: one sentence and one button. You
never have to pick which change you're talking to, so there's no state to get
wrong. The lead works it out, and each turn's line says where its commits
went, which answers "which branch is this on?" without a picker. The marks'
list is there for the rare moment you want each change's branch and button.

B makes you keep a mode in mind (the window "on" a change), and it hides a
wait on another change behind the switch. C is the clearest answer to "where
does what I say go", but it adds a row over the composer for as long as a
task has two changes, and each tab's state competes with the bar's sentence.

## What the ADR would need to match

- **A change has a name.** Once a task has two, whoever starts a change
  gives it a few words, as a task is named; the window uses those. Lines of
  record add the number: "Lane heights (#714) merged."
- **The card's one fact needs an order:** an ask, then a failure, a
  conflict, ready to merge, commits not shipped, a draft to post, a move
  waiting, a helper, checks running. With several changes, it names a change
  only where that change is the exception, and counts what's alike.
- **The task's button acts on every change it can.** Merge both or Merge all
  3 (the bottom of a stack first); Ship ships each held change, bottom up,
  each with its own review. The ADR has Ship and merge per change.
- **What you say goes to the task, not to a change.** The lead picks the
  change from what you say, and each turn's line says where its commits went.
  That also covers the ADR's own risk, "a lead can lose track of which folder
  it's in".
- **Outputs is one page for every change.** A settled change folds to a
  line; one whose after-merge review found something stays open.
- **A line for every part change** becomes: the lead's own fold into its
  work; a line stands alone where someone else made it, or it offers a way on.
- **No preset chip** in the bar or on the board card. The preset is named
  only on the plan card, as its kicker's first word.
- **Commits not shipped keep a task in Needs you,** with "Not shipped" as its
  card's word.
- **Each turn's line:** the total, the part that dominated where one did,
  and with several changes, where its commits went.
- **Your words go first** needs its order within one task: a round of
  Althar's own (fixing checks) waiting for a place is overtaken by your
  message to the same lead.
- **After merge, back in Needs you:** the card says "Review found 2", naming
  the merged pull request.
- **A change can go first** (your release flow). The ADR has siblings, which
  merge in any order, and stacks. It needs a third: a change that waits for
  another to merge, toward the same target, without building on its code.
  Its checks that the first one fixes don't ask for the person, and when the
  first merges, Althar brings main into it (held with it, where it has
  commits waiting). Today's text, "so does a fix the change under way needs"
  (stays one change), would put main's fix inside the release.
- **Split less** (your two tickets). "The lead splits where the parts should
  be reviewed or merged apart" becomes: a task stays one change until
  something forces a second (another target or repository, one that has to
  go first) or the person asks. Two tickets in one place are one change, its
  pull request closing both.
- **A change records the issues it closes,** and Keep them together carries
  them across.
- **Keep them together is offered only where the lead split by its own
  choice,** never where the person asked for the work apart.
- **Run it's prompt** offers Not now beside the two levels.
- **Out of usage and a stuck step** offer the models free to take the work
  over, with how each is reached, not only Wait and Try again.

The ADR's lead is still settling three points: a child push carrying a
parent's held commits, the after-merge path settling the whole task, and
finding a pull request by its head branch without matching its target. The
text this follows already has a hold reaching up a stack and a merge settling
only its change. If those change again, so do these cases: "A hold reaching
up a stack", "One merged, the rest carry on", "After the merge, nothing
found", "A pull request opened elsewhere" and "One it won't guess".

## Where it is hard

Most of what is hard here isn't the window. The window is one rule applied
over and over (one sentence, one button, count the rest), and this
prototype shows it holds for every case. What decides whether the window can
stay calm is underneath it: every state the engine can't settle by itself
becomes an ask, and too many asks, not the layout, is what would make it
noisy.

- **The bookkeeping.** Everything that took "one task, one branch, one pull
  request" for granted changes: where a task works, the hold, the review's
  mark, the card, settling, every tool that names the task's branch. The
  products the research read each shipped bugs there.
- **Git.** A push sends the whole branch, so a held commit low in a stack
  holds everything above it; a new target with commits waiting means a
  rebase; a pull request the lead opened itself has to be found by its branch
  and target. Two of the three points the ADR's lead is still settling are
  here.
- **The person's checkout.** Moving into or out of Local waits on their own
  edits and never touches them. The ADR calls it the part that needs the
  most care.
- **The lead's judgment.** What the person says goes to the task, and the
  lead picks the change. A commit to the wrong one can only be shown at once
  (each turn's line says where its commits went), not prevented by the
  window.
- **When a task is done.** With several changes and a review after each
  merge, "settled" is worked out, not set; the third point still being
  settled is here.
- **Cost and speed.** A worktree and a setup for each change, a warm session
  that costs more once its cache lapses, and a review that keeps spending
  after the person has moved on.

The window's own hard parts are three: which change the one sentence names
when several compete (the order under "What the ADR would need to match"),
making "which change am I talking to" a question nobody has to answer, and
saying "commits not shipped" so it needs no explaining.

## Your two flows

Two flows the person has all the time (9 November), as cases in the group
"Your two flows". Both are one conversation with two things to do, one
leaning on the other. The person thinks in what they want done and in what
order ("fix main first", "do this one too"), never in changes, stacks or
siblings, so the window never asks them to.

**A release, and main is red** (`?s=release-red`, then
`release-fix-ready`, `release-on`). "Cut 0.9.0" puts up `release-0.9.0` as
#710. Its checks fail with the e2e that fails on main. "Fix main first, then
carry on with the release": the lead makes Fix main, toward main, and says
in its own turn that the release waits for it. In A:

1. "Fix main: 1 commit not shipped · Ship". The release's red checks don't
   take the sentence, as Fix main is what fixes them. Its mark is grey, and
   its row says "Waits for Fix main to merge".
2. Ship: reviewed, up as #719, checks pass. "Fix main: ready to merge · Merge".
3. Merge: "Fix main (#719) merged, and main came into Release 0.9.0." The
   release's checks run again, and pass. "Release 0.9.0: ready to merge".

Fix main isn't stacked under the release: that would point #710 at the
fix's branch and show the fix in the release's diff, and main should be
green for everyone as soon as it can be. Both go toward main; one goes
first.

**Two tickets** (`?s=tickets-split`, then `tickets-one`). "Do DEV-140, a
privacy page", then "pull in DEV-141 too, the terms page". Claude Code put
them on two branches, and the person wanted one. In A:

- Split, as Claude Code did: "4 commits not shipped, in 2 changes · Ship",
  and the lead's line "Started a second change, Terms page… as DEV-141 is a
  page of its own · Keep them together". One press joins them: "You kept
  Terms page with Privacy page… and its pull request closes DEV-140 and
  DEV-141." Ship opens one pull request.
- Kept together from the start, as proposed: one change, "4 commits not
  shipped · Ship", the parts naming DEV-140 and DEV-141. The lead's own
  words say it's one branch; nothing else changes on screen.

What the flows changed in this design:

- **A change can go first.** A change that waits for another isn't stacked
  on it. What the first one fixes doesn't ask for the person on the second,
  and once the first merges, main comes into the second. Its row says
  "Waits for Fix main to merge".
- **One change until something forces a second:** another target or
  repository, one that has to go first, or the person asks. Two tickets in
  one place stay one change, its pull request closing both.
- **Keep them together only where the lead chose to split.** Where the
  person asked for it ("fix main first"), the lead's line offers nothing to
  undo it.

These are in A only; B and C read the same rules their own way.

## How to choose between A, B and C

Most cases look the same in all three; these six are where they differ. Open
each at its address, press 1, 2 and 3 to swap the direction in place, and try
the button and the message box. Each asks one question.

1. **Can you tell in a second what needs you?** One needs you, two more
   (`?s=needs-one`). A: "Lane heights: checks failing · Fix it", the marks in
   the pill. B: "Checks failing · Fix it" for the change in view, a dot on the
   switch. C: the same sentence with "· 2 more", and a row of tabs over the
   message box.
2. **Does a wait on another change reach you?** No place for an agent
   (`?s=no-slot`). A and C: "Fixing Rename's checks waits for one of the 4
   agents at work". B, on Lane heights: "Open · checks pass"; only the board
   card says it. B's weak spot.
3. **When you type, do you know which change it goes to, or care?** A helper
   on one, you on another (`?s=helper`). A: "Tell Claude Code something"; the
   lead picks, and the turn's line says "1 commit to Lane heights". B: "…
   something about Lane heights". C: the picked tab.
4. **Does the one button do what you expect?** A hold reaching up a stack
   (`?s=stack-held`). A: Ship ships both, bottom up. B opens on Card slide, the
   top; switched to Lane heights, Ship ships only it. C: each tab's own.
5. **How much moves when a task gets its second change?** A second change
   starts (`?s=split`). A: a second mark in the pill. B: a switch after the
   title. C: a row of tabs over the message box.
6. **What happens to a change that's done while the rest carry on?** One
   merged (`?s=merged-one`). A: its mark turns green. B: the switch lists only
   the two still open. C: tabs for the open ones, then "Lane heights merged".

And one to confirm: a task with one change (`?s=one`) is the same in all
three, as today.

## Questions for the person

1. Several changes: A · As one (recommended, and where you lean), B · One at
   a time, or C · Where you talk?
2. Two tickets in one task: one pull request closing both, unless something
   forces two (recommended), or one pull request per ticket?
