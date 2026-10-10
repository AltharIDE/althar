# Developing Althar

How to work in this repository. For what Althar is, see the [README](README.md); for how to propose a change, [CONTRIBUTING.md](CONTRIBUTING.md).

## Set up

You need Bun 1.3.5 and Node 24. The pinned versions are in `.bun-version` and `.node-version`.

```bash
bun install --frozen-lockfile
```

Installing also sets up the pre-commit hook (`.vite-hooks/pre-commit`), which formats and lints the files you stage and fixes what it can.

## Commands

From the repository root:

| Command | What it does |
| --- | --- |
| `bun run dev` | The pitch site, at `http://localhost:5290` |
| `bun --filter @althar/desktop dev` | Builds the desktop app and opens it |
| `bun --filter @althar/ui storybook` | The UI package's Storybook, at `http://localhost:6006` |
| `bun run check` | Format, type-aware lint and type checks, in every package |
| `bun run fix` | The same, fixing what can be fixed |
| `bun run test` | Unit and component tests, in every package |
| `bun run verify` | Everything CI runs, in every package: checks, tests with coverage, builds, and end-to-end tests where a package has them |

Each app and package has its own README with its own commands.

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

## Reviewing on Linux

A Mac can't stand in for every Linux leg; these are run on a real
distribution (the packaged app, not a dev build):

| Leg | How | What it covers |
| --- | --- | --- |
| X11 | `apps/desktop/scripts/x11-smoke.sh` under a real X server and window manager (`DISPLAY=:0 ALTHAR_BIN=/usr/bin/althar`, with `ALTHAR_ARGS=--no-sandbox` where the desktop runs as root) | the window's identity, its own buttons, moving, resizing, maximizing, closing |
| Wayland | run the packaged app on a GNOME or KDE Wayland session | the same through the compositor, and the window's own chrome under it |
| packages | `bun run package` in `apps/desktop`, then install the deb or rpm (or run the AppImage) | the packaged app, its entry in the menu, its icon, and a sign-in being sealed |
| Flatpak | `apps/desktop/scripts/flatpak.sh`, then `apps/desktop/scripts/flatpak-smoke.sh` | the sandbox's own environment, the device's own tools, the keyring over the secret service (see [ADR-018](docs/decisions/018-what-the-flatpak-reaches.md); the Flatpak is experimental until a task has run under GNOME and KDE) |
| keyring | a GNOME session (gnome-keyring) and a KDE one (KWallet 5.97+) | sealing a sign-in, and reopening it after a restart |

CI runs the end-to-end suite with the fake agent under Xvfb instead; the legs
above are for a real desktop, and what each covers is what the Linux packaging
change promises.


## Changes and CI

Work on a branch and open a pull request to `main`. On a pull request:

- **GitHub Actions** runs a package's workflow when its files change: `pitch` for `apps/pitch`, `site` for `apps/site` and the UI kit it uses, `ui` for `packages/ui`, `harness` for `packages/contracts`, `packages/domain`, `packages/persistence-sqlite`, `packages/provider-adapters`, `packages/runtime` and `apps/cli`, and `desktop` for `apps/desktop` and everything it builds on. The desktop app's end-to-end tests run in CI with the fake agent, under a virtual display. The agent adapter's contract runs in CI against a scripted fake agent; the real agents run only on demand (`bun run test:agents` in `packages/provider-adapters`, and `e2e/real.spec.ts` in `apps/desktop`), since they need sign-in and cost usage. Every workflow also runs when the root `package.json`, `bun.lock` or `vite.config.ts` changes.
- **Cloudflare Workers Builds** builds the pitch site. A branch gets a preview deployment (`wrangler preview`), and `main` deploys to production. The preview build fails without the `previews` block in `apps/pitch/wrangler.jsonc`, so keep it.

Merge only when every check is green, the Cloudflare one included.
