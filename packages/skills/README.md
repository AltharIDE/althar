# @althar/skills

Agent Skills for every harness ([plan](../../docs/plans/skills-across-harnesses.md)): what a skill must be to be installed, the shared store, the default catalog's format, a per-run projection, and the repository boundary. The runtime hands a Claude Code lead the active skills as a session-scoped plugin and checks every push with the guard; Codex and OpenCode are not wired yet (see the plan's status section).

## Use it

```ts
import { validateSkill, putObject, projectRun, blockedBeforeCommit, DEFAULT_REPOSITORY_FILES } from '@althar/skills'

const checked = validateSkill('my-skill', files) // files: Map<relative path, bytes>, fetched but never run
if (checked.ok) {
  const treeHash = await putObject(storeRoot, files)
  await projectRun({ root: storeRoot, runId, agent: 'codex', selected: [{ id: 'my-skill', treeHash }], capabilities: [], keepOutOf: [repoPath] })
}
blockedBeforeCommit(changedPaths, DEFAULT_REPOSITORY_FILES) // skill and OpenSpec paths, blocked unless the project allows them
```

- **Validation rejects what grants a harness something.** `allowed-tools` and `hooks` are refused, as are unsafe paths, a name that is not the directory's, and oversized trees. Scripts and fields outside the specification are flagged for the review card. Push and pull-request instructions in the text are flagged, or rejected when the default catalog is built (`pushes: 'reject'`). Nothing in a skill is run. **Callers must validate before `putObject`**: the store keeps whatever it is given under its hash, and does not check it is a safe skill.
- **Installed is not active.** An install that is `not-reviewed` cannot be written as `active`; activation follows the review card.
- **The store is content-addressed.** `objects/<tree-hash>/` is immutable; reading one back checks it still hashes to its name and holds no links. `installs.json` is written atomically.
- **Projection copies read-only, into Althar's own directory.** It refuses a store inside any repository listed in `keepOutOf`, so the caller must list the project's repositories: an empty list guards nothing. It refuses a repeated skill id and a malformed tree hash, and leaves out a skill whose `needs` the agent lacks (reported, not hidden).
- **The guard looks at paths only.** `.agents/skills`, `.claude/skills` and `.opencode/skills`, and `openspec/`, at any depth, are blocked before commit and before push unless the project turned the matching setting on. Every setting is off by default. Paths must be plain and unquoted (for example from `git status -z`), a rename as both its paths.

## Work on it

| Command | What it does |
| --- | --- |
| `bun run check` | Format, type-aware lint and type checks |
| `bun run test` | The tests, against real temporary directories |
| `bun run test:coverage` | The same, with the coverage gate: 90% of lines and branches (needs Node on PATH; Bun has no `node:inspector`) |
| `bun run verify` | Check and coverage, as CI runs them |
