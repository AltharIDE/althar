# Tests that hold

> **Temporary.** Why Althar's tests flake, and the plan that removes the causes
> rather than the symptoms. Delete this file when the last phase ships, and move
> the rules that lasted into DEVELOPMENT.md (Tests that hold) and an ADR.

Proposed on 29 October 2026, from three pieces of work done that day: a census
of every failing test in CI from 22 to 29 October, an audit of how the tests
handle time, waiting, processes and shared state, and a look at how other teams
deal with flaky tests.

## What a week of CI says

From 22 to 29 October, CI ran 509 workflow runs and 3,919 jobs. 541 jobs failed.
Main's post-merge failed on every run but one.

| | Occurrences | Tests |
| --- | --- | --- |
| Real breaks, on every run until a fix | 618 (81%) | 116 |
| Flaky: failed, then passed on the same or an equivalent commit | 139 (18%) | 40 |
| Not sure | 7 | 5 |

Most of the red was real breaks reaching main: pull requests merged while their
checks failed (#347, #396), pull requests that passed alone and clashed
together (#385 and #386), and end-to-end breaks that only post-merge runs, which
#390 left on main for a day. The merge queue (#394, on since 29 October) stops
the first two. The third needs the end-to-end run before merge (Keeping main
green, below).

The flakes, by what failed:

| What failed | Flakes | Share |
| --- | --- | --- |
| A wait that checks the database until a fixed deadline | 54 | 39% |
| A test's own time limit (Vitest's 20 s) | 20 | 14% |
| An end-to-end wait for something on screen | 17 | 12% |
| A process still running when the test looked | 14 | 10% |
| Something in the wrong order, or not there yet | 13 | 9% |
| A duration compared to a limit | 12 | 9% |
| A real `gh` or `glab` killed at its deadline | 8 | 6% |
| A port already in use | 1 | 1% |

94 were on Linux (23 of them end-to-end, which runs only on Linux) and 45 on
Windows, which ran the unit tests about 0.6 times as often, and only since
26 October: per run, Windows flakes more. On the same commit, GitHub's Windows
machines run the runtime's tests a median 3.4 times slower than its Linux ones,
5.8 times at the 90th percentile and 13.6 at worst (1,370 s against 522 s for
the whole suite).

## Why they flake: five causes

### 1. Tests race the wall clock

A test waits by checking the database every 20 ms until a deadline in real
time: 1,046 `until` calls in the runtime's tests (787 on its 10 s default, 259
with a limit of their own), 88 `eventually` calls copied into six files, and
131 `Effect.sleep`. 72 tests raise their own time limit (51 to 60 s). No limit
scales with the machine, so every one shrinks 3.4 times on Windows. 162 tests
have a wait at least as long as the test's own limit, so when it runs out the
test fails with a bare "timed out in 20000ms" instead of saying what it was
waiting for.

The runtime has two clocks. Stored times come from Effect's `Clock`, but 23
`Date.now()` and 3 `new Date()` read the system's, Automations has a `now` of
its own, and the fake agent times itself with `setTimeout`. So what happens on
a timer (the 25 s countdown, sweeps, the change feed's fallback, debounces,
stall checks) can only be tested in real time, which is why 1,209 runtime tests
are `it.live` and 118 are `it.effect`.

This is 65% of the flakes, and the speed assertions (9%) are a form of it.

### 2. Real programs where they aren't what's tested

78 runtime test files start processes only as setup: a git repository made
with the runtime's own git, a sign-in check run through `sh`, `gh` and `glab`,
and on Windows PowerShell and `netstat` on every process agent's turn. The
in-process fake agent commits with synchronous `execFileSync('git')`, which
blocks the event loop the runtime shares with it. About 25 files have the
process as their subject; the rest pay for it on every run, most on Windows,
where starting a process is slowest. Git has 167 call sites in 27 modules
behind free functions, so nothing can stand in for it.

Processes still running when looked at (10%) and `gh` killed at its deadline
(6%) come from here, and much of Windows' slowness.

### 3. Races nobody saw before they landed

Some tests fail on a real ordering problem, in the code or in the test: the
13 ordering flakes, and `home.test.ts`, where the runtime's reminder and the
person's queued words reached the fake agent as one prompt (fixed in #407).
A new test runs once on its pull request, so a race that shows one run in ten
lands.

### 4. Shared state between tests

36 writes to `process.env` in 11 runtime test files (PATH shims, HOME,
GIT_CONFIG_GLOBAL), which processes still running from another test then see;
lists in `tests/support.ts` that fill up across a file; 264 temporary folders
and a shared `tmpdir()/althar-fake-agent`; detached servers left running; a
fixed callback port in a sign-in test (the port in use).

### 5. Nothing makes the right way the easy way

Every one of these was fixed where it flaked: a limit raised, a wait added, a
test skipped on Windows (49 skips, never more time). No rule stops the next
`Date.now()` in the runtime, the next number as a time limit in a test, or the
next `waitForTimeout` (73 in the end-to-end specs).

## How other teams deal with it

None of the public accounts fixes flakiness by raising time limits one test at
a time. They do three things.

- **Tests don't race the clock.** Google's test sizes keep small tests free of
  processes, the network and sleeps, and say how long each size may take;
  medium and large tests flake 3 and 28 times as often as small ones. They wait
  for the event, not a delay, and make internal timeouts tunable for tests.
  Chromium scales its timeouts centrally, by build configuration (3 times for
  some Windows builds), never per test.
- **New tests prove themselves before they land.** Chromium runs a new or
  changed test 20 times before it can merge; Mozilla runs changed tests many
  times over, then again in chaos mode.
- **Retry once, and record every pass that needed it.** Meta retries each
  failure once and tracks a flakiness score per test; GitHub files an issue for
  a flaky test and assigns it; Slack, Dropbox, Uber and Atlassian take a flaky
  test out of the gate until it's fixed, each with an owner. GitHub cut builds
  red from flakes 18 times; Slack's main went from 20% to 96% green.

OpenAI's public Codex repo does the same: one retry, a slow-test limit, tests
that wait on the event stream and run on paused time, and process-heavy Windows
tests run one or two at a time "sensitive to Windows runner process-startup
stalls". Anthropic's public SDK tests run against a local mock server, and a
Windows end-to-end job that failed "on a different test each time" doesn't
gate. Nothing more about either company's internal practice is public.

## The fix: the right way, built in once

**A. One clock.** The runtime and the packages it uses read time only through
Effect's `Clock`. A lint rule forbids `Date.now()`, `new Date()` with no
argument, `performance.now()`, `setTimeout` and `setInterval` in `packages/*/src`.
Automations takes `Clock`. The fake agent's timed holds become gates a test
opens. Whatever happens on a timer is tested with `it.effect` and
`TestClock.adjust`: instantly, and the same every time.

**B. Wait for the thing, not a deadline.** One `until` (Effect) and one
`waitFor` (promises), in `@althar/testing`, replace `until`, `eventually`, the
sign-in waits and every loop that gave up after so many tries. They read again
every 20 ms, so a test goes on within 20 ms of what it waits for; what made
waits flaky was their deadline, which now comes from the test's budget (C), so
it is the same everywhere and fails saying what it last read. Waking them on
the store's change signal (`Ledger.listen`) instead would save a few
milliseconds, at the cost of making the runtime's 132 raw writes signal, so it
waits for a reason. The end-to-end support waits with Playwright's own
waiting, and `waitForTimeout` goes.

**C. One time budget, by kind of test and machine.** Tests come in three sizes:
small (no processes, virtual time), medium (real git, processes, the network on
localhost) and large (the app, end to end). Each size has one budget, set in
`@althar/testing`, multiplied on a slow machine (Windows in CI, by what it
measures: about 4). It applies to Vitest's `testTimeout`, to every wait and to
Playwright. A wait's deadline is always inside its test's, so a test that fails
says what it was waiting for. A time of a test's own is an error
(`tests/limits.test.ts` in `@althar/testing`). A test that passes gets to its end as soon as it can, so a generous
budget costs nothing.

**D. Real programs only where they're the subject.** Git, process and port
lookups, the sign-in shell and `gh`/`glab` become Effect services, with fakes
in memory. Fixtures use the fakes; the fake agent's git is asynchronous. The
files whose subject is a real process are the medium suite, run in a job of
their own, with few at a time on Windows.

**E. Nothing shared.** The environment a test gives the runtime goes through
the runtime's options, not `process.env`. `runtime()` returns what it records
rather than filling module lists. Temporary folders and servers belong to the
test's scope and go with it. Ports are 0.

**F. No durations in correctness tests.** A test checks the mechanism: that
the change feed hears a write is shown by holding its fallback still under
`TestClock`, not by timing it. How fast something is goes in a performance job
that reports and doesn't gate.

**G. Guards that keep it so.**

- In CI a failed test runs once more, and one that passes only then gets an
  issue labelled `flaky` (#409).
- While that issue is open, the test is quarantined: it runs in every CI job,
  but its failures go on its issue and the job's summary rather than failing
  the job, and it gates again once the issue closes. The summary warns when
  more than ten are. `stress` and `nightly` don't quarantine.
- A pull request's new and changed tests run 20 times, on Linux and Windows,
  and its changed end-to-end specs 5 times; a flake fails the pull request.
- Every night the whole suite runs shuffled, and five times over on Windows.
- The guard against times of a test's own (C), and lint rules for A and E.

## Every flaky test, and what removes it

From the census, 22 to 29 October, and the merge queue on 29 October.

| Test | Where | Times | Cause | Removed by |
| --- | --- | --- | --- | --- |
| waitingTurns › is gone on without when the person skips it | Linux | 23 | wait | stopped after #373; B, C |
| leftBehind › marked done, leaves none of it running | Linux | 12 | process | #399 (a stopped process not yet reaped); B |
| connecting › reads no sign-in of gh or glab | Windows | 8 | real `gh` | D |
| placesKept › goes by the project's rule | Linux | 7 | wait | stopped after #373; B, C |
| e2e/merging › settles on the board as soon as GitHub merges it | Linux | 6 | duration | #407 |
| api › hears a change as soon as it is written | Windows | 6 | duration | F |
| models › record the process asking starts | Windows | 6 | order | investigate; G |
| home › shows across projects what runs | Linux | 5 | wait (a race) | #407 |
| placesKept › starts a review at once on the reviewer | Linux | 5 | wait | stopped after #373; B, C |
| e2e/limits › asks the person when the reset isn't known | Linux | 4 | screen wait | B, C |
| e2e/limits › hands the task to the next free agent | Linux | 4 | screen wait | B, C |
| conflictsOnHostWaiting › puts the card in Needs you | Linux | 4 | order | investigate; G |
| failures › session limit · resets 3pm | Windows | 4 | time limit | A, C |
| heldKept › starts a review kept with no reviewer named | Linux | 4 | wait | stopped after #373; B, C |
| heldKept › starts a review kept as resumed | Linux | 4 | wait | stopped after #373; B, C |
| e2e/waiting › says over the composer why the task waits | Linux | 3 | screen wait | #407 (menus); B, C |
| desktop client › asks the coordinator for a task | Windows | 3 | time limit | C |
| e2e/signedOut › asks at once, with Sign in again | Linux | 2 | screen wait | #407 (menus); B, C |
| e2e/switching › going back to an open project is instant | Linux | 2 | screen wait | B, C, F |
| api › reads what a running command has printed | Windows | 2 | time limit | B, C, D |
| conflicts › waits for the person to ask the lead | Windows | 2 | time limit | C, D |
| folderCleanup › removes a merged task's folder | Windows | 2 | time limit | A, C, D |
| leftBehind › goes once Althar looks after it starts again | Linux | 2 | process | A, B |
| permissionJudge › owns and closes the process | Windows | 2 | time limit | C (medium suite) |
| sessions › finds where one answers from its port | Windows | 2 | wait | C, D |
| e2e/firstWord › longer than usual after 30 seconds | Linux | 1 | screen wait | A, B |
| e2e/folders › a finished task's folder goes from Settings | Linux | 1 | screen wait | B, C |
| backups › keeps the newest three copies | Linux | 1 | time limit | C |
| schema › a later migration rebuilds a table | Linux | 1 | time limit | C |
| code › opens a file a message names | Windows | 1 | order | investigate; G |
| conflictsOnHostChecks › waits for the person to push a fix | Windows | 1 | time limit | C, D |
| conflictsUnsent › says its folder isn't on this computer | Linux | 1 | order | investigate; G |
| connections › signs in to Linear | Linux | 1 | port in use | E |
| crashReports › sends ten a launch | Windows | 1 | order | investigate; G |
| folderCleanup › keeps one changed, opened or run from | Windows | 1 | time limit | A, C, D |
| leadHandover › hands one over at a break | Linux | 1 | wait | B, C |
| limits › runs the other held steps at their reset | Windows | 1 | wait | A, B |
| limits › goes to the model picked | Windows | 1 | wait | A, B |
| sessions › finds a silent server in the agent's tree | Windows | 1 | wait | C, D |
| steering › starts afresh on another of its agent's accounts | Windows | 1 | time limit | A, C |

Seen in the merge queue on 29 October, after the census: `limits › is answered
then after Althar restarts` and `localMerge › pushes the task's branch with the
person's own git` (both Windows, time limit and wait: A, B, C, D).

Not sure, from one run each: `FactLine` (#361), `process › removes the temporary
folder` (#326), `coordinator` (#389), `launches` (#406) and `limits › a message
waiting for a reset` (#388). If they flake again, #409 files them.

"Investigate" is five tests whose failure is about order, not time: each is a
race, in the code or in the test, found by running it under G's 20 repeats and
fixed where it is.

## Keeping main green, beyond flakes

- **The merge queue** (on since 29 October) tests each pull request on main as
  it will be. It stops pull requests merged red and pull requests that clash.
- **The end-to-end run before merge.** It runs only after merge, so #390 broke
  three specs on main and nothing said so before. In the queue, for a change to
  the app or the UI kit, split across four machines (about six minutes), it
  would have.
- **CI's capacity.** The account runs about 20 jobs at a time, and a queued pull
  request starts about 25. Building five at once mostly waits. Fewer, larger
  jobs per entry (the Linux packages in one job) and three entries at a time
  would keep the queue moving.

## Where it stands (30 October)

- **Done:**
  - **Phases 0 and 1:** retry, flaky issues, sizes, budgets and one way to wait (#409).
  - **Phase 2:** end-to-end waits (#423).
  - **Phase 3:** one clock, a lint rule, 21 timer tests on TestClock and four duration checks (#424).
  - **Phase 5:** stress and nightly runs (#419).
  - **Phase 6:** the end-to-end run in the queue, fewer jobs, three entries built at a time (#419).
  - **The five order races,** and three more the flaky issues found (#418).
  - **Phase 4, in part:**
    - free ports, and `gh`'s deadline from the budget (#420);
    - the fake agent's git asynchronous;
    - testing-library's waits from the budget (#418).
- **Found on the way, and fixed:**
  - two catalog reads at once started every agent twice (#418);
  - a test that depended on the machine having `~/Documents` (#411);
  - a board class name colliding with the Up next lane's, which broke dragging in Up next (#403);
  - three tests and a spec that kept state between runs (#402, #411, #418).
- **Left, none of it a flake the census or the first day of stress and flaky issues saw:**
  - **Phase 4's git, process and port lookups as services with fakes.** Git has 167 call sites; once phase 3's budget is in, this is about speed on Windows more than flakes. `folderCleanup`'s two flakes were slow git there.
  - **The fake agent's `[lead:wait]` cap** (5 s) and other timed holds.
  - **45 tests that pass short real-time timer options** (`listenEvery: 100 ms`).
  - **Four performance checks among the unit tests** (`diagnostics`, connectors `jiraText`, ui `Code` and `Terminal`), for a performance run that doesn't gate.
  - **The fake host's 3 s merge,** better as a gate.
  - **`process.env` writes in eleven runtime test files.** Vitest runs each file in a worker of its own, so they can't reach another file, and each test puts back what it changed.

## Phases

Each is one pull request, through the queue.

0. **Retry and flaky issues** (#409, with #404's index fix).
1. **Waits and budgets (B, C), in the unit tests.** `@althar/testing` gets
   the sizes, the budget and the scale; one `until` and one `waitFor` replace
   the others; the 87 test times, 419 wait times and the loops that gave up
   after so many tries go (the six tests that needed more than a minute take
   `budget.large`); `tests/limits.test.ts` fails on any that comes back.
2. **Waits and budgets in the end-to-end specs.** Playwright's times from the
   budget; the 166 `timeout:` options, 16 `test.setTimeout` and 73
   `waitForTimeout` go.
3. **One clock (A, F).** The lint rule against the system's time in `src`; the
   23 `Date.now()` and Automations on `Clock`; the fake agent's holds as gates;
   timer tests on `TestClock`; the eight duration checks in unit tests and three
   in end-to-end specs replaced by their mechanism.
4. **Programs only as subjects (D, E).** Git, process and port lookups, the
   sign-in shell, `gh` and `glab` as services with fakes; fixtures on the
   fakes; the medium suite as its own job; environment, folders and ports
   scoped to the test.
5. **Guards (G).** The 20-runs job for new and changed tests, and the nightly
   shuffled run. The five order races are fixed here if 1 to 3 haven't shown
   them.
6. **Main green (Keeping main green).** The end-to-end run in the queue, split;
   fewer, larger jobs; three entries built at a time.

Phases 1 to 4 change the same test files, so they go one after another. Phase 6
touches only the workflows and can go alongside them.
