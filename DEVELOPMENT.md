# Developing Althar

How to work in this repository. For what Althar is, see the [README](README.md); for how to propose a change, [CONTRIBUTING.md](CONTRIBUTING.md).

## Set up

You need git, [Bun](https://bun.sh) 1.3.5 and Node 24. The pinned versions are in `.bun-version` and `.node-version`.

```bash
git clone https://github.com/AltharIDE/althar.git && cd althar
```

```bash
bun install --frozen-lockfile
```

Installing also sets up the pre-commit hook (`.vite-hooks/pre-commit`), which formats and lints the files you stage and fixes what it can. Then build the desktop app and open it:

```bash
bun --filter @althar/desktop dev
```

## Commands

From the repository root:

| Command | What it does |
| --- | --- |
| `bun run dev` | The public site, at `http://localhost:5320` |
| `bun --filter @althar/desktop dev` | Builds the desktop app and opens it |
| `bun --filter @althar/ui storybook` | The UI package's Storybook, at `http://localhost:6006` (see [Showing a change works](#showing-a-change-works) for a port of a task's own) |
| `bun run check` | Format, type-aware lint and type checks, in every package |
| `bun run fix` | The same, fixing what can be fixed |
| `bun run test` | Unit and component tests, in every package |
| `bun run verify` | Checks, tests with coverage and builds, in every package |
| `bun run test:e2e` | The end-to-end tests: the desktop app's, which run quietly on a Mac, at most three runs at once on the computer ([apps/desktop](apps/desktop#work-on-it)) |

Each app and package has its own README with its own commands.

The full suites are heavy: the desktop app's end-to-end run takes much of a
Mac for its length. While you work, run what your change touches (the checks
and tests of the packages you changed and of those that build on them, and
the end-to-end specs for what you changed), and leave the rest to CI, which
runs the checks and unit tests on the pull request, the end-to-end run in the
merge queue, and coverage and the packages after merge.

## The repository

| Path | What's there |
| --- | --- |
| [`apps/site`](apps/site) | The public site: the developer page, the shifts and the thesis |
| [`apps/report`](apps/report) | `@althar/report`: the Cloudflare Worker that turns a problem reported from the app into a Linear issue |
| [`packages/ui`](packages/ui) | `@althar/ui`, the interface components, with a Storybook |
| [`packages/domain`](packages/domain) | `@althar/domain`: identifiers, vocabularies, lifecycles and commands, as Effect schemas |
| [`packages/persistence-sqlite`](packages/persistence-sqlite) | `@althar/persistence-sqlite`: the local store, its schema ([schema.sql](packages/persistence-sqlite/schema.sql)) and migrations |
| [`packages/provider-adapters`](packages/provider-adapters) | `@althar/provider-adapters`: how Althar talks to agents over ACP, and the agent registry |
| [`packages/runtime`](packages/runtime) | `@althar/runtime`: the store's one writer, which owns projects, tasks, agent sessions, turns and permissions |
| [`packages/contracts`](packages/contracts) | `@althar/contracts`: the API between the runtime and its clients, and the transport it runs over |
| [`packages/testing`](packages/testing) | `@althar/testing`: how the tests run in CI, retried once, with the flaky ones reported |
| [`apps/desktop`](apps/desktop) | `@althar/desktop`: the desktop app, Electron with the runtime in a utility process |
| [`apps/cli`](apps/cli) | `@althar/cli`: a command-line client for the runtime, which runs a task with a real agent in a terminal |
| [`brand`](brand) | `@althar/brand`: the mark, lockups, avatars, banners and screenshots, ready to use, and the code that draws them |
| [`docs/architecture`](docs/architecture) | The working architecture: a local-first desktop app, with seams for a later cloud |
| [`docs/decisions`](docs/decisions) | Architecture decisions, one per file |
| [`docs/glossary.md`](docs/glossary.md) | The words the interface uses, beside the words the architecture uses |
| [`docs/open-questions.md`](docs/open-questions.md) | What is not decided yet |
| [`docs/plans`](docs/plans) | Temporary plans, such as the current demo's. Not architecture |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | The engineering standards every app and package follows |
| [`THESIS.md`](THESIS.md) | The research hypothesis Althar comes out of |

## Standards

[ARCHITECTURE.md](ARCHITECTURE.md) is the target every app and package moves toward. In short:

- TypeScript everywhere, strict, with runtime validation of anything untrusted.
- Tests first for new behaviour, and at least 90% line and branch coverage in each app and package.
- Accessibility to WCAG 2.2 AA from the first implementation.
- A consequential decision gets an ADR in [`docs/decisions`](docs/decisions); an exception gets an owner and an expiry.

Runtime-side code is written with Effect 4, with the conventions in
[ADR-009](docs/decisions/009-effect-on-the-runtime-side.md); the UI kit never
uses it. The desktop app is MVVM in feature folders
([ADR-010](docs/decisions/010-desktop-app-mvvm.md)).

Each app and package has its own `ARCHITECTURE.md` for what is specific to it. Before naming anything on screen, check [the glossary](docs/glossary.md).

### Tests that hold

A test passes or fails for what the code does, not for how fast the machine it runs on is. `@althar/testing` holds what makes that so ([the plan](docs/plans/tests-that-hold.md) says why).

- **A test takes its size's time, never a time of its own.** A package's Vitest config takes `testing('small')` (no processes, files or network) or `testing('medium')` (real git, processes, files, localhost); a test that needs more takes `budget.large` by name. The budgets are scaled for the machine: four times on GitHub's Windows runners, and `ALTHAR_TEST_SCALE=3 bun run test` on a busy Mac. A test that passes is done as soon as it can be, so the budget only bounds how long one that hangs takes to fail.
- **Wait with `until` (Effect) or `waitFor` (promises), never a loop of your own.** Each reads again every 20 ms until its check passes, and gives up only near its test's own time, saying what it last read. A wait takes no time of its own either.
- **One clock.** The runtime and the packages it uses read the time and wait only through Effect's `Clock`, which in production is the system's and in a test is the test's. `lint/clock.js` (`althar/one-clock`) fails on `Date.now()`, `performance.now()`, `new Date()` or `Date()` with no time, `DateTime.nowUnsafe`, `setTimeout` and `setInterval` in their `src`, the fake agent apart. Where only a Node timer will do, outside any effect, the line says why with `// oxlint-disable-next-line althar/one-clock`.
- **What happens on a timer is tested on the test's clock:** `it.effect` with `onTestClock` (`tests/support.ts`), moving the clock with `TestClock.adjust` or `atReset(later())`. A jump fires everything due before it, so jump no further than the test needs. A plain `it(…, () => Effect)` never runs, and under a plain TestClock `until` never returns.
- **Hold the fake agent, don't time it.** A test passes `holds: holds()` and opens a marker's hold when it is ready, rather than waiting out the fake's delay.
- **No durations in correctness tests.** A test checks what happened, not how long it took: that the change feed hears a write is shown with its fallback held still, not timed. How fast something is belongs in a performance run that doesn't gate.
- **`tests/limits.test.ts` in `@althar/testing` fails on any test, hook or wait given a time of its own,** or a loop that gives up after so many tries. The tests of real agents and real accounts, with their own configs, and a benchmark run by hand are the exceptions it names.

## The architecture

Start from [the overview](docs/architecture/README.md), then:

1. [Concepts and the project model](docs/architecture/01-concepts-and-project-model.md)
2. [Desktop runtime](docs/architecture/02-desktop-runtime.md)
3. [Agent runtime and auth](docs/architecture/03-agent-runtime-and-auth.md)
4. [Coordinator](docs/architecture/04-coordinator.md)
5. [Workflow engine](docs/architecture/05-workflow-engine.md)
6. [Integrations and skills](docs/architecture/06-integrations-and-skills.md)
7. [Persistence, security and cloud](docs/architecture/07-persistence-security-and-cloud.md)
8. [Precedents and validation](docs/architecture/08-precedents-and-validation.md)

## Showing a change works

A change to what someone sees is shown with screenshots of the states it
changed; a change behind the screen, with the test run or command that shows
it. An agent leading a task in Althar hands them with `finish_step` as
evidence, and lists what it couldn't show as unverified.

There are two ways to screenshot this repository's interface, both headless:

- **A component, in its Storybook story.** Start Storybook on a port of the
  task's own (another worktree may have 6006, with its own code), and shoot the
  story's frame with Playwright, which the desktop app already has:

  ```bash
  cd packages/ui && bunx storybook dev --port 6116 --ci --no-open &
  cd apps/desktop
  bunx playwright screenshot --viewport-size=900,900 --full-page \
    --wait-for-selector "#storybook-root > *" --wait-for-timeout 800 \
    "http://localhost:6116/iframe.html?id=thread-evidence--shown&viewMode=story" test-results/evidence.png
  ```

  The story's id is its title and name in kebab case (`Thread/Evidence`,
  `Shown`); a `play` function runs first, so a story can open what it shows.
  Add a story for a state that has none.

- **The desktop app, with the fake agent.** An end-to-end spec drives the
  built app and saves what it shows with `page.screenshot`, as
  `apps/desktop/e2e/evidence.spec.ts` does; `bun run test:e2e e2e/your.spec.ts`
  builds the app and runs it.

Shoot at 1×, and only what changed where you can. The command above shoots a
story at 1× already, and a story's frame is just the component. In a spec, the
app's window on a Retina Mac shoots at 2× unless told otherwise: pass
`scale: 'css'` to `page.screenshot` and to an element's `screenshot`, and take
one element (`page.getByRole(…).screenshot({ scale: 'css' })`) rather than the
window. An agent reads each shot it looks at into its
context, where it stays: a Retina shot of the whole window costs it as much as
a few thousand words, and one cropped at 1× a tenth of that. Look at each shot
once.

Shots go in `test-results/`, which git ignores. In an agent's sandbox on a
Mac, Chromium and Electron can't start (Chromium exits with `SIGTRAP`), so run
the shooting command outside the sandbox; Storybook itself runs inside it,
since a lead may listen on localhost. A lead in Althar runs `bunx playwright`
and the end-to-end run's own `node scripts/e2e.ts` (in `apps/desktop`)
outside its sandbox from the start (the project's rules, under Sandbox), but
only on a line of their own: change folder in a command of its own first, as
above. Claude Code keeps a line that starts with `bun` in its sandbox
whatever its settings say, so `bun run test:e2e` fails there: run
`node scripts/e2e.ts e2e/your.spec.ts` from `apps/desktop` instead.

## Reviewing on Linux

A Mac can't stand in for every Linux leg; these are run on a real
distribution (the packaged app, not a dev build):

| Leg | How | What it covers |
| --- | --- | --- |
| X11 | `apps/desktop/scripts/x11-smoke.sh` under a real X server and window manager (`DISPLAY=:0 ALTHAR_BIN=/usr/bin/althar`, with `ALTHAR_ARGS=--no-sandbox` where the desktop runs as root) | the window's identity, its own buttons, moving, resizing, maximizing, closing |
| Wayland | run the packaged app on a GNOME or KDE Wayland session | the same through the compositor, and the window's own chrome under it |
| packages | `bun run package` in `apps/desktop`, then install the deb and rpm on their real target distributions (or run the AppImage) | The AppImage build is covered in CI; `.deb` and `.rpm` installation, menu entry, icon and keyring still need later real-desktop checks. Track those follow-ups in `docs/plans/package-linux.md`. |
| Flatpak | `apps/desktop/scripts/flatpak.sh`, then `apps/desktop/scripts/flatpak-smoke.sh` | the sandbox's own environment, the device's own tools, the keyring over the secret service (see [ADR-027](docs/decisions/027-what-the-flatpak-reaches.md); the Flatpak is experimental until a task has run under GNOME and KDE) |
| keyring | a GNOME session (gnome-keyring) and a KDE one (KWallet 5.97+) | sealing a sign-in, and reopening it after a restart |

CI runs the end-to-end suite with the fake agent under Xvfb instead; the legs
above are for a real desktop, and what each covers is what the Linux packaging
change promises.


## Changes and CI

Work on a branch and open a pull request to `main`. On a pull request:

- **GitHub Actions** runs a package's workflow when its files change: `site` for `apps/site` and the UI kit it uses, `report` for `apps/report`, `ui` for `packages/ui`, `harness` for `packages/contracts`, `packages/domain`, `packages/persistence-sqlite`, `packages/provider-adapters`, `packages/runtime` and `apps/cli`, and `desktop` for `apps/desktop` and everything it builds on. For `ui`, `harness` and `desktop` that is the fast part only: checks and unit tests (and the Storybook build). The runtime's tests, the longest, run in parts by file, each its own job (`bun run test --shard=1/4` runs the first of four): four in `harness`, which `verify (packages/runtime)` sums up as one check, four on Windows, and four after merge, whose coverage `harness (packages/runtime)` merges and gates as a whole. `desktop` runs them on Windows too, for the desktop app and every package it builds on, with one end-to-end smoke test there (`e2e/smoke.spec.ts`: the app starts and makes a project), since no one here works on Windows day to day. The agent adapter's contract runs in CI against a scripted fake agent; the real agents run only on demand (`bun run test:agents` in `packages/provider-adapters`, and `e2e/real.spec.ts` in `apps/desktop`), since they need sign-in and cost usage. Every workflow also runs when the root `package.json`, `bun.lock` or `vite.config.ts` changes. `windows-installer` builds the Windows installer on `windows-2025`, installs and uninstalls it, and uploads it as the artifact `desktop-windows-installer` when how the desktop app is packaged changes (`apps/desktop/scripts`, its `package.json`, its main process or `bun.lock`); run it on any branch with `gh workflow run windows-installer.yml --ref <branch>`.

Merge through the merge queue: `gh pr merge <number>`, or Merge when ready on GitHub, puts a pull request in it. Two pull requests can each pass and still break `main` together, so the queue checks each one again on `main` as it will be, with the pull requests ahead of it, and squashes it onto `main` once that passes. It runs the same workflows the pull request ran, for the paths it changes (`queue`), and two of its own: the desktop app's end-to-end run, in four parts on machines of their own (`e2e`), for any change the app builds on, and the stress run of the pull request's changed tests (below). A merge waits about as long as the longest of them. It builds three entries at a time: more only wait for machines. A pull request that fails there goes back to its branch, and `main` never has it. `main`'s rules require one check, `merge queue`: on a pull request it passes at once, and its own checks say how it stands.

In CI, a test that fails runs once more (`@althar/testing`), so one that fails only now and then doesn't stop a merge. One that passes only then is flaky, and it says so: a warning on the run, and an issue labelled `flaky`, one per test, with a comment for each time it happens again, reopened if it was closed. A retry only lets the change through; the test says nothing reliable until its cause is fixed, so fix it and close its issue from that pull request. Locally nothing is retried, so a flaky test fails where you run it.

A pull request's new and changed tests run many times over, with no retry (`stress`, on the pull request and in the queue): each twenty times on Linux and ten on Windows when a few changed, fewer when many did, so the run takes about as long as the other checks; its changed end-to-end specs run up to five times. A race that shows one run in ten fails there, on the pull request that brought it, instead of slipping through on the retry. Every night `nightly` runs `main`'s whole unit suite in a shuffled order, on Linux once and five times over on Windows. A test that fails twice in a row there opens the issue "Nightly tests failed"; the seed in the failing part's log (`--sequence.seed`) runs the same order again.

After merge, `post-merge` runs the heavy part of `ui`, `harness` and `desktop` on `main`: their checks again, the coverage gates, the Storybook build, the desktop app's end-to-end tests again, for the release (`e2e`: with the fake agent, under a virtual display, in jobs of their own, so a check or coverage gate that fails doesn't skip them) and its Linux packages and Windows installer. `site`, `brand` and `report` still run in full on their own. Merges in quick succession share a run. When it fails, an issue titled "Main is red" links the run and the merges since the last green one; fix or revert, and it closes itself when `main` is green again. `main` may be red for a while; a release may not: `release` cuts only a commit `post-merge` passed on. To run the heavy suites on a branch before merging, `gh workflow run post-merge.yml --ref <branch>`.
