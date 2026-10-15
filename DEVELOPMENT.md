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
| `bun run dev` | The pitch site, at `http://localhost:5290` |
| `bun --filter @althar/desktop dev` | Builds the desktop app and opens it |
| `bun --filter @althar/ui storybook` | The UI package's Storybook, at `http://localhost:6006` (see [Showing a change works](#showing-a-change-works) for a port of a task's own) |
| `bun run check` | Format, type-aware lint and type checks, in every package |
| `bun run fix` | The same, fixing what can be fixed |
| `bun run test` | Unit and component tests, in every package |
| `bun run verify` | Checks, tests with coverage and builds, in every package, and the pitch site's end-to-end tests |
| `bun run test:e2e` | The end-to-end tests: the pitch site's, and the desktop app's, which run quietly on a Mac, at most three runs at once on the computer ([apps/desktop](apps/desktop#work-on-it)) |

Each app and package has its own README with its own commands.

The full suites are heavy: the desktop app's end-to-end run takes much of a
Mac for its length. While you work, run what your change touches (the checks
and tests of the packages you changed and of those that build on them, and
the end-to-end specs for what you changed), and leave the rest to CI, which
runs the checks and unit tests on the pull request and the heavy suites after
merge.

## The repository

| Path | What's there |
| --- | --- |
| [`apps/pitch`](apps/pitch) | The brief and research note, as a static site |
| [`apps/site`](apps/site) | The public site: the developer page, the shifts and the thesis |
| [`packages/ui`](packages/ui) | `@althar/ui`, the interface components, with a Storybook |
| [`packages/domain`](packages/domain) | `@althar/domain`: identifiers, vocabularies, lifecycles and commands, as Effect schemas |
| [`packages/persistence-sqlite`](packages/persistence-sqlite) | `@althar/persistence-sqlite`: the local store, its schema ([schema.sql](packages/persistence-sqlite/schema.sql)) and migrations |
| [`packages/provider-adapters`](packages/provider-adapters) | `@althar/provider-adapters`: how Althar talks to agents over ACP, and the agent registry |
| [`packages/runtime`](packages/runtime) | `@althar/runtime`: the store's one writer, which owns projects, tasks, agent sessions, turns and permissions |
| [`packages/contracts`](packages/contracts) | `@althar/contracts`: the API between the runtime and its clients, and the transport it runs over |
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
  cd apps/desktop && bunx playwright screenshot --viewport-size=900,900 --full-page \
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
since a lead may listen on localhost.

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

- **GitHub Actions** runs a package's workflow when its files change: `pitch` for `apps/pitch`, `site` for `apps/site` and the UI kit it uses, `ui` for `packages/ui`, `harness` for `packages/contracts`, `packages/domain`, `packages/persistence-sqlite`, `packages/provider-adapters`, `packages/runtime` and `apps/cli`, and `desktop` for `apps/desktop` and everything it builds on. For `ui`, `harness` and `desktop` that is the fast part only: checks and unit tests (and the Storybook build). The agent adapter's contract runs in CI against a scripted fake agent; the real agents run only on demand (`bun run test:agents` in `packages/provider-adapters`, and `e2e/real.spec.ts` in `apps/desktop`), since they need sign-in and cost usage. Every workflow also runs when the root `package.json`, `bun.lock` or `vite.config.ts` changes.
- **Cloudflare Workers Builds** builds the pitch site. A branch gets a preview deployment (`wrangler preview`), and `main` deploys to production. The preview build fails without the `previews` block in `apps/pitch/wrangler.jsonc`, so keep it.

Merge only when every check is green, the Cloudflare one included.

After merge, `post-merge` runs the heavy part of `ui`, `harness` and `desktop` on `main`: their checks again, the coverage gates, the Storybook build, the desktop app's end-to-end tests (with the fake agent, under a virtual display) and its Linux packages. `pitch`, `site` and `brand` still run in full on their own. Merges in quick succession share a run. When it fails, an issue titled "Main is red" links the run and the merges since the last green one; fix or revert, and it closes itself when `main` is green again. `main` may be red for a while; a release may not: `release` cuts only a commit `post-merge` passed on. To run the heavy suites on a branch before merging, `gh workflow run post-merge.yml --ref <branch>`.
