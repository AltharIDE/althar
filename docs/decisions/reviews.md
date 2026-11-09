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
  ([a task is a conversation plus parts](proposed/a-task-is-a-conversation-plus-parts.md#fixes-are-checked-by-the-same-reviewer-only-where-they-need-it)):
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
skipped. Its pull request merges on the person's word, and the merge starts a
**review task of its own** on the merged pull request (`Reviews.start` with
`afterMerge`), which reads and posts as any review of a pull request does.
Nothing blocks the merge until then.

The review after a merge is refused where the plan named no reviewer, or
where the pull request closed without merging. "Make it a full task", on the
small change's card, moves its review back before the merge.

Why: the review was a fifth of a small task's time, and the person wants
small changes fast. Reviewing after the merge keeps a second reader without
holding the merge. The trade is that a finding then needs a fix of its own.

Because nothing reviewed it before its pull request opened, **a fast-lane
pull request carries no seal**, and its description has no review section.

## Reviewing someone else's pull request

The coordinator starts a review with `review_pull_request`. It is a task of
its own kind.

- **Its lead reads a read-only copy of the pull request's head** that Althar
  fetched: detached, on no branch, with git running with none of the person's
  config (`addReadCopy`). It runs in reader mode under the reader rules and
  runs nothing of the pull request's code. No setup or run touches the copy.
- **A review of the repository's own people** gets every lead tool, and its
  commands reach the network as a lead's do. **An outside author's** gets
  the six reading tools.
- **Only an agent its session can hold to reading leads one.** One that runs
  whatever its sandbox contains without asking, such as Codex, could run the
  pull request's code, so it is refused with the names of those that can.
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

Not built yet:

- A pull request by the repository's own people getting a worktree at its
  head with the setup replayed, and its code run in the sandbox. This, and
  the in-task reviewer's tool list, wait on the work that makes a task a
  conversation plus parts.
- "Run it", the person's word in the thread that turns an outside author's
  review into the team's kind, still offline for its commands.
- Posting on the person's word in the thread (`post_review`), as well as
  from the card.

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
- 9 Nov 2026: a fix is checked only where it needs it, tiny ones not at all, and Ship is reviewed from where the last review left off ([a task is a conversation plus parts](proposed/a-task-is-a-conversation-plus-parts.md)).
