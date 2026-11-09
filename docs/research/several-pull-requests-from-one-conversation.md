# Several pull requests from one conversation: how others do it

Research for
[a task is a conversation plus parts](../decisions/proposed/a-task-is-a-conversation-plus-parts.md#a-task-holds-as-many-changes-as-it-needs).
Its question: can one conversation with an agent hold several branches and
pull requests, in one repository or several, one after another or at the
same time? A task in Althar held one worktree, one branch and one open pull
request per repository at a time. On 8 November 2026 the person chose that
a task holds as many as it needs: "People's asks are not always clear cut."

Read on 8 November 2026 from primary sources: each product's source where
it is open, cited at a commit, its docs and release notes, and the issues
where people say what went wrong. "Not found" means the sources didn't say.
An inference is marked as one. The products are the ones the person named:
T3 Code, Orca, Paradev, Agent Orchestrator and Amp, with Claude Code as the
baseline they compared it to.

| | The conversation is tied to | Several pull requests | Same repository at once | Work on several at once | How a pull request is linked | Stacks | When one merges |
|---|---|---|---|---|---|---|---|
| **T3 Code** | a thread, with one branch and worktree that can change | yes, since 9 September 2026 | in turn, in one worktree | child threads, each in a worktree of its own | recorded, with where it came from, `gh pr create` included | yes, read from head and base, with Merge stack | settles only once no link is open |
| **Orca** | a worktree, with one branch; several chats in it | yes, since 10 October 2026 | in turn | more worktrees; orchestration workers each get one | an address printed in a terminal, if its head matches | yes, GitHub's own stacks | nothing by itself |
| **Paradev** | a workspace, with one worktree, branch and current pull request | in turn; users ask for more | only as separate workspaces | a coordinator skill, a workspace per worker | by the upstream branch, with a sweep every 5 minutes | a base per branch only | nothing by itself |
| **Agent Orchestrator** | a session, with one worktree for life | yes, by design | in turn, in one worktree | separate worker sessions, each pushing its own | by branch-name prefix, or claimed | yes, based on the parent branch | the session stays |
| **Amp** | a thread, with one working copy | possible, not modelled | through child threads | child threads, each with its own machine | the thread's ID in the pull request's description | no | Archive is offered |
| **Claude Code** | CLI: a folder; desktop: a worktree; web: a branch | CLI: no limit; Projects: one per thread | CLI: yes, with more worktrees | subagents in worktrees, `/batch`, Projects' threads | each one it creates or touches | no | the desktop app removed the worktree |

## T3 Code

[`pingdotgg/t3code`](https://github.com/pingdotgg/t3code) at `ade473018d32`.

- **A thread has one branch and one worktree,** which can change: the branch
  picker checks out in place, and the agent's `t3_worktree_handoff` moves the
  thread into a new worktree on a new branch
  ([tools.ts](https://github.com/pingdotgg/t3code/blob/ade473018d32003658b7d38693e083ee2e314bd8/apps/server/src/mcp/toolkits/worktree/tools.ts#L28-L36)).
  Since 5 November, threads follow branch changes made in their worktree.
- **"A thread can hold several pull requests,"** since #10839 (9 September
  2026)
  ([source-control.md](https://github.com/pingdotgg/t3code/blob/ade473018d32003658b7d38693e083ee2e314bd8/docs/user/source-control.md?plain=1#L282-L288)).
  Each link records where it came from: `manual`, `created`, `agent`,
  `stack` or `stack-dismissed`
  ([threadPullRequest.ts](https://github.com/pingdotgg/t3code/blob/ade473018d32003658b7d38693e083ee2e314bd8/packages/contracts/src/threadPullRequest.ts#L28-L34)).
  When the agent runs `gh pr create` in its shell, the server reads the
  address from it and links the pull request, whatever the branch
  ([PullRequestSyncReactor.ts](https://github.com/pingdotgg/t3code/blob/ade473018d32003658b7d38693e083ee2e314bd8/apps/server/src/orchestration-v2/PullRequestSyncReactor.ts#L647-L670)).
- **A current pull request is worked out from the list:** open work first,
  then a finished stack's top layer
  ([glossary.md](https://github.com/pingdotgg/t3code/blob/ade473018d32003658b7d38693e083ee2e314bd8/docs/internals/glossary.md?plain=1#L51-L53)).
  The badge shows it with "+N"; the panel lists all, grouped by stack.
- **Parallel work goes to child threads:** `delegate_task` with
  `isolation: 'worktree'` makes "a new prepared checkout from the parent
  commit". Nothing brings a child's work back (not found); "Subagents cannot
  watch pull requests; the thread that delegated to them does."
- **Stacks** are read from head and base chains, or GitHub's own stacks, with
  Merge stack and Rebase stack.
- **Settling:** "An open link means the pull request has not finished, so
  only inactivity can settle the thread"
  ([ThreadSettlementService.ts](https://github.com/pingdotgg/t3code/blob/ade473018d32003658b7d38693e083ee2e314bd8/apps/server/src/orchestration-v2/ThreadSettlementService.ts#L205-L212)).
- **What went wrong:**
  - #15702: a green open icon "followed by `+6`, which reads as six open
    PRs".
  - #19183: a thread watching several pull requests "gets one wake and one
    turn per pull request".
  - #11078, #28463: the sidebar kept "the branch stamped at thread creation"
    after the agent switched; one user counted 25 threads.
  - #19263: settling after a merge killed background work.

## Orca

[`stablyai/orca`](https://github.com/stablyai/orca) at `ace74af49008`.

- **The unit is the worktree:** "Each worktree has its own branch, its own
  files on disk, and its own agent terminals." The branch can change, but
  not while an agent works there, and since 7 November not with uncommitted
  changes: before, they "silently moved onto the other branch".
- **Several pull requests per worktree since v1.4.224** (10 October 2026):
  "You can attach several pull requests, merge requests and tasks to one
  workspace." The model keeps the old single `linkedPR` as the active one,
  beside a list, `linkedItems`
  ([types.ts](https://github.com/stablyai/orca/blob/ace74af49008dc8d0da7410964883b283757acf8/src/shared/worktree/types.ts#L127-L128)).
  Each attachment names the session that made it. An address printed in a
  terminal is attached only if its head branch and commit match the
  worktree's.
- **Parallel work means more worktrees.** The recipe for racing three agents
  is three worktrees, then "Delete the two losers"
  ([parallel-agents.mdx](https://github.com/stablyai/orca/blob/ace74af49008dc8d0da7410964883b283757acf8/docs/site/content/docs/recipes/parallel-agents.mdx?plain=1#L5-L15)).
  Orchestration workers start with `--worktree new-child`. Bringing their
  work back is left to the coordinator agent: the coordinator ignores
  `merge_ready`.
- **Stacks:** start a worktree from another branch "for stacking work on top
  of a PR in review", and GitHub's own stacks with "Merge through #N".
- **When one merges,** nothing happens by itself. The docs say "Delete merged
  worktrees aggressively"; #14537 asks for more, since "every landed PR
  leaves a dead checkout behind".
- **What went wrong:**
  - #9213: "Orca links exactly one MR/PR to a worktree", against backend
    and frontend pull requests, stacks, and one head with three pull
    requests. A contributor counted 57 files touching `linkedPR`.
  - #39004: several pull requests from one worktree drew as overlapping
    icons.
  - #8760: checks stuck to an old pull request after a branch switch in the
    terminal.
  - #19293: Hand off can't go to a new worktree, so "several sessions write
    to one git index".

## Paradev

Superset, renamed Paradev on 26 October 2026.
[`ParadevAI/Paradev`](https://github.com/ParadevAI/Paradev) at `b77bc046ee98`.

- **A workspace has one worktree, one branch and one current pull request**
  ([schema.ts](https://github.com/ParadevAI/Paradev/blob/b77bc046ee98bbc3ac05c7ae792e630d7e7b73d0/packages/host-service/src/db/schema.ts#L231-L297)).
  The docs: "A separate worktree and terminals for each git branch."
- **Several only one after another,** by switching branches. A table keeps
  the rest: "a workspace that opens a PR per branch accumulates one row
  each"
  ([schema.ts](https://github.com/ParadevAI/Paradev/blob/b77bc046ee98bbc3ac05c7ae792e630d7e7b73d0/packages/host-service/src/db/schema.ts#L374-L397)).
  The activity menu lists them all, but merges only the current one.
- **Parallel work is a workspace per worker,** driven by the `orchestrate`
  skill. "Paradev does not merge worker branches automatically."
- **Pull requests are matched by the upstream branch,** refreshed on git
  events and a 5-minute sweep. A pull request the agent opened with `gh pr
  create` "did not show up" until the sweep ran (#7679, fixed in #7719).
- **Stacks:** each branch can have its own base, "measuring against the repo
  default gets stacked branches exactly backwards". Nothing more.
- **What went wrong:**
  - [#8473](https://github.com/ParadevAI/Paradev/issues/8473) (13 October
    2026): "I often open several PRs from one session: stacked PRs, or
    separate independent PRs". The workaround, a separate workspace per pull
    request, "splits one session's context across several workspaces".
  - #8895: "only shows one of them".
  - #5619: "a branch with multiple PRs showing the wrong (closed) one".
  - #3035, open since March: "I cannot use superset until I have either
    github stack or graphite support".

## Agent Orchestrator

[`OrchestratorInc/agent-orchestrator`](https://github.com/OrchestratorInc/agent-orchestrator)
at `b0274c05e771`.

- **A session keeps one worktree for its whole life,** one per repository in
  a multi-repository project.
- **Several pull requests by design:** "One session can own many PRs … but a
  PR belongs to one session"
  ([0001_init.sql](https://github.com/OrchestratorInc/agent-orchestrator/blob/b0274c05e7711dba64b7483b207a69e96b3c1f3b/backend/internal/storage/sqlite/migrations/0001_init.sql#L51-L56)).
  In one repository they come one after another, in the one worktree: it
  "does not currently create one worktree per PR" (#2408).
- **Ownership is found by branch name:** the observer "prefers exact
  branches, then the longest owned prefix", and workers are told to "create
  independent PR branches as siblings under the same namespace".
- **Parallel work is separate worker sessions.** Workers may not use their
  agent's own subagents. The orchestrator must "Never … push, or open PRs".
  Each worker pushes its own.
- **Each pull request is followed on its own,** every 30 seconds: its
  checks, review threads, comments and conflicts are told to the agent, each
  with the pull request's address. Reviews are per pull request head.
- **Stacks:** "create the new branch from the parent branch and target the
  parent branch in the PR". Only the bottom of a stack is asked to rebase.
- **When one merges,** the session stays, by default. Where the person opted
  in, it ends only when "no open PR remains and at least one of them
  merged", and never while the agent works.
- **What went wrong:**
  - #1193, #1618: a session "permanently bound to the first PR it sees";
    five review comments on a later pull request, one of them high severity,
    were never passed on.
  - #2176, #2408, #6997: reviews and buttons acting on "whichever PR happens
    to come back first", or the first open one.
  - #2398: messages saying "your PR".
  - #2879: "silent loss of PR tracking for any multi-PR worker whose first
    PR merges quickly".
  - #4236, #4984: pull requests missed by name matching.
  - #1044: splitting one issue into several pull requests meant "Reviewers
    have to review several PRs in the correct order".

## Amp

Closed source; from [its docs](https://ampcode.com/docs) and news posts.

- **A thread is the unit of work,** and in the cloud each gets its own
  machine with a working copy of the project's base branch
  ([orbs](https://ampcode.com/docs/orbs)). Locally, a thread can get a
  worktree of its own "when several threads should work in the same
  repository at the same time"
  ([runners](https://ampcode.com/docs/cli/runners#create-a-worktree)).
- **Several pull requests are possible, not modelled:** "You can ship again
  from the same thread"
  ([shipping](https://ampcode.com/docs/orbs/shipping)). A pull request is
  linked by the thread's ID in its description, so the thread's title bar
  lists each one ([github](https://ampcode.com/docs/github)). The docs say
  to "Use one thread per task".
- **Parallel work is child threads,** each with "its own conversation,
  context window, working copy, and orb". "A message does not transfer files
  or commits by itself"
  ([agent to agent](https://ampcode.com/docs/orbs/agent-to-agent)). Each
  child ships its own work.
- **Each pull request is followed on its own:** before calling one complete,
  the thread subscribes to its comments, reviews and "the check rollup for
  its exact head commit".
- **Stacks:** none. Restack splits a large diff into logical commits on one
  branch, and "does not push".
- No public issue tracker; no user reports found.

## Claude Code

From [its docs](https://code.claude.com/docs/en/) and
[`anthropics/claude-code`](https://github.com/anthropics/claude-code) issues.

- **The CLI has no limit:** the agent runs `git` and `gh pr create` as often
  as it likes, can move between worktrees with `EnterWorktree`, and its
  subagents can take `isolation: worktree`. Agent view links a session to
  every pull request it creates or touches, shown as "3 PRs"
  ([agent view](https://code.claude.com/docs/en/agent-view#pull-request-status)).
  `/batch` splits a change into "5 to 30 independent units", each in a
  worktree, each opening its own pull request.
- **The web pins one branch per session:** "DEVELOP all your changes on the
  designated branch … NEVER push to a different branch without explicit
  permission" (quoted in #91018).
- **Projects** (beta, September 2026): "one coordinating conversation with
  Claude plus the threads it starts". "A cloud thread works on its own
  branch and opens a pull request when the work calls for one"
  ([Projects](https://code.claude.com/docs/en/claude-projects)), with an
  overview of pull requests by state.
- **What went wrong,** mostly where one session gathered several pull
  requests on top of a one-pull-request model:
  - [#101199](https://github.com/anthropics/claude-code/issues/101199) (11
    October 2026): "That rule assumes one session = one branch = one PR.
    … When the first PR merges, the worktree the session is still working
    in gets removed." It asks for "A PR merge is a signal to check, never a
    trigger to delete."
  - #103999: a background job killed and its worktree deleted within a
    minute of its pull request merging, mid-turn.
  - #58166: later pull requests in the same repository hidden, since "The
    dedup happens at the per-repo level".
  - #46625, #65488: View PR and auto-fix stuck on the first pull request.
  - #106190: the merge was seen five minutes late, so the agent pushed to a
    merged branch and had to "open a second PR for the stranded commit".
  - #11176: on the web, "After merging a PR, I cannot reuse the
    conversation's built-up context for new branches."

## What they have in common

- **All but Paradev let one conversation hold several pull requests now:**
  Agent Orchestrator by design, Claude Code's CLI always, T3 Code since
  September and Orca since October. Paradev's users ask for it. T3 Code and
  Orca each kept one "current" pull request beside the list, for what still
  reads one.
- **Nobody gives one conversation several live worktrees** but Claude Code's
  CLI. Parallel branches are children, each with a worktree of its own, and
  none of them brings a child's work back by itself.
- **The bugs come from the same four places:**
  - finding pull requests by the folder's branch, or a branch name;
  - one worktree carrying several branches in turn, so "the current pull
    request" goes wrong;
  - treating the first merge as the end of the conversation, its worktree or
    what runs;
  - a wake, a message or a badge that doesn't name which pull request.
- **Stacks are split:** T3 Code, Orca and Agent Orchestrator have them;
  Amp and Claude Code don't; Paradev's users have asked since March.

## What Althar takes

In [a task holds as many changes as it needs](../decisions/proposed/a-task-is-a-conversation-plus-parts.md#a-task-holds-as-many-changes-as-it-needs),
one rule for each of the four places their bugs come from:

- **Everything hangs on the change, never on a folder.** A folder is where
  a change is checked out at the moment. Althar reads each folder's branch
  as a turn ends and follows it, as T3 Code has since 5 November, rather
  than forbid a switch, as Orca does.
- **A pull request is recorded as it's made, or found by a change's own
  branch and target:** Ship, `open_pull_request`, attaching, or a `gh pr
  create`'s address, as T3 Code reads it; and, for one opened another way,
  an open pull request from one of the task's own branches into the branch
  that change works toward. Never by a prefix, as Agent Orchestrator does,
  and never a guess where two could be the change's.
- **A merge ends only its own change,** and the task settles once all are
  done, as T3 Code and Agent Orchestrator settle.
- **Every turn, line and badge names the pull request it's about,** and
  several pull requests' news comes as one turn.

And from what they do well:

- a worktree for each change being worked on, which Claude Code's CLI
  alone gives one conversation;
- a helper handed a change works in that change's worktree, so nothing
  needs bringing back, which none of the products does by itself;
- stacks only where one change needs another's code, shipped and merged
  from the bottom up, as T3 Code's Merge stack and Orca's "Merge through
  #N" do, with a hold on a change below holding those above it;
- a card that names the pull request that needs the person, counts the rest
  apart from its state, and works that out each time rather than keeping a
  "current" one, as T3 Code and Orca do.
