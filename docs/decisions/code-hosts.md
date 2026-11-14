# Code hosts and trackers

How Althar reaches GitHub, GitLab and Bitbucket, and Linear, Jira and
Trello: connecting, pushing a task's work, following its pull request,
seeing its checks and conflicts through, acting on the host as the person's
account can, merging, releases and issues.

**Replaces:** ADR-011,
ADR-016,
ADR-026,
ADR-030,
ADR-040,
ADR-041,
ADR-052,
ADR-059,
ADR-070,
ADR-072,
ADR-081,
ADR-085,
ADR-092

How the connectors are built, their models and their contract suites, is in
[06](../architecture/06-integrations-and-skills.md).

## Connectors

Althar talks to each service through a connector of its own, on the
service's API. There are two models: a code host and a tracker, each with
an adapter per product.

- **Code hosts:** GitHub, GitLab, Bitbucket Cloud and Bitbucket Data Center,
  hosted or on a team's own server.
- **Trackers:** Linear, Jira Cloud, Jira Data Center, Trello, and GitHub's
  and GitLab's own issues.

Each adapter declares what its product can do, and the screens show only
that, in the service's own words. Each has a fake for tests and a contract
suite run against real accounts on demand. A feature ships for every host
and tracker that can have it ([foundations](foundations.md)); where one
lacks something, Althar stands in with what it has, and where neither can,
the tool says so and links the host's own button.

Why its own connectors rather than each service's MCP server, `gh`, or a
unified API: Althar needs to listen to a pull request, keep a receipt for
each write, and speak each service's words. MCP servers can't listen, and
their tools differ by service and version. `gh` covers one host. A unified
API flattens the services to what they share, and a third party would hold
the tokens.

**Tokens** are sealed by the app (Electron's `safeStorage`, whose key the
system keychain keeps for the signed app alone). They are never in the
store, the record or a log, and never handed to an agent.

**Listening is polling,** while the app is open, and only to what something
listens to. A task's pull requests are read every 30 seconds, and ten times
slower after ten minutes with no news. Every other open pull request in the
project's repositories is followed more slowly, for the coordinator's news
([Hearing from the host](#hearing-from-the-host)). Webhooks wait for a
cloud, so nothing is heard while the app is closed.

**Agents and the person's own sign-in.** Agents act on the host through
Althar's tools, which carry the connection's sign-in without showing it.
That is the preferred way, and the recorded one: Althar keeps a receipt,
holds a push someone else would be overtaken by, and knows where a fork's
branch goes. Agents also carry the person's own `gh`, `glab` and git
sign-in where it is set up ([the person's setup](the-persons-setup.md#the-persons-own-sign-in)).
The rules read `gh` and `glab` as they read git, so only
[what can't be undone](what-agents-may-do.md#what-asks) asks: a merge, a
release, a post. Approving the agent's own work, or widening what the host
lets agents do, is refused.

Not built yet: Althar noticing a push it didn't make, by reading the branch
after each of the lead's turns. A head that is a commit of the task's
worktree would be taken as the task's own, any other head as someone else's
push, and a pull request opened with `gh` on the task's branch adopted, not
duplicated. There is no project switch to keep agents off the person's
sign-in.

## Connecting

Connecting is a walk, one step at a time, on a sign-in card. Settings
narrows its panel to it; a task, a project's settings and a new project
show it beside what the person was doing. First come the ways in that can
work in this build, each saying what it needs from the person. Then come
the steps of the one chosen, and then what the connection can do. A way
that can't work in this build is never shown.

The ways in:

- **The service's own browser sign-in,** where Althar's app is set up for
  it: GitHub through Althar's GitHub App by device flow, GitLab by device
  flow, Linear by OAuth with PKCE, Trello through its authorize page.
- **`gh`'s or `glab`'s sign-in, copied,** where the tool is signed in to
  that instance here and its token answers. Althar keeps its own copy in
  its keychain, so `gh auth logout` doesn't stop a task midway. Signing
  `gh` in again doesn't renew Althar's copy.
- **A token, made on a page opened filled in** where the service takes it
  (GitHub's fine-grained token page, GitLab's with the `api` scope, a
  classic token on a company's own GitHub). The token is noticed on the
  clipboard as the window comes back, and pasting is always offered.
  Jira, Bitbucket, and a self-hosted server whose admin hasn't registered
  Althar always go this way.
- **A company's own server, by its address,** filled in from the projects'
  remotes. Each address is asked which product answers there; a Jira site
  says whether it is Cloud or Data Center.

The clipboard is read only while a step waits for a token, and only as the
window comes back. The main process hands the page only text that looks
like a service's token; anything else the person copied never reaches it.

**Every connection is checked by reads only:** who it signs in as, whether
it reaches the projects' repositories there, and each thing Althar does
there, line by line, with the token's expiry where the service says it.
What only a write would tell, such as what a fine-grained token may
change, is said to be unknown, never guessed. A check must never change
anything. A line that can't be done says why and how to put it right on
the service's own page, and the person can connect as it is.

Signing in again keeps the connection's address and the email or key that
went with its token, and takes a token only for the account it was.

OAuth that needs the app's secret (Atlassian's) waits for Althar's cloud.

## Pushing a task's branch

**Connected,** Althar's own steps push with the connection's token, open
the pull request and mark it ready, as the plan says
([tasks](tasks.md)).

**Not connected, a task's branch can still be pushed** with the person's
own git: to the remote the repository's work goes to (the one its default
branch follows, else `origin`, else its only remote), under the branch's
own name. It uses their keychain or SSH agent as a terminal would, fails
rather than waits for a password, and pushes up to the commit they saw.
Nothing is opened on the host. Pushing is git; a connection is what comes
after it: the pull request opened for you, its checks and reviews brought
back to the lead, the merge when you accept. So any host works, a team's
own server included.

The task says where its branch stands on the remote: not there yet, behind
by some commits, or there. Once it is there, the task links to the host's
page for a new pull request from it, where that page can be told from the
remote's address. The offer to connect comes after such a push, not
before: the task says what connecting would add, and opens Connections
beside it. The project's menu always has Connect.

**Every push Althar makes is a plain push, never forced,** and never to the
default branch: publishing refuses a task branch named as the default
branch of the repository it would push to. A branch whose pushed commits
were rewritten waits for the person's Replace on the Push card.

In the Flatpak, a push over SSH runs the device's `ssh`, so it uses the
person's agent there ([packaging](packaging.md)).

### A fork's branches

Althar knows a fork as its code host says, where one is connected
(DEV-171). It asks `origin`'s host whether that repository is a fork, of
what, and, where the host says (GitHub's `source`), what the root of its
forks is. The answer is kept for the whole run of Althar, an hour before it
is asked again; a host that gave none (it failed, hung, or doesn't say) is
asked again only after five minutes, so it holds nothing up twice. Only an
answer reached through `origin`'s own address counts, never a mirror's.
Without an answer, the remotes' names say, as before: an `upstream` beside
`origin` on the same host, naming another repository. Where a fork's work
goes is a per-project choice with three answers: pull requests on the fork,
pull requests upstream from the fork's branches, or branches and pull
requests both upstream.

- **The parent is found among the remotes by address**, whatever the remote
  is called (`upstream`, `base`, an owner's name): at an address the host
  gave for it, or at its path on `origin`'s host as the host's addresses
  are written there, with exactly the server's own path in front (and
  Bitbucket Data Center's `scm/` over HTTPS), never a path that only ends
  in it. An SSH remote has neither in front. `upstream` wins where several
  have it. Where none has the parent, a remote with the root is it, as for
  a fork of a fork whose `upstream` is the root. Where none has either and
  the host can't say the root (GitLab, Bitbucket), an `upstream` that names
  another repository on the same host is it by its name, as before; where
  the host said the root (GitHub), one that is neither isn't.
- **Where no remote has it**, the fork is still one. The repository's
  settings say so and offer to add it, as `upstream`, or `parent` where that
  name is taken, by the host's address written as `origin`'s is. Only the
  person adds it; nothing does for them. Until then, tasks start from the
  fork, its conflict checks fetch the parent by address into
  `refs/althar/parent/`, and its pull requests are listed and fetched from
  the parent through its host's connection, or refused with a word to add
  it where none reaches it, never the fork's instead.

- **Branches upstream is offered only where the host says the account can
  push there.** That is read as the project's repositories are read, and
  again the moment it is chosen. When the host first says so, the project
  asks once, and the answer is recorded. If access goes later, publishing
  falls back to the fork.
- **Remotes are never rewritten.** `origin` and `upstream` stay as they
  are; the clone and its scripts are the person's. A clone whose remotes
  were renamed by hand (`origin` the original, `fork` the fork) just works.
  Adding the parent where the person asks is the one change Althar makes,
  beside theirs: a remote is never renamed or removed.
- **An open pull request stays where its branch is** until it closes,
  whatever the project says now, since a host can't move a pull request's
  source. Only new work follows the setting. Where the host says the fork
  is gone, nothing is pushed and the person is told why.
- A push address that isn't a repository, as `git remote set-url --push
  upstream DISABLED` leaves, is named in the refusal; Althar never changes
  it.

## A lead's commits go up as its turn ends

The project rule "Push the lead's commits automatically", on unless the
person turns it off, pushes what a lead committed to its task's open pull
request as the lead's turn ends, whoever has looked. Pushing was all the
person did with such commits, for work they had already asked for. A turn
is a unit of work, so commits aren't pushed one by one as they're made.

- The end of the turn is waited out, as a conflict round's is: a lead may
  commit just after its turn, or still be at work on what it left running.
- Not while its plan publishes, or a conflict round is under way: those
  push themselves. At launch, and when the rule is turned on, what open
  tasks' leads left waiting goes up. In a task of several repositories,
  each pull request goes up or is held on its own.
- Only an open pull request takes commits. One merged or closed sends them
  to the task's next pull request, which opens as the round ends
  ([tasks](tasks.md)).
- **What holds it:** the pull request's branch is anywhere but where Althar
  last pushed it, or where Althar's own update of it on the host left it
  (`update_branch`, the merge line's: a merge of the target's head into the
  head it asked from, read back once), so someone else pushed there; the
  person stopped or
  interrupted the lead since anything last went up; the push, or the read
  before it, failed; the host isn't connected; or the lead was still at
  work long after its turn. A hold is the last word: nothing else goes up
  past it.
- **The card shows Push only where a push is held,** with why ("Someone
  else pushed to PR #402"). Commits on their way show "1 commit going up to
  the PR", with no Accept, so the pull request is never merged before them.
- Off, every push but a fix for failing checks is the person's.
- **Held for Ship, nothing goes up but Ship.** What a turn the person's words
  began after the plan committed holds the branch until the person ships it
  ([tasks](tasks.md#rounds-back-to-work-and-shipping-again)): this rule, the
  Push card, `push_to_pull_request` and publishing all refuse it, failing
  checks of the pushed head aren't put to the lead, and a conflict waits for
  Ship's push. Ship reviews first, where the plan has a reviewer before the
  work ships, then pushes past the hold. Whatever the phase, Ship's review
  or the lead's turn under way, nothing says they go up as the turn ends
  or offers their Push: the pull request's `pushing.ship` says they wait for
  Ship, and the coordinator's `read_task` says so, and when Ship is under
  way.

**Commits the person makes by hand in the task's folder hold the branch for
Ship too.** Of what isn't sent yet, a commit written outside every turn of
the task's agents (from a moment before each began to two minutes after it
ended, as a lead may commit just after) is the person's. Althar looks as
each turn of its lead begins, before the lead reads anything, and before it
pushes on its own; crediting keeps when a commit was written, so a commit
made again for its credit is still the lead's.

**Merge, with commits not shipped, offers two.** Review and merge is a Ship
that merges once what waited is up, unless the lead set a finding of its
review aside, which a line says, leaving the merge to the person. Merge now
sends them up past the hold and merges at once, and they are reviewed after
the merge, in the same task, where it has a reviewer
([reviews](reviews.md#an-explicit-review-after-merge)). A plain
Accept, from the Dock or anywhere, is refused while they wait: it would
merge the pull request without them, unreviewed. The Dock offers Ship.

`push_to_pull_request` pushes at once wherever the rule or a checks fix
would, and says what it did; otherwise it shows the person the commits with
Push.

**A hold reaches up a stack.** A push sends a branch's whole history, so a
change whose branch carries commits that wait for Ship on the change it is
stacked on is held as if they were its own: nothing pushes it but the Ship
that ships the one below too, which goes first. Althar works this out from
git before each push (where the branch meets the one below, past what that
one's pull request has), rather than keeping it
([tasks](tasks.md#a-task-holds-as-many-changes-as-it-needs)).

**A stacked change follows the one below.** Once a change's pull request
merges, the pull request of each change stacked on it goes into what the
merged one went into: `editChange` sets its base on every host (GitHub's
`base`, GitLab's `target_branch`, Bitbucket's destination and `toRef`), and
the thread says so. One its host won't move is said, for the person to move.

## Attaching a pull request a task didn't open

The person, or an agent, attaches a task to an open pull request by its
link or number, and from then on the task follows it as one Althar opened:
listening, the card, the lead's tools, Push, conflict rounds and checks.
It's how a task takes over a pull request opened from another branch, or
on the repository a fork sends its pull requests to.

- **Which:** an open one, on the task's repository or on the one its fork
  came from. Its branch must be on a repository the task pushes to, as the
  host says. Where the host doesn't say, attaching is refused: a branch of
  the same name may not be the one it merges from. A link is taken only on
  the host the task's repository is on. One that another open task
  follows stays that task's. Pull requests are attached one at a time
  across every task, so two can't both take one.
- **Its branch:** where the task's branch already has the pull request's
  head, nothing moves. Otherwise it moves only when the person, or an
  agent, says to start from its head. Then the head is fetched, the branch
  is moved onto it, and the task's own commits go on top one by one. Where
  they conflict, the worktree has uncommitted work, or the lead is at work,
  it stays as it was and says why. Where it was is kept under
  `refs/althar/before-attach/`, so nothing is lost.
- **Each push goes to the pull request's own branch** by its name on the
  host, whatever the task's branch is called here, as a plain push.
  Publishing opens nothing new for an attached pull request.
- A task follows one pull request per repository: attaching another stops
  listening to the one before.
- From the task's menu (Attach a pull request…), or with
  `attach_pull_request`. `draft_task` takes a pull request, so a task
  drafted to answer a review starts on its head. `find_pull_requests` lists
  a fork's upstream pull requests first, and says which task follows each.

Not built yet: attaching a pull request whose branch is on someone else's
fork, where its author lets maintainers edit it, and pushing to it on the
person's word, never forced. Today that is refused.

## Checks: Althar sees them through

A change's checks are Althar's and its lead's to see through, so the
person is handed work that passed, not work about to fail in CI.

**While its checks run, a change is under way,** not the person's: its card
is Running, with "Checks running". It holds no place among the agents at
work, since nothing works on this computer meanwhile. A pull request that
shows no checks yet counts as running for a minute while the host
registers them, where the repository's pull requests have had checks
before. Once they pass, it comes to the person in Needs you.

**A failure goes to the lead, whoever has looked.** A new failure on an open
task's open pull request, its own or attached, goes to its lead, which is
started again on the agent it was last on if its session ended. First:

- **A failed check is run again once,** where the host can (a GitHub
  Actions job, a GitLab job, a Bitbucket Cloud pipeline whole), in case it
  failed by chance. If it passes, the lead never hears of it. A commit
  counts once toward the lead's fixes, however often it is run.
- Bitbucket Data Center's builds belong to another service (Jenkins,
  Bamboo): Althar says so and links the build.

Then **the lead decides what the failure is,** and is told to:

- its change broke it: it fixes, commits and pushes;
- it failed by chance: it runs it again with `rerun_check`, once;
- it is broken on the default branch, or fails for a reason unrelated to
  the change: it changes nothing to work around it, and calls
  `hand_checks_to_person` with one plain line saying so and what would fix
  it. `read_default_branch_checks` shows it main's latest checks;
- the person needs to decide: it says what.

**Its fix pushes at once,** unless the person said something on the task
since those checks came (what the lead commits may be for that), or the
branch had commits the pull request didn't when the lead was told.

**Limits, each of which hands the work to the person rather than refusing
it:**

- Three fixes (`FIX_ROUNDS`) for a run of failures, counted from the end of
  the plan's run, the person's last push or the checks last passing. Then
  the thread says "The checks on PR #1 still fail after 3 fixes by its
  lead, so the change is yours now", and the lead is asked once to say
  what it tried.
- Checks that run past 45 minutes (`STUCK_AFTER`) on one commit make the
  change the person's.
- Checks Althar can't read are said in the thread once a commit; what
  people say on the pull request, and its merge, are still heard. On
  GitHub, a token without check runs reads only commit statuses, which
  Connect says when the person connects.
- A lead that ends its turn on a failure with nothing done is waited for,
  then asked once to do one of the above. If it stops so again, or its
  agent stops on its own, the card says so and asks the person to tell it
  what to do.
- Stopped or interrupted by the person since a failure came, the lead isn't
  told that failure again; a new failure on a new commit is its again.

It comes to the person only with a reason: the lead's line, or "test still
fails after 3 fixes by the lead". Never a bare "Checks failed". The board
card shows only the check that fails.

**Logs:** the failed-checks card shows the end of each failed check's log,
or why Althar couldn't read it, with a link to the check's page. The lead
reads a whole log a page at a time (`read_check_log`, 300 lines). Logs
behind a redirect to storage elsewhere are followed without Althar's token.
A check another CI service ran gives its page.

## Conflicts

The project rule "Resolve merge conflicts automatically" is on unless the
person turns it off. A task can say otherwise from its menu, which shows
beside it only where it differs from the project. A conflict the lead
settles is work the person doesn't judge; the checks say whether it holds.

- **Althar finds a conflict itself, as the default branch moves,** not only
  when the host says so. Every few listening turns, and at once when it
  sees a pull request merge, it merges each open task's branch with its
  fetched default branch, without anything moving. A host that hasn't
  worked it out yet is asked again soon, not taken for a no.
- **On, a conflict is the lead's to resolve, unasked,** once its lead is
  idle. For a pull request, the branch it goes into is fetched first.
  Turning the rule on looks at every open task at once; "Look for
  conflicts now" does the same at any time.
- **Althar judges the branch, not the lead's word.** The branch it
  conflicted with must be in it, nothing half merged, no markers left.
  Not resolved, the lead is asked once more with why (`ATTEMPTS`, two),
  then it's the person's, in Needs you. Where only the commit was missing,
  the lead is told to commit it.
- **The lead commits the merge** as soon as the conflicts are settled and
  the quick checks pass, before the full suites, and doesn't end its turn
  with it uncommitted. What the full suites find is one follow-up commit on
  top.
- **Althar pushes the resolution itself:** only the merge, on the branch as
  the pull request had it, with at most that one commit on top, and only
  where nobody else asked the lead anything meanwhile. Anything more waits
  for the person's Push. There's no review round on it: the pull request's
  checks run on what Althar pushes.
- **One ask for both.** A conflict found while checks fail is asked with
  them, to fix in the one commit on top of the merge. While the pull
  request conflicts, the failed checks aren't run again first.
- **A round waiting for its merge's checks doesn't hide a new conflict.**
  Once the default branch moves on and conflicts again, the new conflict
  is a round of its own, asked at once.
- **A change's tries at its checks count across rounds,** so a check that
  keeps failing as main keeps moving doesn't go round again.
- **Never skipped without a word.** Where a conflict isn't asked of the lead
  (the rule is off, the person stopped the task, it has no lead, its folder
  isn't here, its target couldn't be fetched), its card and its Needs you
  line say why in one line, with Resolve now, which asks the lead anyway.
  Where the lead is about to be asked, the card is under way, not offering
  Resolve.

A task the person stopped isn't started again for a conflict, unless they
press Resolve now. Stopping or interrupting the lead mid-round makes the
round theirs.

## Acting on the host

The coordinator and every lead share one pool of tools
([coordinator](coordinator.md)), and through them do on the code host what
the person's account can, on any of the project's pull requests and
repositories. Four things stop them, each for a reason no tool takes away:

1. **What can't be undone waits for the person's word,** and never happens
   on an agent's own initiative. That covers merging, entering a merge queue
   or turning on auto-merge, a release tag, moving or deleting a tag,
   approving a release run, publishing a release, deleting another branch,
   and speaking for the person to others. This is the irreversible list,
   kept in [what agents may do](what-agents-may-do.md).
2. **A short never list stays the person's:** the repository's settings,
   its branch protection and rulesets, who has access, its secrets,
   webhooks, keys and runners. These decide what every agent may do, so no
   agent changes them, whoever asks.
3. **A change to the code is a task,** with a lead and a review. This is
   tidiness, not safety ([coordinator](coordinator.md)).
4. **Nothing approves its own work:** no agent approves a pull request a
   task opened, makes a commit status or a check run, dismisses a review,
   or answers its own permission request.

Anything else that stops an agent on the host is a tool nobody wrote yet,
not a rule.

**The person's word** is a message they wrote, in the turn it started, or
an errand kept from one. Each turn records whether the person's own
message is among its inputs; a turn that news, a lead or Althar alone
started can't take an asked-for step, whatever the text in it says. So the
words of an issue or a pull request can't set off a merge. A message counts
where it was written in the window or on a paired device; nothing over the
local socket counts, nor a lead's word to the coordinator. Their message is
their word for whatever the agent works out from it, groups included:
"merge the green ones" merges every green one. The person chose this over
a card for every ask, and accepted that text read in their turn could steer
the agent to a target they didn't mean. The line in the chat is where they
see it.

- **An errand** is what the person asks for later: "merge #461 once it's
  green", or a release's steps. It keeps their words, the message, each
  target, the head read, and what each step waits on. A turn its news
  started may take its next step and nothing else that can't be undone. It
  ends when done, when the person calls it off, or when someone other than
  the task's lead or Althar pushes to its pull request. A fresh session's
  brief lists the open ones.
- **Each asked-for step says what it did** in a line: what, which, at which
  head, and the person's words it acted on ("Merged #461 at 9b50d2c:
  'merge the green ones'"). Each rests on a receipt. An errand says what it
  waits on, and its task's card says so too.
- **Each step reads before it acts, and skips what's done:** a tag already
  at the commit, a release already out, a pull request merged. A call whose
  answer was lost is read back before it is tried again, so a restart
  never does anything twice. An objection (changes requested, a new
  unresolved thread, back to draft) pauses an errand until the person's
  word again. One that hears nothing for a day says what it waits on.

**Speaking for the person:** a post goes ahead on a pull request or issue
that a task of Althar's opened or came from, the person's own or one by the
repository's own people, and on an outside author's goes on the person's word
([what agents may do](what-agents-may-do.md#speaking-for-the-person)).

**Whose pull request it is holds nothing back** (the person's note of 11
Nov): `mark_ready`, `close_pull_request`, `reopen_pull_request`,
`reply_on_pull_request` and `edit_pull_request` act on any of the project's
pull requests. Unasked on Althar's own and the person's own (and a reply or
edit on one by the repository's own people); on anyone else's at once on the
person's word, their message in the turn that asks it. Declining on
Bitbucket Cloud is final, so it goes only on their word, whoever opened it.

**The tools,** beside pushing and reading:

- Can be undone, in any turn: `rerun_check`, `read_default_branch_checks`,
  `mark_ready`, `update_branch` (a merge of the default branch in, never a
  rebase: GitHub's update-branch, elsewhere Althar's own merge, pushed
  plainly), `close_pull_request` and `reopen_pull_request`,
  `reply_on_pull_request`, `edit_pull_request`, `leave_queue`, and the
  reads (`read_pull_request`, `read_checks`, `read_check_log`,
  `find_pull_requests`).
- Asked-for: `merge_pull_request`, `push_tag`, `approve_release_run` and
  `publish_release`.
- The person's own Close on a task's pull request can delete its branch as
  it closes.

A lead keeps its own `rerun_check`, `read_default_branch_checks`,
`reply_on_pull_request`, `edit_pull_request` and `push_tag`, which act on
its task's pull request unless told another; named by its link or number,
another of the project's goes as the coordinator's tools take it.

**Accepting a change merges it.** The person's Accept on a card, their
merge on the host, or `merge_pull_request` on their word all merge it, and
the task settles as done.

## Merging and the merge line

`merge_pull_request` merges at the head the agent read, with a method the
repository allows. A head that moved since is refused, as merging what
nobody saw; an errand's merge takes the head that went green.

The window's Merge also follows the host's queue by default, including for an
admin who can bypass it. Where GitHub explicitly permits this viewer to bypass
branch protections, its secondary menu offers **Merge without queue**. That
choice checks the permission again and merges only the head shown; a refusal
stays a refusal. A queued pull request offers the same explicit choice without
another normal merge. Permission unknown or denied, another host, work waiting
for Ship, and a settled change offer no bypass. The override belongs to the
named pull request, never every repository in a stack.

- **Where the branch has the host's own queue** (GitHub's and Bitbucket
  Cloud's merge queues, GitLab's merge trains), the merge goes there, at its head, and the host
  merges once the queue's checks pass. A build the queue sent back is not cleared by
  the pull request head's own green checks: the rejected head stays out until
  the person asks to put it back. This survives a restart and a host forgetting
  the rejection reason; ordinary sweeps never retry that head.
- **Everywhere else Althar stands in for a queue:** one slot for each
  repository and branch, taken in the order the person asked. Two pull
  requests green against the same main can each merge without being tested
  together and turn main red, and auto-merge alone merges each as soon as
  it's green. So the errand that holds the slot is brought up to date with
  the branch's head, by a merge, and waits for green there. Then it merges,
  with auto-merge as its merge where the host has it (GitLab, Bitbucket
  Data Center). It holds the slot until a read shows the merge landed, and
  the next starts again from the new head. An accepted merge keeps its slot
  even when its row moves or its errand is paused. A pause starts nothing
  more, but the accepted operation is read until it ends. If its result is
  still uncertain after the normal wait, the slot stays held: a timeout is
  not proof that a remote merge stopped. A red head gives its slot up and
  is not brought up to date just because main moved. Where someone else
  writes to the target meanwhile, it brings its branch up to date again,
  three times at most, then waits for the person.
- Cancelled checks are not green. They are run again where Althar can, but
  until they run and pass they cannot authorize a merge. A recorded push,
  whoever pushed it, gets the same bounded wait for checks to register in a
  repository that has CI. Commits held for Ship block the merge line as they
  block the task's own Merge.
- **The person's "merge it now"** (`now: true`), and their press in the app,
  wait only for a merge already in flight, not for the line.
- **A merge that lands later** (Bitbucket's 202, GitLab working out whether
  it can) is done only once a read shows it merged.
- What a server supports (GitLab's tier, Data Center's version) is read
  when a repository is first used and again when a call is refused for it.
- The line and its slots are kept in the store, so a restart keeps them.
- Fast-forward and semi-linear repositories ask only that the default
  branch's head be in the branch, which a merge from it gives, so nothing
  is rebased.

What it can't promise: a write by someone else between the last read and
the merge landing. Where the repository's rules make the host refuse a
branch that isn't up to date, the host closes that gap; otherwise it shows
as main going red, which the coordinator hears.

## Releases

"Release 0.7.0" is a release errand, and each step goes once the news
before it comes:

1. A lead, in a task the coordinator plans, raises the version and writes
   the release notes, reviewed like any change.
2. The coordinator merges its pull request once it is green.
3. CI's post-merge run passes on that commit.
4. The coordinator tags it (`push_tag`).
5. It approves the release run's environment (`approve_release_run`), which
   lets the run use the signing secrets, for a draft.
6. The person tries the draft, unless they said to skip it: one line in the
   chat, and a card.
7. It publishes (`publish_release`) on the person's word "publish", given
   then or in their first message.
8. The Homebrew tap's run is approved, and its cask is read back at the
   version.

A failed run is read as a check is; a job that failed once is run again
once (`rerun_failed_jobs`), and anything else is a fix task while the
release waits. Approving a run's environment is the person's permission to
use the secrets, not a check of the work, so their word for the release
covers it. Where the environment prevents self-review, the person's own
account can't approve a run their tag started, and the coordinator says so.

That is Althar's own release. Another repository's steps are read from its
workflows and docs the first time the person asks (`read_release_steps`),
and kept as a project note. Each host releases its own way: GitHub has a
draft, then Publish. GitLab has no drafts, so making the release is
Publish. Bitbucket Cloud has the tag, then its files in Downloads. On
Bitbucket Data Center, the tag is the release, and the repository's CI
does the rest.

## Hearing from the host

What Althar learns from a task's pull request goes to its thread, and to
its lead for failing checks, conflicts and reviews that aren't approvals.
What the lead hears is what the person and the repository's own people
say, and failed checks; anyone else's words stay in the thread.

**Every open pull request in the project's repositories is followed,**
whoever opened it, for the coordinator's news. One followed so has no lead
and no card; a task attaches to it only when someone asks. The open list is
read every five minutes, with conditional requests, which GitHub doesn't
count when nothing changed. A pull request's checks are read when its head
moves or a check still runs, and for a day after they failed, so a rerun
without a push still comes as news. All of it stays within a fifth of each
host's hourly allowance, backing off as what's left falls. News of an
outside author's pull request is in Althar's words (its state, its checks,
its reviews' verdicts), never their title, description or comments.

**The coordinator is woken only for what it can act on,** in a batch, at
most once every few minutes: an errand's next step, checks a lead handed
to the person, main going red. Woken by news, it does only what can be
undone and an errand's steps; anything else it tells the person in a line.
What it can't act on waits for the person's next message.

**Main is red** when a check on the default branch's head fails. The sweep
reads main's head each time, and its checks when the head moves, while a
run is still going, and while main is red or a release waits on it. The
coordinator is woken to read the failure and say what it finds. A fix is a
task, and a release waiting on main waits on.

## Trackers

**A task's issue moves as the task does:** "Move issues along with their
tasks", on unless the person turns it off, takes it to In Progress, In
Review, then Done. Leads and the coordinator change issues with `change_issue`, file
them with `draft_issue` (project, milestone, cycle, parent, assignee and
the like), comment with `comment_on_issue`, and find them with
`find_issues`.

**Issue changes go at once,** without a card, as the person's note says.
Leads draft issues only when the person asks; what they find out of scope
goes in their report.

**Workspaces side by side.** A tracker whose sign-in reaches one workspace
(Linear) keeps which workspace each connection is, by its URL key and name.
The same account in the same workspace is renewed; another workspace is a
connection beside it, added with "Add a workspace". Linear's sign-in shows
its consent screen each time, so the person can switch workspace there.
Each connection says its workspace and is disconnected on its own.

- **A link to an issue goes to the connection in the workspace it names,**
  never to another workspace's, where the same key is another issue. A link
  to a workspace that isn't connected says so.
- **A project may be bound to one tracker connection and a container there**
  (a Linear team, a Trello board's list), in its settings, "Issues go to".
  Bound, its drafts go there unless the agent names another, its issue list
  and `find_issues` read that tracker alone beside the repository's own
  issues, and a bare key (`ENG-1`) is looked for there first. Disconnected,
  the project stays bound and says so, rather than drafting into another
  workspace. Unbound, issues are listed and keys found across every
  tracker.
- **A connection made again takes over what the removed one held:** the
  issues linked to tasks, and the issue and review drafts.
- Jira Cloud sites are addresses of their own, so several sit side by side
  already. A Trello sign-in reaches every workspace the person is in.

## Not built yet

The decisions above are current. These parts of them aren't built on main:

- **Noticing an agent's own push,** and adopting a pull request it opened
  with `gh`.
- **`delete_branch` for agents:** deleting a branch on the person's word.
  A branch can still be deleted on Close. `post_review` now posts an
  explicitly requested review at the commit read; `draft_review` keeps its
  existing card.
- **A lead's tag on the person's word in its thread:** a lead's `push_tag`
  still asks every time. A lead's merge goes through the same tool and line
  as the coordinator's.
- **Issue changes at once:** `change_issue` still makes a card unless
  `at_once` is passed, and a lead's change to an issue other than its
  task's is always a card.
- **Branches and pull requests made on an agent's own judgment:**
  `create_branch` and `open_pull_request` still go only on the person's
  word, though neither is on the irreversible list.
- **Main red starting a fix task by itself:** the coordinator is woken and
  reads it, but plans the fix like any other task.
- **The coordinator reading the web** under the project's switch: it is
  kept off it today.
- **A contributor's fork:** attaching its pull request, and pushing to it
  where its author lets maintainers edit.
- **A host Althar adds later** gets reads only until its lists are written.

## Changes

- 12 Nov 2026: the lead and coordinator gain complete discussion pages,
  Linear resources, relationships and attachments, review controls and
  broader PR search. `code_host_api` and `tracker_api` provide authenticated
  fallbacks with asked-for writes and receipts; [architecture
  06](../architecture/06-integrations-and-skills.md#authenticated-api-fallbacks)
  records their bounds and protected families.
- 8 Nov 2026: written from the ADRs under Replaces.
- 8 Nov 2026: the limits sweep (#696) built: agents carry the person's own sign-in, and `gh` and `glab` are read as git is.
- 9 Nov 2026: what a turn the person's words began after the plan commits holds the branch for Ship (a task is a conversation plus parts, [tasks](tasks.md#changing-parts)).
- 10 Nov 2026: commits made by hand hold the branch too; Merge with commits not shipped offers Review and merge or Merge now (a task is a conversation plus parts, [tasks](tasks.md#changing-parts)).
- 10 Nov 2026: a task follows several pull requests at once, one for each change; stacks hold, ship, merge and retarget from the bottom up, and a pull request opened outside Althar from a change's own branch is that change's (a task is a conversation plus parts, [tasks](tasks.md#a-task-holds-as-many-changes-as-it-needs)).
