# Automations

> **A proposal, not yet a plan.** How automations could be built, what each
> way costs, and the calls that are the person's. Written on 19 October 2026,
> after the prototype (the Automations tab, as cards, each automation on its
> own page) was picked and thrown away. Once the calls at the end are made,
> this becomes the build plan; what lasts moves into the architecture docs
> and ADRs, and this file is deleted when the last step ships.

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
- **It runs on this Mac, in the runtime, while Althar runs.** On a Mac,
  Althar already keeps running with every window closed. Add one opt-in,
  "Open Althar at login, in the background". No daemon, and no waking the
  Mac, which needs root. A run missed while the Mac slept runs once when it
  wakes, inside a window; never a backlog.
- **Events come from three places, cheapest first:** Althar's own record (a
  task's pull request merged), then polling what the connectors already read
  (with conditional requests, free when nothing changed), and later webhooks
  through a small relay in the cloud.
- **A run can do no more than the person, and less by default.** Althar
  takes every outward step itself, as it does today: a draft pull request, a
  drafted review, a held plan. It never merges. A run that would ask the
  person parks in Needs you without holding a place. Events from outside the
  team fire nothing by default.
- **Small by construction:** one place for automations at most, after the
  person's own work; a time limit a run; at least an hour between runs;
  three failures in a row pause it; a run that found nothing leaves no card.
- **Ready for the cloud without building it.** The occurrence is a record
  with an idempotency key, whoever noticed the trigger; starting its task is
  a step of its own that could be leased to a device. Moving the clock or the
  webhooks to a server later swaps one part, not the model. Running agents in
  the cloud is a different product, and a separate decision.
- **Twelve calls are the person's**, at the end, each with what I'd pick.

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
  Mac slept. It is the history the page shows, and the unit of dedupe:
  `(automation, slot)` for a schedule, `(automation, subject, version)` for
  an event, unique in SQLite and written before anything starts. Every
  product that does this well lands here: delivery is at least once, so
  dedupe at the record (Superset's partial unique indexes, Kubernetes'
  "jobs should be idempotent").
- **The task** is unchanged, and carries the occurrence that started it.
  Its kind is read from what it has
  ([ADR-035](../decisions/035-a-task-s-kind-is-read-from-what-it-has.md)): a
  review automation makes review tasks, a nightly bump makes changes, a sweep
  that only reports makes plain tasks.

Keeping the occurrence apart from the task buys three things: a run that
found nothing leaves no card; duplicates are refused by a constraint, not
by care; and it is the seam for the cloud, since whoever notices the trigger
writes occurrences and whoever has the repository starts the task.

An occurrence is marked started only once its task has started, not when it
was dispatched: Claude Code's desktop tasks wrote "last run" at dispatch,
dropped the run during startup, and showed it as done.

### Subjects: why the morning review is four tasks

Most triggers are about something: a pull request, an issue, a commit on
main. Althar reviews one pull request a task, with its read-only copy, its
reader rules and its drafted review. So "every weekday at 9, review the pull
requests opened since yesterday by anyone but me" is a schedule with a
**subject query**: at 9:00, list the open pull requests opened since the
last time, not by the person, and not reviewed by a task already, then start
one review for each. Four new pull requests make four review tasks, one
occurrence each, grouped under the automation.

The coordinator compiles the query from the person's words when it writes
the automation, and the card says it back in words: "Each pull request
opened since the last time, not yours, not reviewed yet". Where no query
fits, the subject is the project as a whole, and the lead does the choosing
in one task. The connectors mostly list with filters already (`listChanges`
takes an author, review requested and draft); "opened since" is missing.

### Who decides what a fire does

| | Althar starts the kept plan | The coordinator is told it's time, and decides |
|---|---|---|
| How | Fire → occurrences → tasks, through the commands `propose_plan` and `review_pull_request` use | Fire → a quiet message to the coordinator (`say` with `quiet` exists) → its tools |
| Same every time | Yes; dedupe at the record | Varies by turn; dedupe by its tools' command ids |
| Cost | No model until a task starts; "nothing to do" is free | A coordinator turn every fire, nothing to do or not |
| When it breaks | A query or connector fails: the occurrence says why | A coordinator that can't start (out of usage, signed out) misses everything, quietly |
| The person's conversation | Untouched | A machine's message in it every morning |
| Judgement | Inside the task, by its lead | At once: "only the ones that touch the runtime" |

**I'd pick Althar starting the kept plan.** The coordinator's judgement is
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
| **5. A clock in the cloud, the Mac's hands** | On time even with the Mac off; runs when a Mac is up | An Althar account, a server, leases to devices ([07](../architecture/07-persistence-security-and-cloud.md)) | A cloud product; the run still needs a Mac awake |
| **6. Hands in the cloud too** | Always | Cloud machines, clones, secrets, pay-per-use agents | A different product (see The cloud) |

**I'd pick 1 now, with 2 offered** the first time a scheduled automation is
turned on, and 3 to 6 not now. Option 1 is close to free: on a Mac, closing
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
  (screen unlocked, `unlock-screen`) or after the Mac has been up for a few
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
  Call 2 decides.

So the promise on screen is honest: "Runs on this Mac while Althar is open.
If the Mac is asleep at 2:00, it runs when it wakes, until 14:00."

## Schedules

- **Kept as a rule and a zone:** a small RRULE (how often, which days, what
  time) and an IANA zone, said in words on the card. The coordinator turns
  the person's words into the rule. At least an hour apart: Claude's
  routines hold an hour, and an agent-made automation every ten minutes is
  how Codex users spent a month's allowance in a day.
- **9:00 where the person is.** Keep the zone, but read the time in the
  Mac's zone of the moment, as Calendar's floating times do, so travelling
  doesn't move the morning review to 3:00. The zone is still kept, for a
  server that has none.
- **Daylight saving:** a 2:30 that doesn't exist runs at 3:30 (Temporal's
  `compatible`); a 1:30 that happens twice runs once, the first time.
- **The next slot comes from the last slot, not from now** (Superset
  advances from the previous `next_run_at`), so a late run doesn't drift the
  schedule.
- **Staggered:** each automation starts a fixed few minutes after its time,
  from a hash of its id, so nine automations at 9:00 don't start at once and
  nothing hammers the hour (GitHub, Claude's desktop tasks, gh-aw do the
  same).
- **Missed:** once, if still within a window (half its period, at most 12
  hours: a nightly 2:00 still runs at 8:52, a weekday 9:00 review still runs
  at 14:00, an hourly one doesn't catch up), otherwise "missed", said in its
  history. Never every slot it missed: launchd and systemd coalesce to one,
  Claude's desktop tasks run "exactly one catch-up run for the most recently
  missed time", and Codex's replayed eight runs in 21 minutes.
- **The run is told when it was due:** a run due at 9:00 that starts at
  14:00 says so in its brief ("this was due at 9:00; it is 14:00").
- **Overlap:** while its last run still runs, the next is skipped (Kubernetes'
  `Forbid`), never replaced: Cursor cancels the run under way, and people
  lose work to it. A change automation whose last pull request is still
  open continues that task with a follow-up round rather than opening
  another, as a dependency bot updates its one pull request (call 4).
- **Catch-ups at launch go one at a time,** after the person's own work, so
  waking doesn't start everything at once (Claude Code issue #51120).

## Events

| Trigger | Where it comes from | How | Cost |
|---|---|---|---|
| A task's pull request merged or closed; a task finished; checks failed on a task's pull request | Althar's own record (`record_events`) | Tail the record by cursor, as `Nudges` and `UsageData` do | Free, at once |
| Someone asks the person's review | The host's list of open pull requests with `reviewRequested` (`listChanges`, exists), or search `user-review-requested:@me` | One poll a repository every few minutes, shared by every automation | A few dozen requests an hour a repository |
| Checks fail on main | Main's head commit (REST with an ETag: free when unchanged), then `statusCheckRollup` when it moved or is pending (GraphQL, 1 point) | Fire on the change to failing, for that commit | Near free |
| An issue gets a label, on GitHub | Issues by label, updated since the watermark (REST with an ETag) | Watermark with an overlap; key (issue, label, when labelled) | Near free |
| An issue gets a label, on Linear | `issues(filter: {labels, updatedAt > watermark})` | Slow and narrow: Linear "especially discourage[s] polling" | Complexity points |
| A pull request opened or merged, not by Althar | Open or recently closed pull requests, updated since | As above | Near free |

- **Ruled out: GitHub's Notifications API.** It would be ideal (review
  requests, `X-Poll-Interval`, free 304s), but "these endpoints only support
  authentication using a personal access token (classic)", and Althar signs
  in with a GitHub App. **The Events API** is "anywhere from 30s to 6h" late,
  keeps 300 events or 30 days, and has no checks.
- **Conditions, not edges.** Compare the state ("main's head fails at this
  commit") rather than replaying every event; it survives gaps.
- **Nothing fires for what was already there.** Turning one on sets its
  watermark to that moment. The card can offer "Include what's open now",
  which Try it once now uses.
- **After Althar was closed:** catch up from the watermark within a day,
  coalesced by subject (a pull request whose checks failed three times fires
  once, on its latest state). Older is "missed": Superset's code says "a run
  fired for a day-old event is worse than none".
- **Still wanted?** Right before its task starts, an occurrence checks its
  subject again: still open, still failing, still asking. If not, it is
  skipped as no longer needed.
- **One budget, shared.** The person's 5,000 requests an hour on GitHub are
  shared with Althar's listening to pull requests and with the agents' own
  `gh` calls. So: one poller a repository and source, shared by every
  automation; ETags kept on disk (today they are in memory and lost at each
  restart, `http.ts:224`); backoff with jitter and a queue for each
  connection, which [06](../architecture/06-integrations-and-skills.md)
  asks for and isn't built.
- **What the connectors lack:** a branch's head commit; a tracker query by
  label and by updated-since; "opened since" on `listChanges`.
- **Not its own echo.** Runs act with the person's own token, so "ignore our
  bot" can't work. Althar keeps a receipt of every outward step it takes
  (`mutation_receipts`): an automation never fires on what Althar did unless
  it says so, and fires at most a few times an hour (claude-code-action
  reacted to its own replies; another issue there asks for a guard against
  "denial of wallet").
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
"Approval integrity"). A change that widens any of them needs the person to
turn it on again; one that narrows doesn't.

- **Outward steps stay Althar's,** as today. Althar pushes and opens the
  pull request at the end of a run, posts a review only when the person does
  or `post_team_reviews` allows, and files an issue only when the person
  does. This is GitHub's "safe outputs" design (the agent proposes, a
  separate trusted step writes, with a cap for each kind), and Althar
  already has it. No automation gets a tool that writes outside the Mac.
- **A draft pull request as policy, not as a prompt;** at most one open pull
  request for each automation and subject; ready for review only where the
  person chose it. It never merges, and pushing to the default branch still
  always asks.
- **Permissions are the project's rules, as they are.** What would ask the
  person parks the run: its place goes after the 5 minutes an asking agent
  already keeps it (`Busy.ts:186`), and the task waits in Needs you with the
  automation named. Nothing widens for automations: they can't carry an
  allow-everything of their own (call 6).
- **Try it once now shows what it would ask.** Where the project's rules
  ask a lot, automations will mostly park; the trial says so ("it asked 3
  times") and points at the rules, before it's on. Claude Code's desktop
  tasks carry the trial's "always allow" over to later runs; Althar's
  Allow always already keeps a rule
  ([ADR-018](../decisions/018-allow-always-keeps-a-rule.md)).
- **What came from outside is data.** An event's text (an issue's body, a
  pull request's title) goes into the brief quoted, marked as from outside,
  as Claude's routines wrap theirs. Events from people GitHub doesn't name as
  the repository's own fire nothing by default; allowed, the run is a reader
  (no network, runs nothing), as a review of an outside pull request already
  is (call 7).
- **A run can't make automations.** Leads get no automation tools. Codex's
  runaway was a heartbeat an agent made for itself, re-sending a 4.36M-token
  thread every 10 minutes.

## Capacity, cost and the morning after

- **Places:** a new order, `automation`, after `new`
  ([ADR-037](../decisions/037-what-the-person-does-goes-first.md),
  `Busy.ts:76-82`), so nothing of the person's waits behind an automation.
  One place for automations at most, by default; never over the number,
  which only the person's own work may go over.
- **A deadline to start:** an occurrence that can't start inside its window,
  because the Mac was busy all day, is skipped and says so ("the Mac was
  busy"), not queued for ever.
- **Plans (Claude Max, ChatGPT Pro):** Althar can't read how much of a plan
  is left; it learns of a limit only from the agent's error
  (`failures.ts`). What keeps the person's morning safe is therefore:
  - a time limit for each run (45 minutes by default);
  - a turn budget lower than the stall watch's 6 hours and 40 turns
    (`Stalls.ts:71-72`);
  - runs a day, capped;
  - on a usage limit, an automation never moves to another account or agent
    (the project's rule may `move` a task's work): it stops, and says so.
- **Per-use models (an API key, OpenRouter):** today work never moves to a
  paid account unasked (`Limits.ts:97`). An automation on one needs a cap per
  run and per month, and that needs cost accounting Althar doesn't have:
  tokens are kept per turn (`turn_deliveries.usage`), money only for the
  permission judge. **First version: plan accounts only;** per-use comes with
  cost accounting (`runs.budget` is already in the schema, unused).
- **Each run's worktree:** a new task makes a worktree and runs its setup,
  installing what the lockfile names
  ([ADR-023](../decisions/023-althar-runs-the-project.md)), which takes
  minutes and gigabytes for a JavaScript project. Thirty nightly runs make
  thirty worktrees. Either keep one warm worktree for each automation, or
  remove a run's worktree once it settled with nothing to keep (nothing to
  do; merged; reviewed and posted). This is the easiest place for automations
  to quietly fill a disk.

## Failures, and what reaches the person

| Mark | Meaning |
|---|---|
| Made something | A pull request, a drafted review, a held plan, a report |
| Nothing to do | Its lead looked and found nothing; no task card |
| Failed | Its task stopped without finishing |
| Missed | The Mac was asleep or Althar closed, past its window |
| Skipped | Paused, busy past its deadline, still running, or no longer needed |
| Running | Its task is under way |

- **Status is the outcome, not "started".** Superset's runs end at
  `dispatched`, and a green routine in Claude "does not mean the task…
  succeeded"; both left people with silent failures.
- **Quiet by default.** Runs show in the tab. The tasks they make show on
  the board as any task does: a drafted review waits in Needs you. A run
  that found nothing makes no task and no notification.
- **Three failures in a row pause it,** with one call in Needs you saying
  why and what to do (Run it now, Change it), and no notification for each
  failure. Factory pauses after five failures or ten days missed, Zapier at
  95% errors over seven days.
- **What expires pauses it, with the reason:** a model gone, a repository
  left out, a connection signed out. Claude's routines turn off after 72
  hours without GitHub, rather than failing every night.
- **After a restart,** an occurrence admitted but not started starts once
  the runtime has reconciled, if still in its window; a task already started
  carries on as any task does.
- **One switch stops everything:** "Pause all automations", in the quick
  settings and the tab's menu. Removing a project pauses its automations.

## Where they live

- **In Althar's database, the person's own, not as files in the
  repository.** An automation spends this person's plan and acts as them. A
  file in the repository would fire on every teammate's Mac, and every pull
  request would get two reviews. Automations for a team need one runner,
  which means the cloud.
- **On the Mac they were made on.** Each names its device, so two Macs never
  both run it: cheap now, and what a lease needs later. Device-only data
  stays in device-keyed tables, as the schema rules ask.
- **Later, perhaps, as a file to share:** `.althar/automations/<name>.md`, a
  template a teammate imports and turns on for themselves, like gh-aw's
  markdown without running by itself.

A sketch of the tables, following the schema rules (vocabularies as lookup
tables, a revision on every row that changes, the project in every key):

```text
automations              id, project_id, device_id, name, state (on | paused),
                         paused_by (person | itself), pause_reason, revision
automation_revisions     automation_id, revision, prompt, lead (agent, model, effort),
                         review, ending, trigger (rule and zone, or event kind and
                         filters), limits (window, overlap, time, runs a day),
                         made_by (person | coordinator), made_at
automation_occurrences   id, automation_id, revision, cause (schedule | event | now),
                         due_at, subject_key, subject_version, state, outcome,
                         reason, task_id
                         unique (automation_id, due_at) for a schedule
                         unique (automation_id, subject_key, subject_version) for an event
automation_cursors       connection, repository, source → watermark, etag, polled_at
                         (shared by every automation that reads it)
```

Facts in the record: `automation.created`, `automation.changed`,
`automation.paused`, `occurrence.fired`, `occurrence.skipped`. Subjects are
keyed by the host's numeric ids, not names: Superset does this "so a rename
must not change the key", and renaming a repository silently breaks
Cursor's automations.

**The coordinator's tools:** `propose_automation` (a card; nothing runs until
Turn on), `change_automation` (a card with what changed; widening needs Turn
on again), `list_automations`, `read_automation`, `pause_automation`,
`resume_automation`, `run_automation_now`. Pausing, resuming and Run now
need no card (call 9). Leads get none of them.

## The cloud

For the build, the cloud barely matters yet; for the shape, it does. What
is kept now costs nothing and keeps the way open:

| Kept now | Why it matters later |
|---|---|
| An occurrence is a record with an idempotency key, made by whoever noticed | A server can write occurrences in place of the Mac, and dedupe still holds |
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
   offers the run to whichever of the person's Macs is up; with two Macs,
   one runs it. It still needs a Mac awake.
3. **Runs in the cloud.** Agents in cloud machines: a clone every run, setup
   baked into an image, secrets through a proxy, a network allowlist. Plans
   like Claude Max are for the person's own use on their own machine, so
   these runs pay per use; architecture 03 already says running on a plan
   stays on the device. The screens barely change: the card gains "Runs on:
   this Mac or Althar's cloud", and the page stays. What a run can do
   changes: nothing runs on the Mac, and results come back only as branches
   and pull requests.

Superset, Claude's routines, Cursor and Copilot went to the cloud first for
automations, because events and always-on are free there. Factory and
Claude Code's desktop tasks show that local works for schedules. **My read:**
local first is right for Althar, whose point is the person's own Mac and
plans. A relay is the likeliest first cloud piece, if review requests should
feel instant. Runs in the cloud only if Althar becomes a product for teams.

## Testing it

- **The clock:** Effect's `TestClock` for each schedule: both daylight
  saving days, a week asleep, a 2:00 run on waking at 8:52, a change of zone,
  five automations due at once.
- **Sleep:** a fake power source in the runtime (wake, unlock, dark wake), so
  the catch-up policy is tested in units, not on a laptop.
- **Events:** fake connectors with scripted timelines (a review requested,
  requested again, closed; checks failing three times), asserting one
  occurrence for each subject and version, with a restart in the middle.
- **A soak:** thirty nightly fires against the fakes: the board stays calm,
  the disk bounded, no duplicates.
- **Real accounts on demand,** one end-to-end run for each trigger, as the
  integrations do.
- **Measures:** lag from due to start, missed and skipped by reason,
  duplicates refused, polls and 304s an hour, runs that parked on a
  permission.

## In what order

1. **Schedules and Althar's own events, on this Mac.** The tab, the page,
   the card, the coordinator's tools; occurrences; catching up once; one
   place; time limits; pausing itself; plan accounts only; worktree cleanup.
   That covers release notes, the nightly bump, the weekly polish and flaky
   sweeps, and the morning review, a schedule with a pull request query.
2. **Events polled from GitHub:** review requested, checks failing on main,
   a label added, a pull request opened or merged; shared pollers with ETags
   kept on disk; who may trigger; the still-wanted check.
3. **In the background:** open at login; Linear and GitLab triggers;
   per-use models with caps, once cost is counted.
4. **The cloud, if and when:** the relay, then the clock and leases. Runs
   in the cloud are a separate decision.

## The calls that are the person's

1. **While Althar is closed.** (a) Automations run only while Althar runs,
   and catch up when it opens; (b) as (a), with an opt-in "Open Althar at
   login, in the background"; (c) a daemon that survives Quit. **I'd pick
   (b).**
2. **A run the Mac slept through.** (a) Run once on waking, within its
   window, and say so in its history; (b) skip it; (c) hold it for the
   person, as plans that came due are held today. **I'd pick (a),** changeable
   on each automation's page.
3. **What a fire does.** (a) Althar starts the kept plan on each subject;
   (b) the coordinator is told it's time, and decides. **I'd pick (a).**
4. **Each run: a new task, or the open one carried on.** **I'd pick** a new
   task for each subject; reviews one task a pull request; a change
   automation whose last pull request is still open carries that task on
   with a follow-up round instead of opening another.
5. **What it may do with nobody there.** Draft pull requests yes; ready for
   review only where chosen; never merge. Reviews: drafted only, or posted
   under the existing "Post reviews of my team's pull requests without
   asking"? **I'd pick drafted only** in the first version, whatever that
   setting says.
6. **Permission asks at night.** **I'd pick** the project's rules as they
   are, with asks parking in Needs you, and no allow-everything for an
   automation alone.
7. **Events from people outside the team.** (a) They fire nothing; (b)
   allowed, the run reads only (no network, runs nothing). **I'd pick (a)**
   by default, with (b) on the automation's page.
8. **The limits by default.** One place for automations; at least an hour
   apart; 45 minutes a run; on a usage limit, stop rather than move; plan
   accounts only at first. Keep, or change the numbers.
9. **The coordinator's reach.** Pausing, resuming and Run now in words, with
   no card; any other change on a card. **I'd pick this.**
10. **Where they live.** **I'd pick** in Althar, the person's own, on the
    Mac they were made on; no files in the repository at first.
11. **Rules or automations** for what needs no agent (close the issue when
    its pull request merges). **I'd pick rules.**
12. **The cloud.** Is running agents in the cloud on the way in the next six
    months or so, or is the person's own Mac the product? The model is the
    same either way; it only changes how soon a relay is worth building.

And a word for the glossary: it keeps "run" off the screen, but the picked
page says Run now, and the history shows runs. Either "run" joins the
glossary for automations (a run: one time it fired, and the task it
started), or the page finds other words.

## What I'd still want to know

- **What a run costs.** How much of a plan does a week of the morning review
  and the nightly bump use, on the person's own projects? Measure before
  fixing the defaults.
- **How often runs park.** Under the person's real rules, how many asks does
  each automation meet? Try it once now will show it; count it.
- **Unattended, agent by agent.** Do Claude Code, Codex and OpenCode each run
  inside the rules over ACP with nothing interactive Althar can't answer?
  Codex can't ask before a command its sandbox contains, which is why it
  leads no review of someone else's pull request.
- **Disk.** How big is a worktree with its install on the person's
  projects, and how fast do an automation's worktrees add up?
- **GitHub's budget.** Projects × repositories × pollers, against 5,000 an
  hour shared with the agents' `gh`, measured on the person's account.
- **Timers at wake.** Does an overdue timer fire at wake or late, on a real
  Mac? The design looks again on wake either way. And does `resume` fire
  for a dark wake?
- **Review fatigue.** In dotnet/runtime, 44% of the agent's closed pull
  requests were drafts nobody reviewed. How many open automation pull
  requests are too many? One for each automation, to begin with.
- **Two Macs, travel, holidays.** Does the person use more than one Mac?
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
