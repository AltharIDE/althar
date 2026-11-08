# Skills across harnesses: shared defaults, installs, and repository boundaries

**Status:** Partly built; what landed and what didn't is under [Implementation status](#implementation-status). Decisions: [ADR-094](../decisions/the-persons-setup.md#skills), [ADR-095](../decisions/the-persons-setup.md#skill-and-openspec-files-in-a-change). **Changed 8 Nov 2026:** Althar ships no skills of its own; the default catalog of this plan's section 6 was built, then taken out ([section 6](#6-default-catalog-dropped))
**Research checked:** 2026-10-14
**Upstream baseline:** `upstream/main` at `818df85e35ce4aa704334ffd846878750a30702c`

## Goal

Give every harness Althar runs the same Althar-managed skills: what the person
adds from GitHub, with per-project selection, and reviewed installs and updates.
Althar carries no default set of its own. Use the open Agent Skills directory format so the skill content does
not fork by provider. Keep managed skills and OpenSpec artifacts outside
project repositories by default. A person must explicitly change a project's
setting before Althar may place these files in that repository.

This extends the skill entities, scopes, run snapshots, and script safeguards
already proposed in [architecture 06, “Skills”](../architecture/06-integrations-and-skills.md#skills).
The architecture doc remains the broader model; this plan narrows the store,
adapter delivery, GitHub lifecycle, OpenSpec location, and repository guard.

## Current behavior

The task branch began at `83e6a4ab0b2f`. I fetched `upstream/main` on
2026-10-14; it was `818df85e35ce`, 72 commits ahead. The branch was clean and
was fast-forwarded to that fetched commit before this design was written. The
adapter registry currently has three connected harnesses: Claude Code, Codex,
and OpenCode. Its `home.shared` filters select existing files and folders to
share in Althar-managed homes; they do not form a common skill catalog or
install/update mechanism. [The registry](../../packages/provider-adapters/src/registry.ts)
does not resolve a common set or pin skill versions for a run.

| Harness | Native skill discovery documented upstream | What Althar currently shares |
| --- | --- | --- |
| Claude Code | Personal `~/.claude/skills`; project `.claude/skills`; nested project directories and managed/plugin locations. | Its `CLAUDE_CONFIG_DIR` home shares `skills` along with settings, instructions, agents, commands, plugins, and output styles. The adapter does not populate or update that directory. |
| Codex | Project `.agents/skills` from the current directory up to repository root; user `$HOME/.agents/skills`; admin and bundled locations. | Its `CODEX_HOME` (normally `~/.codex`) shares a folder named `skills`, plus config, instructions, prompts, and rules. The current Codex docs identify `$HOME/.agents/skills` as the user skill root, so this path deserves an adapter version probe rather than assuming the existing `CODEX_HOME/skills` link is sufficient. |
| OpenCode | Project `.opencode/skills`, `.claude/skills`, and `.agents/skills`; global `~/.config/opencode/skills`, `~/.claude/skills`, and `~/.agents/skills`. | The registry shares OpenCode's data home (normally under `XDG_DATA_HOME`) except its own `opencode` folder. That does not include global skills under the separate config home (`~/.config/opencode/skills`). There is no skill-specific selection or projection in the registry. |

Sources: [Claude Code skills](https://code.claude.com/docs/en/skills),
[Codex skills](https://developers.openai.com/codex/skills/), and
[OpenCode skills](https://opencode.ai/docs/skills/). The precise behavior of
the bundled Claude/Codex adapter versions and installed OpenCode version must
continue to be checked when those dependencies change. Native project skills
may already be visible to a harness even though Althar has no manager for
them; they are not evidence that all harnesses see the same set.

## Proposed design

### 1. One canonical skill format and store

Use the Agent Skills specification: one directory per skill with `SKILL.md`
and optional `scripts/`, `references/`, and `assets/`. Require and validate
`name` and `description`; retain optional `license`, `compatibility`, and
string-valued `metadata`. Provider-specific fields stay namespaced in
`metadata`. The specification says scripts are executable code and supports
progressive loading, so installation is a content operation, not permission
to run a skill's scripts.

Keep the canonical files in Althar's per-user application data, outside every
project checkout, with metadata in Althar's store. A proposed layout is:

```text
<Althar user data>/skills/
  objects/<content-hash>/       # immutable skill trees
  installs.json                # source, pinned commit, path, hashes, review state
                               # (source: github | local)
  runs/<run-id>/<adapter>/      # read-only adapter projection for one run
```

Althar carries no skills of its own (decided 8 Nov 2026, [section 6](#6-default-catalog-dropped)):
the store holds what the person adds.

Skills the person installs use the store and format described here. First-run migration may
scan recognized native skill roots, show a names-and-paths inventory, and let
the person copy selected skills into Althar. For each imported skill, record
a GitHub repository, subpath, and resolved commit SHA only when the source can
be matched and verified. If it cannot be matched, mark it `local` with its
import-time content hash; it can only be refreshed by an explicit user
re-import/reinstall action, not by a GitHub update check. Migration must leave
existing harness folders untouched and must not silently overwrite a
same-named skill.

### 2. Per-project selection and reproducible resolution

Add per-project skill bindings in Althar's project settings, not a manifest
inside the repository. A binding names a skill identity and exact installed
version; it can enable a default, disable it for this project, or pin a
user-installed skill. Project selection overrides the user's default set.
Conflicting names are shown with both sources and versions and require a
choice; Althar must not silently concatenate or pick one.

At run admission, resolve one selected set and snapshot its skill IDs,
content hashes, source scopes, compatibility result, and activation reason.
The same resolved set is the contract for Claude Code, Codex, and OpenCode.
Each adapter projects those exact immutable versions outside the repository
and read-only for that run:

- Claude Code: the isolated `CLAUDE_CONFIG_DIR/skills` native root.
- Codex: the isolated user root's `$HOME/.agents/skills`; verify how the
  supported build resolves this alongside `CODEX_HOME` before implementation
  and never write to the person's actual home.
- OpenCode: the documented global skills root, `~/.config/opencode/skills`,
  inside an isolated per-run home. Do not put the projection in the repository
  or assume `OPENCODE_CONFIG_DIR` changes skill discovery: its config docs
  document that variable for agents, commands, modes, and plugins. Probe the
  minimum supported OpenCode version to confirm how it resolves the isolated
  home and whether an explicit skills-directory config is stable before
  relying on it.

Codex project exclusions should also use its documented per-skill
`[[skills.config]]` entry with `enabled = false` for the skill path, in the
isolated run config. Keep the resolved projection limited to selected skills
as the primary control; the config entry handles a discovered/native skill
that must be disabled. Codex may shorten descriptions or omit skills when its
initial list exceeds the default budget (about 2% of context, or 8,000
characters when context size is unknown); `skills.max_context_tokens` can
change that budget. Preflight should estimate the list, warn when it may
be truncated, and report any omission warning from Codex rather than claim
that the full selected list reached the model.

Add a skill-delivery capability to each registry entry instead of extending
the broad `home.shared` allowlists. A running task keeps its snapshot;
install, update, or project-setting changes apply only to later runs.

Native skills already found inside a user's repository remain repository
content, not Althar-managed installs. During preflight, report their names and
paths and identify same-name collisions. Include them in Althar's shared set
only through an explicit project selection/import. Where a harness cannot
disable automatic native discovery, report the extra native skills rather
than claiming that its full effective skill list is identical. Verify and
document any native-discovery suppression before making parity a strict
guarantee.

### 3. GitHub install, review, pinning, and updates

An install starts from a GitHub repository and a selected skill directory (or
catalog entry). Resolve a branch or tag once to a full commit SHA, fetch only
that subtree, and store per-file hashes plus the SHA and subpath. Updates
resolve the chosen ref again only when the person asks to check or update;
they never follow a moving branch during a run. The GitHub content API accepts
a commit, branch, or tag as `ref`, and the Git reference/commit APIs expose
the resolved SHA ([contents API](https://docs.github.com/en/rest/repos/contents#get-repository-content),
[Git references](https://docs.github.com/en/rest/git/refs)).

Before install or update, stage the new immutable version and present a
review card with publisher/repository, subpath, resolved SHA, license,
`SKILL.md` instructions and triggers, complete file list, content hash, and a
diff against the installed version. Highlight permission-/lifecycle-related
frontmatter fields with their values and provider semantics. Claude Code
treats `allowed-tools` as a temporary pre-approval grant for the invoking
turn and registers skill `hooks` for the rest of the session. Reject either
field during default installation and update validation; do not silently
discard a field or deliver it to Claude Code. Any future exception would
need a separate explicit trust decision and must still be constrained by
Althar's permissions. Codex's skill guide documents no SKILL.md permission
grant equivalent to Claude's `allowed-tools` or skill-level `hooks`; its
general hooks are configured separately. The Agent Skills specification
marks `allowed-tools` experimental, so Althar must not assume Codex enforces
it. OpenCode documents `name`,
`description`, `license`, `compatibility`, and `metadata`, and ignores
unknown frontmatter fields, with no documented skill-level `hooks`
equivalent; its skill allow/ask/deny control is the separate
`permission.skill` config. Althar should reject unsupported
authorization-like fields before projection even where a provider currently
ignores them. The card also highlights executable files, external links,
environment/runtime requirements, and any new scripts. The person chooses
whether to activate that version. Do not execute install hooks, build
scripts, or skill scripts while fetching, validating, or previewing.
Private repositories should use the existing GitHub connection for
read-only content access; never ask a skill to handle a GitHub token.

Validate the Agent Skills metadata and directory-name rules. Reject path
traversal, unsafe symlinks, files that escape the skill root, malformed
frontmatter, and excessive file counts/sizes. Reject, at fetch time, any
selected path outside the chosen skill directory, so a repository's `hooks/`,
`commands/`, plugin manifests (`.claude-plugin/`, `.codex-plugin/`, and
similar) and `package.json` are never fetched or stored. Inside a skill
directory, preserve all relative resources so skill references keep
working; the review card flags executable files there. Trust labels such as `Althar default`,
`reviewed by user`, and `not reviewed` describe provenance/review only;
they do not grant tools, filesystem access, network access, secrets, or
approval. Harness-specific skill fields can still affect the harness:
Claude's `allowed-tools` and `hooks` are rejected by default as above, while
OpenCode's `permission.skill` and Codex's skill enablement config are
generated only from Althar settings. Skills and scripts inherit the run's
existing Althar permission and sandbox rules. A signature may help establish
publisher identity but does not establish safety, as noted in the existing
architecture.

The update screen should show installed, available, and changed versions and
support update one/update selected. Never auto-replace an active version or
move a user's existing home installation. Keep old immutable versions while
a run references them; garbage-collect only unreferenced versions after a
retention period.

### 4. Repository boundary and project setting

Default destinations are Althar-owned data for both skills and OpenSpec.
Materialize skills under the app data run overlay, not in `.agents/skills`,
`.claude/skills`, `.opencode/skills`, or any project path. Do not initialize
OpenSpec in a user's repository on project import or task start.

Expose a **Repository files** section in each project's Althar settings, with
three independent, default-off choices:

| Setting | Default | When enabled |
| --- | --- | --- |
| Write Althar-managed skills | App-managed store | A requested repository write targets the exact harness-native paths: Claude Code `.claude/skills/<skill-id>/`, Codex `.agents/skills/<skill-id>/`, and OpenCode `.opencode/skills/<skill-id>/`. For a task targeting multiple harnesses, show every destination and obtain consent for that set. Show the file diff and provenance like other task changes. |
| Write OpenSpec artifacts | Private Althar store | The person explicitly permits OpenSpec `openspec/` artifacts to live in and be versioned with this repository. |
| Push skill/OpenSpec files | Blocked | The person separately and explicitly permits Althar to push changes under the protected skill roots or `openspec/` for this project. This never follows from either write setting. |

Each enabled setting is durable, per-project consent visible in settings and
revision history; an agent or task prompt cannot silently change it. A write
setting authorizes only the named repository destination when a task
explicitly asks for the operation. It does not auto-install, sync, commit, or
push. The separate push setting is the required explicit consent for these
file classes to leave the machine; it does not itself initiate a push, and
Althar's ordinary task/branch push flow still applies. With a write setting
off, a direct user request for repository-backed files needs a one-time
confirmation naming the destination before Althar writes them. The UI should
say plainly that repository-backed files can appear in a task diff, can be
committed only when repository-write consent permits, and can be pushed only
when the separate push consent is enabled.

When a destination is app-managed, provide the agent a read-only skill bundle
and OpenSpec context from outside the checkout. Keep OpenSpec authoring in
Althar's project/task data and expose edits through an Althar-controlled path;
do not rely on a normal `openspec/` directory or on `.gitignore` to enforce
privacy. OpenSpec's standard project flow stores specs and changes under
`openspec/` and treats them as versioned project files
([team workflow](https://github.com/Fission-AI/OpenSpec/blob/main/docs/team-workflow.md)).
Its current upstream docs also describe **beta** standalone stores and a
`--store` option, including a model for keeping planning outside a code repo
([stores guide](https://github.com/Fission-AI/OpenSpec/blob/main/docs/stores-beta/user-guide.md)).
Evaluate that CLI path at implementation time; its beta state and machine
registry are reasons to keep Althar's private store as the stable boundary.

Make path-sensitive write denial a release requirement: verify it covers each
harness's file-edit and shell-write routes for managed skill/OpenSpec paths.
If a harness cannot enforce that inside the repository, keep Althar's
artifact-authoring route entirely in the external store for that harness until
it can; do not describe a staging check alone as preventing writes.

Define protected repository paths independently of provenance: every
supported native skill root at any repository depth (`**/.agents/skills/**`,
`**/.claude/skills/**`, and `**/.opencode/skills/**`) and `**/openspec/**` (so a monorepo subproject is covered; a docs folder that happens to be named `openspec` needs a one-time grant).
Before staging or committing, inspect changed
paths and block changes under a skill root when its write setting is off, or
under `openspec/` when the OpenSpec write setting is off, unless an explicit
one-time grant names that destination. This check applies even if no Althar
marker exists or a harness wrote the file. Before pushing, apply the same
path-based check and also block any protected path unless the separate push
setting is enabled. These Git checks are defense in depth and cover untracked
files and renames; provenance from Althar's install/sync/authoring records is
a secondary signal for managed files written outside the known roots. Fail
closed on unknown path classification or missing setting state. Do not infer
consent from a task plan, repository instruction, a write toggle, or an
ignored path. The
`/openspec/` ignore rule in Althar's own `.gitignore` protects only this
repository and is not a boundary for a user's repository.

### 5. OpenSpec use in Althar

Treat OpenSpec artifacts as task/project planning data with an explicit
lifecycle: proposal, requirements/spec deltas, design, tasks, verify, sync,
and archive. Link them to Althar's project and task records so agents on any
harness get the same artifact context and Althar can show progress without
depending on harness-specific OpenSpec skills. The default private mode must
not write workflow instruction files (for example `.agents/skills/openspec-*`)
or planning files into the code checkout. Althar can ship a reviewed
cross-harness OpenSpec skill set in its catalog, but the task workflow and
write boundary remain Althar-owned.

If OpenSpec's beta store path proves stable for the pinned CLI, Althar may
use a non-repository store per project; otherwise, keep the compatible
proposal/spec/design/tasks files in Althar data and mediate them through
Althar. Repository mode remains opt-in and uses the normal OpenSpec layout.
In either mode, OpenSpec itself does not commit or push; Althar must keep its
own push path from publishing private-store artifacts by construction.

### 6. Default catalog (dropped)

This section planned a default set: 32 skills copied from
[addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) and
[obra/superpowers](https://github.com/obra/superpowers) at pinned commits, each
with its licence and the patches Althar applied, shipped with the app and kept
in the store as `althar-default`. It was built (2026-10-18) and used until
8 Nov 2026, when the person decided **Althar ships no skills of its own**.

Why it went: a default set is Althar choosing how every lead works, patched
and carried by Althar's releases, while the person's own agents already load
the skills they chose. What the person has comes from their agents' own skill
folders and plugins, the repository's `.claude/skills`, and what they add from
GitHub through the review card of section 3.

What went with it: `packages/skills/catalog/` (the 32 skills, `catalog.json`,
`CURATION.md`, the licences and `THIRD_PARTY.md`), the scripts that vendored
and curated it, the loader that installed it, the desktop app's packaging step
and `ALTHAR_SKILLS_CATALOG`, the `althar-default` source, the catalog's hash
and revision, and the first-run switch that turned it on. What stays: the
store, GitHub install, review, updates and rollback, validation, projection
and the repository guard.

**On the first start after the update,** the runtime takes the installs the
older Althar made (`althar-default`) out of the person's store, so no run is
given them again, with the stored versions nothing else points at.
What the person added from GitHub is left as it was. Until that has run, a
read of the store leaves those installs out (`packages/skills/src/legacy.ts`).

The licence and provenance notes that came with it are in this file's history,
and the catalog itself in the repository's, before this change.

## Staged implementation after the newest Althar

1. **Lock product decisions.** Confirm per-project skill selection; pin
   supported harness versions; decide whether to consume OpenSpec's beta
   stores or keep artifacts in Althar's own store.
2. **Build the store.** Add immutable local versions and provenance; import selected existing skills without
   changing harness homes; add Agent Skills validation and safe GitHub fetch.
3. **Add review and updates.** Add GitHub source entry, pinned checkout,
   changed-file diff, install approval, manual update check, rollback, and
   old-version retention.
4. **Resolve and deliver per run.** Add user/project bindings, conflict
   handling and run snapshots; implement isolated projections for each
   adapter; add parity/collision diagnostics and probe current native roots.
5. **Add project guardrails and OpenSpec.** Add independent default-off skill
   write, OpenSpec write, and protected-file push consent settings; private
   OpenSpec storage/context; path-sensitive write denial; and path-based
   checks before staging/commit/push, with provenance as a secondary signal.
   Add repository mode only behind the corresponding explicit setting.
6. **Verify before release.** Exercise all adapters against the same fixture
   skills; prove an app-managed skill and OpenSpec change never appears in
   a repository or task diff; prove opt-in repository mode is visible in the
   diff and follows normal commit/push policy; test update pinning, rollback,
   malformed archives, unsafe paths/symlinks, and unchanged active-run
   snapshots.
7. **Document.** Once the implementation is final, write the ADR and docs
   below; not before, so they describe what shipped.
   - **ADR (next free number in `docs/decisions/`, currently 036):** "Skills
     are one shared store." Records the shared store and per-run projection,
     the reject-by-default frontmatter and subtree-only install rules, and the
     repository boundary (default-off write, OpenSpec and push settings).
     Possibly a second ADR for the repository boundary alone, since it
     amends [ADR-013](../decisions/what-agents-may-do.md#the-persons-rules) project rules.
   - **Docs:** update `docs/architecture/06-integrations-and-skills.md` (the
     skills section) and `docs/architecture/07-persistence-security-and-cloud.md`
     (store, trust, the update-check data); the `docs/decisions/README.md`
     index; `docs/glossary.md` (skill, projection, pin); add a
     user guide for installing, reviewing and updating skills and the
     Repository files settings; update `apps/desktop/README.md` for the settings UI, and the privacy
     notes for the update check.

## Implementation status

**Landed (Claude Code, 2026-10-15), on the branch, not pushed:**

- `packages/skills` (`@althar/skills`): validation, the content-addressed store,
  `installs.json` (an unreviewed install cannot be active), the per-run
  projection, and the path-based guard. (A catalog format and a local-directory
  catalog loader stood here until 8 Nov 2026.)
- **Delivery to Claude Code.** The registry's `claude-code` entry takes a
  `skillsPlugin` session option and passes it as the SDK's
  `plugins: [{ type: 'local', path }]`. The path is a plugin Althar builds
  under `<skills root>/runs/<session>/claude-code/plugin/` (a bare manifest and
  `skills/<id>/`), removed when the session's scope closes. This differs from
  the "isolated home" wording of section 2 on purpose: Claude Code's sign-in is
  tied to the account home's path (the registry notes a macOS Keychain item
  named after it), so a per-run `CLAUDE_CONFIG_DIR` would break sign-in, and
  writing into the shared account home would leak one run's selection into
  the next. A session-scoped plugin touches neither the account home, the
  person's own `~/.claude`, nor any repository.
- **Delivery to Codex and OpenCode (2026-10-18).** Each agent's registry entry
  says how it is given the run's folder (`skills.via`). Codex: the folder is laid
  out as `<run>/codex/.agents/skills/<id>/` and handed to the session as an added
  directory; codex-acp 2.2.2 sets each added directory's `.agents/skills` as
  Codex's extra skill roots (`skills/extraRoots/set`, Codex 0.160.1). It also
  makes that folder writable in Codex's sandbox, where only the run's read-only
  copies are. OpenCode: the folder (`<run>/opencode/<id>/`) is added to its
  config's `skills.paths` in `OPENCODE_CONFIG_CONTENT`, beside its asks
  (OpenCode 1.19.0 reads it; read from the binary, not yet a live session).
  Codex is not counted on for subagents, so a skill that needs them is left out
  for it, and the thread gets a notice naming what was left out and why. (No
  skill says it needs them now that the catalog is gone, which was the only
  place that was written; the projection and the notice stay.)
- **Who gets it.** Only a task's lead, on any agent that says how, and only where the runtime
  was given a skills store. Readers, reviewers, a review's lead (untrusted) and
  other agents get none. A failure to set skills up costs the session its
  skills, not its start.
- **Per-project settings.** `repositoryFiles` on the project's rules (a new
  revision per change, like the others): `writeSkills`, `writeOpenSpec`,
  `pushProtected`, each off unless set. The API reads and sets them. They
  govern what reaches a repository, not what a run is given: delivery is one
  switch for the whole runtime (`RuntimeOptions.skills`), with no per-project
  selection or bindings yet (stage 4), so every project's lead gets
  the same active set. A per-project switch for delivery does not exist.
- **Where the write settings bite.** A harness commits in the task's worktree
  by itself, where Althar cannot check its staging, so the first point Althar
  controls is the push. Both consents are required there: the class's write
  setting (`writeSkills`, `writeOpenSpec`) and `pushProtected`. Commit-time
  blocking before staging is not built (it needs the agents' own git to be
  interposed), and Althar's local merge into a default branch is not guarded.
- **Push guard.** Every push Althar makes for a task (publish, push the
  branch, push to a pull request, replace after a rewrite, push after a local
  merge) first lists what the task's own commits changed (git `-z`, no
  renames, no quoting) and refuses with `PushRefused` (`protected`) any path
  under a protected root unless both its write setting and `pushProtected`
  are on, naming the settings that are off (`needs`). It is path-based and
  ignores who wrote the file. The task's own commits are those no remote, no
  default branch Althar fetched and nothing it pushed before already has,
  past its base; a merge counts only for what its resolution changed, so
  protected files that came in with the default branch don't block. With
  nothing found to stop at, every commit counts, so the push is held, not let
  by.

- **Default catalog (2026-10-18; dropped 8 Nov 2026).** 32 skills from
  agent-skills and superpowers at pinned commits, patched to fit, vendored in
  `packages/skills/catalog/` and installed as `althar-default`. Section 6 says
  why Althar no longer ships any, and what happens to a store that has them.

- **GitHub install, review, update, rollback (2026-10-18).** A ref is resolved
  once to a commit, only the skill's folder is fetched (files from GitHub's
  raw host, each checked against the commit tree's blob hash), and a review
  card shows source, licence, findings, files and a line diff; only approving
  it installs. Updates are checked on request and staged as cards; the
  version replaced is kept to roll back to. Settings has a Skills section for
  all of it. Public repositories only: the connections hold no token the
  skills page may use.
- **Checked live (2026-10-18), without a model call:** OpenCode 1.19.0's
  `debug skill` lists the skills of a run's folder from `skills.paths` with an
  isolated home; Codex 0.160.1's app server lists them from the extra root
  codex-acp sets.
- **Checked on every run of `test:agents` (DEV-187), without a sign-in or a
  model call:** a run's folder, laid out by `@althar/skills`' `projectRun` for
  each registry entry's layout and handed over as Althar hands it, is found by
  the real agent: Claude Code (through claude-agent-acp 0.101.0) lists its
  plugin's skills as `althar:<skill>` commands, Codex (codex-acp 2.5.0) lists
  the folder added to its session, and OpenCode lists it from `skills.paths`:
  1.x in `debug skill` (seen with 1.18.31), 2.x, which has no `debug skill`,
  from its own server's `GET /api/skill` (seen with 2.2.6). Althar runs the
  person's OpenCode where they have one, of either major, and downloads 2.x
  where they don't; `ALTHAR_TEST_OPENCODE` names the copy to check. Claude Code
  skips where its adapter or the program it starts can't be found, OpenCode
  where it isn't installed. No workflow runs `test:agents` yet. On every pull
  request, the runtime's tests check the other half: that the plugin and the
  added directory reach the session the fake agent opens, and that the launch
  `Agents.fromRegistry` composes for OpenCode carries the run's folder in
  `skills.paths` (the fake runs in the test's process, so that is the
  composed environment, not one a process received).
- **Repository files in the project's settings (2026-10-18).** The project's
  Settings panel has a Repository files module that says where they stand and
  opens out to the three switches of section 4, each off until turned on and
  each a new revision of the project's rules (`SetProjectRules`'s
  `repositoryFiles`). A push held back for them names the switches there
  that are off for what it held back.
- **ADRs (2026-10-18).** [ADR-094](../decisions/the-persons-setup.md#skills)
  (the store, the catalog, delivery per session) and
  [ADR-095](../decisions/the-persons-setup.md#skill-and-openspec-files-in-a-change)
  (the repository boundary, amending ADR-013 and ADR-016).

**Not yet:**

- Blocking a protected write before it happens: path-sensitive write denial
  in each agent (section 4), the commit-time check before staging, and the
  one-time grant naming a destination. Today the push is the only barrier.
- Guarding Althar's local merge into a default branch.
- Per-project selection and bindings, name conflicts between sources, and
  Codex's `[[skills.config]]` exclusions (stage 4).
- The Codex size check: estimating the list against its budget, warning, and
  reporting what Codex left out (section 2).
- Reporting skills a repository already has, and same-name collisions with
  them (section 2's preflight and parity diagnostics).
- First-run import of skills already in an agent's home (section 1).
- Removing old stored versions no run uses (section 3's retention).
- Installs from private repositories.
- Refusing OpenCode 2.x (per the OpenCode 2 plan, which is not in this tree).
- A logged-in Claude Code, Codex or OpenCode session using a skill end to end.
- Skills for the agents that came over ACP after this plan: Copilot, Junie,
  Grok, Kimi, Mistral Vibe, Qwen Code and Antigravity. Each reads a skills
  folder in its home, but that is the person's own, and none has a known way
  to load a folder for one session alone, so each entry says `skills: null`
  and its sessions get none. Each needs the probe Codex and OpenCode had.
- OpenSpec (section 5).
- The user guide for installing, reviewing and updating skills (stage 7).

## Open decisions and risks

- Where skill-written planning files (`SPEC.md`, `docs/superpowers/...`) sit
  in the repository settings: a fourth setting, or part of the OpenSpec one.
- Where Codex and OpenCode read skills from was probed (Implementation
  status, "Checked live"): Codex 0.160.1 through codex-acp's extra roots,
  OpenCode 1.19.0 through `skills.paths`. Each new version needs the probe
  again: `test:agents` repeats it for Althar's own folder, by hand until a
  workflow runs it. Codex may still truncate its initial list under its context budget;
  reporting that is not built.
- Native repo skills can differ by harness and may be automatically loaded.
  Althar must surface this extra context and prove any attempt to suppress it;
  only Althar-managed selection can be promised identical before that work.
- OpenSpec's external store feature is beta. Confirm the supported version,
  output paths, multi-project registry isolation, and ACP access model before
  making it an implementation dependency.
- Path-sensitive denial inside a harness's own workspace sandbox may differ
  by provider. Keep artifact storage outside repositories as the primary
  guarantee and make staging/push checks a second barrier, not the only one.

## References

- [Agent Skills specification](https://agentskills.io/specification)
- [Claude Code skills](https://code.claude.com/docs/en/skills)
- [Codex skills](https://developers.openai.com/codex/skills/)
- [Codex configuration reference](https://developers.openai.com/codex/config-reference/)
- [OpenCode skills](https://opencode.ai/docs/skills/)
- [OpenCode skill discovery and permissions](https://opencode.ai/docs/skills/)
- [OpenCode configuration](https://opencode.ai/docs/config/)
- [GitHub REST repository contents](https://docs.github.com/en/rest/repos/contents#get-repository-content)
- [OpenSpec team workflow](https://github.com/Fission-AI/OpenSpec/blob/main/docs/team-workflow.md)
- [OpenSpec standalone stores (beta)](https://github.com/Fission-AI/OpenSpec/blob/main/docs/stores-beta/user-guide.md)
- [Althar architecture: Skills](../architecture/06-integrations-and-skills.md#skills)
