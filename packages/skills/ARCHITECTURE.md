# @althar/skills — Architecture

The shared skills of [docs/plans/skills-across-harnesses.md](../../docs/plans/skills-across-harnesses.md). The repository's [ARCHITECTURE.md](../../ARCHITECTURE.md) sets the general engineering target.

- **Owner:** Repository maintainers
- **Consumers:** the runtime (`Skills.ts`, `repositoryGuard.ts`), which takes out what an older Althar shipped, projects a run's skills and guards pushes. The other adapters are not wired yet.
- **Dependency direction:** depends on `effect` and `js-yaml` alone. It fetches nothing from the network and runs nothing from a skill; fetching GitHub content and the review UI are the runtime's.

## What it holds

| Module | What it does |
| --- | --- |
| `frontmatter.ts` | The YAML block of a `SKILL.md` and the Markdown after it |
| `validate.ts` | Agent Skills rules and Althar's: rejects authorizing fields, unsafe paths and oversized trees; flags scripts and unknown fields |
| `lint.ts` | Text that tells an agent to push or open a pull request |
| `hash.ts` | Per-file and whole-tree SHA-256, independent of order |
| `store.ts` | The content-addressed object store and `installs.json`, and the first-start removal of the skills an older Althar shipped |
| `legacy.ts` | Reads a store written by an older Althar as if it held none of those |
| `github.ts`, `review.ts` | Adding a skill from GitHub: resolving a ref, fetching the skill's folder, the review card, approving, updating, rolling back and removing |
| `selection.ts` | The skills a run is given: the active installs |
| `projection.ts` | A run's read-only copy of the chosen skills, kept outside every project |
| `guard.ts` | The repository boundary: protected paths and the per-project settings, all off by default |
