# @althar/skills — Architecture

The shared skills of [docs/plans/skills-across-harnesses.md](../../docs/plans/skills-across-harnesses.md). The repository's [ARCHITECTURE.md](../../ARCHITECTURE.md) sets the general engineering target.

- **Owner:** Repository maintainers
- **Consumers:** the runtime (`Skills.ts`, `repositoryGuard.ts`), which seeds the store, projects a run's skills for Claude Code and guards pushes. The other adapters are not wired yet.
- **Dependency direction:** depends on `js-yaml` and `zod` alone. It fetches nothing from the network and runs nothing from a skill; fetching GitHub content and the review UI are the runtime's.

## What it holds

| Module | What it does |
| --- | --- |
| `frontmatter.ts` | The YAML block of a `SKILL.md` and the Markdown after it |
| `validate.ts` | Agent Skills rules and Althar's: rejects authorizing fields, unsafe paths and oversized trees; flags scripts and unknown fields |
| `lint.ts` | Text that tells an agent to push or open a pull request |
| `hash.ts` | Per-file and whole-tree SHA-256, independent of order |
| `catalog.ts` | The default catalog's format: pins by commit SHA, tree hashes, licence, needs |
| `store.ts` | The content-addressed object store and `installs.json` |
| `projection.ts` | A run's read-only copy of the chosen skills, kept outside every project |
| `local.ts` | A catalog on disk (`catalog.json`, `skills/<id>/`), checked and installed as the default set; stands in for the real source |
| `guard.ts` | The repository boundary: protected paths and the per-project settings, all off by default |
