# ADR-077: The coordinator merges and releases on the person's word, and does what can be undone itself

- **Status:** Accepted, to build for 0.7.0 ([Build](#build-for-070))
- **Date:** 2026-10-31
- **Amends:** [ADR-011](011-own-connectors-for-hosts-and-trackers.md),
  [ADR-024](024-signed-releases-and-updates.md),
  [ADR-048](048-where-the-runtime-runs-and-who-may-reach-it.md),
  [ADR-052](052-a-task-attaches-to-a-pull-request-it-didn-t-open.md),
  [ADR-058](058-the-coordinator-is-a-trusted-reader-in-copies-of-its-own.md)
- **Owner:** Repository maintainers
- **Context:** A separate Claude Code session, with `gh` signed in, gets the
  person's changes into main and releases them (DEV-180):
  - it puts pull requests into GitHub's merge queue, and looks after the
    ones the queue sends back (#395, #419, #442);
  - it keeps main and CI green: flaky tests and races (#418, #424, #428,
    #429, #433, #437, #449), and CI's set-up (#409, #442, #451);
  - it releases: the version and its notes (#370, #463), the `v*` tag that
    runs `release.yml`, publishing the draft, and the Homebrew tap that
    follows (#439);
  - it does upkeep: adapter bumps (#396, #417).

  Althar can't do this itself, for four reasons:
  1. **The coordinator can't act on the code host.** ADR-058 made it a
     reader, ADR-011 says merging is never an agent's, and ADR-048 keeps
     merging, pushing and posting a review as the person's press. Most of
     the gap is tools nobody wrote, not decisions: the connectors already
     merge, mark ready, close, run checks again and reply, and only the
     person's buttons and leads call them.
  2. **It acts only when the person writes,** and its news is plans, issue
     cards, issues started and quick tasks made into changes. Althar polls
     every pull request it follows every 30 seconds, but what it learns goes
     to the task's thread, and to the lead only for failing checks and
     reviews that aren't approvals.
  3. **Pull requests Althar didn't open aren't followed** unless a task is
     attached to one (ADR-052), so the side session's aren't.
  4. **Althar has no idea of a release.**

  On 30 October an exploration (the task
  `explore-the-coordinator-s-and-leads-arbitrary-wa`) read every limit on
  the coordinator and on leads. The person had allowed all 182 asks Althar
  ever put to them, each "once", and had never refused one. They had found
  Althar "a bit timid" (29 October), and asked of merging, the queue and
  releases: "Whats preventing us from doing this?" (30 October). Their
  calls, on 30 and 31 October, are what this records.
- **Decision:**
  - **The coordinator does it, not a standing task's lead**
    ([why](#the-coordinator-not-a-standing-task)). A fix stays a task with
    a lead, which the coordinator plans.
  - **What can be undone just happens. What can't happens when the person
    asked for it, and never on the coordinator's own initiative**
    ([the kinds](#what-happens-and-what-waits)). Merging and the merge queue
    are of the second kind: only when the person asks.
  - **The person's message is their word, for whatever the coordinator works
    out from it,** in the turn the message started, or for an errand kept
    from it ([The person's word](#the-persons-word)). This widens ADR-048,
    where their word was only a press.
  - **On the code host, typed tools for what's frequent, and one gated call
    to the host's API for the rest,** with a never list that holds whatever
    anyone says. The call can't change the repository's content, which stays
    a task's, nor stand in for a check or a review
    ([On the code host](#on-the-code-host)). This amends ADR-011 and
    ADR-058.
  - **On every code host Althar supports,** GitHub, GitLab, Bitbucket Cloud
    and Bitbucket Data Center, as ADR-078 asks. Where a host lacks
    something, Althar stands in with what the host has, and where neither
    can, the tool says so and links the host's own button
    ([On every code host](#on-every-code-host)).
  - **CI's news reaches the coordinator,** which is woken for what it can
    act on ([CI news](#ci-news-and-what-the-coordinator-does-with-it)).
  - **Every open pull request in the project's repositories is followed,**
    for news, whoever opened it
    ([Every open pull request](#every-open-pull-request)). This amends
    ADR-052.
  - **A release is an errand:** the version and notes as a task, then the
    tag, the run's approval, the draft, Publish on the person's word, and
    the Homebrew tap ([A release](#a-release)). This amends ADR-024.
  - **Every restriction on the coordinator is kept or lifted,** each for a
    reason
    ([the list](#every-restriction-on-the-coordinator-kept-or-lifted)).
  - **Edge cases are settled by rule,** and what nobody foresaw ends in a
    line in the chat, not in something done ([Edge cases](#edge-cases)).
  - **The build is fourteen tasks, for 0.7.0** ([Build](#build-for-070)),
    beside ADR-078's six.
- **Alternatives considered:**
  - **A standing release task's lead,** compared
    [below](#the-coordinator-not-a-standing-task).
  - **Althar's own green, reviewed pull requests into the queue unasked**
    (DEV-180's first rule): the person decided that merging is only ever on
    their word.
  - **A card with Apply after the person asked,** as ADR-048 stood: they
    would be asked twice for one thing.
  - **Their word only for what their message names** (a number, a link, a
    task, a version), with a card for a group: it stops what the
    coordinator reads from steering it to another target, but "merge the
    green ones" would still be a card. The person chose what the
    coordinator works out instead.
  - **Typed tools only, with no gated call:** every new action would wait
    for someone to write a tool. With the gated call, tomorrow's new thing
    works the first time the person asks, and gets a typed tool once it
    comes up often.
  - **GraphQL mutations through the gated call:** what one does can't be
    read off a method and a path.
  - **A never list written endpoint by endpoint:** the Contents API's file
    writes, each a commit to a branch, showed how easily one path is missed.
    Families of paths, and a test against the host's published description
    of its API, catch the next one.
  - **GitHub first, the other hosts later:** ADR-078 settles that a feature
    ships for every host that can have it.
- **Trade-off:**
  - **Steering.** In a turn the person started, what the coordinator reads
    there could take it to a target or an action they didn't mean, and
    they see it in the chat after, not before
    ([The person's word](#the-persons-word)).
  - **The keychain.** All of this holds against a mistake, and against text
    steering the coordinator through Althar's tools; not against a script
    set on going round Althar. On a Mac, a script inside Claude Code's
    sandbox can still read the person's GitHub sign-in, gh's or git's, from
    the keychain, and call the host with it (ADR-071). The person accepted
    that on 31 October, and waits for Claude Code's sandbox to deny the
    keychain's service. It is less exposure than today's side session,
    which has `gh` signed in.
  - **Wakes cost turns** on the person's plan; batching keeps them few.
  - **Stand-ins are Althar's, not the host's.** Where a host has no queue
    Althar can use, errands merge into each branch one at a time, each
    brought up to date and green first. A line of them waits for each one's
    CI in turn, slower than a queue that tests several together. A write by
    someone else just before a merge lands can still reach main untested,
    where the repository's rules don't refuse it. Bitbucket Cloud's merge
    takes no head, so the head is checked by a read just before it, a
    moment's gap.
  - **Following every pull request costs requests,** and what people
    outside write on them reaches the coordinator, as data.
  - **An errand kept for days** could merge what the person forgot they
    asked for. It says what it waits on when it is kept, and the task's
    card shows it until it is done.
- **Overlaps:**
  - **DEV-176 (a lead waits on something outside).** An errand is the
    coordinator's wait. Both watch for something outside, kept as a
    record, and start a turn when it happens, with no agent's place held
    meanwhile. The watch is built once, in tasks 2 and 3; DEV-176 adds a
    lead's `wait_for` and several pull requests to one task. The queue
    sending a pull request back wakes its lead in both (task 4).
  - **DEV-173 (Needs you only when it truly does).** A green pull request
    the person already said to merge isn't a decision, so it merges rather
    than waiting in Needs you. The coordinator's news makes no card of its
    own, except for a decision: trying and publishing a release's draft.
    Approving a merge stays a real decision, which the person can now say
    instead of press.
  - DEV-177 swaps a task's lead, DEV-94 reads any run's log, and DEV-170
    pushes to a contributor's fork. Each stays its own.
  - **Proving each code host and tracker on a real account** (the task
    `prove-each-code-host-and-tracker-on-a-real-accou`, from the person's
    same message) is where each host's part of tasks 5 to 8 and 14 is first
    tried for real, with each host's contract clauses.
- **Revisit when:** Claude Code's sandbox can deny the keychain's service;
  the coordinator acts on a target, or does something, the person didn't
  mean; following every pull request reaches a host's rate limit; the
  person wants something that can't be undone to go ahead unasked; a
  project is shared, and it matters whose word counts; a host opens an API
  for what Althar stands in for, such as entering Bitbucket Cloud's queue.

Paths below are in `packages/runtime/src`, or in `packages/` where they
start with another package's folder, as they stood at 3b4e42f1.

## The coordinator, not a standing task

| | The coordinator | A standing release task's lead |
| --- | --- | --- |
| Where its state lives | Althar's records: tasks, pull requests, and the errands below. Its session is disposable (ADR-004), and a fresh one is briefed from the records (ADR-031) | A task's thread and worktree, open for good: a task meant to finish that never does, in no lane of the board (ADR-065) |
| How the person follows it | In the chat they already talk to it in, a line for each thing it did | A second thread to watch, and a card always at work |
| What it costs to keep alive | A turn when the person writes, and one when news it can act on comes, batched | The same turns, plus a worktree, and a context that grows with every merge until it is handed over |
| What it sees | Every task and pull request, through its own tools | Whatever of the coordinator's reads it is given |
| How it fails | Talking and acting share one session: an errand's turn and the person's message wait behind each other | Two agents deciding about the same pull requests, and a second set of host powers to hold to the rules |

A fix stays a task with a lead: a flaky test, a race, CI's set-up. The
coordinator plans it, and a change is always a task (ADR-004). An adapter
bump comes from the nightly dependency check, an automation already, and its
pull request merges on the person's word like any other.

## What happens and what waits

| Kind | When the coordinator does it | What, here |
| --- | --- | --- |
| Can be undone in a step | Whenever its work calls for it | Run a failed check again; mark one of Althar's pull requests ready; bring a branch up to date with the default branch, by a merge; close or reopen one of Althar's own, where the host can reopen it; reply on Althar's or the repository's own people's; take a pull request out of the queue before it merges |
| **Asked-for:** can't be undone, and the person asked for it | In the turn their message started, or for an errand kept from it, with no card ([The person's word](#the-persons-word)) | Merge; enter the merge queue or turn on auto-merge; push a tag; approve a run's `release` environment; publish a release; delete a branch; discard a task; reply on, or close, an outside author's pull request; close one on Bitbucket Cloud, where declining is final |
| Can't be undone, and the person didn't ask | Never. It says so in a line in its chat, or, where there is a decision to make, on DEV-173's card | The same, prompted by what it read or by news |
| Never | Only the person, in Althar's Settings or on the host (ADR-048) | Althar's rules, allow everything, accounts and connections; the host's settings, in the [never list](#on-the-code-host) |

- **What an action does in that repository decides its kind,** not its
  name. Here a `v*` tag builds a draft and waits for the `release`
  environment's reviewer (`.github/workflows/release.yml`), so the tag
  could be taken back and only Publish can't. Althar still treats every
  tag as asked-for: the person says "tag 0.7.0" anyway, and where a tag
  publishes (a package to npm) it has to be.
- **Merging and the merge queue happen only when the person asks,** never
  on the coordinator's own initiative, green and reviewed or not.

## The person's word

ADR-048 took the person's word only from a press in the window. A message
they write to the coordinator is now their word too, for whatever the
coordinator works out from it, groups included: "merge the green ones"
merges every green one it finds, and "release 0.7.0" is a
[release](#a-release).

- **In the turn the message started.** Each turn records whether something
  the person wrote is among its inputs (`byPerson`, `Sessions.ts:1480`), so
  far read only by the stall watch (`stallWatch.ts:255`). No tool can see it
  yet: a tool's `ToolAccess` (`ToolServer.ts:22-30`) carries the role,
  project, thread, session and task. An asked-for tool runs only in such a
  turn. A turn that news, a lead or Althar alone started can't run one,
  whatever the text in it says, so the words of an issue or a pull request
  can't set off a merge by themselves.
- **Or for an errand kept from it.** What the person asks for later ("merge
  #461 once it's green", or a release's steps) is kept as an errand: their
  words, the message they're in, what the coordinator worked out from them
  (each target, and for a merge the head it read), and what each step
  waits on. A turn that an errand's news started may take that errand's
  next step, and nothing else that can't be undone. An errand ends when it
  is done, when the person calls it off, or when someone other than the
  task's lead or Althar pushes to its pull request, which it says. Errands
  are Althar's records, not the session's, so a fresh session's brief lists
  the open ones (ADR-031).
- **Only the person's own messages.** A message counts where it was written
  in the window, or on a device paired as ADR-048 says. Nothing sent over
  the local socket counts, nor a lead's word to the coordinator: a socket
  client can't answer for the person (ADR-048), so it can't speak for them
  either. Messages don't record who sent them yet: today `byPerson` is any
  message the thread shows.
- **It says what it did, as it does it.** Each asked-for action leaves a line
  in the coordinator's chat: what, which, at which head, and the person's
  words it acted on, which the call names and Althar finds in their message
  ("Merged #461 at 9b50d2c: 'merge the green ones'"). An errand says what it
  waits on when it is kept, and its task's card says it too. Each rests on a
  mutation receipt, as the person's own merge does.
- **At the head it read.** The person's Merge refuses a head that moved since
  they saw it (`Changes.ts:2227`), and GitHub is sent that head too
  (`connectors/src/github.ts:772`, `expectedHeadOid` on the queue). The
  coordinator's merge names the head it read when it worked the merge out,
  and where the branch has moved since it reads again rather than merging
  what nobody saw. An errand's merge takes the head that went green, where
  every push since was the task's lead's or Althar's.
- **The risk the person accepted.** In a turn they started, text the
  coordinator reads there (a pull request's description, a comment, an
  issue) could steer it to another target or another action than the one
  they meant, and with no card it goes ahead. The line in the chat is where
  they would see it. Two things narrow it: a turn the person didn't start
  does nothing that can't be undone, and the never list holds whatever
  anyone wrote. The person chose this on 31 October over a card for a group,
  and over a card for every ask.
- **Still the window's press,** as ADR-048 has it: answering a permission
  request or a question, and widening what agents may do.

## On the code host

Typed tools for what comes up often, each marked with its kind, and one
gated call for the rest. Each works on any of the project's pull requests,
whoever opened it.

- **Can be undone:**
  - `rerun_check`: a failed job once more, on a pull request or on the
    default branch, as each host can ([below](#on-every-code-host));
  - `read_default_branch_checks`;
  - `mark_ready`, on Althar's own;
  - `update_branch`, which merges the default branch in and never rebases:
    GitHub's update-branch, and elsewhere Althar's own merge, pushed
    plainly;
  - `close_pull_request` and `reopen_pull_request`, on Althar's own. On
    Bitbucket Cloud a declined pull request can't be reopened, so there
    closing is asked-for;
  - `reply_on_pull_request`, on Althar's and the repository's own people's.
    On an outside author's pull request, a reply or a close sends them a
    notification that can't be taken back, so there it is asked-for.
- **Asked-for:**
  - `merge_pull_request`: merge it, or put it in the host's queue or merge
    train where its branch has one Althar can reach, with a method the
    repository allows, at a head. Where it can't, an errand stands in, one
    merge at a time into each branch, with auto-merge as its merge where the
    host has it ([below](#on-every-code-host)). `leave_queue` takes it out
    until it merges, and can be undone;
  - `push_tag`, on a commit of the default branch, made by Althar, never
    moved or deleted. A lead's `push_tag` still asks the person each time
    (`rules.ts:1939-1941`);
  - `approve_release_run`: a run waiting for approval, where the person's
    account may give it: GitHub's environment, here `release`, or GitLab's
    deployment approval or manual job;
  - `publish_release`, as each host publishes one ([A release](#a-release));
  - `delete_branch`.
- **One gated call, `code_host_api`, for everything else** (the person's
  call, 31 October): a REST request to the host's API with Althar's sign-in,
  which never leaves Althar.
  - Reads (`GET`) go, in any turn, on the project's repositories and others
    of their owners (such as the Homebrew tap). What comes back is data, cut
    to size, a page at a time.
  - Writes (`POST`, `PUT`, `PATCH`, `DELETE`) are asked-for.
  - What a typed tool does (merging, bringing a branch up to date, tags,
    releases, approving a run, deleting a branch) is refused with the tool's
    name, so the head check and the line in the chat always happen.
  - **A change to the repository's content is refused, whichever path it
    takes,** and the refusal says to plan a task: a change is always a task,
    with a lead and a review (ADR-004). On GitHub that is the Contents API's
    file writes (`PUT` and `DELETE` on `contents/{path}`, each of which
    commits to a branch), the Git database's writes (`git/blobs`,
    `git/trees`, `git/commits`, `git/tags`, `git/refs`), merging one branch
    into another (`merges`), syncing a fork (`merge-upstream`), and making a
    repository from a template (`generate`).
  - **What stands in for a gate is refused too:** a commit status
    (`statuses/{sha}`) or a check run made, either of which can satisfy a
    required check on a branch; and submitting or dismissing a review
    (`pulls/{n}/reviews`), since an Approve can satisfy branch protection,
    and posting a review stays the person's
    ([below](#every-restriction-on-the-coordinator-kept-or-lifted)).
  - **Starting a workflow** (`dispatches`, and a workflow's own
    `dispatches`) is asked-for, and only at the default branch, whose
    workflow files were reviewed. Here that covers `post-merge` again, or
    `release.yml`'s run by hand from main, which still stops for the
    `release` environment's approval.
  - The never list is refused whatever the person said, by method and path,
    written for each host. On GitHub it is:
    - the repository's own settings: renaming it, its default branch, its
      visibility, transferring or deleting it;
    - branch protection and rulesets;
    - collaborators, teams and invitations;
    - webhooks, deploy keys, installed apps, and self-hosted runners;
    - secrets and variables: Actions', Dependabot's, Codespaces' and
      environments';
    - the settings of environments, of Actions (a workflow turned off
      included) and of Pages;
    - codespaces, each of which can push as the person;
    - anything under `orgs`, `user`, `users`, `admin`, `enterprises`,
      `applications` and `authorizations`.
  - **On GitLab and both Bitbuckets,** the same families, in their own
    paths ([below](#the-gated-calls-lists-on-the-other-hosts)).
  - **Each list is written by family of paths, not endpoint by endpoint,** so
    a new endpoint under `contents` or `git` is refused with the rest. A test
    reads GitHub's published description of its API
    (`github/rest-api-description`) and fails on any write it can't place:
    let through, a typed tool's, content, a gate, or never. Each other
    host's test reads its own. At run time a write Althar hasn't placed,
    such as one a host added since, is refused as never until it is. A host
    Althar adds later gets reads only until its lists are written.
  - GraphQL, on GitHub and GitLab, is for queries only: what a mutation
    does is in its name and arguments, which Althar would have to read one
    at a time.
  - It shares the connection's rate limit, and stops before what the
    [sweep](#every-open-pull-request) needs.
- **The gate is Althar's, not the token's.** The GitHub connection here is a
  token, connected on 11 October, before Althar noted whether it was gh's or
  pasted (migration 0022). Through Althar it has merged 109 pull requests,
  opened 185 and marked 33 ready. Its scopes couldn't be read for this ADR:
  the token is sealed in the keychain, and Althar keeps no record of them.
  Althar's connect flow asks for a classic token's `repo` and `workflow`
  (`connectors/src/github.ts:1015`), and gh's own sign-in carries `repo`,
  `workflow`, `read:org` and `gist`. With `repo`, the token can change branch
  protection, collaborators, webhooks and secrets wherever the account is an
  admin. So the never list is what stops that, not the scopes. A
  fine-grained token given only Contents, Pull requests, Issues and Actions
  would narrow it further.

## On every code host

What this ADR builds, it builds for GitHub, GitLab, Bitbucket Cloud and
Bitbucket Data Center (ADR-078). Where a host lacks something, Althar stands
in with what the host has. Where neither can, the tool says so in the host's
words and links the host's own button, which is the person's press.

| | GitHub | GitLab | Bitbucket Cloud | Bitbucket Data Center |
| --- | --- | --- | --- | --- |
| Merging at the head read | The head goes with it (`connectors/src/github.ts:772`; `expectedHeadOid` on the queue, `:409`) | The head goes with it (`gitlab.ts:630`) | It takes no head: a read just before it (`bitbucketCloud.ts:530-537`) | The pull request's version (`bitbucketDataCenter.ts:569`) |
| The queue, or merging once green | The merge queue | A merge train where the project has them; else the errand stands in, with auto-merge (`auto_merge`; "merge when pipeline succeeds" on older servers) as its merge | Its merge queue can be read and left through the API, not entered: the errand stands in | The errand stands in, with auto-merge as its merge where the server has it |
| Why the queue sent one back | The pull request's timeline (#458) | The train's own read, and the merge request's notes | The queue's own read | The pull request's activities |
| A failed check again | An Actions job | A job, or a pipeline's failed jobs | The pipeline again, whole, on the same commit | Its builds are another service's (Jenkins, Bamboo): said, with the build's link |
| A failed check's log | Actions' | A job's trace | A step's log | Another service's: the build's link |
| Up to date with the default branch | Its update-branch, a merge | Althar's merge, pushed: GitLab's own is a rebase | Althar's merge, pushed | Althar's merge, pushed |
| An outside author's branch | Where they let maintainers edit it | Where they allow commits from members | Where the account may push to the fork | As on Cloud |
| Closing, and reopening | Both can be undone | Both can be undone | Declining is final, so closing is asked-for | Both can be undone |
| A release | A draft, then Publish | No drafts: making the release is Publish | No releases: the tag, then its files in Downloads, which is Publish | No releases: the tag, and what the repository's CI does with it |
| Approving a run | An environment's required reviewers | A deployment approval where the project has them, or a manual job, played | A manual step has no API: the person's press, linked | Another service's |
| The rate limit | 5,000 an hour; a "not modified" reply is free | The server's own, from its `RateLimit-` headers | 1,000 an hour at least, more with seats, from its `X-RateLimit-` headers | The server's own; without headers, Althar's own count |

- **Where the errand stands in for a queue, it does what a queue does:
  one merge at a time into each branch.** Two pull requests green against
  the same main can each merge without ever being tested together, and
  that can turn main red. Auto-merge isn't a queue either: it merges each
  one as soon as it's green. So wherever there is no merge queue or merge
  train, every merge Althar makes into a repository's branch takes that
  branch's one slot:
  - Errands wait for the slot in the order the person asked. The one that
    holds it reads the target's head. Where its pull request doesn't have
    that head, it brings the branch up to date and waits for green at the
    new head. Then it reads the target again, and merges at the head that
    went green, or turns on auto-merge for it.
  - It holds the slot until a read shows the pull request merged and the
    target's new head, including a merge that lands later. The next errand
    then starts again from that head. An errand gives the slot up when its
    pull request goes red, is refused, or is closed or taken out, and says
    so.
  - The person's "merge it now", and their press in the app, wait for a
    merge in flight but not for the line. The errands behind them start
    again from the new head.
  - Where the target moves while an errand holds the slot, someone else
    wrote to it. The errand brings its branch up to date again, three
    times at most, then says so and waits for the person.
  - The slot and the line are kept with the errands, so a restart keeps
    them.
  - **What it can't promise:** a write by someone else, another computer's
    Althar included, between the last read and the merge landing. No host's
    plain merge takes the target's head, so no host checks it as it merges.
    Where the repository's rules make the host refuse a branch without the
    target's head (GitHub's "up to date before merging", GitLab's
    fast-forward and semi-linear methods, Bitbucket's fast-forward
    strategies), the host closes the gap itself. Otherwise what slips
    through shows as main red
    ([below](#ci-news-and-what-the-coordinator-does-with-it)), which the
    coordinator hears.
  - Where the host refuses a plain merge because the branch merges only
    through its queue, the line links the host's Add to queue.
- **What a server has is read, not assumed.** GitLab's tier, and Bitbucket
  Data Center's version, decide merge trains, auto-merge, deployment
  approvals and drafts. Each is read when a repository is first used, and
  again when a call is refused for it. A missing one falls back to the
  stand-in, and the line says which was used.
- **Fast-forward and semi-linear repositories** (GitLab's merge methods,
  Bitbucket's fast-forward strategies) ask only that the default branch's
  head be in the branch, and a merge from it puts it there, so nothing is
  rebased. Where a repository's rule still refuses a branch with a merge in
  it, the coordinator takes a method that accepts it, such as a squash,
  where the repository allows one, and otherwise says so.
- **A merge that lands later** (Bitbucket's 202, GitLab's while it works
  out whether it can) is done only once a read shows it merged, and the
  line says "merging" until then.
- **Main is red** on any host when a check on the default branch's head
  fails. Here that is `post-merge` (ADR-074).
- **On any agent.** The tools are Althar's and the person's word is
  Althar's record, so all of this works whichever of the ten agents runs
  the coordinator (doc 03). Only Claude Code's sandbox holds its commands
  (ADR-071); on another agent every command meets Althar's rules, as now,
  until ADR-078's task 4.

### The gated call's lists on the other hosts

The same families as GitHub's, in each host's paths. Each is tested against
the host's published description of its API. GitLab's OpenAPI covers only
part of its API, so what it leaves out is placed by hand, and Data Center's
is read for each version Althar supports. A write placed nowhere is refused.

| Family | GitLab | Bitbucket Cloud | Bitbucket Data Center |
| --- | --- | --- | --- |
| A typed tool's | Merging, merge trains and auto-merge, releases, deployment approvals, a job played or retried | Merging, declining, Downloads, a pipeline run again | Merging, declining and reopening, auto-merge |
| Content, pointing to a task | `repository/files`; `repository/commits`, a commit made of file actions; cherry-picks and reverts; branches and tags made or deleted | `src`, a commit made of files; `refs/branches`; `refs/tags` | A file edited through `browse`; `branch-utils`; tags made or deleted |
| A gate | Commit statuses; approving, unapproving and resetting approvals; approval rules | Build statuses; approving and requesting changes | Build statuses and builds; a reviewer's status |
| Started only at the default branch | A pipeline made, or triggered | A pipeline made | – |
| Never | `rebase`, since nothing is rebased; the project's settings, transfer, archive and deletion; protected branches, tags and environments; push rules; members, invitations and shares; hooks; deploy keys and tokens; access tokens; CI/CD variables; runners; mirrors; integrations; Pages; anything under `groups`, `users`, `user`, `admin`, `application` and `namespaces` | The repository's settings and deletion; branch restrictions and the branching model; permissions; webhooks; deploy keys; default reviewers; Pipelines' settings, variables and deployment environments; forks made; anything under `workspaces`, `user` and `users` | The repository's settings, moves and deletion; branch permissions; permissions; hooks and webhooks; access keys and tokens; default reviewers; auto-merge's settings; anything under `admin`, `users` and a project's own settings |

## CI news, and what the coordinator does with it

Althar learns most of this already, for the pull requests it follows. Each
poll, every 30 seconds and ten times slower after ten minutes with no news
(`Changes.ts:345-377`), reads a pull request's state, checks, reviews and
place in the queue; since #458 it notices one put in the queue on GitHub,
and why one left it (merged, checks, conflict, removed, `github.ts:412-429`).
What it learns goes to the task's thread (`Changes.ts:3296-3517`). The
coordinator now hears it too, beside plans and issue cards:

| News | Who else hears it | What the coordinator does |
| --- | --- | --- |
| A pull request's checks pass | The task's card (ADR-040) | An errand's next step: it merges or queues it. Without an errand, nothing: the card says so already |
| Checks fail on a task's pull request | Its lead, which fixes them (ADR-070) | Nothing, until the lead hands them to the person (`hand_checks_to_person`). Then it reads the log: a flake it runs again once, and a break on main gets one fix task, as below |
| Checks fail on a pull request no task follows | – | Kept for the person's next message, unless an errand names it |
| The queue sends a pull request back, and why | Its lead, woken (task 4) | A flake, or an entry ahead of it failing: back into the queue under its errand, which stays open until it merges. Its own checks: the lead fixes them, and the errand queues it again once it is green. A conflict: the lead resolves it (ADR-030). Taken out by someone: the errand ends, and says so |
| Main's `post-merge` run fails, "Main is red" (ADR-074) | – | Reads the run. A job that passes when run again is run once more. Otherwise it names the merges since the last green run, plans one fix task for main, with its plan card's countdown, and says so in a line. A release waiting on main waits on |
| Main is green again | – | A release's next step: its tag |
| A pull request merges or closes | The task's card | Ends an errand that names it, or takes a release's next step |
| A review approves, or asks for changes | The lead, as now | An errand that waits on an approval goes on |
| Someone opens a pull request | – | A line among its news, kept for the person's next message. Reviewing it is `review_pull_request`, when asked |

- **It is woken only for what it can act on, in a batch:** an errand's step,
  checks handed to the person, main going red. What's new comes as one
  message in the quiet wake the coordinator already has
  (`Coordinator.ts:307-324`, which today only an answered question uses),
  at most once every few minutes. What it can't act on waits, as news, for
  the person's next message (`coordinatorNews.ts`).
- **Woken by news, it does only what can be undone, and an errand's steps.**
  Anything else it tells the person in a line in its chat. It makes no Needs
  you card of its own (DEV-173), except where a decision is waiting: a
  release's draft.
- **One fix task for main at a time.** A second break while one is at work
  goes to that task's lead.
- **Main's checks** are read in the sweep, which today looks only for
  conflicts (`Changes.ts:5443-5472`): main's head each time, and its checks
  when the head moves, while a run is still going, and, at an unchanged
  head, while main is red or a release waits on it.
- **A finished result at an unchanged head isn't final.** A failed run can
  be run again, by its author, the person or Althar, and a new check can
  start, all without a push. So whatever an errand waits on is read as a
  task's own pull request is (every 30 seconds, ten times slower after ten
  minutes with no news) until the errand is done, finished or not: a pull
  request's checks, main's `post-merge` run, a release's run. Each read is
  conditional where the host allows it: on GitHub, with the last read's
  ETag, which isn't counted against the limit when nothing changed. A run
  Althar starts again is read again at once.
- **What it acts on, it reads first.** A merge, a queue or a tag works from
  a read made then, not from the last poll, which is only news.

## Every open pull request

- Every open pull request in the project's repositories is followed,
  whoever opened it, not only those a task opened or was attached to
  (ADR-052; `Changes.ts:5304-5310`). One followed this way has no lead and
  no card: it is news for the coordinator, and a task is attached to it
  only when the person asks.
- Slowly: the open list every five minutes, with conditional requests,
  which GitHub doesn't count against the limit when nothing changed. A pull
  request's checks are read when its head moves or a check is still
  running, and, at an unchanged head, at each sweep for a day after they
  failed, conditionally too, so a rerun without a push still comes as
  news. After that day, such a rerun is read when the person next asks.
  One an errand waits on is polled as a task's own is, as
  [above](#ci-news-and-what-the-coordinator-does-with-it), and a task's own
  pull request is still polled as now.
- About 30 open pull requests is well inside GitHub's 5,000 requests an
  hour. On every host, following takes at most a fifth of what the host
  allows in an hour, by its own headers or Althar's count where it sends
  none, and the five minutes grow to fit. Bitbucket Cloud allows 1,000 at
  least, and its lists say nothing of checks, so a repository with many
  open pull requests there is read more slowly. The sweep backs off as the
  remaining budget falls, as a failing service is waited out (ADR-060).

## A release

"Release 0.7.0" is a release errand. Each step goes once the news before it
comes:

| Step | Who | Kind |
| --- | --- | --- |
| 1. Raise `version` in `apps/desktop/package.json`, and write `apps/desktop/release-notes/0.7.0.md`: a few plain lines for testers, under New, Improved and Fixed, from what merged since v0.6.1 | A lead, in a task the coordinator plans, reviewed like any change | A change |
| 2. Merge its pull request, once it is green and reviewed | The coordinator | Asked-for: the release errand |
| 3. `post-merge` passes on that commit, which `release.yml` requires | CI | – |
| 4. Tag that commit `v0.7.0` | The coordinator, `push_tag` | Asked-for |
| 5. Approve the run's `release` environment, which lets it use the signing secrets, for a draft | The coordinator, `approve_release_run` | Asked-for |
| 6. The draft, with every platform's files; the run has opened both Mac builds | CI | – |
| 7. Try the draft: each dmg on its Mac, the installer on Windows (`apps/desktop/README.md`, "Cutting a release") | The person, unless they say to skip it | A decision: one line in the chat, and one card as DEV-173 settles it |
| 8. Publish | The coordinator, `publish_release`, on the person's word "publish", given then or in their first message | Asked-for |
| 9. The Homebrew tap: approve `homebrew-tap.yml`'s `release` environment, then read the tap's `Casks/althar.rb` back at the version | The coordinator | Asked-for, by the word to publish |

- **A run that fails** is read as a check is (a run on a tag; DEV-94 reads
  any run). A job that failed once is run again once, which can be undone.
  Anything else is a fix task, and the release waits.
- **Where "Prevent self-review" is on** for the `release` environment, the
  person's account can't approve a run their own tag started, and Althar
  pushes tags as them. The coordinator says so in a line, and the other
  reviewer approves.
- **`release.yml` doesn't change.** It still checks the tag against the
  version, the notes, main and `post-merge`, and still makes only a draft.
- **This table is Althar's own release.** Another repository's steps are
  its own: its release workflow and its docs, read when the person first
  asks, shown as a line a step with each step's kind, and kept as a project
  note for the next time. What can't be undone among them is asked-for,
  whatever it is.
- **On the other hosts** ([above](#on-every-code-host)), GitLab has no
  drafts, so making the release is Publish, and the person tries the tag
  pipeline's files before it. Bitbucket has no releases: on Cloud, Publish
  puts the files in Downloads; on Data Center the tag is the release, and
  the repository's CI does the rest.

## Edge cases

- **A new objection pauses an errand.** Changes requested, a reviewer's new
  unresolved thread, or the pull request turned back to draft after the
  person asked: the errand waits and says why, and their word again goes on.
- **An errand that hears nothing says so.** After a day with no news, or a
  required check that hasn't reported an hour after the rest finished, it
  says what it waits on, once a day, until it is done or called off.
- **Each step reads before it acts, and skips what's done:** a tag already
  at the commit, a release out, a pull request merged. A call whose answer
  was lost, such as one that timed out, is read back before it is tried
  again, and its receipt stays pending until then, so a restart or a lost
  answer doesn't do anything twice.
- **The target branch changes while an errand waits:** it ends and says so,
  since the ask was for that branch.
- **Someone acts on the host meanwhile,** the person included (merges it,
  closes it, takes it out of the queue): the errand hears it as news and
  ends.
- **Several repositories in a project:** "merge the green ones" covers all
  of them. A release is of one, which the person names or a project note
  says, and the coordinator asks where neither does.
- **A refusal Althar doesn't know** is said in the host's words and isn't
  tried another way: not through the gated call, nor with another method.
- **Anything nobody foresaw** meets the defaults: what can't be undone waits
  for the person, a write the gate can't place is refused, and a head that
  moved is read again. So it ends in a line in the chat, not in something
  done.

## Every restriction on the coordinator, kept or lifted

| Restriction today | Where | Now | Why |
| --- | --- | --- | --- |
| **The code host** | | | |
| It only reads the host: `read_pull_request`, `read_check_log`, `find_pull_requests` | ADR-058; `Reviews.ts:1321-1348`, `Coordinator.ts:1553` | Lifted | The rows below replace it |
| No `rerun_check`, `read_default_branch_checks` or `reply_on_pull_request`: leads' alone | `Changes.ts:5861-6075` | Lifted | A rerun changes nothing that lasts, a read only reads, and a reply on Althar's or its own people's can be deleted |
| No mark ready or close: the person's buttons alone | `Changes.ts:626-640`; `Api.ts:1250`, `:1382` | Lifted for Althar's own | Both can be undone: back to draft, reopened. On Bitbucket Cloud, where declining is final, closing is asked-for |
| A reply on, or close of, an outside author's pull request | – | Asked-for | Their notification can't be taken back |
| No branch update: no connector has one | `connectors/src/model.ts:292` | Lifted | A merge of the default branch into it can be undone; never a rebase |
| "Agents never merge": the person's Merge alone | ADR-011; `Changes.ts:644`, `:2216`; `contracts/src/Api.ts:3511-3516` | Lifted, when the person asks | It can't be undone, so only on their word, never on its own |
| The merge queue is entered only inside the person's press | `connectors/src/github.ts:775-786` | Lifted, when the person asks | As merging: on every host, through its queue or merge train, or the errand standing in, one merge at a time into each branch |
| A merge goes at the head the person saw | `Changes.ts:2227` | Kept | It merges at the head it read, or reads again |
| The merge method is the first the repository allows | `connectors/src/github.ts:770` | Lifted | It takes any method the repository allows |
| No tag: `push_tag` is a running lead's, and asks the person each time | `Changes.ts:2708-2825`; `rules.ts:1939-1941` | Lifted, when the person asks | A tag may publish elsewhere; their message is the word, so no second card |
| A tag is never moved or deleted | `Changes.ts:2781-2782` | Kept | People and CI have read it |
| No release: no connector call, and `gh release create` held as a deploy | `connectors/src/model.ts:292`; `rules.ts:2019` | Lifted, when the person asks | Publishing reaches every updater at once |
| Approving a run's `release` environment, and publishing, are the person's on GitHub | ADR-024 | Lifted, when the person asks | The approval lets only a draft be built; the person's word for the release covers both |
| Deleting a branch is the person's | `Changes.ts:2323-2363` | Asked-for | A deleted branch can't always be brought back |
| Only pull requests a task opened or attached are followed | ADR-052; `Changes.ts:5304-5310` | Lifted | Every open one, slowly, for news |
| A contributor's fork can't be attached or pushed to; the task's own fork can | `Changes.ts:1585-1596` | Kept here | DEV-170 decides it |
| It posts no review; an outside pull request's waits for the person | `Reviews.ts:59`, `:223-227`, `:957-961` | Kept | An Approve can satisfy branch protection; a review task's lead drafts one |
| Agents carry no host sign-in; `gh` and `glab` only read | ADR-011; `Config.ts:336-346`; `rules.ts:402-449` | Kept | Althar's tools are the one way to the host, which is what lets the gate hold |
| A rerun reaches the host's own CI only: Actions' jobs, GitLab's jobs, and now Bitbucket Pipelines', whole | `connectors/src/github.ts:867-872`, `gitlab.ts:719-724`, `bitbucketCloud.ts:598` | Kept | No host can run another service's; Bitbucket Data Center's builds are all another's |
| *New:* the gated call can't change the repository's content, make a status or a check run, submit or dismiss a review, or start a workflow off the default branch | [On the code host](#on-the-code-host) | Added | A change is always a task, and CI's and a review's gates stay as they are |
| *New:* what a host lacks is stood in for, or said with a link to the host's own button; never a no-op that looks done | [On every code host](#on-every-code-host) | Added | ADR-078 |
| **Git and its copies** | | | |
| It reads in copies of its own, from a mirror, with no network | ADR-058; `provider-adapters/src/registry.ts:760` | Kept | News brings what it would have fetched for |
| Its edit tools are denied: a change is always a task | `provider-adapters/src/registry.ts:754`; `Sessions.ts:2915` | Kept | The record and the review |
| Where no sandbox holds it, only commands that look | ADR-058; `provider-adapters/src/registry.ts:743-744` | Kept | ADR-071 runs Claude Code's inside its sandbox unread already; DEV-179 is the rest |
| **Tasks** | | | |
| It can't stop, hold, restart or settle a task; `settle_task` is a lead's | `Coordinator.ts:1480-1776`, `:1808` | Lifted | Each can be undone: a stopped task starts again, a settled one goes back to work (ADR-034). Discarding one is asked-for |
| It can't swap a task's lead | No such tool | Lifted in DEV-177 | DEV-177 decides how |
| `message_lead` to a stopped lead: "nobody reads this yet … Tell the person" | `Coordinator.ts:1106-1108` | Lifted | It starts the lead, as the person's message does |
| Resuming an automation, or running it now, is a card | `Coordinator.ts:1728-1739` | Lifted, when the person asks | Their message is the word for spending their plan |
| Turning an automation on is the person's | `propose_automation` | Kept | It spends the plan on a schedule from then on |
| `attach_pull_request` starts from the pull request's head "only once the person agreed" (its brief) | `Coordinator.ts:657`, `:1538` | Lifted | The task's old head is kept, so nothing is lost |
| `list_tasks` shows the newest 50, `find_pull_requests` 30 a repository | `Coordinator.ts:376`; `pullRequestList.ts:22` | Kept | `find_tasks` reaches the rest |
| Its brief says a task's lead can't fetch | `Sessions.ts:2933` | Lifted | Untrue since ADR-066 |
| **Issues** | | | |
| Every issue it drafts waits on the person's card | `IssueDrafts.ts:100` | Lifted | It files at once or drafts, as it judges from the person's notes; a card's "always" or "never" becomes a note |
| `draft_issue` takes no project, milestone, assignee or parent | `Coordinator.ts:1426-1455` | Lifted | It was the minimum, not a decision |
| Issue changes wait on a card unless "Change issues without asking" is on, which it is not by default | `Policies.ts:84-90`, `:184`; `IssueChanges.ts:851` | Lifted | The same judgment; the switch becomes a note |
| It comments on an issue only when the person asks (its brief) | `IssueChanges.ts:1140`; `Sessions.ts:2941` | Kept, and held in code as asked-for | Others read it under the person's name |
| `gh` and `glab` issue writes are refused | `rules.ts:423-449` | Kept | One way to the tracker, with receipts |
| **Hearing** | | | |
| It speaks only when spoken to | `Sessions.ts:1320-1322` | Lifted | It is woken for what it can act on, in a batch |
| Its news is plans, issue cards, issues started and quick tasks made changes | `coordinatorNews.ts:32`, `:102-104` | Lifted | Pull requests' and main's news join them |
| Main's checks are never polled | `Changes.ts:5443-5472` | Lifted | The sweep reads main's head, and its checks when it moves, while a run goes, and while main is red or a release waits on it |
| **The person's word** | | | |
| Merging, pushing and posting a review are the person's press | ADR-048 | Lifted for merging and releasing | Their message is their word; posting a review stays theirs, above |
| Answering a permission request or a question is the person's press | ADR-019, ADR-048 | Kept | What can't be undone asks only the person |
| Widening what agents may do is the person's, in Settings | ADR-048 | Kept | The never list |
| A client on the local socket can't answer for the person | ADR-048 | Kept, and widened | Its messages aren't the person's word either |
| *New:* a turn the person didn't start does nothing that can't be undone, except an errand's next step | [The person's word](#the-persons-word) | Added | So news, and what it reads, can't set off a merge by themselves |
| A step's turns, fix rounds, review rounds and stuck checks are capped | `Stalls.ts`; `Changes.ts`; `Runs.ts` | Kept | Each hands the work to the person rather than refusing it |

## Build, for 0.7.0

The coordinator plans these from this list, at most four at a time. Each
title is a task's, in at most 60 characters.

| # | Task | Scope | Size | After |
| ---: | --- | --- | :---: | --- |
| 1 | Coordinator: rerun, mark ready, close and reply on PRs | The coordinator gets `rerun_check`, `read_default_branch_checks`, `mark_ready`, `close_pull_request`, `reopen_pull_request` (a new connector call) and `reply_on_pull_request`, on any of the project's pull requests, within the kinds above. Its brief says what it does unasked, and no longer that a lead can't fetch. Reruns on every host: GitLab's jobs, Bitbucket Cloud's pipeline again, whole, on the same commit, and on Data Center a line saying whose build it is. Reopening on GitHub, GitLab and Data Center; closing on Bitbucket Cloud asked-for. Doc 04's tools | M | – |
| 2 | PR and CI news reach the coordinator | News for each followed pull request: checks done, merged, closed, sent back by the queue and why as each host says it, reviews, checks handed to the person; what a poll records grows to carry the head and the queue. Main's head and checks in the sweep, on every host: red, and green again, read again at an unchanged head while main is red. The watch, for task 3's errands and DEV-176: what it watches is read as a task's pull request is until it ends, finished results included, with conditional reads. The quiet wake, batched, only for what it can act on; woken by news, only what can be undone. Tests: a failed run that passes when run again at the same head is heard, on main and on a watched pull request | M | – |
| 3 | The person's word: errands, receipts, who sent it | A message records who sent it: the window, a paired device, the socket. Tool calls see `byPerson`. An asked-for kind on tools, run only in a turn the person's message started or for an open errand. Errands as records (words, message, targets, heads, what each step waits on), a line when kept and when done, the task's card, the handover brief. ADR-048's marks on the contract. The [edge cases](#edge-cases): an objection pauses an errand, one that hears nothing says so, each step reads before it acts, and a lost answer is read back. Tests: a turn news started is refused, a socket's message is refused, an errand's step goes, an objection pauses it, a lost answer isn't acted on twice | L | – |
| 4 | A stopped lead hears what's meant for it | `message_lead` starts a stopped lead. Reviews, comments and the queue sending its pull request back are queued for it, and wake it (today `Changes.ts:3261` drops them). Shared with DEV-176 | S | – |
| 5 | Coordinator merges and queues when you ask | `merge_pull_request` at a head, with a method the repository allows: GitHub's queue (at `expectedHeadOid`), GitLab's merge train, and elsewhere the errand standing in for a queue: one slot per repository and branch, taken in the order asked and held until a read shows the merge landed, each branch brought up to date and green against the target's new head (three tries for someone else's writes), auto-merge as its merge where the host has it (GitLab's, Data Center's), the person's "merge it now" waiting only for a merge in flight, and a link to the host's Add to queue where a plain merge is refused; `leave_queue` on each. What each server has, read and kept. A merge that lands later is done once read. Any of the project's pull requests, in any of its repositories. "Once it's green" as an errand. The line in the chat. Contract clauses on every host's fake. Tests: two errands with the first merge held pending, where the second waits, then starts again from the new head; the person's "merge it now" ahead of the line; a write by someone else in the gap, heard as main red; a restart keeps the line | L | 2, 3 |
| 6 | Bring a PR's branch up to date with main | `update_branch` in the connectors, for the coordinator and leads: GitHub's update-branch, a merge; GitLab and Bitbucket by Althar's merge in a copy of its own, pushed plainly. An outside author's branch where the host lets the account push to it, else a reply asks them, asked-for. Never a rebase, never forced | M | 1 |
| 7 | Follow every open PR in the project, for news | The open list every five minutes, with conditional requests; checks when a head moves or a check runs, and at an unchanged head for a day after they fail, conditionally; one an errand waits on is polled as a task's. At most a fifth of each host's hourly allowance, by its headers or Althar's own count, backing off as it falls; Bitbucket's lists carry no checks. News only: no card, no lead. Test: an outside author's rerun at the same head reaches the errand that waits on it | M | 2, 3 |
| 8 | Coordinator tags, approves and publishes releases | `push_tag` for the coordinator, on a commit of the default branch, on every host. In the connectors: read a release, and publish one as each host does (GitHub's draft, GitLab's release made, Bitbucket Cloud's files in Downloads); approve a run (GitHub's environment, GitLab's deployment approval or manual job), and link the host's own button where only the person can (Bitbucket's manual steps); run a run's failed jobs again; read a run on a tag (with DEV-94). Another repository's release steps, read from it and kept as a note | L | 3 |
| 9 | Release 0.7.0 through the coordinator | The release errand above: the version-and-notes task, then merge, tag, approve, the draft, the decision to try and publish it, Publish, the tap. Each step in the chat. The coordinator's brief for releasing. Proven by releasing 0.7.0 itself, so it goes last | M | 2, 5, 8 |
| 10 | A gated call to the code host's API | `code_host_api`: REST reads; writes asked-for; GitHub's lists by family of paths: typed tools' (by name), the repository's content (pointing to a task), what stands in for a gate, workflows started only at the default branch, and never. A test that places every write in GitHub's published description of its API; a write not placed is refused at run time. The other hosts' lists are task 14; GraphQL queries only; receipts and the line in the chat; a floor under the rate limit | L | 3 |
| 11 | Coordinator acts on tasks when you ask | Stop, hold, restart and settle a task; discard one, asked-for; `attach_pull_request` from its head without asking; resume an automation, or run it now, on the person's word. Swapping a lead is DEV-177 | M | 3 |
| 12 | Coordinator files issues at once or as a card | `draft_issue` files at once or drafts, as the coordinator judges from the project's notes; a card's "always" or "never" is kept as a note; "Change issues without asking" becomes a note. Commenting on an issue becomes asked-for in code | M | 3 |
| 13 | draft_issue takes project, milestone and assignee | On every tracker: project or milestone, assignee, parent, and Jira's issue type; set right after creating where a tracker's create can't take them | M | – |
| 14 | The gated call on GitLab and both Bitbuckets | GitLab's, Bitbucket Cloud's and Data Center's lists, by [the same families](#the-gated-calls-lists-on-the-other-hosts), each tested against the host's published description: GitLab's, which is partial, completed by hand, and Data Center's for each version Althar supports. A write placed nowhere is refused | M | 10 |

In order:
1. **First, side by side:** 1, 2, 3 and 4. None waits on another.
2. **Then:** 5, 6, 7 and 8.
3. **Then:** 10, 11, 12 and 13.
4. **Then:** 14, beside ADR-078's tasks 1, 2 and 4.
5. **Then:** ADR-078's tasks 3, 5 and 6.
6. **Last:** 9, which is 0.7.0's own release.
