# Automations

> **Temporary: the build plan for automations.** Written on 19 October 2026,
> after the prototype (the Automations tab, as cards, each automation on its
> own page) was picked and thrown away, as a proposal with calls for the
> person. Decided with the person on 21 October 2026: five calls are theirs,
> and the rest are taken where Claude Code, Codex, Cursor, Orca and Superset
> agree (What was decided, at the end). What lasts moves into the
> architecture docs and ADRs as each step ships, and this file is deleted
> when the last one does.

## In short

- **An automation is a standing request plus a trigger.** The request is
  what the person would say to the coordinator, kept: a prompt, a lead and
  its effort, a reviewer or none, what it ends in. The trigger is a schedule
  or something that happens. Each time it fires Althar keeps an
  **occurrence**, and an occurrence with work to do starts an ordinary task.
  Nothing new runs agents: automations only decide when to start the tasks
  Althar already knows how to run.
- **Althar decides when, the same way every time; the lead decides how.** A
  fire doesn't ask the coordinator what to do. It starts the kept plan on
  each thing it found (each new pull request, the issue that got its label).
  The coordinator writes and changes automations, in the conversation, on a
  card the person turns on.
- **It runs on this computer, in the runtime, while Althar runs.** On a Mac,
  Althar already keeps running with every window closed. Add one opt-in,
  "Open Althar at login, in the background". No daemon, and no waking the
  computer, which on a Mac needs root. A run missed while the computer slept
  runs once when it wakes, inside a window; never a backlog. The cloud comes later, in two
  steps: a relay for GitHub's webhooks, then runs in the cloud, a product of
  their own, paid per use.
- **Events come from three places, cheapest first:** Althar's own record (a
  task's pull request merged), then polling what the connectors already read
  (with conditional requests, free when nothing changed), and later webhooks
  through a small relay in the cloud.
- **A run goes ahead without asking, mostly.** Its task allows everything,
  so no permission ask stops it at night; pushing to the default branch is
  never allowed, and merging is the person's, as for any agent. Althar takes
  every outward step itself, as it does today, and signs it with the
  automation's name. An automation's first review waits for the person, who
  can let its next ones post by themselves. Events from outside the team
  fire nothing by default.
- **A new task each time,** by default; a change automation can carry on
  its open pull request instead.
- **Small by construction:** one place for automations at most, after the
  person's own work, for every step of its task; a time limit a run, over
  all its steps; at least an hour between runs; at most five of its pull
  requests open; three failures in a row pause it; a query that found
  nothing starts no task.
- **Ready for the cloud without building it.** The occurrence is a record
  with an idempotency key, whoever noticed the trigger; starting its task is
  a step of its own that could be leased to a device. Moving the clock or the
  webhooks to a server later swaps one part, not the model. Running agents in
  the cloud is a different product, and a separate decision.
- **The calls are made,** at the end: the five that were the person's, and
  ten taken where the other tools agree.

## What was picked

The prototype is gone, so the design it settled is kept here for the build.

- **A project tab, Automations,** between Both and Settings. The automations
  as cards in two groups, On a schedule and When something happens. One that
  paused itself comes first, violet, saying why in place of its prompt; one
  the person paused is quiet. Each card: its mark (a clock, a flash, or the
  pause), its name, when it runs, where it stands on the right ("Next tonight
  2:00", "Running since 9:21", "Waiting for it", "Paused itself"), two lines
  of its prompt, and its last seven runs as small marks with what the last
  one did.
- **A card opens the automation as its own page** in the tab: back to
  Automations; its name and a status line with a dot ("Runs next tonight at
  2:00"); Run now, an on/off switch and a menu (Rename, Duplicate, Delete); a
  violet band when it paused itself, with what to do (Run it now, Move it);
  then What it does (its card), Limits, and its history, each line opening
  its task.
- **One card, in the conversation and on the page.** The plan card's frame,
  with the automation's mark (a turning clock) and the word Automation where
  a task's card names the task. Rows: When, Lead, Review, Ends in, Each run.
  In the conversation: Turn on and Try it once now. Changed by the
  coordinator: the old values struck through, with Undo. On the page it drops
  its kicker, and its prompt is its head, with Edit.
- **Made by asking the coordinator** in plain words, or with New automation
  on the tab, which opens a blank page with the prompt ready to type in. No
  form opens inside a list.

## What an automation is, in the model

```text
Automation      what, when, its limits; a new revision on every change
   │ the trigger fires: a schedule's slot, or something happening to a subject
   ▼
Occurrence      one per slot, or per subject and version; unique; keeps its revision
   │ admitted: there is work, it is allowed, a place is free, it is still wanted
   ▼
Task            an ordinary task, change, review or plain, with its rounds,
                review and pull request
```

Three records, three lifetimes:

- **The automation** is what the person made. Every change is a new
  revision, made by the person or by the coordinator, and each occurrence
  keeps the revision it ran with. History never rewrites itself, and "what
  changed since it last worked?" has an answer.
- **The occurrence** is the fact that it was time, or that something
  happened. It exists even when nothing starts: skipped (paused, busy, out of
  its window, overlapping, no longer needed), nothing to do, missed while the
  computer slept. It is the history the page shows, and the unit of dedupe:
  `(automation, slot)` for a schedule, `(automation, slot, subject)` for a
  schedule with a subject query, `(automation, subject, version)` for an
  event, unique in SQLite and written before anything starts. A slot is the
  time it was due, as its rule says it (a local date and time), not when the
  stagger starts it. Every product that does this well lands here: delivery
  is at least once, so dedupe at the record (Superset's partial unique
  indexes, Kubernetes' "jobs should be idempotent").
- **The task** is unchanged, and carries the occurrence that started it.
  Its kind is read from what it has
  ([ADR-035](../decisions/035-a-task-s-kind-is-read-from-what-it-has.md)): a
  review automation makes review tasks, a nightly bump makes changes, a sweep
  that only reports makes plain tasks.

Keeping the occurrence apart from the task buys three things: a query that
found nothing starts no task; duplicates are refused by a constraint, not
by care; and it is the seam for the cloud, since whoever notices the trigger
writes occurrences and whoever has the repository starts the task.

An occurrence is marked started only once its task has started, not when it
was dispatched: Claude Code's desktop tasks wrote "last run" at dispatch,
dropped the run during startup, and showed it as done. And the occurrence
names its task in the same transaction that makes the task, since both are
in the one SQLite database: a restart in between finds the task and carries
it on, and never makes a second.

### Subjects: why the morning review is four tasks

Most triggers are about something: a pull request, an issue, a commit on
main. Althar reviews one pull request a task, with its read-only copy, its
reader rules and its drafted review. So "every weekday at 9, review the pull
requests opened since yesterday by anyone but me" is a schedule with a
**subject query**: at 9:00, list the open pull requests opened since the
last time, not by the person, and not reviewed by a task already, then start
one review for each. Four new pull requests make four review tasks, one
occurrence each, grouped under the automation.

The person's words say which it is. Claude Code, Codex and Orca start one
session a fire, which does everything; but a review in Althar is of one pull
request and ends in a review posted on it, so "review the new pull
requests" makes one review for each. "Tell me what came in" is one plain
task with one report, and posts nothing. The card says which ("Each pull
request … one review each", or "One report").

The coordinator compiles the query from the person's words when it writes
the automation, and the card says it back in words: "Each pull request
opened since the last time, not yours, not reviewed yet". Where no query
fits, the subject is the project as a whole, and the lead does the choosing
in one task. The connectors mostly list with filters already (`listChanges`
takes an author, review requested and draft); "opened since" is missing.

"Since the last time" means since the last listing that came back whole,
not the last fire: a slot skipped because the computer was busy, or a listing
that failed, moves nothing on. "Not reviewed by a task already" is what
keeps a pull request from being reviewed twice; "since" only keeps the
listing short. A listing holds at most its `limit`, newest first, and says
when the host has `more`; `listChanges` doesn't page, so the oldest are the
ones cut. It needs paging or the "opened since" filter, and until then a
listing with more says how many it left, rather than moving past them.

### Who decides what a fire does

| | Althar starts the kept plan | The coordinator is told it's time, and decides |
|---|---|---|
| How | Fire → occurrences → tasks, through the commands `propose_plan` and `review_pull_request` use | Fire → a quiet message to the coordinator (`say` with `quiet` exists) → its tools |
| Same every time | Yes; dedupe at the record | Varies by turn; dedupe by its tools' command ids |
| Cost | No model until a task starts; "nothing to do" is free | A coordinator turn every fire, nothing to do or not |
| When it breaks | A query or connector fails: the occurrence says why | A coordinator that can't start (out of usage, signed out) misses everything, quietly |
| The person's conversation | Untouched | A machine's message in it every morning |
| Judgement | Inside the task, by its lead | At once: "only the ones that touch the runtime" |

**Althar starts the kept plan** (call 3). The coordinator's judgement is
worth most once, when it writes the automation; after that a fire should be
predictable and cheap. The lead still judges, inside its task, and can end
with "nothing to do". Revisit if people write automations whose choosing
can't be a filter.

### Some are rules, not automations

"When a task's pull request merges, close its issue" needs no agent: it is
Althar taking one outward step, like the status move the
[integrations plan](integrations.md) already makes. It belongs in the
project's rules, beside how a task ends. Automations are for work an agent
does. The test: if no agent runs, it is a rule.

## Where it runs: the clock and the hands

| | Runs when | What it takes | What it costs |
|---|---|---|---|
| **1. In the runtime, while Althar runs** | Althar open, windows or not (already so on a Mac, `main.ts:813`); not after Quit; not while the Mac sleeps | A scheduler loop in the runtime, and wake handling | Quitting stops automations, and the person must know it |
| **2. And open at login, in the background** | Also after a restart, with nobody opening Althar | `app.setLoginItemSettings` (`SMAppService`), a switch in Settings, the "requires approval" state, starting with no window | macOS's "background item added" notice; must start quiet and light |
| **3. A daemon that outlives Quit** | After Quit too | The runtime as a LaunchAgent, the app a client of it over a local socket (the CLI wants one too, `apps/cli/ARCHITECTURE.md`); the daemon stays the one writer | Install, upgrades in step, two lifecycles, support. Rejected for the MVP ([02](../architecture/02-desktop-runtime.md)); the runtime still leans on Electron's `net` and on main for secrets |
| **4. Wake the Mac to run** | Asleep too, lid open or on power | A privileged LaunchDaemon, since scheduling a wake needs root (`IOPMSchedulePowerEvent`, `pmset`) | An administrator's approval and a root helper, for a laptop that still won't wake with its lid shut. Not worth it |
| **5. A clock in the cloud, the computer's hands** | On time even with the computer off; runs when a computer is up | An Althar account, a server, leases to devices ([07](../architecture/07-persistence-security-and-cloud.md)) | A cloud product; the run still needs a computer awake |
| **6. Hands in the cloud too** | Always | Cloud machines, clones, secrets, pay-per-use agents | A different product (see The cloud) |

**1 now, with 2 offered** the first time a scheduled automation is turned
on (call 1). 3 and 4 not at all; 5 and 6 later, with the cloud (call 12).
Option 1 is close to free: on a Mac, closing
the last window already leaves the runtime, its agents and the plan
countdown running.

### What a sleeping Mac allows

- **Keep awake holds idle sleep only.** Althar's Keep awake holds
  `prevent-app-suspension` while work runs (`awake.ts`), an automation's run
  included. Apple's header says the system "may still sleep for lid close,
  Apple menu, low battery", and the assertion "has no effect if the system
  is in Dark Wake". A laptop shut on battery runs nothing; one open, or on
  power, can.
- **Power Nap is Apple's own** (Mail, Calendar, Time Machine). A run that
  starts in a dark wake can be cut off when the Mac sleeps again: Codex's
  scheduled tasks stalled that way. Start catch-ups once the person is back
  (screen unlocked, `unlock-screen`) or after the computer has been up for a few
  minutes, never at the instant of waking.
- **Don't wait for 9:00 on one long timer.** A timer that came due during
  sleep is overdue at wake, but whether it fires at once couldn't be
  confirmed. Keep each automation's next time as a UTC instant, and look
  again on wake, on unlock and on a minute's tick against the wall clock: the
  plan countdown's loop with its wake queue (`Plans.ts:188-223`), plus a
  signal from main's `powerMonitor` `resume`, which Althar doesn't listen to
  yet.
- **A precedent to settle:** a plan that came due while Althar was closed is
  held, "rather than starting unannounced" (`Plans.ts:214`). An automation
  is announced by being on, but a catch-up at launch is still a surprise.
  Call 2 decided against holding: it runs once, within its window, as
  Claude's desktop tasks and Orca do, and says so in its history.

So the promise on screen is honest: "Runs on this computer while Althar is open.
If the computer is asleep at 2:00, it runs when it wakes, until 14:00."

## Schedules

- **Kept as a rule and a zone:** a small RRULE (how often, which days, what
  time) and an IANA zone, said in words on the card. The coordinator turns
  the person's words into the rule. At least an hour apart: Claude's
  routines hold an hour, and an agent-made automation every ten minutes is
  how Codex users spent a month's allowance in a day.
- **9:00 where the person is.** Keep the zone, but read the time in the
  computer's zone of the moment, as Calendar's floating times do, so travelling
  doesn't move the morning review to 3:00. The zone is still kept, for a
  server that has none. So the next time, kept as an instant, is worked out
  again when the computer's zone changes; and since a slot is its local date and
  time, flying across zones never runs a day's 9:00 twice, and a day the
  flight skips is missed, as any (call 14).
- **Daylight saving:** a 2:30 that doesn't exist runs at 3:30 (Temporal's
  `compatible`); a 1:30 that happens twice runs once, the first time.
- **The next slot comes from the last slot, not from now** (Superset
  advances from the previous `next_run_at`), so a late run doesn't drift the
  schedule.
- **Staggered:** each automation starts a fixed few minutes after its time,
  from a hash of its id, so nine automations at 9:00 don't start at once and
  nothing hammers the hour (GitHub, Claude's desktop tasks, gh-aw do the
  same).
- **Missed:** once, if still within a window (half the time to its next
  slot, at most 12 hours, from when it was due rather than from its
  staggered start: a nightly 2:00 still runs at 8:52, a weekday 9:00 review
  still runs at 14:00, even on a Friday, and an hourly one only within half
  an hour), otherwise "missed", said in its history. Never every slot it
  missed: launchd and systemd coalesce to one, Claude's desktop tasks run
  "exactly one catch-up run for the most recently missed time", and Codex's
  replayed eight runs in 21 minutes.
- **The run is told when it was due:** a run due at 9:00 that starts at
  14:00 says so in its brief ("this was due at 9:00; it is 14:00").
- **Overlap:** while its last run still runs, the next is skipped (Kubernetes'
  `Forbid`), never replaced: Cursor cancels the run under way, and people
  lose work to it.
- **A new task each time, or the open one carried on,** a choice on the
  automation (call 4). A new task each time is the default, as in every
  other tool: each run has its own task, worktree and pull request, and at
  most five of an automation's pull requests are open at once (Dependabot's
  limit); past that, a run is skipped, saying why. A change automation can
  instead carry on its last task while that task's pull request is open,
  with a follow-up round rather than another pull request, as a dependency
  bot updates its one pull request. Carrying on comes after the first
  version. It is new: today Althar's own messages to a lead don't open a round,
  and a round never publishes by itself
  ([ADR-034](../decisions/034-a-task-goes-back-to-work-and-ships-again.md)).
  It takes a round Althar opens for the automation, carrying the new
  occurrence, whose commits go up to the open pull request as a check fix's
  do while the change is in Althar's hands
  ([ADR-040](../decisions/040-a-change-reaches-the-person-green.md)). A
  task the person took over or stopped isn't carried on: the run is
  skipped, saying it's theirs now.
- **Catch-ups at launch go one at a time,** after the person's own work, so
  waking doesn't start everything at once (Claude Code issue #51120).

## Events

| Trigger | Where it comes from | How | Cost |
|---|---|---|---|
| A task's pull request merged or closed; a task finished; checks failed on a task's pull request | Althar's own record (`record_events`) | Tail the record by a cursor kept on disk, so what happened while Althar was closed still fires. `UsageData` tails it only from where it stood at launch, its cursor in memory, and `Nudges` reads `change_log`, so neither is one to copy | Free, at once |
| Someone asks the person's review | The host's list of open pull requests with `reviewRequested` (`listChanges`, exists), or search `user-review-requested:@me` | One poll a repository every few minutes, shared by every automation | A few dozen requests an hour a repository |
| Checks fail on main | Main's head commit (REST with an ETag: free when unchanged), then `statusCheckRollup` when it moved, or while it isn't passing, since a rerun changes it on the same commit (GraphQL, 1 point) | Fire on the change to failing, for that commit | Near free |
| An issue gets a label, on GitHub | Issues by label, updated since the watermark (REST with an ETag), and the issue's timeline for who put it on | Watermark with an overlap; key (issue, label, when it was seen put on) | Near free |
| An issue gets a label, on Linear | `issues(filter: {labels, updatedAt > watermark})` | Slow and narrow: Linear "especially discourage[s] polling" | Complexity points |
| A pull request opened or merged, not by Althar | Open or recently closed pull requests, updated since | As above | Near free |

- **Ruled out: GitHub's Notifications API.** It would be ideal (review
  requests, `X-Poll-Interval`, free 304s), but "these endpoints only support
  authentication using a personal access token (classic)", and Althar signs
  in with a GitHub App. **The Events API** is "anywhere from 30s to 6h" late,
  keeps 300 events or 30 days, and has no checks.
- **Conditions, not edges.** Compare the state ("main's head fails at this
  commit") rather than replaying every event; it survives gaps.
- **Each trigger says what its version is.** For a condition, it is when
  Althar saw it become true: it fires once while it holds, and again only
  once it was seen not to. A review asked again after the person reviewed
  fires again; one asked again while still asked doesn't. A label taken off
  and put back between two polls fires nothing new, unless the timeline is
  read. Checks on main are keyed by the commit, so a rerun that fails again
  fires nothing new.
- **Nothing fires for what was already there.** Turning one on sets its own
  start to that moment. The card can offer "Include what's open now", which
  Try it once now uses.
- **After Althar was closed:** catch up from the watermark within a day,
  coalesced by subject (a pull request whose checks failed three times fires
  once, on its latest state). Older is "missed": Superset's code says "a run
  fired for a day-old event is worse than none".
- **Still wanted?** Right before its task starts, an occurrence checks its
  subject again: still open, still failing, still asking. If not, it is
  skipped as no longer needed. It checks the automation too: still on, and
  still at the revision it fired with. The task keeps the version it was
  admitted at, as a review already reads the head its lead was given.
- **One budget, shared.** The person's 5,000 requests an hour on GitHub are
  shared with Althar's listening to pull requests and with the agents' own
  `gh` calls. So: one poller a repository and source, shared by every
  automation; ETags kept on disk with the answer they stand for (today both
  are in memory and lost at each restart, `http.ts:224`); backoff with
  jitter and a queue for each connection, which
  [06](../architecture/06-integrations-and-skills.md) asks for and isn't
  built. The poller's cursor is shared, and each automation's start is its
  own: what a poll found becomes every automation's occurrences in the
  transaction that moves the poller on, so neither runs ahead of the other.
- **What the connectors lack:** a branch's head commit; a tracker query by
  label and by updated-since; "opened since" on `listChanges`, and paging;
  an issue's timeline, for when a label went on and who put it there
  (`Issue` has its labels and `updatedAt`, nothing more).
- **Not its own echo.** Runs act with the person's own token, so "ignore our
  bot" can't work. Althar keeps what it did outward, in three places today:
  receipts for opening, marking ready, merging, closing and replying, and
  for moving issues (`mutation_receipts`); the commits it pushed
  (`repository_changes`); and the reviews it posted (`review_drafts`). The
  guard reads all three, and counts the checks a push of Althar's started as
  Althar's too: an automation never fires on what Althar did unless it says
  so, and fires at most a few times an hour (claude-code-action reacted to
  its own replies; another issue there asks for a guard against "denial of
  wallet").
- **Webhooks need a relay we run.** A GitHub App has one webhook address,
  so it takes a server: GitHub App webhooks to a Worker and a Durable Object
  for each person, then a WebSocket to the desktop. GitHub says
  `gh webhook forward` and smee.io are not for production. GitHub doesn't
  redeliver a failed delivery (three days, by hand), so the desktop still
  catches up by polling after a gap. Minutes become seconds; not needed for
  the first version.

## With nobody there: what a run may do

**Turning an automation on approves that exact request:** its prompt, its
ending, its subjects ([07](../architecture/07-persistence-security-and-cloud.md),
"Approval integrity"). Whether new words narrow or widen can't be told, so
any change to its prompt, its lead (agent, model, account), how often it
runs, its review, its ending or its subjects needs the person to turn it on
again. Only a tighter limit doesn't: fewer runs a day, a shorter time.

The person's call (5 and 6) is that a run goes ahead on its own, mostly,
and signs what it does. So:

- **Its task allows everything** ([ADR-043](../decisions/043-allow-everything-is-one-switch-for-a-project-or-a-task.md)'s
  switch for a task, on from the start), and no permission ask stops a run
  at night. The automation's page has the switch, on by default; off, the
  project's rules apply, and an ask waits in Needs you, its place going
  after the 5 minutes an asking agent already keeps it (`Busy.ts:186`).
- **Pushing to the default branch is never allowed** in a run, whatever the
  switches say: the run's rules add it to what they never allow, which
  allow everything doesn't go past
  ([ADR-013](../decisions/013-project-rules.md)'s order). Then, as for any
  rules that never allow something, a command the rules can't read (`eval`,
  `$(…)`) is refused with how to spell it out. Merging was never an
  agent's: `gh pr merge` and every other write to the code host are refused
  in any mode (`hostReason` in `rules.ts`).
- **Outward steps stay Althar's,** as today. Althar pushes and opens the
  pull request at the end of a run, as the automation's ending says: ready
  for review, or a draft. It replies on the pull request when the lead asks
  it to (`reply_on_pull_request`), and files an issue only when the person
  does. This is GitHub's "safe outputs" design (the agent proposes, a
  separate trusted step writes, with a cap for each kind), and Althar
  mostly has it. One tool ordinary leads have is taken away:
  `set_run_command`, since what it keeps runs in every next task's setup as
  Althar's own process, outside the sandbox
  ([ADR-023](../decisions/023-althar-runs-the-project.md)).
- **Signed, with the automation's name.** Althar already signs the reviews
  and replies it posts ("From Althar, by Claude Code", `signed` in
  `pullRequestWords.ts`). An automation's say whose: "From Althar's morning
  review, by Claude Code". So does the description of a pull request it
  opens.
- **A review asks once.** An automation's first review waits in Needs you
  as a drafted review, with Post and "Post this automation's reviews from
  now on". Chosen, its later reviews post themselves, and the page shows it
  as a switch the person can turn off. A review of a pull request from
  outside the team always waits, as it does today. The existing "Post
  reviews of my team's pull requests without asking" doesn't reach an
  automation, and posts from inside the drafting tool today
  (`Reviews.ts:876`), so an automation's review needs its own check there.
- **A review stays a reader,** whatever the switch: its lead only reads, in
  its read-only copy, as any review's does (`decideReader` in `rules.ts`).
- **Try it once now runs it as it would run,** before it's on, so the
  person sees what it ends in.
- **What came from outside is data.** An event's text (an issue's body, a
  pull request's title) goes into the brief quoted, marked as from outside,
  as Claude's routines wrap theirs. With every ask allowed, this is what
  keeps a stranger from steering a run: events from people GitHub doesn't
  name as the repository's own fire nothing by default; allowed, the run is
  a reader (no network, runs nothing), as a review of an outside pull
  request already is (call 7). Who counts is whoever made it happen: who asked the review,
  who put the label on, who opened the pull request. A teammate's label on
  an outsider's issue fires, and the issue's text is still quoted as from
  outside. A schedule's subject query takes the same test, and where the
  connector can't say who, nothing fires. A review is a reader whoever opened
  the pull request, and its review waits for the person, so the morning
  review can take outside pull requests as it is.
- **A run can't make automations.** Leads get no automation tools. Codex's
  runaway was a heartbeat an agent made for itself, re-sending a 4.36M-token
  thread every 10 minutes. Nor can what the coordinator reads: a lead's
  report or a pull request's text can't get it to resume one or run it now,
  since both go on a card (call 9).

## Capacity, cost and the morning after

- **Places:** a new order, `automation`, after `new`
  ([ADR-037](../decisions/037-what-the-person-does-goes-first.md),
  `Busy.ts:76-82`), so nothing of the person's waits behind an automation.
  It holds for every step of the task, not only its first: today the step
  after another, a step carried on after a restart and one back from a
  usage limit are all `underway` (`orderOf` in `Runs.ts`), ahead of the
  person's new work. The task carries its occurrence, so each of its steps
  waits as `automation`. One place for automations at most, by default; never
  over the number, which only the person's own work may go over. That is a
  count of an automation's agents at work, not a rank: a rank only says who
  goes first.
- **A deadline to start:** an occurrence that can't start inside its window,
  because the computer was busy all day, is skipped and says so ("the computer was
  busy"), not queued for ever.
- **Plans (Claude Max, ChatGPT Pro):** Althar can't read how much of a plan
  is left; it learns of a limit only from the agent's error
  (`failures.ts`). What keeps the person's morning safe is therefore:
  - a time limit for each run (45 minutes of its agents' work by default),
    counted on the occurrence over all its steps, its review and its check
    fixes (up to three,
    [ADR-040](../decisions/040-a-change-reaches-the-person-green.md)), since
    the stall watch starts its budget whole at each step (`fresh` in
    `Stalls.ts`);
  - a turn budget lower than the stall watch's 6 hours and 40 turns
    (`Stalls.ts:71-72`), counted the same way;
  - runs a day, capped for each automation and for all of them together,
    Run now and catch-ups included;
  - on a usage limit, an automation never moves to another account or agent
    (the project's rule may `move` a task's work): it stops, and says so.
- **Per-use models (an API key, OpenRouter):** today work never moves to
  another agent's paid account unasked (`Limits.ts:97`), but an agent's own
  accounts take over whatever pays for them
  ([ADR-012](../decisions/012-several-accounts-per-agent.md)), and the
  permission judge spends the coordinator's account. An automation on one
  needs a cap per run and per month, and that needs cost accounting Althar
  doesn't have: tokens are kept per turn (`turn_deliveries.usage`), money
  only for the permission judge. **First version: plan accounts only,** as
  a check of its own: an automation's lead and reviewer start only on an
  account a plan pays for, and its asks are judged only on one, else they
  wait for the person. OpenCode always says a key, so it leads no
  automation at first. Per-use comes with cost accounting (`runs.budget` is
  already in the schema, unused).
- **Each run's worktree is its task's,** as for any task
  ([ADR-006](../decisions/006-worktree-per-task.md), call 13): a new task
  makes a worktree and runs its setup, installing what the lockfile names
  ([ADR-023](../decisions/023-althar-runs-the-project.md)), which takes
  minutes and gigabytes for a JavaScript project. Thirty nightly runs make
  thirty worktrees. No rule of automations' own removes them: the clean-up
  of finished task folders that is coming (DEV-143) does, for every task
  alike, a review's soonest. Until it ships, this is the easiest place for
  automations to quietly fill a disk.

## Failures, and what reaches the person

| Mark | Meaning |
|---|---|
| Made something | A pull request, a review (drafted, or posted), a held plan, a report |
| Nothing to do | Its query found nothing, so no task; or its lead looked and found nothing, and its task settled out of sight |
| Failed | Its task stopped without finishing, or Althar couldn't start one: a query or a connector failed |
| Missed | The computer was asleep or Althar closed, past its window |
| Skipped | Paused, busy past its deadline, still running, or no longer needed |
| Running | Its task is under way |

- **Status is the outcome, not "started".** Superset's runs end at
  `dispatched`, and a green routine in Claude "does not mean the task…
  succeeded"; both left people with silent failures.
- **Quiet by default.** Runs show in the tab. The tasks they make show on
  the board as any task does: a review waiting to be posted waits in Needs
  you. A query
  that found nothing makes no task and no notification. A lead that found
  nothing has a task, since a lead only runs in one, and a plan posts its
  card in the conversation when proposed (`Plans.ts:168`). So a run's card
  goes on the automation's page instead, and a task that found nothing
  settles as done, stays in the automation's history, and never reaches the
  board.
- **Three failures in a row pause it,** with one call in Needs you saying
  why and what to do (Run it now, Change it), and no notification for each
  failure. Factory pauses after five failures or ten days missed, Zapier at
  95% errors over seven days. A failure is an occurrence that failed once
  its own tries were spent: its task failed, or its query did. Nothing to
  do and made something end the streak; skipped and missed leave it as it
  was. A slot with several subjects counts once, as failed only if all of
  them did.
- **What expires pauses it, with the reason:** a model gone, a repository
  left out, a connection signed out. Claude's routines turn off after 72
  hours without GitHub, rather than failing every night.
- **After a restart,** an occurrence admitted with no task yet starts once
  the runtime has reconciled, if still in its window; one that names its
  task carries on as any task does.
- **One switch stops everything:** "Pause all automations", in the quick
  settings and the tab's menu. Removing a project pauses its automations.
  Runs under way finish; each can still be stopped from its card (call 15).

## Where they live

- **In Althar's database, the person's own, not as files in the
  repository.** An automation spends this person's plan and acts as them. A
  file in the repository would fire on every teammate's computer, and every pull
  request would get two reviews. Automations for a team need one runner,
  which means the cloud.
- **On the computer they were made on.** Each names its device, so two computers
  never both run it: cheap now, and what a lease needs later. Device-only data
  stays in device-keyed tables, as the schema rules ask.
- **Later, perhaps, as a file to share:** `.althar/automations/<name>.md`, a
  template a teammate imports and turns on for themselves, like gh-aw's
  markdown without running by itself.

A sketch of the tables, following the schema rules (vocabularies as lookup
tables, a revision on every row that changes, the project in every key):

```text
automations              id, project_id, device_id, name, state (on | paused),
                         paused_by (person | itself), pause_reason, since, revision
automation_revisions     automation_id, project_id, revision, prompt,
                         lead (agent, model, effort), review, ending,
                         trigger (rule and zone, or event kind and filters),
                         limits (window, overlap, time, runs a day),
                         made_by (person | coordinator), made_at
automation_occurrences   id, automation_id, project_id, automation_revision,
                         cause (schedule | event | now), slot, subject_key,
                         subject_version, state, outcome, reason, task_id, revision
                         unique (automation_id, slot) for a schedule
                         unique (automation_id, slot, subject_key) for a schedule's subjects
                         unique (automation_id, subject_key, subject_version) for an event
automation_cursors       connection, repository, source → watermark, etag, answer, polled_at
                         (shared by every automation that reads it)
```

References between them are composite, `(id, project_id)`.
`automation_revision` is the definition an occurrence ran with; `revision`
is the occurrence's own, as its state moves. `since` is when it was turned
on, which events count from.

Facts in the record: `automation.created`, `automation.changed`,
`automation.paused`, `occurrence.fired`, `occurrence.skipped`. Subjects are
keyed by the host's numeric ids, not names: Superset does this "so a rename
must not change the key", and renaming a repository silently breaks
Cursor's automations.

**The coordinator's tools:** `propose_automation` (a card; nothing runs until
Turn on), `change_automation` (a card with what changed; widening needs Turn
on again), `list_automations`, `read_automation`, `pause_automation`,
`resume_automation`, `run_automation_now`. Pausing needs no card, since it
only stops. Resuming and Run now go on a small card (call 9): both spend,
and the coordinator reads what leads report and what pull requests say. Run
now keeps every limit a fire has. Leads get none of them.

## The cloud

For the build, the cloud barely matters yet; for the shape, it does. What
is kept now costs nothing and keeps the way open:

| Kept now | Why it matters later |
|---|---|
| An occurrence is a record with an idempotency key, made by whoever noticed | A server can write occurrences in place of the computer, and dedupe still holds |
| Starting an occurrence's task is a step of its own | It becomes a lease to a device, with a fencing token ([07](../architecture/07-persistence-security-and-cloud.md), local runner leases) |
| Definitions hold no paths, and name their device | They can sync; the device is the runner's claim |
| Triggers and schedules are data, with a zone | A server can evaluate them |
| Outward steps are Althar's, through its connectors | The same in a run anywhere |

Then three steps, each a decision of its own:

1. **A relay for webhooks,** the smallest cloud. Seconds instead of minutes,
   and still a catch-up by polling after a gap. It takes an Althar account
   and a service to run: operations, security, and payloads passing through
   Althar's server.
2. **A clock in the cloud, and leases to devices.** It fires on time and
   offers the run to whichever of the person's computers is up; with two,
   one runs it. It still needs a computer awake.
3. **Runs in the cloud.** Agents in cloud machines: a clone every run, setup
   baked into an image, secrets through a proxy, a network allowlist. Plans
   like Claude Max are for the person's own use on their own machine, so
   these runs pay per use; architecture 03 already says running on a plan
   stays on the device. The screens barely change: the card gains "Runs on:
   this computer or Althar's cloud", and the page stays. What a run can do
   changes: nothing runs on the computer, and results come back only as branches
   and pull requests.

Superset, Claude's routines, Cursor and Copilot went to the cloud first for
automations, because events and always-on are free there. Factory and
Claude Code's desktop tasks show that local works for schedules. **The
person's roadmap (call 12):** this computer only now; the relay later, with an
Althar account; then runs in the cloud, as a product of their own, paid per
use, with the clock and leases coming with them. Nothing in the first
version waits on either.

## Testing it

- **The clock:** Effect's `TestClock` for each schedule: both daylight
  saving days, a week asleep, a 2:00 run on waking at 8:52, a change of zone,
  five automations due at once.
- **Sleep:** a fake power source in the runtime (wake, unlock, dark wake), so
  the catch-up policy is tested in units, not on a laptop.
- **Events:** fake connectors with scripted timelines (a review requested,
  requested again, closed; checks failing three times; a label taken off
  and put back), asserting one occurrence for each subject and version, with
  a restart in the middle, and one between making a task and its
  occurrence naming it.
- **Queries:** a listing with more than its cap, and one that fails, so the
  next slot still finds what they left.
- **Rules:** an automation's run with every switch on, where a push to the
  default branch is still refused, and a review's lead still only reads.
- **Reviews:** an automation's first review waits; told to post from now
  on, the next posts, signed with its name; one of an outsider's pull
  request still waits.
- **A soak:** thirty nightly fires against the fakes: the board stays calm,
  the disk bounded, no duplicates.
- **Real accounts on demand,** one end-to-end run for each trigger, as the
  integrations do.
- **Measures:** lag from due to start, missed and skipped by reason,
  duplicates refused, polls and 304s an hour, what runs did that would
  have asked.

## In what order

1. **Schedules and Althar's own events, on this computer.** The tab, the page,
   the card, the coordinator's tools; occurrences and their keys; catching
   up once; the still-wanted check, since four reviews in one place start
   one after another, and a pull request can merge while its review waits;
   who may trigger, for a query's subjects; one place, for every step; time
   limits over all of a run's steps; pausing itself; plan accounts only,
   checked; a new task each time, with at most five pull requests open;
   allow everything for a run's task, with the default branch never; signed
   outward steps; a review that asks once, then posts if told to; open at
   login, offered the first time a schedule is turned on. That covers
   release notes, the nightly bump, the weekly polish and flaky sweeps, and
   the morning review, a schedule with a pull request query.

   **Built** ([ADR-057](../decisions/057-automations-start-ordinary-tasks-on-a-schedule.md)):
   schedules (days at a time, or hourly), the three tables, the clock with
   catching up once and missing past the window, one place after the
   person's work for every step, a run's minutes over its turns, the skips
   (still going, all paused, five pull requests open, 24 a day, per-use
   agents), pausing itself after three failures, allow everything with the
   default branch never, signed reviews and pull requests, the review that
   asks once, the coordinator's six tools with their cards, and the tab, the
   page and the card. **Still to build of it:** Althar's own events (a
   task's pull request merged, checks failed on it), the still-wanted check
   (Reviews refuses a pull request no longer open, and a task reviewing it
   already, but nothing looks again at a run's own task while it waits), a
   Needs you call when one pauses itself (the tab says it, violet), and a
   wake signal from main's `powerMonitor` (the clock notices a sleep within
   its 30-second look).
2. **Events polled from GitHub:** review requested, checks failing on main,
   a label added, a pull request opened or merged; shared pollers with
   their cursors, ETags and answers kept on disk; who may trigger, for
   labels, from the issue's timeline.
3. **Carrying on the open one:** the follow-up round Althar opens, for a
   change automation set to carry on its pull request (call 4).
4. **More trackers, and paying per use:** Linear and GitLab triggers;
   per-use models with caps, once cost is counted.
5. **The cloud:** the relay, then runs in the cloud with the clock and
   leases, each a product step of its own (call 12).

## What was decided

Asked of the person on 21 October 2026. Five calls were theirs. The other
ten, and the word "run", are taken where Claude Code, Codex, Cursor, Orca
and Superset agree, as the person asked; the numbers are the proposal's.

The person's:

- **4. A new task each time, or the open one carried on:** a choice on the
  automation, a new task each time by default. Carrying on, for a change
  automation whose pull request is still open, comes after the first
  version. A review automation makes one review for each pull request,
  since a review in Althar is of one pull request; a report is one task.
- **5. What it may do with nobody there:** mostly anything, signed with the
  automation's name. Pull requests as its ending says, replies on them,
  never a merge. Its first review waits for the person, who can let its
  next ones post by themselves.
- **6. Permission asks at night:** they don't stop a run. Its task allows
  everything, on by default and switchable on its page; pushing to the
  default branch is never allowed, and allow everything doesn't go past
  that.
- **12. The cloud:** this computer only now; a relay for GitHub's webhooks later,
  with an Althar account; then runs in the cloud, a product of their own,
  paid per use.
- **13. A run's worktree:** its task's own, as any task's. The clean-up of
  finished task folders that is coming (DEV-143) removes them, as it does
  every task's.

Taken where the other tools agree:

- **1. While Althar is closed:** automations run while Althar runs, windows
  or not, with an opt-in "Open Althar at login, in the background"; no
  daemon. Claude Code's desktop tasks, Codex and Orca run only while their
  app is open.
- **2. A run the computer slept through:** once on waking, within its window,
  said in its history. Claude's desktop tasks run "exactly one catch-up run
  for the most recently missed time"; Orca keeps a window for each
  automation, 12 hours by default.
- **3. What a fire does:** Althar starts the kept plan; the coordinator
  isn't asked. Every one of them works this way.
- **7. Events from outside the team** fire nothing by default; allowed, the
  run only reads. claude-code-action and GitHub's agentic workflows do the
  same, and with every ask allowed it matters more.
- **8. The limits by default:** one place for automations; at least an hour
  apart; 45 minutes of work a run, over all its steps; a cap on runs a day
  for all automations together; on a usage limit, stop rather than move;
  plan accounts only at first, which leaves OpenCode out; at most five of
  an automation's pull requests open, Dependabot's limit.
- **9. The coordinator's reach:** it pauses one in words; resuming and Run
  now go on a small card, since both spend and the coordinator reads text
  from outside. Any other change is on a card.
- **10. Where they live:** in Althar, the person's own, on the computer they were
  made on; no files in the repository. Claude's desktop tasks and Orca keep
  theirs on the machine that runs them.
- **11. Rules for what needs no agent,** such as closing an issue when its
  pull request merges. GitHub already closes an issue a merged pull request
  names, and Linear moves its own.
- **14. 9:00 where the person is,** in the computer's zone of the moment. Claude
  uses the local time; Orca the computer's, unless a zone is pinned.
- **15. Pause all** stops only what would start; runs under way finish.
  Cursor cancelling running work is what its users complain about.

**"Run" joins the glossary** for automations, when the tab ships: a run is
one time an automation fired, and the task it started. Every one of the
other tools says Run now and runs.

## Still to find out

- **What a run costs.** How much of a plan does a week of the morning review
  and the nightly bump use, on the person's own projects? Measure before
  fixing the defaults.
- **What would have asked.** With every ask allowed, count what each run did
  that the project's rules would have asked about, and whether never
  pushing to the default branch is the only floor it needs.
- **Unattended, agent by agent.** Do Claude Code, Codex and OpenCode each run
  inside the rules over ACP with nothing interactive Althar can't answer?
  Codex can't ask before a command its sandbox contains, which is why it
  leads no review of someone else's pull request.
- **Disk.** How big is a worktree with its install on the person's
  projects, and how fast do an automation's worktrees add up?
- **GitHub's budget.** Projects × repositories × pollers, against 5,000 an
  hour shared with the agents' `gh`, measured on the person's account.
- **Timers at wake.** Does an overdue timer fire at wake or late, on a real
  computer, on each system? The design looks again on wake either way. And
  does `resume` fire for a Mac's dark wake?
- **Review fatigue.** In dotnet/runtime, 44% of the agent's closed pull
  requests were drafts nobody reviewed. How many open automation pull
  requests are too many? Five for each automation, to begin with.
- **Two computers, travel, holidays.** Does the person use more than one?
  Should there be "Pause all until Monday"?

## Sources

What other products do:

- Superset, read from its source (`apps/api/src/app/api/automations/`,
  `packages/trpc/src/router/automation/dispatch.ts`,
  `packages/shared/src/automation-matching/github.ts`), and
  [its docs](https://github.com/superset-sh/superset).
- Claude Code: [routines](https://code.claude.com/docs/en/routines),
  [desktop scheduled tasks](https://code.claude.com/docs/en/desktop-scheduled-tasks),
  [GitHub Actions](https://code.claude.com/docs/en/github-actions); issues
  [#51120](https://github.com/anthropics/claude-code/issues/51120),
  [#73927](https://github.com/anthropics/claude-code/issues/73927),
  [#76340](https://github.com/anthropics/claude-code/issues/76340);
  claude-code-action
  [#794](https://github.com/anthropics/claude-code-action/issues/794),
  [#1481](https://github.com/anthropics/claude-code-action/issues/1481).
- Codex: [scheduled tasks](https://learn.chatgpt.com/docs/automations.md?surface=app);
  issues [#24327](https://github.com/openai/codex/issues/24327),
  [#34794](https://github.com/openai/codex/issues/34794),
  [#45070](https://github.com/openai/codex/issues/45070),
  [#47037](https://github.com/openai/codex/issues/47037),
  [#51239](https://github.com/openai/codex/issues/51239).
- Cursor: [automations](https://cursor.com/docs/cloud-agent/automations);
  [runs cancelling each other](https://forum.cursor.com/t/cursor-automation-push-to-main-runs-are-being-cancelled-by-new-runs-instead-of-running-concurrently/163778).
- GitHub: [Copilot automations](https://docs.github.com/en/copilot/concepts/agent-capabilities/agent-powered-workflows-and-operations/about-automations),
  [gh-aw safe outputs](https://github.github.com/gh-aw/reference/safe-outputs/),
  [ten months of the coding agent in dotnet/runtime](https://devblogs.microsoft.com/dotnet/ten-months-with-cca-in-dotnet-runtime/).
- [Devin](https://docs.devin.ai/product-guides/automations),
  [Factory](https://docs.factory.com/web/automations.md),
  [Zapier's dedupe](https://docs.zapier.com/platform/build/deduplication),
  [Kubernetes CronJob](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/).

The platform:

- Electron [`app`](https://www.electronjs.org/docs/latest/api/app),
  [`powerMonitor`](https://www.electronjs.org/docs/latest/api/power-monitor),
  [`powerSaveBlocker`](https://www.electronjs.org/docs/latest/api/power-save-blocker);
  Apple [`SMAppService`](https://developer.apple.com/documentation/servicemanagement/smappservice),
  [App Nap](https://developer.apple.com/library/archive/documentation/Performance/Conceptual/power_efficiency_guidelines_osx/AppNap.html),
  `IOPMLib.h`, `man launchd.plist`.
- GitHub [REST best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api),
  [rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api),
  [notifications](https://docs.github.com/en/rest/activity/notifications),
  [events](https://docs.github.com/en/rest/activity/events),
  [search](https://docs.github.com/en/rest/search/search),
  [GraphQL limits](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api),
  [failed deliveries](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries),
  [`gh webhook forward`](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/using-the-github-cli-to-forward-webhooks-for-testing).
- [Linear rate limits](https://linear.app/developers/rate-limiting),
  [Jira webhooks](https://developer.atlassian.com/cloud/jira/platform/webhooks/),
  [GitLab to-dos](https://docs.gitlab.com/api/todos/),
  [Cloudflare Durable Objects and WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).
