# @althar/testing

How Althar's tests run. Each test has a time budget by its size, scaled for the machine, and waits one way, by that budget; no test sets a time of its own. In CI a test that fails runs once more, and one that passes only then is reported as flaky, so it stays in sight until its cause is fixed; while its issue is open it is quarantined, so its failures don't fail CI. Locally nothing is retried, and nothing is quarantined.

## Use it

A package's Vitest config spreads the shared settings for its size into `test`:

```ts
import { testing } from '@althar/testing/vitest'

export default defineConfig({ test: { ...testing('medium'), include: ['tests/*.test.ts'] } })
```

That is `testTimeout` and `hookTimeout` from `budget` (`src/budget.ts`: small 10 s, medium 60 s, large 180 s, times `scale`, which is 4 on Windows in CI and `ALTHAR_TEST_SCALE` where set), and `setupFiles: ['@althar/testing/setup']`, which notes each test's time as it starts. A package with setup files of its own lists them after that one. A test that needs more than its package's size takes `budget.large` as its time.

Tests wait with `until` from `@althar/testing/effect`, or `waitFor` from `@althar/testing` with promises: each reads again every 20 ms until its check passes, and gives up only with a tenth of its test's time left (`src/deadline.ts`), saying what it last read.

For a live reset or expiry, use `isoAfter(milliseconds)` from `@althar/testing`; its optional second argument is an explicit reference time in milliseconds. Use historical dates for static payload and calendar examples. The lint rule `althar/no-future-dates` (`lint/dates.js`, in every package's checks) rejects future date values and timestamps in tests, specs and fixtures, including JSON and SQL, so a deadline cannot silently pass as the calendar moves on. Dates mentioned in prose and comments are not deadlines.

For time-dependent reads that must not wake the runtime's background loops, obtain `const clock = yield* readClock` from `@althar/testing/effect` after the runtime is provided. `yield* clock.advance('5 days')` moves only the time seen by `yield* clock.run(service.read)`; the runtime's timers retain their original clock. Use `TestClock.adjust` when firing timers is what the test covers.

For test folders, `realPath` canonicalizes an existing path (including Windows' short names), and `slashPath` formats paths for output that uses forward slashes on every OS. Use `removeTree` or `removeTreeSync` for recursive test cleanup: they retry Windows' transient busy/permission errors with Node's backoff, while persistent failures still fail the test. Stop processes using a folder before removing it.

In CI the settings add `retry: 1` and the reporters `default`, `github-actions` and `@althar/testing/reporter`. A command that names its own reporters names this one too (`--reporter=@althar/testing/reporter`). Playwright takes `@althar/testing/playwright` as a reporter, with `retries: 1` in CI.

Both reporters write a warning on the run for each flaky test (a GitHub annotation) and a line to the file `FLAKY_REPORT` names. The workflows set `FLAKY_REPORT`, and their test jobs end with `.github/actions/flaky`, which runs `src/report.ts`: it files each flaky test as an issue labelled `flaky`, or comments on its issue, reopening it if it was closed.

### Quarantine

A test with an open issue labelled `flaky`, titled as `src/report.ts` titles one (`Flaky: <file> › <name>`) and filed by CI, is quarantined (`src/quarantine.ts`). A job reads which ones are as it starts, with `.github/actions/flaky/quarantine` (`bun src/quarantine.ts read`, which asks GitHub's API through `gh` for the open issues, and when each opened, and names the file it keeps them in `QUARANTINE`). In that job, when a quarantined test fails on its retry too, both reporters record it (a warning, and a line to `FLAKY_REPORT` with the issue's number), and a run that failed for quarantined tests alone passes: Vitest's exit code is set back once the run ends (an error outside any test, a suite's hook or a module's import still fails it), and Playwright's reporter returns `passed` from `onEnd`. Merging the runtime's parts (`--merge-reports`), the reporter records nothing again and lets the same tests through. At the end of the job, `src/report.ts` comments on each one's issue and writes the job's summary: the quarantined tests that failed, a warning when more than ten are quarantined, and, when the issues couldn't be read, that nothing was quarantined.

A quarantine lasts a week from its issue's opening (`LASTS`; one open before ends landed lasts until `GRACE_ENDS`), or until its test fails on its retry twice in a day, when `src/tend.ts` labels its issue `broken`. Once it has lapsed the test is skipped where quarantine is read: `src/setup.ts`, the shared setup, skips a Vitest test with `context.skip`, and the job's `QUARANTINE_SKIPPED` is a regular expression of the lapsed specs, which `e2e.yml` passes Playwright as `--grep-invert` (Windows' smoke test doesn't, as cmd would read its `|`; a lapsed failure there doesn't gate). Should a lapsed test run anyway, its failure is let through as a quarantined one's. The summary lists the lapsed tests with their owners. At night, which reads no quarantine, every lapsed test runs and gates.

`src/tend.ts`, every night in `nightly`, with git's whole history: for each open quarantine it records the owner in its issue's body, the last commit to the test's file or the source it imports (`select.ts`'s graph; not the tests' shared support or this package's files), with the pull request a squash merge's subject names and the session its `Claude-Session` trailer names; and labels the issue `broken` once its quarantine has lapsed, by age or by the issue's comments (two failures on a retry within a day, since ends landed), naming the owner in a comment.

Vitest checks coverage only on a run with no failed test, unless the coverage config sets `reportOnFailure`; without it, the reporter doesn't let a quarantined failure pass a coverage run, since its coverage would go unchecked. A job that doesn't read the issues, or one with `QUARANTINE` unset, as on a computer, quarantines nothing.

### Durations and shards

`@althar/testing/sequencer` distributes the runtime's selected files across Vitest shards; `playwrightShard` from `@althar/testing/shards` assigns the app's full specs when `E2E_SHARD` is set. Both use `durations.json`, separately by OS, and assign every discovered file exactly once. Missing or invalid measurements fall back to a normal cost; timings never decide whether a test runs or passes. Playwright's worker count stays one, and Vitest's normal sorting and isolation remain.

The CI install action names `TEST_TIMINGS`. Both existing reporters append measurements there, and `.github/actions/flaky` uploads each job's `test-timings-*` artifact. Vitest report merging records no duplicate measurements. Each `post-merge` run on main merges its jobs' artifacts over the durations it started from (`bun src/timingHistory.ts <folder> 'post-merge run <id>'`) and uploads the result as the artifact `test-durations`. A workflow's plan job picks the newest of those once, and every part downloads it over `durations.json` before its tests (`.github/actions/durations`), so all parts of a run read the same durations; one that can't download it fails rather than take another share. Where none is found, the committed `durations.json` is the fallback, which no one needs to edit.

The refresh sums each spec's test attempts per job and uses median durations across the supplied jobs. Windows and Linux data stay separate, and only full runs measure, not stress runs with extra repetitions. A timing artifact is optional diagnostics; losing it cannot turn a failed test or coverage gate green.

Windows uses a fresh Bun package-cache directory and an exact OS, architecture, Bun-version and lockfile key. `post-merge`'s manual `bun-cache` input compares `isolated`, `off` and the old `legacy` cache with the same tests. Install durations are recorded on the summary; cache restoration time is the cache step's duration. Jobs that do not execute Electron skip its binary caches.

## Work on it

```sh
bun run check
bun run test
```

`src/select.ts` is what CI runs for a change: the workflows `harness`, `desktop`, `ui` and `windows` plan with it, and run its plan ([Changes and CI](../../DEVELOPMENT.md#changes-and-ci)). Windows runs affected unit tests for changes to the runtime, adapters, connectors, persistence, skills, CLI and the desktop host, including on drafts and in the merge queue. On a ready pull request and in the queue, `harness` gates the coverage of each package the plan reaches that has a `test:coverage` (`gated`), and leaves its selected tests to that job (`covered`). `src/stress.ts` stresses a change's tests and the nearest that import its source (`nearest`), capped. Renderer-only work and docs do not start Windows unit jobs; shared tooling starts the whole set. `tests/select.test.ts` checks the plan for example changes in a small repository shaped like this one, and that every import in this one leads to a file or a package it depends on, so none goes unseen.

`tests/reporter.test.ts` runs Vitest on a test that fails once, then passes (`tests/fixtures/once.fixture.ts`), and checks that it alone is reported. `tests/quarantine.test.ts` runs Vitest on tests that always fail (`tests/fixtures/fails.fixture.ts`, `broken.fixture.ts`, `hook.fixture.ts`, with a fake coverage provider in `coverage.ts`), and the Playwright reporter on a run's end, and checks which runs quarantine lets pass; and the matching of tests to issues, the decision and the job's summary on their own. `tests/deadline.test.ts` checks the waits and their deadline. `tests/e2eImports.test.ts` follows every end-to-end file's imports and fails one that reaches what Node can't load. `tests/lintRules.test.ts` checks the repository's own lint rules, among them those that were tests here and read every test in the repository: `althar/test-time` fails a test that sets a time of its own (a third argument to `it`, `test` or `describe` other than a budget by name, a `timeout` in a test's options, a time given to a hook or to a wait, or a loop that gives up after so many tries), `althar/spec-time` and `althar/system-keys` the same and a Mac's key in a spec, and `althar/no-future-dates` a date still to come. As lint rules they run in the checks of the package whose file they read, so a pull request that adds one fails on it.
