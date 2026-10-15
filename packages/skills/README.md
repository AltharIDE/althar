# @althar/skills

Agent Skills for every harness ([plan](../../docs/plans/skills-across-harnesses.md)): what a skill must be to be installed, the shared store, the default catalog's format, a per-run projection, and the repository boundary. This is the first slice of the plan's stages 2 and 5; nothing in the runtime or the adapters uses it yet.

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

- **Validation rejects what grants a harness something.** `allowed-tools` and `hooks` are refused, as are unsafe paths, a name that is not the directory's, and oversized trees. Scripts and fields outside the specification are flagged for the review card. Nothing in a skill is run.
- **The store is content-addressed.** `objects/<tree-hash>/` is immutable; reading one back checks it still hashes to its name and holds no links. `installs.json` is written atomically.
- **Projection copies read-only, outside every project.** It refuses a store inside any repository it is told to keep out of, and leaves out a skill whose `needs` the agent lacks (reported, not hidden).
- **The guard looks at paths only.** `.agents/skills`, `.claude/skills` and `.opencode/skills` at any depth, and `openspec/`, are blocked before commit and before push unless the project turned the matching setting on. Every setting is off by default.

## Work on it

| Command | What it does |
| --- | --- |
| `bun run check` | Format, type-aware lint and type checks |
| `bun run test` | The tests, against real temporary directories |
| `bun run test:coverage` | The same, with the coverage gate: 90% of lines and branches (needs Node; Bun has no `node:inspector`) |
| `bun run verify` | Check and coverage, as CI runs them |
