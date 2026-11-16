# @althar/skills

Agent Skills for every harness ([plan](../../docs/plans/skills-across-harnesses.md)): what a skill must be to be installed, the shared store, adding a skill from GitHub with a review card, a per-run projection, and the repository boundary. Althar ships no skills of its own: what a run is given is what the person added. The runtime hands a Claude Code lead the active skills as a session-scoped plugin and checks every push with the guard; Codex and OpenCode are not wired yet (see the plan's status section).

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

- **Validation rejects what grants a harness something.** `allowed-tools` and `hooks` are refused, as are unsafe paths, a name that is not the directory's, and oversized trees. Scripts and fields outside the specification are flagged for the review card. Push and pull-request instructions in the text are flagged for the review card (`pushes: 'flag'`), or rejected where a caller asks (`pushes: 'reject'`). Nothing in a skill is run. **Callers must validate before `putObject`**: the store keeps whatever it is given under its hash, and does not check it is a safe skill.
- **Installed is not active.** An install that is `not-reviewed` cannot be written as `active`; activation follows the review card.
- **The store is content-addressed.** `objects/<tree-hash>/` is immutable; reading one back checks it still hashes to its name and holds no links. `installs.json` is written atomically.
- **Skills an older Althar shipped are gone.** `removeBundledSkills` takes the installs it made as `althar-default` out of the store on the first start after the update, with the stored versions nothing else points at, and leaves what the person added from GitHub; until it has run, a read leaves them out (`legacy.ts`).
- **Projection copies read-only, into Althar's own directory.** It refuses a store inside any repository listed in `keepOutOf`, so the caller must list the project's repositories: an empty list guards nothing. It refuses a repeated skill id and a malformed tree hash, and leaves out a skill whose `needs` the agent lacks (reported, not hidden).
- **Read-only permissions follow the OS.** On POSIX systems the folders also refuse additions. Windows' `chmod` sets read-only attributes, protecting existing file contents but not directory entries; reading a stored object checks its content hash and refuses additions or changed content. Rebuilding a run's projection clears its previous entries. Directory attributes are not a Windows ACL boundary.
- **The guard looks at paths only.** `.agents/skills`, `.claude/skills` and `.opencode/skills`, and `openspec/`, at any depth, are blocked before commit and before push unless the project turned the matching setting on. Every setting is off by default. Paths must be plain and unquoted (for example from `git status -z`), a rename as both its paths.

## Work on it

| Command | What it does |
| --- | --- |
| `bun run check` | Format, type-aware lint and type checks |
| `bun run test` | The tests, against real temporary directories |
| `bun run test:coverage` | The same, with the coverage gate: 90% of lines and branches (needs Node on PATH; Bun has no `node:inspector`) |
| `bun run verify` | Check and coverage, as CI runs them |
