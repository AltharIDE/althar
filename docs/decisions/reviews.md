# Reviews

Who reviews a task's change and how the rounds go, the review after a small
change merges, reviews of other people's pull requests, and what a pull
request shows of the review and of the work: the seal, the screenshots
comment, and Outputs. How review steps run is in
[05](../architecture/05-workflow-engine.md); reviewing someone else's pull
request is in [06](../architecture/06-integrations-and-skills.md).

**Replaces:** ADR-076,
ADR-077,
ADR-079. It also holds the
review parts of
ADR-034,
ADR-035,
ADR-050,
ADR-097
and
ADR-102,
which live in [tasks](tasks.md), [agents](agents.md) and
[what agents may do](what-agents-may-do.md).

## Who reviews

A change's plan names its reviewer: an agent, a model and an effort, beside
the lead. The coordinator picks them by the person's preferences first, then
by the models' scores ([agents](agents.md)):

- **GPT-6.1 Sol or Terra** reviews first, with Sol at medium effort for large
  or risky changes.
- **DeepSeek V4.1 Flash on OpenCode Go** reviews when those are out. OpenCode
  Zen is only the backup for Go.
- **Never GPT Luna.**

The person can change who reviews at any time before the task merges, as
Change the team does; a review under way finishes with the reviewer it
started with, and the next round takes the new one.

## How a review round runs

- **The reviewer reads a copy, not the lead's worktree:** a throwaway copy of
  the worktree as it stood when the round began, at
  `<project>/.review/<task>/<repository>`, with the lead's evidence beside it
  (`.evidence`). Whatever the reviewer does lands in the copy, and the copy
  doesn't move if the person talks to the lead meanwhile.
- **The reviewer files findings; the lead settles each one,** in
  `finish_step`: fixed, with a line saying what changed and the commit that
  made it, or set aside, with the reason. A set-aside finding with no reason
  counts as unsettled.
- **A fix is checked only where it needs it, never by another whole review**
  (a task is a conversation plus parts, [tasks](tasks.md#changing-parts)):
  - **A tiny fix isn't read again:** ten changed lines or fewer, every one in
    a file a finding of that review named, read against the copy the review
    read. The task goes on to its ending, its seal kept, and the folded
    review names the files.
  - **A bigger fix gets one short check** by the same reviewer: told it is
    a check of the fixes, not another review, it reads only what the fixes
    changed (`git diff` from the copy it read) against its findings, and
    reopens only one a fix didn't settle.
  - **A finding the check reopened** goes back to the lead once more, and
    that second fix isn't read again.
- **When a check finds more** and the lead settles it, the person's "When a
  check finds more" setting decides. By default, "Carry on when every
  finding is settled": the task goes on to its ending with the second fix
  unreviewed, and the person decides on any merge. Its thread and pull
  request say the last fixes weren't reviewed, and it carries no seal. With
  "Ask me", or with findings still open, the task is stuck in Needs you for
  the person to say. The old "Review rounds" setting is kept as it was and
  read by nothing.
- **The person can skip a round's review** from the task's menu: a review
  under way stops, and a round whose lead is done concludes. The next round
  has its review again.
- **Ship is reviewed as the plan says,** where it has a reviewer before the
  work ships: one pass over what came after the commit the last review read,
  found by its tree, as pushing may have credited it since. What the person's
  turns with the lead committed and any fix for checks in between are in it
  ([tasks](tasks.md#rounds-back-to-work-and-shipping-again)).
- **No agent approves its own work.** Approving a pull request a task opened,
  making a commit status or a check run, and dismissing a review are refused
  to agents ([what agents may do](what-agents-may-do.md)).

## A small change is reviewed after it merges

A change of a few lines takes the fast lane ([tasks](tasks.md)): one step on
a light model, no countdown, and a review step that names its reviewer but is
skipped. Its pull request merges on the person's word, and the merge ends
that change: the task settles where it was its last. Then **the task's own
reviewer reads what merged, in the same task** (`MergeReviews.ts`, a
decision of a task is a conversation plus parts, [tasks](tasks.md#a-task-holds-as-many-changes-as-it-needs)):

- It is owed as the merge is heard, kept before it is tried
  (`merge_reviews`), and started in a thread of the task's own
  (`merge_review`), on a copy at the merged head, from what the last review
  read. Settling spares it, and a restart starts it again.
- It reports in the task's thread, naming the pull request it read. Nothing
  is posted on the merged pull request.
- **Nothing found** is a line in the thread, and nothing more.
- **What the project's rule brings back** puts the task back in Needs you,
  "Review found 2 after #715 merged", with **Fix it**, which hands the
  findings to the lead as the person's word and ships its fix as a new pull
  request after the merged one once its turn ends, and **Leave it**, which
  closes them. Agents answer it on the person's word with
  `answer_review_after_merge`.
- **What it doesn't bring back** ends as the same quiet line as nothing
  found ("Review · … · 2 findings · None major"), its findings readable
  there, and nothing waits on the person; its Outputs say "Reviewed by", not
  "Changes asked by".

### What the review after a merge brings back

A project rule says it (`afterMergeReview`, on the project's Settings ›
Tasks, under How they go; `read_settings` and `change_settings` reach it as
`project/tasks`):

- **Bring back major findings** (the default, and what a project made before
  the rule has): the reviewer reads what merged, and only `blocking` and
  `major` findings bring the task back. A review whose findings are all
  `minor` or `nit` ends as a quiet line. Its brief tells the reviewer so,
  so it doesn't pad the review with small things.
- **Bring back every finding:** any finding brings it back, as before the
  rule.
- **Don't review it:** no review is owed after the merge. The small change's
  card says "no review" in place of "reviewed after it merges". "Make it a
  full task" still moves a review before the merge.

New projects start from a default in Althar's Settings › Tasks (`althar/tasks`,
`new_project_after_merge_review`), as the other new-project rules do.

**One small change may say otherwise**, until it merges: keep a review after
its merge where the rule has none (it brings back what Major only does), or
drop it where the rule has one (`review_after_merge` on the person's word,
`SetReviewAfterMerge` from the window, kept as `task.after_merge_review_set`).
Its card reads what holds (`afterMerge` on the small change's card); the
card's control for it waits on the card's redesign.

The rule and the task's word are **read when the merge is heard**, not when
Althar starts, and what the review brings back is kept on it then
(`merge_reviews.reviewer`, `bringsBack`), so the reviewer's brief and its
report read the same rule, whatever changes meanwhile.

What Merge now merges with commits not shipped is reviewed after the merge
the same way, where the task has a reviewer, and brings back what the rule
says; only a small change's is dropped by Don't review it.

The review after a merge isn't owed where the plan named no reviewer, where
the rule or the task's word says none, or where the pull request closed
without merging. "Make it a full task", on the small change's card, moves
its review back before the merge.

Why: the review was a fifth of a small task's time, and the person wants
small changes fast. Reviewing after the merge keeps a second reader without
holding the merge. The trade is that a finding then needs a fix of its own,
so only what is worth one comes back by default: a nit brought the person
back to a change that had merged, which they didn't want (11 November). They
asked for the choice of skipping it too, per project and as a default.

Because nothing reviewed it before its pull request opened, **a fast-lane
pull request carries no seal**, and its description has no review section.

## Reviewing someone else's pull request

The coordinator starts a review with `review_pull_request`. It is a task of
its own kind.

- **Its lead reads a read-only copy of the pull request's head** that Althar
  fetched: detached, on no branch, with git running with none of the person's
  config (`addReadCopy`). It runs in reader mode under the reader rules. No
  setup or run touches the copy, and nothing it does reaches the host but the
  draft review the person posts.
- **A review of the repository's own people** gets every lead tool, and its
  commands reach the network as a lead's do. **An outside author's** gets
  the six reading tools.
- **Any model leads one,** Codex's GPT models included. Codex runs what its
  read-only sandbox contains without asking, so as a review's lead it may run
  the pull request's scripts there: offline for an outside author's, writing
  nothing, held by the OS sandbox. That is the sandbox doing its job, not a
  reason to refuse the agent (the person's note of 11 Nov).
- **An outside author's pull request stays offline.** An outside author is
  someone on a fork, or someone the host doesn't name a member or
  collaborator. The review's commands reach no network, and none of the
  repository's settings, hooks or MCP config load. This sits under "an
  outside author's code doesn't run without the person's word" in
  [what stays](what-agents-may-do.md): a stranger's text can steer the agent,
  and the private code is what a leak would expose. There is no host list
  for it.
- **The lead drafts with `draft_review`:** a verdict, a summary and comments
  on lines, as a card in the task's thread. Nothing reaches the host until
  the person posts it from the card, keeping or dropping each comment and
  choosing the verdict. The lead's verdict is a suggestion, and never Approve
  for the person on an outside pull request. Posting a review on a pull
  request no task of Althar's opened speaks for the person, so it waits for
  them ([what agents may do](what-agents-may-do.md)).
- **"Post reviews of my team's pull requests without asking,"** off by
  default, posts a team member's review as soon as it is drafted. An outside
  author's always waits.
- **Posted, the card folds to a line** with the review's link, and the task
  settles.

### Run it

A review that runs code is a review whose Access moved: "Run it" is the
person's word, from the buttons under its reach line or to its lead, whose
`run_it` only relays it. How far is kept on the review's workspace
(`workspaces.trust`), and the lead starts afresh in the role that gives it,
told to run its tests and its app.

- **The team's own pull request** runs at once, trusted as their code:
  the copy is set up with the recorded setup and files, as a worktree is,
  with the network, and any agent may lead it.
- **An outside author's** asks how far: **Run safely** installs from the
  lockfile with install scripts off, after putting back the base branch's
  registry settings (`.npmrc`, `.yarnrc`, `bunfig.toml`) in place of any the
  pull request changed, copies nothing of the person's setup, and runs its
  commands in the sandbox, offline, with every lead tool; what didn't
  install is said, with Trust fully beside it, and so is each of the
  lockfile's entries from a git host or a tarball off a registry that isn't
  in `node_modules` after it (npm's, bun's, yarn's and pnpm's lockfiles,
  `lockOutside.ts`). **Trust fully** runs it as the team's code.
- **Stop running it,** beside how far it trusts the code while it runs,
  takes that back: what its lead started of it stops, its copy is read only
  again, and its lead starts afresh as a reader, told so.
- **"When I say Run it on code from outside the team"** (Settings, Pull
  requests): ask each time, the default, run safely, or trust fully. It only
  answers the question: the code runs once the person says Run it.

### Any task can review a pull request

`add_review` gives a task with work of its own a read-only copy of a related
pull request's head beside its worktree, a workspace of its own
(`workspaces.reviewing`), which its lead drafts a review of with
`draft_review`, as a review task's lead does. The task stays its work's: it
isn't a review task on its card, and posting the review doesn't settle it.

Not built yet: posting on the person's word in the thread (`post_review`),
as well as from the card.

## What a pull request shows of its review

Where a task's change had a review before its pull request opened, and the
person has the seal on, the description (`pullRequestReview.ts`) carries:

- **A seal** at its head, floated right, naming the reviewer, the number of
  passes, the commit the last pass read and the day.
- **The review, folded,** after the lead's description: "Reviewed by GPT-6.1
  Sol in 3 passes, at `2f67c42`". Under it, what changed after review, each
  in the lead's words with its commit; what was looked at and kept, each with
  the lead's reason; and a line naming the model that built the change and
  the one that reviewed it.

It gives no counts of findings and no severity: the person said the counts
matter to nobody. A commit is shown only where it is one the lead made
settling that pass, and the sha is the one the host has after crediting. The
commit the last pass read must hold the tree it read, or there is no seal.
Where the code changed after the last pass, there is no seal either, and the
folded review says the last fixes weren't reviewed, unless every fix after
it was tiny: then the seal stands, naming the commit the last pass read, and
the folded review names the tiny fixes under "Fixed after it, too small to
read again".

- **The site draws the seal:** a Worker route, `/seal/<look>.svg`, renders
  the kit's pure drawing (`packages/ui/src/seal`) from its query, with glyph
  outlines instead of fonts, because an `<img>` loads none. It is drawn in two
  inks for light and dark, picked by `<picture>`, so **the seal goes only on
  GitHub**; GitLab's support for `<picture>` is uncertain. The folded review
  is plain HTML and goes on both.
- **Settings › Pull requests** has "Review seal on pull
  requests", on by default, with three looks to pick from (ring by default).
- **Written once,** when the pull request opens; the hosts' connectors can't
  edit a description. Rounds after it opened don't change it. A failure to
  read the review never holds the pull request up: it opens without it.

The seal depends on althar.ai being up when a host first fetches it; host
image proxies keep it after.

## Screenshots on the pull request

- **What goes is what Outputs shows.** One function (`screenshotsNow`) works
  out a task's screenshots as it is now, each view once, as last taken. The
  window draws Outputs by it and the runtime posts by it, so they can't
  differ.
- **One comment, written anew** as they change, rather than a new comment
  each time. Earlier pictures of a view are folded away under the current
  ones. A hidden mark finds the comment again; a deleted one is posted again.
  It is signed as Althar's, so listening doesn't read it to the lead.
- **An edit notifies nobody,** so where someone reviewed after it was last
  written and it changed, a one-line comment says how many changed, with a
  link.
- **Uploaded to the host, nowhere else:** GitHub through the uploads endpoint
  its CLI uses, GitLab through the project's uploads, so pictures keep the
  repository's access. Each picture goes up once, by its digest. GitHub
  Enterprise Server and Bitbucket take no such upload, so the control isn't
  offered there.
- **By hand, or by a project rule.** "Post screenshots to pull requests
  automatically" (`postScreenshots`) is off by default. Off, Outputs offers
  "Post to PR #142" quietly, opening the screenshots to keep or leave out; on,
  it says "Synced to PR #142". Once posted either way, the comment follows
  Outputs. A view the person left out stays out of that pull request.

GitHub's upload endpoint isn't in its REST documentation, so it may change.
An upload can't be taken back, which is why the first post by hand confirms
what goes.

## Outputs show the change as built

- **The lead says what each picture is,** in `finish_step`'s evidence: a
  `view`, a short name it keeps for a view of the work as built, so a later
  picture replaces it; or `option`, for a direction the person chooses
  between, or an exploration. A change's options stay in the thread and never
  reach Outputs or the pull request. A prototype's Outputs are its
  directions.
- **A later round replaces earlier ones,** but for the views it takes again
  and those it names in `kept_views`. A round that only takes known views
  again leaves the others as they were. A view gone from Outputs leaves the
  posted comment too.

A round that forgets `kept_views` shows less, never something stale.

## Changes

- 8 Nov 2026: written from the ADRs under Replaces.
- 8 Nov 2026: the limits sweep (#696) built: a review of the repository's own people gets every lead tool and the network.
- 9 Nov 2026: a fix is checked only where it needs it, tiny ones not at all, and Ship is reviewed from where the last review left off (a task is a conversation plus parts, [tasks](tasks.md#changing-parts)).
- 10 Nov 2026: Run it, safely or trusted, with its setting; any task can review a related pull request beside its own work (a task is a conversation plus parts).
- 10 Nov 2026: Stop running it; Run safely names the lockfile's entries from a git host or a tarball that didn't install.
- 11 Nov 2026: any model leads a review of someone else's pull request; the refusal of agents that "can't be held to reading only" is gone.
