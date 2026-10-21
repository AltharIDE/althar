# Skills across harnesses: shared defaults, installs, and repository boundaries

**Status:** Partly built; what landed and what didn't is under [Implementation status](#implementation-status). Decisions: [ADR-056](../decisions/056-skills-one-store-a-curated-catalog.md), [ADR-057](../decisions/057-skill-and-openspec-files-stay-off-the-repository.md)
**Research checked:** 2026-10-14
**Upstream baseline:** `upstream/main` at `818df85e35ce4aa704334ffd846878750a30702c`

## Goal

Give every harness Althar runs the same Althar-managed skills, with a maintained
default set, per-project selection, and reviewed installs and updates from
GitHub. Use the open Agent Skills directory format so the skill content does
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
  catalog.json                 # packaged default catalog and pinned revision
  objects/<content-hash>/       # immutable skill trees
  installs.json                # source, pinned commit, path, hashes, review state
                               # (source: github | local | althar-default)
  runs/<run-id>/<adapter>/      # read-only adapter projection for one run
```

The package/release should include a small curated Althar default catalog and
its exact source revision, so defaults work offline and do not depend on a
branch moving. The catalog source is not settled by this research. OpenAI's
`openai/skills` is a candidate for some general-purpose skills, not an assumed
complete Althar catalog; the initial set should be selected and reviewed for
license, maintenance, portability, and fit. Althar-owned skills can live in
the Althar source tree and be versioned with a release. The catalog records
which entries are defaults and the commit/hash from which each was built.

User-installed skills use the same store and format. First-run migration may
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
initial catalog exceeds the default budget (about 2% of context, or 8,000
characters when context size is unknown); `skills.max_context_tokens` can
change that budget. Preflight should estimate the catalog, warn when it may
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
retention period. Package updates can ship a refreshed default catalog, with
an optional explicit check for a newer catalog revision between app releases.

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

### 6. Default catalog: sources, licensing, and how we carry them

Candidates for the default set are
[addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) and
[obra/superpowers](https://github.com/obra/superpowers). Both were shallow
cloned into a scratch directory on 2026-10-15 and measured; nothing was run.

#### 6.1 Licence and provenance

| | agent-skills | superpowers |
| --- | --- | --- |
| Licence | MIT, `LICENSE` "Copyright (c) 2025 Addy Osmani" | MIT, `LICENSE` "Copyright (c) 2025 Jesse Vincent" |
| Head checked | `aeac41d4` (2026-10-13), 25 skills | `bb92a77` (2026-10-09), 15 skills |
| Top level | `skills/ commands/ agents/ hooks/ references/ evals/ scripts/ plugin.json` and per-harness dirs | `skills/ hooks/ scripts/ package.json index.js` and per-harness plugin dirs |

MIT permits copying, modifying and redistributing, on one condition: the
copyright notice and licence text stay in all copies or substantial portions.
Neither repo has a `NOTICE` file or an attribution clause beyond that. So:

- Ship each upstream's full `LICENSE` and a `THIRD_PARTY` file (name, repo,
  pinned SHA, copyright line, list of vendored skills) with the vendored
  snapshot and with the `althar-skills` repo, and show the licence on a
  skill's review card.
- A patched skill is a modified copy: keep the notice, mark the file as
  modified, and keep the patch visible in the catalog.
- **Not everything under `skills/` is the author's.**
  `superpowers/skills/writing-skills/anthropic-best-practices.md` (46 KB) is
  Anthropic's published authoring guide, copied in verbatim; the upstream MIT
  licence does not clearly cover it. Exclude it from the vendored copy (or
  clear its terms) before shipping `writing-skills`. A per-file scan for
  similar third-party text is a stage 1 task; this document did not complete
  one.
- Provenance is the pinned SHA plus a per-file content hash; the catalog
  records both so a later reader can prove what was reviewed. This is a
  planning reading of MIT, not legal advice.

#### 6.2 What is in the two sets

**Frontmatter is clean.** Every `SKILL.md` in both sets has only `name` and
`description`; none carries `allowed-tools` or `hooks`, so the section 3
frontmatter validator would accept all 40.

**They overlap heavily where it matters.**

| Job | agent-skills | superpowers |
| --- | --- | --- |
| Test-driven development | `test-driven-development` | `test-driven-development` (same name) |
| Debugging | `debugging-and-error-recovery` | `systematic-debugging` |
| Planning | `planning-and-task-breakdown` | `writing-plans`, `executing-plans` |
| Design before code | `spec-driven-development`, `idea-refine` | `brainstorming` |
| Review | `code-review-and-quality` | `requesting-code-review`, `receiving-code-review` |
| Finish | `shipping-and-launch`, `git-workflow-and-versioning` | `finishing-a-development-branch`, `using-git-worktrees` |
| Meta router | `using-agent-skills` | `using-superpowers` |

Shipping both whole means two TDD skills with the same `name` (a name collision;
how each harness resolves duplicates must be probed, section 2), two planning procedures, and two routers each
telling the agent to consult skills first. Pick one per job. Only
agent-skills has API design, CI/CD, performance, security hardening,
frontend, observability, deprecation, source-driven and documentation skills;
only superpowers has parallel-agent dispatch, subagent-driven execution,
worktrees and the skill-authoring skill. They complement more than they
compete outside the table above.

**Codex context budget.** Codex lists each skill's name, description and path
at startup within a budget (about 2% of context, 8,000 characters when the
context size is unknown, see section 2). Measured name plus description
text, before path and formatting overhead:

| Set | Skills | Catalog characters | About tokens |
| --- | --- | --- | --- |
| agent-skills | 25 | 9,425 | 2,350 |
| superpowers | 15 | 2,632 | 660 |
| both | 40 | 12,057 | 3,000 |

Both together, or agent-skills alone, exceed the 8,000-character fallback
before paths are added, so Codex could drop descriptions or entries. A
curated set of roughly 15 skills (about 5,000 characters at these averages)
fits with room for the person's own installs. Full `SKILL.md` bodies are
large (about 85K tokens for agent-skills, 40K for superpowers, bodies only)
but load on demand; the point is that the *catalog line* is the always-paid
cost, and agent-skills' descriptions average 377 characters against 175 for
superpowers. A catalog patch may shorten a description, which is a modified
copy under 6.1.

**Hooks and harness-specific wiring.**

- Neither repo's skills need a hook to be *valid*. agent-skills'
  `hooks/session-start.sh` only injects its router, and its own comments say
  not to wire it on hosts with native skill routing. superpowers' `hooks/`
  does the same job for `using-superpowers`; its plugin dirs and
  `package.json`/`index.js` exist to install that bootstrap per harness. The
  catalog takes none of it.
- `using-superpowers` is the exception that matters: it is written as the
  always-on router (an `EXTREMELY-IMPORTANT` block telling the agent that a
  1% chance a skill applies means it must invoke it) and mentions
  `TodoWrite`, the `Skill` tool and per-harness tool maps
  (`references/hermes-tools.md`, `muse-tools.md`). It assumes the bootstrap
  hook and names tools that not every harness has. Do not ship it unchanged.
  Skills are already routed by each harness's native catalog; if a router is
  wanted, Althar writes one of its own.
- `writing-skills` has 15 references to `.claude` paths, and
  `diagnosing-superpowers` is about debugging the superpowers plugin itself;
  both are Claude/plugin-specific and should be left out.
- `subagent-driven-development` (85 mentions of subagents),
  `dispatching-parallel-agents`, `executing-plans` and `requesting-code-review`
  depend on the harness dispatching subagents. Treat them as **capability
  dependent**: the catalog marks them `needs: subagents`, and the per-run
  projection omits them for a harness without the capability instead of
  presenting a skill the agent cannot follow. This is a real exception to
  "the same skills in every harness" and should be shown in parity
  diagnostics (section 2) rather than hidden.
- agent-skills mentions `CLAUDE.md`/`AGENTS.md` in a handful of skills
  (`constraint-driven-development`, `context-engineering`,
  `documentation-and-adrs`, `code-simplification`) and `AskUserQuestion` once
  (`idea-refine`). These are advice about context files, harmless as text; the
  review card should list them.

**Executable content.** agent-skills has one script
(`idea-refine/scripts/idea-refine.sh`). superpowers has many: a local web
server for `brainstorming` (`server.cjs`, `start-server.sh`, `helper.js`),
`task-brief`/`sdd-workspace`/`review-package` for subagent-driven development,
`task-start`/`task-done` for `executing-plans`, `find-polluter.sh`, and
`render-graphs.js`. Under section 3 these are flagged on the review card and
never executed by Althar; running them is the harness's tool call under the
run's permission rules. Prefer skills without scripts for the default set.

**Several skills instruct the agent to write into, commit to, or push from
the repository.** This is the finding that most affects the guardrail and
is easy to miss because it is skill *content*, not skill *files*:

- superpowers `brainstorming` and `writing-plans` save to
  `docs/superpowers/specs/` and `docs/superpowers/plans/` and commit them.
- agent-skills `spec-driven-development` and `planning-and-task-breakdown`
  write `SPEC.md`, `tasks/plan.md` and `tasks/todo.md` in the project root.
- superpowers `finishing-a-development-branch` offers "Push and create a
  Pull Request" and runs `git push -u origin`; agent-skills
  `git-workflow-and-versioning` and `shipping-and-launch` include
  `git push` for tags and rollbacks.

None of these paths are skill roots or `openspec/`, so the protected-path
checks in section 4 do not catch them, and the push instruction conflicts
with Althar owning pushes (the task flow, section 4). The design therefore
treats them as follows:

1. **Plans and specs are ordinary task output, not skill files.** They are
   allowed in the working tree when the task's agent writes them, subject to
   the usual diff review, but the default catalog **patches the output
   location** to the run's private workspace outside the checkout (Althar
   supplies the path in the run context) unless the project has opted in to
   repository-backed planning files. Whether this should be a fourth
   "Repository files" setting, or fold into the OpenSpec one (planning
   artifacts being the thing OpenSpec replaces), is an open decision.
2. **Push and PR steps are removed or rewritten** in catalog patches to
   "stop and report; Althar pushes." No default skill may tell an agent to
   run `git push` or open a PR. A validator check enforces this for catalog
   entries (a lint, not a security boundary: the real boundary is the
   harness permission rules and Althar's push flow).
3. User-installed skills are not patched; they are shown on the review card
   with these instructions highlighted, and the push boundary is Althar's
   permission and push guard, not trust in skill text.

#### 6.3 Options considered

| Option | For | Against |
| --- | --- | --- |
| Fork both into `althar-skills`, curate periodically | Familiar; full control; local edits are plain commits | Two diverging forks merged by hand. The forks carry `hooks/`, plugin manifests, `package.json`, scripts and per-harness dirs we reject or would have to strip on every merge. Needed edits (push removal, output paths, descriptions, third-party file) touch many files, so each upstream update becomes a conflict. Large, noisy repo to review |
| In-app baseline only (copy skills into the Althar repo) | Offline; versioned with the app | Skill churn becomes app-release churn; upstream text and licences live in the app repo; no path to newer skills between releases; same patching problem with no pin trail |
| Catalog repo of pins (manifest only, nothing vendored) | Tiny; upstream stays the source of truth; one mechanism for default and user installs | First run needs the network; pins to repos we do not control (force-push or deletion breaks a fresh install) |
| **Hybrid: catalog repo of pins, with `skills/` content vendored, plus an in-app snapshot** | Combines reviewed pins and content hashes with offline first run and rollback if upstream disappears; patches stay small and named; users' own GitHub sources use the identical flow | A small repo to maintain, and a human review per update |

**Recommendation: the hybrid, confirming the coordinator's lean with
adjustments the measurements force.** The evidence for it: the forks would
carry about as much non-skill code as skill content (hooks, plugin manifests,
`index.js`, per-harness dirs), the content we want needs real edits (6.2:
output paths, push steps, third-party file, descriptions, the router), and
the two sets overlap enough that we must choose rather than merge.

1. `althar-skills` holds `catalog.json` plus `skills/<id>/` directories
   vendored from the upstream `skills/<name>/` only. Each catalog entry
   records upstream repo, full commit SHA, upstream subpath, per-file content
   hashes of the *upstream* tree, the licence and copyright line, the
   capability needs (`subagents`, scripts present), a review note, and the
   patch applied, if any. Patches are small named diffs kept next to the
   entry so a re-vendor reapplies them and shows when one no longer applies.
   Aim to carry few; they are the price of 6.2 and not optional.
2. Take skill directories only, never upstream `hooks/`, `commands/`,
   personas, plugin manifests or `package.json`. This is a catalog-build rule;
   for user installs the subtree-only fetch in section 3 enforces it.
3. Curate, don't union: one skill per job from the 6.2 table. As a starting
   point to confirm in stage 1, not a decision (since settled otherwise:
   every skill of both is carried unless two do the same job, 32 in all, in
   `packages/skills/catalog/CURATION.md` and ADR-056): agent-skills for the
   lifecycle and engineering skills it alone has (API design, CI/CD,
   security, performance, documentation, source-driven development, code
   review), superpowers for what it alone has (systematic debugging,
   verification-before-completion, worktrees, parallel dispatch where the
   harness has subagents), and one TDD skill. Keep the total near 15 to fit
   Codex's budget alongside the person's own skills.
4. (Not created: the catalog is vendored in this repository for now,
   `packages/skills/catalog/`.) `althar-skills` is hosted under the account Althar's own repositories use
   (`ninemate`), decided in stage 1.
5. The app ships a vendored snapshot of the catalog at a pinned catalog
   version with each upstream `LICENSE` and the `THIRD_PARTY` file. It lands
   in the store (section 1) with `source: althar-default` in `installs.json`.
6. Updates reach people as **catalog releases**, not app releases. The check
   is off until the person turns it on or presses "Check for updates"; it
   sends one unauthenticated GitHub request for the catalog's latest release
   and nothing about the person, their projects or their installed skills
   beyond what any HTTPS request reveals (IP, user agent). The app shows the
   changed-file diff per skill (section 3) and applies only on approval.
   Users can deselect, pin back, or add their own GitHub sources, which go
   through the same pin, hash and review flow; their choices are bindings
   over the store and survive catalog updates.
7. Curation is periodic and human: a scheduled job opens a catalog PR when an
   upstream head moves, listing the diff per pinned skill and whether any
   patch still applies; a person reads it, and the stage 6 fixture runs on
   all adapters, before the pin moves. Nothing auto-follows an upstream
   branch. The job is maintainer-side automation with write access to the
   `althar-skills` repository only, using a token scoped to it; it never
   touches a user's repositories, and the app never runs it. A monthly
   cadence plus on-demand for security fixes is a starting point.

If a skill's licence, contents or required patch make it unsuitable, drop it
from the catalog; the structure does not depend on either upstream.

#### 6.4 Repository defaults still hold

Nothing in this section relaxes section 4. The default catalog materializes
only into Althar's app data and per-run overlays; no skill, `THIRD_PARTY`
file or OpenSpec artifact is written to a user's repository or pushed unless
the person has turned on the matching per-project setting (and, to push, the
separate push setting). The catalog's output-path and no-push patches above
exist so default skills do not undermine that default through their own
instructions, but they are not relied on: the path-based write and push
checks and the harness permission rules remain the enforcement.

## Staged implementation after the newest Althar

1. **Lock product decisions.** Create `althar-skills` per section 6 (owner
   account included); choose the initial skills from the two MIT sources and
   record licences; confirm default versus per-project skill selection; pin
   supported harness versions; decide whether to consume OpenSpec's beta
   stores or keep artifacts in Althar's own store.
2. **Build catalog and store.** Bundle a pinned default catalog; add immutable
   local versions and provenance; import selected existing skills without
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
   catalog; prove an app-managed skill and OpenSpec change never appears in
   a repository or task diff; prove opt-in repository mode is visible in the
   diff and follows normal commit/push policy; test update pinning, rollback,
   malformed archives, unsafe paths/symlinks, and unchanged active-run
   snapshots.
7. **Document.** Once the implementation is final, write the ADR and docs
   below; not before, so they describe what shipped.
   - **ADR (next free number in `docs/decisions/`, currently 036):** "Skills
     are one shared store, carried as a curated catalog of pins." Records the
     shared store and per-run projection, the hybrid catalog sourcing, the
     reject-by-default frontmatter and subtree-only install rules, and the
     repository boundary (default-off write, OpenSpec and push settings).
     Possibly a second ADR for the repository boundary alone, since it
     amends [ADR-013](../decisions/013-project-rules.md) project rules.
   - **Docs:** update `docs/architecture/06-integrations-and-skills.md` (the
     skills section) and `docs/architecture/07-persistence-security-and-cloud.md`
     (store, trust, the update-check data); the `docs/decisions/README.md`
     index; `docs/glossary.md` (skill, catalog, projection, pin); add a
     user guide for installing, reviewing and updating skills and the
     Repository files settings; add a maintainer runbook for curating
     `althar-skills` (cadence, review checklist, patches, `THIRD_PARTY`);
     update `apps/desktop/README.md` for the settings UI, and the privacy
     notes for the update check.

## Implementation status

**Landed (Claude Code, 2026-10-15), on the branch, not pushed:**

- `packages/skills` (`@althar/skills`): validation, the content-addressed store,
  `installs.json` (an unreviewed install cannot be active), the catalog format,
  a local-directory catalog loader that stands in for the real source, the
  per-run projection, and the path-based guard.
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
  for it, and the thread gets a notice naming what was left out and why.
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

- **Catalog updates.** Installing the local catalog is serialized per store,
  and a default the catalog no longer lists is dropped from `installs.json`
  (its stored version is kept) and reported (`removedByCatalog` lists them first,
  for the later update screen); a person's own installs are untouched.

- **Default catalog (2026-10-18).** `packages/skills/catalog/`: 33 skills from
  agent-skills and superpowers at pinned commits, every skill of both except
  where two do the same job, read in full and patched to fit (no push or pull
  request steps, planning files kept out of commits, harness-neutral text);
  `catalog/CURATION.md` says what was chosen and why, `scripts/vendor.ts`
  rebuilds it. The desktop app and the CLI turn delivery on with it, the store
  in the profile's `skills/`.
- **GitHub install, review, update, rollback (2026-10-18).** A ref is resolved
  once to a commit, only the skill's folder is fetched (files from GitHub's
  raw host, each checked against the commit tree's blob hash), and a review
  card shows source, licence, findings, files and a line diff; only approving
  it installs. Updates are checked on request and staged as cards; the
  version replaced is kept to roll back to. Settings has a Skills section for
  all of it. Public repositories only: the connections hold no token the
  skills page may use.
- **Checked live (2026-10-18), without a model call:** OpenCode 1.19.0's
  `debug skill` lists all 33 from `skills.paths` with an isolated home; Codex
  0.160.1's app server lists all 33 from the extra root codex-acp sets.
- **Repository files in the project's settings (2026-10-18).** The project's
  Settings panel has a Repository files module that says where they stand and
  opens out to the three switches of section 4, each off until turned on and
  each a new revision of the project's rules (`SetProjectRules`'s
  `repositoryFiles`). A push held back for them names the switches there
  that are off for what it held back.
- **ADRs (2026-10-18).** [ADR-056](../decisions/056-skills-one-store-a-curated-catalog.md)
  (the store, the catalog, delivery per session) and
  [ADR-057](../decisions/057-skill-and-openspec-files-stay-off-the-repository.md)
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
- A catalog update channel between app releases (`althar-skills`).
- Refusing OpenCode 2.x (per the OpenCode 2 plan, which is not in this tree).
- A logged-in Claude Code, Codex or OpenCode session using a skill end to end.
- Skills for the agents that came over ACP after this plan: Copilot, Junie,
  Grok, Kimi, Mistral Vibe, Qwen Code and Antigravity. Each reads a skills
  folder in its home, but that is the person's own, and none has a known way
  to load a folder for one session alone, so each entry says `skills: null`
  and its sessions get none. Each needs the probe Codex and OpenCode had.
- OpenSpec (section 5).
- The user guide and the maintainer runbook for curating the catalog
  (stage 7).

## Open decisions and risks

- **Settled:** the skills carried. Every skill of both was read in full on
  2026-10-18 and 33 were carried (`packages/skills/catalog/CURATION.md`), more
  than the ~15 section 6 aimed at for Codex's budget; ADR-056 records why and
  what it costs. After review, `using-git-worktrees` was left out (Althar makes
  the worktrees), leaving 32, and all ship off until the person turns them on.
- Where skill-written planning files (`SPEC.md`, `docs/superpowers/...`) sit
  in the repository settings: a fourth setting, or part of the OpenSpec one.
- **Settled:** third-party text. The per-file read found Anthropic's
  authoring guide (left out) and text close to Google's Engineering Practices
  (credited); see `CURATION.md`.
- Where Codex and OpenCode read skills from was probed (Implementation
  status, "Checked live"): Codex 0.160.1 through codex-acp's extra roots,
  OpenCode 1.19.0 through `skills.paths`. Each new version needs the probe
  again. Codex may still truncate its initial list under its context budget;
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
