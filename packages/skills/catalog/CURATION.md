# How the default catalog was curated

The default catalog carries the skills of two MIT-licensed repositories,
[addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) at
`aeac41d4d005999432bb7312f7ff06383a91d59d` (25 skills) and
[obra/superpowers](https://github.com/obra/superpowers) at
`bb92a77741419a4ab5f06e711a283343f1ada0c3` (15 skills), read in full on
2026-10-18. The rule: every skill is carried, unless two skills do the same
job, in which case the better one is kept, or it only does what Althar
already does. 32 are carried.
[`scripts/curation.ts`](../scripts/curation.ts) is the source of truth for
what is carried and how it is patched; `scripts/vendor.ts` builds this
folder from it, and the package's tests load the result as the app does.
[THIRD_PARTY.md](THIRD_PARTY.md) lists every skill with its source.

## Licences

Both repositories are MIT ("Copyright (c) 2025 Addy Osmani", "Copyright (c)
2025 Jesse Vincent"), with no `NOTICE` file and no skill carrying a licence
header of its own. MIT asks that the notice stays with the copies:
each licence is in [`LICENSES/`](LICENSES), and each catalog entry records the
licence and copyright line. A patched skill is a modified copy, marked
`patch` in `catalog.json`.

Text inside the repositories that is not the authors':

- `superpowers/skills/writing-skills/anthropic-best-practices.md` is
  Anthropic's "Skill authoring best practices" page, copied from its
  documentation site (its markup is still there). The MIT licence of the
  repository does not cover it, so it is **left out**, with the line that
  pointed at it.
- `agent-skills/skills/code-review-and-quality` follows Google's
  [Engineering Practices](https://google.github.io/eng-practices/)
  documentation closely in places (CC BY 3.0). The carried copy credits it
  at its top.
- Short, attributed quotations (Hyrum's Law, a passage from the React 19
  blog, well-known one-liners in `idea-refine`) and ideas from the "Software
  Engineering at Google" book written in the author's own words were left
  as they are.

This is a reading of the licences for curation, not legal advice.

## Where two skills did the same job

| Job | Kept | Left out | Why |
| --- | --- | --- | --- |
| Test-driven development (same name in both) | superpowers `test-driven-development` | agent-skills `test-driven-development` | Superpowers makes "watch it fail for the right reason" a step of its own, and its `writing-good-tests.md` (mutation checks, mirror assertions, change detectors) is sharper than a textbook test pyramid. The agent-skills version needs a Chrome DevTools MCP section and a file outside its folder. |
| Debugging | superpowers `systematic-debugging` | `debugging-and-error-recovery` | One hypothesis at a time and one variable per change; after three failed fixes it stops and questions the design; real technique files (root-cause tracing, defense in depth, condition-based waiting). The other is mostly npm-flavoured decision trees, and its "safe fallback" patterns invite masking a symptom. |
| Turning a design into tasks | superpowers `writing-plans` | `planning-and-task-breakdown` | Exact files, signatures and an expected output for every command, and a self-review for coverage and consistency, against generic slicing advice tied to the author's `/build` command. |
| Design before code | superpowers `brainstorming` | `spec-driven-development`, `interview-me` | All three draw out what the person wants and get approval before handing off. `brainstorming` sizes the work first, so a clear task just gets done, and hands off to `writing-plans`. `spec-driven-development` repeats planning in its own later phases, and `interview-me` is the same one-question conversation in another format. |
| The always-on router | agent-skills `using-agent-skills` | `using-superpowers` | `using-agent-skills` gives a phase map and harness-neutral working habits. `using-superpowers` is mostly a forcing rule (a 1% chance a skill applies means it must be invoked before any reply), assumes the plugin's start-up hook, and covers some harnesses but not OpenCode. The kept router's map was rewritten to name the skills carried from both. |

Pairs that looked alike but do different jobs, so both are carried:
`code-review-and-quality` (how to review) with `requesting-code-review`
(dispatching a fresh reviewer) and `receiving-code-review` (weighing
feedback); `executing-plans` (running a plan) with `writing-plans`;
`idea-refine` (ideation the person asks for) with `brainstorming`;
`shipping-and-launch` (a production rollout) with
`finishing-a-development-branch` (handing a branch off).

Where a carried skill named one left out, the name was changed to the one
carried for the same job.

## Left out though nothing does its job

- **`using-git-worktrees`**: Althar gives every task its own worktree and
  branch, and cleans them up. A lead making more leaves state Althar
  neither sees nor removes, and where the lead is in the person's own
  checkout it would make `.worktrees/` there. The skills that sent a lead to
  it now say the work happens in the worktree Althar made.

- **`diagnosing-superpowers`**: it only analyses sessions of the
  superpowers plugin, which Althar does not run, and files issues on that
  project's tracker. It has nothing to work on here.

## What the patches change

Every patch is a list of exact edits in `scripts/curation.ts`; a re-vendor
against a newer commit stops where upstream changed under one. They fall
into a few kinds:

- **Althar pushes.** No carried skill tells an agent to `git push` or open
  a pull request: `finishing-a-development-branch` ends in a hand-off,
  `git-workflow-and-versioning` and `shipping-and-launch` tag or revert
  locally and stop, `ci-cd-and-automation` commits a fix and leaves the push,
  `writing-skills` ends with a commit, and `receiving-code-review` replies
  with the pull request tool the harness gives it instead of `gh`. A lint
  refuses push text in a default skill, so this is checked on every build.
- **Planning files stay out of commits.** `brainstorming` and
  `writing-plans` keep their documents under `.superpowers/`, which they
  ignore with a `.gitignore` of `*`, instead of committing them under
  `docs/superpowers/`;
  `idea-refine` and `performance-optimization` keep their notes outside the
  repository unless the person asks. `idea-refine`'s script, which made a
  folder in the repository, is left out.
- **Althar's worktrees and branches are not the skill's.**
  `finishing-a-development-branch` merged by going to the person's own
  checkout, switching it to the base branch and pulling, then removed the
  worktree and deleted the branch, and on a discard force-deleted them. Its
  merge and its discard are now hand-offs, as its pull request is: the lead
  commits, reports and stops, and Althar merges, abandons and cleans up. It
  removes only a worktree it made itself. `git-workflow-and-versioning` no
  longer adds worktrees beside the repository nor resets hard.
- **Every harness.** References to one harness's tools (`AskUserQuestion`,
  `Glob`/`Grep`/`Read`, `$ARGUMENTS`, Claude Code-only MCP settings), the
  authors' own slash commands and personas, and the superpowers plugin's
  `superpowers:` names were made harness-neutral.
- **Nothing reaches outside.** `brainstorming`'s visual companion no longer
  loads a logo from the author's site.
- **Self-contained.** agent-skills' shared checklists (`references/` at its
  root) are carried into each skill that links them; `executing-plans`
  carries the scripts and reviewer prompt it borrowed from sibling skills,
  so it works where `subagent-driven-development` is not given. The notes
  from writing `systematic-debugging`, which nothing links, are left out.

## Skills that need subagents

`doubt-driven-development`, `dispatching-parallel-agents`,
`requesting-code-review`, `subagent-driven-development` and `writing-skills`
cannot be followed without dispatching subagents. They are marked
`needs: subagents`, and a harness Althar does not count on for subagents
(Codex, for now) is not given them; its thread says which were left out.

## Still to watch

- The 32 skills' names and descriptions come to about 9,200 characters, all
  of them turned on.
  Codex lists skills within a budget of about 2% of its context, or 8,000
  characters when it does not know the context size, so it may shorten or
  drop entries there. A live session shows whether it does.
- Several skills carry scripts (`brainstorming`'s visual companion,
  `executing-plans` and `subagent-driven-development`'s helpers,
  `systematic-debugging`'s `find-polluter.sh`, `writing-skills`'
  `render-graphs.js`). Althar never runs them; an agent may, under the run's
  permission rules.

## Updating

Clone both repositories at the commits you want, set them in
`scripts/curation.ts`, and run

```sh
node packages/skills/scripts/vendor.ts --agent-skills <clone> --superpowers <clone>
```

It stops on an edit that no longer applies, a link to a skill the catalog
does not carry, or a name of one it left out. Read the upstream changes to
every carried skill before moving a pin.
