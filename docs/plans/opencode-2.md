# OpenCode 2 in Althar

> **Temporary.** Research for one decision: can Althar run OpenCode 2 by
> default, what has to change, and what follows. Not architecture: what lasts
> moves into [03](../architecture/03-agent-runtime-and-auth.md) and the
> registry once the follow-up ships, and this file goes.

Researched on 15 October 2026, against upstream `main` at `e3fbf929`. The
person fetched it on the host that morning; the task branch started at
`83e6a4ab` and was fast-forwarded to it, and `origin/main` (`ee10a31e`) is
older still. OpenCode 1.19.0 and 2.0.29 ran in throwaway homes inside
Althar's Flatpak sandbox. The person's own OpenCode, config, data and
sign-ins, and Althar's profile, were not touched. **[V]** marks what was run
here, **[D]** what OpenCode's docs say, and **[C]** a claim made only by a
third party.

## The answer

**Not by default, not yet.** Althar already runs OpenCode 2 if the person has
it. The person's own install always wins (`installs.ts`), so an
`opencode upgrade --major` in their terminal switches Althar too. Most of it
works unchanged: the ACP handshake, sessions, modes, models, effort, the
inline ask rules, interrupts and questions. Four things break or go wrong, and
two of them are safety or account problems:

1. **Rejecting a command ends the whole turn** (`stopReason: "cancelled"`),
   where on 1.x the turn carries on. 2.x ignores
   `experimental.continue_loop_on_deny` [V][D].
2. **The sign-in check can't tell, and can read the wrong account.**
   `opencode auth list` no longer prints "N credentials", so every 2.x
   account shows "can't tell" [V]. Without `--standalone`, it goes through a
   background service shared by the whole user, which answers with the data
   of whichever account's home started it [V].
3. **A home 2.x has opened can't be opened again by 1.x** if 2.x created it
   ("Database is not empty and has no session table") [V]. Sessions from 1.x
   are copied into 2.x once, not kept in step [V].
4. **`OPENCODE_CONFIG_DIR` replaces the person's global config folder** in
   2.x, where 1.x adds it alongside [V]. Separately, the way Althar switches
   off the person's MCP servers is a form 2.x says it ignores [D,
   unverified here].

Recommendation: keep 1.x as the supported line, pin Althar's own download to
1.x, and say plainly in Settings when the person's OpenCode is 2.x. Then make
the adapter version-aware in the stages below, and switch the default only
once a signed-in contract run passes on 2.x.

## What OpenCode 2 is

- **Release status.** The binaries are published on npm as `@opencode/cli`,
  tagged `latest`: 2.0.0 on 11 September 2026, 2.0.29 on 14 October 2026,
  30 versions in five weeks [V, npm registry]. The old package `opencode-ai`
  stays at `latest: 1.19.0` [V]. On GitHub, `anomalyco/opencode` (formerly
  `sst/opencode`) has tags `v2.0.0`–`v2.0.29` but **no GitHub Releases for
  2.x**: its latest release is v1.19.0 [V, GitHub API]. The
  [Anomaly announcement](https://anoma.ly/notes/opencode-2-0/) (undated)
  treats 2.0 as the current product. The
  [New Stack piece](https://thenewstack.io/opencode-2-shared-service/)
  (12 October 2026) reports doubts about whether it is stable [C, only its
  summary was readable]. No support policy or end date for 1.x was found
  anywhere.
- **The upgrade path.**
  [v1.19.0](https://github.com/anomalyco/opencode/releases/tag/v1.19.0)
  (11 October 2026, 01:39 UTC) adds `opencode upgrade --major` "to OpenCode
  2" and stops installing updates automatically (`/update` instead). v1.18.35
  was 6 October [V].
  [Migrate from V1](https://opencode.ai/v2/docs/migrate-v1/) [D]: 1.x and
  2.x both use the `opencode` command and aren't installed side by side by
  default, and the curl installer replaces the 1.x binary. The npm package
  ships `opencode` and `opencode2` [V].
- **Breaking changes** [D, migrate guide]: the plugin API (1.x plugins don't
  run), the server API and clients (`@opencode/client`), and the terminal
  client's config (`tui.json` becomes one global `cli.json`). "Supported V1
  behavior outside these areas should remain compatible."
- **Config** [D]: the same locations as 1.x, with 1.x fields normalised in
  memory. Renames include `permission` → an ordered `permissions` array of
  `{action, resource, effect}` (`bash` → `shell`, `task` → `subagent`);
  `agent` → `agents`; MCP servers under `mcp.servers` with `disabled`;
  `skills` as one array; and `autoupdate` → `update`
  (`auto`/`notify`/`disable`, read only from the global config). **Ignored
  with a warning:** `experimental.continue_loop_on_deny`, and "enabled-only
  MCP entries without `type`". 2.x runs no language servers. It doesn't read
  `CLAUDE.md`.
- **CLI** [V, `--help`]: new are `service`, `api`, `pair`, `reload`, `mini`
  and `--standalone` (a private server instead of the background service);
  `auth` gains `logout`, `export`, `import` and `switch`, and `auth list`
  gains `--format json`. `acp` remains, with `--login`. `providers`,
  `agent`, `github`, `pr`, `export`/`import`, `db` and `web` are gone from
  the top level.
- **The background service** [V][D]: one `opencode serve --service` per
  user, started by any CLI command that needs a server, detached, left
  running. On this machine it listened on `127.0.0.1:49374`. Where it is and
  its id are in `$XDG_STATE_HOME/opencode/service.json`, its password in
  `$XDG_CONFIG_HOME/opencode/service.json`.
- **ACP** ([ACP docs](https://opencode.ai/v2/docs/cli/acp/)) [D, checked
  [V]]: still `opencode acp`, ACP protocol version **1**, newline JSON-RPC
  on stdio. It starts a private server and doesn't use the background
  service. Capabilities: `loadSession`; `session` close, delete, fork, list,
  resume and `additionalDirectories`; MCP over HTTP but not SSE; images and
  embedded context. New are questions as `elicitation/create` forms, usage
  in the prompt response, and `usage_update` with the session's cost in USD.
- **Data** [V, `debug paths`]: still `$XDG_DATA_HOME/opencode`
  (`opencode.db`, `log/`, `repos/`, `shell/`). Credentials move from
  `auth.json` into `opencode.db`.

## How Althar finds and runs OpenCode today

- **Registry** (`packages/provider-adapters/src/registry.ts`, the `opencode`
  entry): `opencode acp` with `OPENCODE_CONFIG_CONTENT` (the ask rules and
  `continue_loop_on_deny`, `openCodeBase`) and `inheritEnv:
  ['OPENCODE_CONFIG_DIR']`. Sign-in is `opencode auth list`, read by
  `/(\d+)\s+credentials?/`, with `opencode auth login` in a terminal. The
  version comes from `opencode --version`. A review's lead gets
  `OPENCODE_DISABLE_PROJECT_CONFIG=1` and `lsp: false`
  (`openCodeReviewing`). The person's MCP servers are switched off by
  `openCodeWithoutOwnTools` (`ownTools.ts`). The account home is
  `XDG_DATA_HOME`, with everything but `opencode/` linked in (ADR-012). The
  probe dates in the header are 1.18.31 (28 September) and effort on
  8 October, plus "seen 9 October 2026, v1.18.35" on the download.
- **Finding it** (`provider-adapters/src/installs.ts`): the person's
  `opencode` on the PATH or in the usual folders (`~/.opencode/bin`,
  `~/.local/bin`, `~/.bun/bin`, Homebrew, `/usr/local/bin`), else a copy
  Althar downloaded. No version is checked or pinned: whatever they have
  runs.
- **Downloading it** (`runtime/src/Installs.ts`): at the person's asking,
  GitHub's `releases/latest` for `anomalyco/opencode`, checked against
  GitHub's sha256, kept under the profile. Today that is **v1.19.0** [V],
  because 2.x isn't released on GitHub. If Anomaly starts publishing 2.x
  there, Althar's download switches to 2.x silently.
- **Flatpak** (`apps/desktop/flatpak/dev.althar.app.yml`, ADR-027): no
  OpenCode is bundled. The person's own runs on the host through
  `flatpak-spawn`, else the downloaded copy. `scripts/flatpak-smoke.sh` only
  checks that `opencode --version` prints a number, which `opencode v2.0.29`
  does.
- **Version shown in Settings** (`provider-adapters/src/version.ts`): the
  first `\d+.\d+.\d+`, so `2.0.29` [V].

## Compatibility matrix

1.19.0 and 2.0.29, each in an isolated home. "Contract" is Althar's own
`bun run test:agents tests/agents/real.test.ts` with `ALTHAR_AGENTS=opencode`
and nothing signed in.

| Touch point (file) | 1.x (1.19.0) | 2.x (2.0.29) | |
| --- | --- | --- | --- |
| Found by name (`installs.ts`) | `opencode` | `opencode` (also `opencode2` from npm) | works [V] |
| Althar's download (`Installs.ts`) | `releases/latest` = v1.19.0 | not on GitHub Releases | 1.x today [V]; unpinned |
| Version (`version.ts`) | `1.19.0` | `opencode v2.0.29` → `2.0.29` | works [V] |
| ACP handshake | v1; contract passes | v1, `OpenCode 2.0.29`; contract passes | works [V] |
| Session start in the mode asked | passes | passes (mode is a config option only, no legacy `modes`) | works [V] |
| Inline ask rules beat a repo's `allow` (`OPENCODE_CONFIG_CONTENT`) | asks | asks; the inline document is the last source, `permission` normalised to `permissions` | works [V] |
| Permission option ids (`permissions` in the registry) | `once`, `always`, `reject` (registry, 29 Sept) | `once`, `always`, `reject` (the docs say `allow_once`…; `answerFor` falls back on kinds either way) | works [V] |
| **A rejected command, then the turn carries on** | carries on (`continue_loop_on_deny`, registry) | **turn ends `cancelled`**; contract fails | **breaks** [V] |
| Questions (`asks` in the contract) | in words | as an `elicitation` form; Althar's form path passes once `asks: 'form'` | change [V] |
| Streaming, interrupt, withdrawing a waiting permission | not run: 1.19's free tier refuses ACP clients | pass | works [V] |
| Model list, effort (`options`, `ownEffort: 'default'`) | (probe of 8 October) | `model`, `effort` (`thought_level`, includes `default`) and `mode` at session start; also lists a local Ollama's models | works [V]; switching unverified (needs a sign-in) |
| Usage over ACP | not checked | `usage` in the prompt response, `usage_update` with cost | new [V] |
| **Sign-in status (`signIn.read`)** | `└ 1 credentials` | `OpenAI  API key  stored`; `--format json` gives `[{id, name, connections:[{type, method, label}]}]` | **always "can't tell"** [V] |
| **Status per account (ADR-012)** | reads the home's `auth.json` | through the user-wide service: answers from whichever home started it, or waits out the 15 s timeout if the port is taken; `--standalone` reads the home's own | **wrong account** [V] |
| Login line (`signIn.login`) | `opencode auth login` | same name; goes through the service unless `--standalone` (which it accepts); `acp --login` is new | unverified per account |
| Credentials in an existing home | `auth.json` | imports `auth.json` into `opencode.db` on first run and leaves the file | survives [V, a fake key] |
| History in an existing home | `opencode.db` | adds tables; lists and `session/load`s the 1.x session, but as a copy taken once | one-way [V] |
| **Back to 1.x** | n/a | a home 2.x created: 1.x fails ("no session table"); a home 1.x made first: 1.x still works | **one-way** [V] |
| Data home (`home.variable: XDG_DATA_HOME`) | `opencode/` | `opencode/`, but the service's state and password are under `XDG_STATE_HOME`/`XDG_CONFIG_HOME`, which aren't per account | partly [V] |
| `OPENCODE_CONFIG_DIR` (`inheritEnv`, skills projection) | read alongside `~/.config/opencode` (`ownTools.ts`) | **replaces** `~/.config/opencode`: its `opencode.json` is no longer read | change [V] |
| `OPENCODE_DISABLE_PROJECT_CONFIG` (`openCodeReviewing`) | drops the repo's config (registry, 14 Oct) | drops the repo's `opencode.json` and `.opencode/` | works [V] |
| `lsp: false` (`openCodeReviewing`) | stops language servers | 2.x runs none | moot [D] |
| Switching off the person's MCP servers (`ownTools.ts`: `{name: {enabled: false}}`) | `mcp list`: "disabled" | the migrate guide says this form is ignored; `mcp list` shows no servers either way here | **likely breaks**, unverified |
| The person's plugins | run | 1.x plugins don't run | theirs to port [D] |
| Skills and agents folders | `.opencode/skills`, `.claude/skills`, `.agents/skills`, global config | `.opencode/skill(s)`, the config folder's; doesn't read `CLAUDE.md` | partly [D] |
| Inside the Flatpak sandbox (the downloaded copy) | runs | runs; unpacks `.bun-*.so` into `TMPDIR` | works [V] |
| The person's own on the host (`flatpak-spawn`) | smoke script | the same smoke check passes on the version line | unverified on a host |
| Self-update into its own folder | 1.19: never automatic | `update: auto` exists, read only from the global config; the default isn't documented | unverified |

Run on 15 October 2026. Contract on 1.19.0: 3 passed and 7 failed, all
seven on "OpenCode's free tier can only be used from within OpenCode" or the
OpenCode Go model the check switches to. On 2.0.29: 7 passed and 3 failed,
namely the model switch (needs Go, as on 1.x), the turn carrying on after a
rejection, and the question asked in words.

## What breaks in Althar, by file

- **`registry.ts`, `openCodeBase`.** `continue_loop_on_deny` is ignored, and
  a rejection ends the turn. Althar's `answerFor` still sends `reject` as
  "carries on" (`rejectAndContinue: ['reject']`), so the session thinks the
  turn goes on while OpenCode has cancelled it. Either OpenCode gets a 2.x
  setting for this (none in the docs; ask upstream), or on 2.x `reject` is
  `rejectAndStop` and Althar tells the lead what was refused in its next
  prompt. The knownGap text changes with it.
- **`registry.ts`, `signIn`.** On 2.x, `status` should be
  `auth list --standalone --format json`, and `read` should count entries
  with a `credential` connection. `--standalone` is what keeps each
  account's check on its own home. On 1.x it stays as it is. `paidBy` could
  read `method` (`key` against `chatgpt-*` and others), which is what the
  plan-usage design is missing.
- **`registry.ts`, `signIn.login` and `inApp`.** A login in a terminal for an
  account needs `--standalone` on 2.x, or it may save into the home of
  whichever account's service is running (inferred from the status
  behaviour; not run).
- **`registry.ts`, the knownGaps and the header.** The probe dates and
  versions, and "its sign-ins are `opencode/auth.json`" (now `opencode.db`;
  deleting the home still removes them).
- **`ownTools.ts`, `openCodeWithoutOwnTools`.** On 2.x, write
  `mcp.servers.<name>.disabled: true`. And on 2.x with
  `OPENCODE_CONFIG_DIR`, `~/.config/opencode` is no longer read, so the list
  of files read changes.
- **`openCodeReviewing`.** Holds (`OPENCODE_DISABLE_PROJECT_CONFIG` checked).
  The `websearch: 'ask'` key should map to 2.x's `websearch` action, but
  that wasn't checked.
- **`tests/agents/real.test.ts`.** `asks.opencode` becomes `'form'` on 2.x,
  and the contract needs a way to run against each major.
- **`runtime/src/Installs.ts`.** Pin to 1.x (a tag, or `releases` filtered
  to `v1.*`) until 2.x is supported. 2.x would come from npm
  (`@opencode/cli-<platform>`, sha512 integrity), not GitHub Releases, so
  the download needs a second source.
- **Account homes (ADR-012, `home`).** Nothing per account covers the
  service's state and password. Every command Althar runs must be
  `--standalone` or `acp`, or Althar must give each home its own
  `XDG_STATE_HOME`. Its own `XDG_CONFIG_HOME` would also cut the person's
  config, so no.
- **Flatpak.** No manifest change. Worth knowing: a 2.x command run on the
  host without `--standalone` leaves a background server running there, on a
  loopback port, after Althar quits.

## Implications

- **What the person does.** Running `opencode upgrade --major` (or
  installing `@opencode/cli`) outside Althar changes the binary Althar runs,
  at once. Their existing Althar accounts keep their sign-ins: 2.x imports
  each home's `auth.json` [V]. But from then on 1.x may refuse those homes
  (a home 2.x created certainly; one it only migrated still opened with 1.x
  in the one test here), and history diverges. Going back to 1.x after
  using 2.x through Althar is not safe.
- **The safest default.** Stay on 1.x, and detect the major from the version
  Althar already reads. On 2.x, until the follow-up lands, show the gaps in
  Settings; don't block, since it is the person's own install. Offering both
  side by side isn't practical: OpenCode doesn't install them side by side,
  and the homes don't go back.
- **Migrating accounts.** Nothing for Althar to do for sign-ins. Once 2.x is
  supported, a note per account ("opened with OpenCode 2; OpenCode 1 can't
  open it again") is enough.
- **Plan-usage design** (`plan-usage-data-acp-vs-api-research-and-design`).
  It reads `opencode auth list`. On 2.x that output changes, and must be
  `--standalone`. `--format json` gives a provider and a method per
  credential, which may settle "plan or key" without reading a credential
  store. ACP now carries usage and cost per turn.
- **Skills projection** (`skills-for-every-harness-default-set-user-instal`).
  On 2.x, an isolated `OPENCODE_CONFIG_DIR` *replaces* the person's global
  config folder, providers and all, not just skills. That favours projecting
  into the config folder, but the person's `opencode.json` then has to be
  carried in too.
- **Security doc** (`security-privacy-threat-model-and-audit-kickoff`).
  `OPENCODE_DISABLE_PROJECT_CONFIG` holds on 2.x. Three findings feed it:
  the MCP switch-off is likely void on 2.x; a user-wide service on a
  loopback port, with a password in the config folder, outlives Althar; and
  2.x logs CLI arguments to `log/opencode.log`, so a key passed as
  `--answer` would land there (a key typed at the prompt didn't).
- **Free models.** 1.19 refuses its free tier to ACP clients. 2.x serves it,
  which made the turn checks above possible without anyone's key.

## Follow-up, staged

1. **Now, small.** Pin `Installs.ts` to 1.x. Show the major in Settings, and
   on 2.x list the gaps (rejections end the turn; sign-in can't tell). Add
   the probe dates.
2. **Sign-in on 2.x.** `--standalone --format json` status, and a
   `--standalone` login line. Parse by version (`versionIn`, major ≥ 2).
   Unit tests on recorded output.
3. **Rejections.** Ask upstream for a 2.x way to carry on after a deny.
   Meanwhile, `rejectAndStop` on 2.x, with the lead told what was refused.
   The contract runs per major, with `asks: 'form'` on 2.x.
4. **Config by version.** Native 2.x inline config (`permissions`,
   `mcp.servers…disabled`), checked over ACP that the person's MCP servers
   stay off. Agree `OPENCODE_CONFIG_DIR` semantics with the skills plan.
5. **Homes.** A note when a home has been opened by 2.x. Never fall back to
   1.x on such a home.
6. **Switch the default.** Once 2–5 pass a signed-in contract run on 2.x,
   download 2.x from npm with its integrity checked, keep a supported range
   (`>=2.0.29 <3`), and re-probe on each minor.

## Not tried

- A signed-in session on either version, and model switching. No paid
  sign-in was used, on purpose.
- The person's own OpenCode on the host through `flatpak-spawn`, and the
  Flatpak smoke script itself.
- `opencode upgrade --major` itself. It replaces the binary in place, and
  was not run anywhere near the person's install.
- Whether 2.x honours the MCP switch-off over ACP. `mcp list` showed no
  servers in any case, so it doesn't answer this.
- 2.x's self-update default, and whether file-based agents and skills in an
  `OPENCODE_CONFIG_DIR` are discovered (`debug agents` listed only built-in
  agents either way).
- A login from one account's terminal landing in another's home: inferred
  from `auth list` through the service, not run.

## Sources

- [Release v1.19.0](https://github.com/anomalyco/opencode/releases/tag/v1.19.0), 11 October 2026 (GitHub API: published 01:39 UTC; `releases/latest`; tags `v2.0.0`–`v2.0.29`, no 2.x releases; read 15 October)
- npm registry: [`@opencode/cli`](https://www.npmjs.com/package/@opencode/cli) 2.0.0 (11 September 2026) to 2.0.29 (14 October 2026), `latest`; [`opencode-ai`](https://www.npmjs.com/package/opencode-ai) `latest: 1.19.0` (read 15 October)
- [OpenCode 2.0](https://anoma.ly/notes/opencode-2-0/), Anomaly's announcement (undated)
- [Migrate from V1](https://opencode.ai/v2/docs/migrate-v1/), [ACP](https://opencode.ai/v2/docs/cli/acp/), [Permissions](https://opencode.ai/v2/docs/permissions/), [Config](https://opencode.ai/v2/docs/config/), [CLI settings](https://opencode.ai/v2/docs/cli/config/), and the [config schema](https://opencode.ai/config.json) (all read 15 October 2026)
- ["A major overhaul": OpenCode 2.0 puts its terminal, desktop, and web apps on one shared service](https://thenewstack.io/opencode-2-shared-service/), The New Stack, 12 October 2026 (headline and summary only)
- [OpenCode 1.19.0 opens the upgrade path to OpenCode 2](https://aicoder.com/news/news-20261012-opencode-2-upgrade-path-v1-19), AICoder, 12 October 2026 (secondary)
