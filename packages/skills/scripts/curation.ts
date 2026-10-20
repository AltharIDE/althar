/*
 * The default catalog's curation: which upstream skills it carries, at which commit, and the patch each needs to
 * fit Althar (catalog/CURATION.md says why). `vendor.ts` applies it to clones of the upstream repositories.
 *
 * A patch is a list of exact edits: each `find` must occur in its file (exactly once, unless `all`), so a re-vendor
 * against a newer commit stops where upstream changed under a patch instead of shipping it half-applied.
 */

export interface Upstream {
  readonly repo: string
  readonly sha: string
  readonly license: string
  readonly copyright: string
}

export const UPSTREAMS = {
  'agent-skills': {
    repo: 'addyosmani/agent-skills',
    sha: 'aeac41d4d005999432bb7312f7ff06383a91d59d',
    license: 'MIT',
    copyright: 'Copyright (c) 2025 Addy Osmani',
  },
  superpowers: {
    repo: 'obra/superpowers',
    sha: 'bb92a77741419a4ab5f06e711a283343f1ada0c3',
    license: 'MIT',
    copyright: 'Copyright (c) 2025 Jesse Vincent',
  },
} as const satisfies Record<string, Upstream>

export type UpstreamName = keyof typeof UPSTREAMS

export interface Edit {
  readonly file: string
  readonly find: string
  readonly replace: string
  readonly all?: boolean
}

export interface Curated {
  readonly id: string
  readonly from: UpstreamName
  /** Capabilities a harness needs for the skill to make sense; a harness without them is not given it. */
  readonly needs?: ReadonlyArray<'subagents'>
  /** Files of the upstream skill left out. */
  readonly drop?: ReadonlyArray<string>
  /** Files added to the skill, by their path in it, from a path in the upstream repository (same author and licence). */
  readonly add?: Readonly<Record<string, string>>
  readonly edits?: ReadonlyArray<Edit>
  /** Why it is in, and what its patch changes, for the catalog entry and the review card. */
  readonly note: string
}

/** Upstream skills not carried, and why (catalog/CURATION.md has the comparison). */
export const LEFT_OUT: Readonly<Record<string, { readonly from: UpstreamName; readonly why: string }>> = {
  'test-driven-development@agent-skills': {
    from: 'agent-skills',
    why: 'same job and name as superpowers’ test-driven-development, kept instead',
  },
  'debugging-and-error-recovery': { from: 'agent-skills', why: 'same job as superpowers’ systematic-debugging, kept instead' },
  'planning-and-task-breakdown': { from: 'agent-skills', why: 'same job as superpowers’ writing-plans, kept instead' },
  'spec-driven-development': { from: 'agent-skills', why: 'same job as superpowers’ brainstorming, kept instead' },
  'interview-me': { from: 'agent-skills', why: 'same job as superpowers’ brainstorming, kept instead' },
  'using-superpowers': { from: 'superpowers', why: 'a second always-on router beside agent-skills’ using-agent-skills, kept instead' },
  'using-git-worktrees': {
    from: 'superpowers',
    why: 'Althar gives every task its own worktree and branch; a lead making more leaves state Althar neither sees nor cleans up',
  },
  'diagnosing-superpowers': {
    from: 'superpowers',
    why: 'only diagnoses sessions of the superpowers plugin, which Althar does not run, and files issues on its tracker',
  },
}

/** Every upstream root reference file a skill links as `../../references/<name>`, carried into the skill. */
const ROOT_REFERENCES = [
  'accessibility-checklist',
  'definition-of-done',
  'observability-checklist',
  'performance-checklist',
  'security-checklist',
  'testing-patterns',
]

const NOT_COMMITTED_SUPERPOWERS = 'never committed (create `.superpowers/.gitignore` containing `*` first if it is missing)'

export const CURATED: ReadonlyArray<Curated> = [
  // agent-skills: the engineering and lifecycle skills it alone has.
  { id: 'api-and-interface-design', from: 'agent-skills', note: 'As upstream.' },
  {
    id: 'browser-testing-with-devtools',
    from: 'agent-skills',
    note: 'Its MCP setup no longer names a Claude Code-only place or a file in the repository.',
    edits: [
      {
        file: 'SKILL.md',
        find: "Add the following to your project's `.mcp.json` or Claude Code settings:",
        replace:
          "Add the chrome-devtools server to your harness's MCP configuration (not a file in the repository unless the person asks). In the common JSON form:",
      },
    ],
  },
  {
    id: 'ci-cd-and-automation',
    from: 'agent-skills',
    note: 'The agent commits a fix and Althar pushes it, instead of the agent pushing.',
    edits: [
      {
        file: 'SKILL.md',
        find: 'Fix the issue and verify locally before pushing again."',
        replace: 'Fix the issue, verify locally and commit; Althar pushes."',
      },
      { file: 'SKILL.md', find: 'Agent fixes → pushes → CI runs again', replace: 'Agent fixes → commits → Althar pushes → CI runs again' },
    ],
  },
  {
    id: 'code-review-and-quality',
    from: 'agent-skills',
    note: 'Credits the Google engineering-practices material it adapts; its checklists are carried in.',
    edits: [
      {
        file: 'SKILL.md',
        find: '# Code Review and Quality\n',
        replace:
          "# Code Review and Quality\n\n> Parts adapted from Google's Engineering Practices documentation (https://google.github.io/eng-practices/), CC BY 3.0.\n",
      },
    ],
  },
  {
    id: 'code-simplification',
    from: 'agent-skills',
    note: 'Reads whichever agent rules file the project has, not CLAUDE.md alone.',
    edits: [
      {
        file: 'SKILL.md',
        find: '1. Read CLAUDE.md / project conventions',
        replace: "1. Read the project's agent rules (AGENTS.md, CLAUDE.md or similar) and conventions",
      },
    ],
  },
  {
    id: 'constraint-driven-development',
    from: 'agent-skills',
    note: 'Its phases name when the checks run instead of the author’s own slash commands; its template names no one.',
    edits: [
      {
        file: 'SKILL.md',
        find: "- You're about to run `/build auto` or any autonomous loop",
        replace: "- You're about to run an autonomous loop",
      },
      { file: 'SKILL.md', find: 'Last reviewed: 2026-08-08 by @addy', replace: 'Last reviewed: YYYY-MM-DD by @owner' },
      { file: 'SKILL.md', find: '| BUILD | `/build` |', replace: '| BUILD | after each edit |' },
      { file: 'SKILL.md', find: '| VERIFY | `/test` |', replace: '| VERIFY | at task end |' },
      { file: 'SKILL.md', find: '| REVIEW | `/review` |', replace: '| REVIEW | at review |' },
      { file: 'SKILL.md', find: '| SHIP | `/ship` |', replace: '| SHIP | in CI |' },
    ],
  },
  {
    id: 'context-engineering',
    from: 'agent-skills',
    note: 'AGENTS.md is named for every harness that reads it.',
    edits: [{ file: 'SKILL.md', find: '- `AGENTS.md` (OpenAI Codex)', replace: '- `AGENTS.md` (Codex, OpenCode and others)' }],
  },
  { id: 'deprecation-and-migration', from: 'agent-skills', note: 'As upstream.' },
  { id: 'documentation-and-adrs', from: 'agent-skills', note: 'As upstream.' },
  {
    id: 'doubt-driven-development',
    from: 'agent-skills',
    needs: ['subagents'],
    note: 'Needs a fresh-context subagent. The references to the author’s own personas and orchestration notes are left out.',
    edits: [
      {
        file: 'SKILL.md',
        find: '- **Do NOT add this skill to a persona\'s `skills:` frontmatter.** A persona that follows Step 3 would spawn another persona — the orchestration anti-pattern explicitly forbidden by `../../references/orchestration-patterns.md` ("personas do not invoke other personas").\n',
        replace: '',
      },
      {
        file: 'SKILL.md',
        find: "In Claude Code, the role-based reviewers in `agents/` start with isolated context by design and are usable here — see `agents/` for the roster and per-domain match.\n\n**The adversarial prompt above takes precedence over the persona's default response shape.** Personas like `code-reviewer` are written to produce balanced verdicts with both strengths and weaknesses; doubt-driven needs issues-only output. Paste the adversarial prompt verbatim into the invocation so it overrides the persona's default. If a persona's response shape can't be overridden cleanly, fall back to a generic subagent with the adversarial prompt.\n",
        replace:
          '**The adversarial prompt above takes precedence over a reviewer’s default response shape.** Doubt-driven needs issues-only output: paste the adversarial prompt verbatim into the invocation.\n',
      },
      {
        file: 'SKILL.md',
        find: '- **Repo orchestration rules** (`../../references/orchestration-patterns.md`): this skill orchestrates from the main session. A persona calling another persona is anti-pattern B — see Loading Constraints above.\n',
        replace: '',
      },
    ],
  },
  { id: 'frontend-ui-engineering', from: 'agent-skills', note: 'Its accessibility checklist is carried in.' },
  {
    id: 'git-workflow-and-versioning',
    from: 'agent-skills',
    note: 'Tags locally and leaves pushing to Althar; leaves worktrees, branches and merging to Althar, and never resets hard.',
    edits: [
      {
        file: 'SKILL.md',
        find: 'opening or reviewing a pull request (PR), pushing to a remote, or when',
        replace: 'reviewing a pull request (PR), or when',
      },
      {
        file: 'SKILL.md',
        find: 'Tag it so it can always be reproduced:\n\n```bash\ngit tag -a v1.4.0 -m "Release 1.4.0"\ngit push origin v1.4.0\n```',
        replace:
          'Tag it locally so it can always be reproduced, then stop and report the tag; Althar pushes it:\n\n```bash\ngit tag -a v1.4.0 -m "Release 1.4.0"\n```',
      },
      {
        file: 'SKILL.md',
        find: '## Working with Worktrees\n\nFor parallel AI agent work, use git worktrees to run multiple branches simultaneously:\n\n```bash\n# Create a worktree for a feature branch\ngit worktree add ../project-feature-a feature/task-creation\ngit worktree add ../project-feature-b feature/user-settings\n\n# Each worktree is a separate directory with its own branch\n# Agents can work in parallel without interfering\nls ../\n  project/              \u2190 main branch\n  project-feature-a/    \u2190 task-creation branch\n  project-feature-b/    \u2190 user-settings branch\n\n# When done, merge and clean up\ngit worktree remove ../project-feature-a\n```\n\nBenefits:\n- Multiple agents can work on different features simultaneously\n- No branch switching needed (each directory has its own branch)\n- If one experiment fails, delete the worktree \u2014 nothing is lost\n- Changes are isolated until explicitly merged\n\n',
        replace:
          "## Working with Worktrees\n\nAlthar gives each task its own worktree and branch, so agents already work\nin parallel without interfering. Do not add worktrees, or switch this one's\nbranch: Althar merges the work and cleans up.\n\n",
      },
      {
        file: 'SKILL.md',
        find: '- Delete branches after merge\n',
        replace: "- Leave deleting a task's branch to Althar, which does it once the work is merged\n",
      },
      {
        file: 'SKILL.md',
        find: 'If an agent goes off the rails, `git reset --hard HEAD` takes you back to the last successful state.',
        replace:
          'If an agent goes off the rails, `git restore` on the files it changed takes you back to the last successful commit; never `git reset --hard`, which also throws away work you meant to keep.',
      },
    ],
  },
  {
    id: 'idea-refine',
    from: 'agent-skills',
    note: 'Asks with whatever the harness offers, names no harness’s tools, and keeps its one-pager out of the repository unless asked. Its script, which made a folder in the repository, is left out.',
    drop: ['scripts/idea-refine.sh'],
    edits: [
      {
        file: 'SKILL.md',
        find: '\n```bash\n# Optional: Initialize the ideas directory\nbash skills/idea-refine/scripts/idea-refine.sh\n```\n',
        replace: '',
      },
      {
        file: 'SKILL.md',
        find: 'saved to `docs/ideas/[idea-name].md` (after user confirmation)',
        replace: 'saved outside the repository, or where the user says (after user confirmation)',
      },
      { file: 'SKILL.md', find: ' (`$ARGUMENTS`)', replace: '' },
      {
        file: 'SKILL.md',
        find: '(use `interview-me`), or a direction already chosen that needs a spec (use `spec-driven-development`)',
        replace: 'or a direction already chosen that needs a design (use `brainstorming` for both)',
      },
      {
        file: 'SKILL.md',
        find: 'Use the `AskUserQuestion` tool to gather this input.',
        replace: "Ask the user directly (with your harness's question tool, if it has one) to gather this input.",
      },
      { file: 'SKILL.md', find: 'Use `Glob`, `Grep`, and `Read` to scan', replace: 'Search and read the code to scan' },
      {
        file: 'SKILL.md',
        find: 'save this to `docs/ideas/[idea-name].md` (or a location of their choosing)',
        replace: 'save this outside the repository (or to a location of their choosing, the repository included if they ask)',
      },
    ],
  },
  { id: 'incremental-implementation', from: 'agent-skills', note: 'Its Definition of Done is carried in.' },
  { id: 'observability-and-instrumentation', from: 'agent-skills', note: 'Its checklist is carried in.' },
  {
    id: 'performance-optimization',
    from: 'agent-skills',
    note: 'Keeps its experiment ledger out of the repository unless asked; its checklist is carried in.',
    edits: [
      {
        file: 'SKILL.md',
        find: 'or a `PERF.md` in the repo both work',
        replace: 'or a ledger file outside the repository (in it only if the user asks) both work',
      },
    ],
  },
  { id: 'security-and-hardening', from: 'agent-skills', note: 'Its checklist is carried in.' },
  {
    id: 'shipping-and-launch',
    from: 'agent-skills',
    note: 'Reverts locally and leaves pushing to Althar; its checklists are carried in.',
    edits: [
      {
        file: 'SKILL.md',
        find: '1. Deploy previous version: `git revert <commit> && git push`',
        replace: '1. Deploy previous version: `git revert <commit>`, then stop and report (Althar pushes)',
      },
    ],
  },
  { id: 'source-driven-development', from: 'agent-skills', note: 'As upstream.' },
  {
    id: 'using-agent-skills',
    from: 'agent-skills',
    note: 'The router for the whole catalog: its map names the skills carried from both upstreams, not those left out.',
    edits: [
      {
        file: 'SKILL.md',
        find: 'Agent Skills is a collection of engineering workflow skills organized by development phase.',
        replace:
          'This catalog is a collection of engineering workflow skills organized by development phase, from agent-skills and superpowers.',
      },
      {
        file: 'SKILL.md',
        find: "    ├── Don't know what you want yet? ──────→ interview-me\n    ├── Have a rough concept, need variants? → idea-refine\n    ├── New project/feature/change? ──→ spec-driven-development\n    ├── No quality bar written down? ──→ constraint-driven-development\n    ├── Have a spec, need tasks? ──────→ planning-and-task-breakdown\n    ├── Implementing code? ────────────→ incremental-implementation\n",
        replace:
          "    ├── Don't know what you want yet? ──────→ brainstorming\n    ├── Have a rough concept, need variants? → idea-refine\n    ├── New project/feature/change? ──→ brainstorming\n    ├── No quality bar written down? ──→ constraint-driven-development\n    ├── Have a spec, need tasks? ──────→ writing-plans\n    ├── Have a plan, need it carried out? ─→ executing-plans\n    │   ├── Can dispatch subagents? ────→ subagent-driven-development\n    │   └── Independent problems? ─────→ dispatching-parallel-agents\n    ├── Implementing code? ────────────→ incremental-implementation\n",
      },
      {
        file: 'SKILL.md',
        find: '    ├── Something broke? ──────────────→ debugging-and-error-recovery\n    ├── Reviewing code? ───────────────→ code-review-and-quality\n',
        replace:
          "    ├── Something broke? ──────────────→ systematic-debugging\n    ├── About to say it's done? ───────→ verification-before-completion\n    ├── Reviewing code? ───────────────→ code-review-and-quality\n    │   ├── Want a fresh reviewer? ───→ requesting-code-review\n    │   ├── Got review feedback? ─────→ receiving-code-review\n",
      },
      {
        file: 'SKILL.md',
        find: '    ├── Committing/branching? ─────────→ git-workflow-and-versioning\n',
        replace:
          '    ├── Committing/branching? ─────────→ git-workflow-and-versioning\n    │   └── Branch finished? ──────────→ finishing-a-development-branch\n',
      },
      {
        file: 'SKILL.md',
        find: '    └── Deploying/launching? ─────────→ shipping-and-launch\n',
        replace: '    ├── Deploying/launching? ─────────→ shipping-and-launch\n    └── Writing a skill? ─────────────→ writing-skills\n',
      },
      {
        file: 'SKILL.md',
        find: '`idea-refine` → `spec-driven-development` → `planning-and-task-breakdown` → `incremental-implementation`',
        replace: '`idea-refine` → `brainstorming` → `writing-plans` → `incremental-implementation`',
      },
      {
        file: 'SKILL.md',
        find: "4. **When in doubt, start with a spec.** If the task is non-trivial and there's no spec, begin with `spec-driven-development`.",
        replace:
          "4. **When in doubt, start with a design.** If the task is non-trivial and there's no agreed design, begin with `brainstorming`.",
      },
      {
        file: 'SKILL.md',
        find: "1.  interview-me                → Extract what the user actually wants\n2.  idea-refine                 → Refine vague ideas\n3.  spec-driven-development     → Define what we're building\n4.  planning-and-task-breakdown → Break into verifiable chunks\n",
        replace:
          '1.  brainstorming               → Extract what the user actually wants and agree a design\n2.  idea-refine                 → Refine vague ideas\n3.  constraint-driven-development → Write down the quality bar\n4.  writing-plans               → Break into verifiable chunks\n',
      },
      {
        file: 'SKILL.md',
        find: '`debugging-and-error-recovery` → `test-driven-development` → `code-review-and-quality`.',
        replace: '`systematic-debugging` → `test-driven-development` → `verification-before-completion` → `code-review-and-quality`.',
      },
      {
        file: 'SKILL.md',
        find: '| Define | interview-me | Surface what the user actually wants before any plan, spec, or code exists |\n| Define | idea-refine | Refine ideas through structured divergent and convergent thinking |\n| Define | spec-driven-development | Requirements and acceptance criteria before code |\n| Plan | planning-and-task-breakdown | Decompose into small, verifiable tasks |\n',
        replace:
          '| Define | brainstorming | Surface what the user wants and agree a design before code |\n| Define | idea-refine | Refine ideas through structured divergent and convergent thinking |\n| Define | constraint-driven-development | A written quality bar the checks enforce |\n| Plan | writing-plans | Decompose into small, verifiable tasks with exact files and commands |\n| Plan | executing-plans | Carry a written plan out task by task |\n| Plan | subagent-driven-development | Carry a plan out with a fresh subagent per task |\n| Plan | dispatching-parallel-agents | Work independent problems in parallel |\n',
      },
      {
        file: 'SKILL.md',
        find: '| Verify | debugging-and-error-recovery | Reproduce → localize → fix → guard |\n',
        replace:
          '| Verify | systematic-debugging | Root cause before any fix, one hypothesis at a time |\n| Verify | verification-before-completion | Evidence before claiming done |\n',
      },
      {
        file: 'SKILL.md',
        find: '| Review | code-simplification |',
        replace:
          '| Review | requesting-code-review | Dispatch a fresh reviewer after a task |\n| Review | receiving-code-review | Weigh review feedback before acting on it |\n| Review | code-simplification |',
      },
      {
        file: 'SKILL.md',
        find: '| Ship | git-workflow-and-versioning | Atomic commits, clean history |\n',
        replace:
          '| Ship | git-workflow-and-versioning | Atomic commits, clean history |\n| Ship | finishing-a-development-branch | Verify, then hand the branch off |\n',
      },
    ],
  },

  // superpowers: the ones kept for a job both have, and those it alone has.
  {
    id: 'brainstorming',
    from: 'superpowers',
    note: 'Kept over spec-driven-development and interview-me. Its trigger no longer fires on every task, its design document is not committed, its visual companion keeps its files ignored and makes no request to the author’s site.',
    edits: [
      {
        file: 'SKILL.md',
        find: 'description: "You MUST use this before any creative work - creating features, building components, adding functionality, modifying behavior, or planning anything new, in software or out of it (a talk, a business, a renovation)."',
        replace:
          'description: "Use before building a new feature or change whose intent or design is not settled yet: draws out what the person wants and agrees a design before any code. Also for planning something new outside software."',
      },
      {
        file: 'SKILL.md',
        find: '`docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`, committed.',
        replace: `\`.superpowers/specs/YYYY-MM-DD-<topic>-design.md\`, ${NOT_COMMITTED_SUPERPOWERS}.`,
      },
      {
        file: 'visual-companion.md',
        find: "Remind the user to add `.superpowers/` to `.gitignore` if it's not already there.",
        replace:
          'Create `.superpowers/.gitignore` containing `*` if it does not exist, so nothing in it (the session key included) is committed.',
      },
      {
        file: 'scripts/server.cjs',
        find: 'const SUPERPOWERS_TELEMETRY_DISABLED = TELEMETRY_DISABLE_ENV_VARS.some(name => isTruthyEnv(process.env[name]));',
        replace: 'const SUPERPOWERS_TELEMETRY_DISABLED = true; // Althar: never load the logo from the author’s site.',
      },
    ],
  },
  {
    id: 'dispatching-parallel-agents',
    from: 'superpowers',
    needs: ['subagents'],
    note: 'Needs subagents.',
  },
  {
    id: 'executing-plans',
    from: 'superpowers',
    note: 'Carries the scripts and reviewer prompt it borrowed from sibling skills, so it works where subagent-driven-development is not given.',
    add: {
      'scripts/sdd-workspace': 'skills/subagent-driven-development/scripts/sdd-workspace',
      'scripts/task-brief': 'skills/subagent-driven-development/scripts/task-brief',
      'scripts/review-package': 'skills/subagent-driven-development/scripts/review-package',
      'references/code-reviewer.md': 'skills/requesting-code-review/code-reviewer.md',
    },
    edits: [
      {
        file: 'SKILL.md',
        find: 'Ensure the work happens in an isolated workspace: use\nsuperpowers:using-git-worktrees to create one or verify the existing one.\n',
        replace: 'The work happens in the worktree Althar made for the task: never create\nanother, nor switch its branch.\n',
      },
      {
        file: 'SKILL.md',
        find: '- Your harness has no subagent tool (see the per-platform references in\n  `../using-superpowers/references/`). Never fabricate a dispatch; run\n',
        replace: '- Your harness has no subagent tool. Never fabricate a dispatch; run\n',
      },
      { file: 'SKILL.md', find: '../subagent-driven-development/scripts/', replace: 'scripts/', all: true },
      { file: 'SKILL.md', find: '../requesting-code-review/code-reviewer.md', replace: 'references/code-reviewer.md', all: true },
      { file: 'scripts/task-start', find: '"$(dirname "$0")/../../subagent-driven-development/scripts"', replace: '"$(dirname "$0")"' },
      { file: 'scripts/task-done', find: '"$(dirname "$0")/../../subagent-driven-development/scripts"', replace: '"$(dirname "$0")"' },
    ],
  },
  {
    id: 'finishing-a-development-branch',
    from: 'superpowers',
    note: 'Ends in a hand-off: Althar merges, pushes, opens the pull request and cleans up. It never leaves the task’s worktree, switches or deletes its branch, or touches the person’s own checkout.',
    edits: [
      {
        file: 'SKILL.md',
        find: '2. Push and create a Pull Request',
        replace: '2. Hand off for a pull request (Althar pushes and opens it)',
      },
      {
        file: 'SKILL.md',
        find: '1. Push as new branch and create a Pull Request',
        replace: '1. Hand off for a pull request (Althar pushes and opens it)',
      },
      {
        file: 'SKILL.md',
        find: '1. Merge back to <base-branch> locally',
        replace: '1. Hand off to merge into <base-branch> (Althar merges it and cleans up)',
      },
      {
        file: 'SKILL.md',
        find: '# Capture now, while still inside the workspace \u2014 Step 5 changes directory\n# before cleanup (Step 6) needs this value\n',
        replace: '',
      },
      {
        file: 'SKILL.md',
        find: '### Option 1: Merge Locally\n\n```bash\n# Get main repo root for CWD safety\nMAIN_ROOT=$(git -C "$(git rev-parse --git-common-dir)/.." rev-parse --show-toplevel)\ncd "$MAIN_ROOT"\n\n# Merge first \u2014 verify success before removing anything\ngit checkout <base-branch>\ngit pull\ngit merge <feature-branch>\n\n# Verify tests on merged result\n<test command>\n```\n\nIf tests fail on the merged result: stop, leave the worktree and branch in\nplace, and investigate \u2014 nothing has been pushed, so the merge is local\nand recoverable.\n\nOnce the merged result is green: clean up the worktree (Step 6), then\ndelete the branch:\n\n```bash\ngit branch -d <feature-branch>\n```\n\n',
        replace:
          "### Option 1: Hand off to merge\n\nDo not merge, switch branches or leave this worktree yourself, and never\n`cd` into the main checkout: Althar owns the task's worktree and branch,\nmerges the work into <base-branch> and cleans up after. Make sure all work\nis committed, then stop and report the branch, its commits and the test\nresult, saying your human partner chose to merge it.\n\n",
      },
      {
        file: 'SKILL.md',
        find: "### Option 2: Push and Create PR\n\n```bash\ngit push -u origin <feature-branch>\n# From a detached HEAD, name the new branch on the remote:\n# git push origin HEAD:refs/heads/<new-branch>\n```\n\nThen create the pull/merge request against <base-branch> with the forge's\ntooling \u2014 its CLI if one is available, or the creation URL most forges\nprint when you push \u2014 following the repo's PR template and conventions if\npresent, and report the URL to your human partner.\n\nKeep the worktree \u2014 your human partner iterates on PR feedback there.\n\n",
        replace:
          '### Option 2: Hand off for a pull request\n\nDo not push or open the pull request yourself. Make sure all work is\ncommitted, then stop and report the branch, its commits and the test\nresult. Althar pushes and opens the pull request.\n\nKeep the worktree \u2014 your human partner iterates on PR feedback there.\n\n',
      },
      {
        file: 'SKILL.md',
        find: 'Wait for that exact confirmation. When it arrives:\n\n```bash\nMAIN_ROOT=$(git -C "$(git rev-parse --git-common-dir)/.." rev-parse --show-toplevel)\ncd "$MAIN_ROOT"\n```\n\nThen clean up the worktree (Step 6) and force-delete the branch:\n\n```bash\ngit branch -D <feature-branch>\n```\n\n',
        replace:
          "Wait for that exact confirmation. When it arrives, delete nothing\nyourself: report that your human partner chose to discard the work. Althar\nremoves the task's worktree and branch when they abandon the task.\n\n",
      },
      {
        file: 'SKILL.md',
        find: '## Step 6: Cleanup Workspace\n\n**Runs for Option 1 and confirmed discards.** Options 2 and 3 always\npreserve the worktree. Both callers have already changed directory to the\nmain repo root \u2014 worktree removal must run from outside the worktree \u2014\nand use the `GIT_DIR`/`GIT_COMMON`/`WORKTREE_PATH` values captured in\nStep 2, from before that directory change.\n\n**If `GIT_DIR == GIT_COMMON`:** Normal repo, no worktree to clean up. Done.\n\n**If `WORKTREE_PATH` is under `.worktrees/` or `worktrees/`:** Superpowers\ncreated this worktree \u2014 we own cleanup:\n\n```bash\ngit worktree remove "$WORKTREE_PATH"\ngit worktree prune  # Self-healing: clean up any stale registrations\n```\n\n**If removal is refused** (`contains modified or untracked files`): the\nworktree holds files that exist nowhere else \u2014 uncommitted plans, notes,\nor scratch work. Never `--force` on your own initiative. Show your human\npartner what is at stake and ask:\n\n```bash\ngit -C "$WORKTREE_PATH" status --porcelain -uall\n```\n\n```\nWorktree removal refused \u2014 these files were never committed:\n\n<file list>\n\n1. Commit them to <branch> before cleanup\n2. Move them into <main repo root>\n3. Delete them (unrecoverable)\n\nWhich?\n```\n\nCarry out the choice, then remove the worktree.\n\n**Otherwise:** The host environment owns this workspace \u2014 leave it in\nplace. If your platform provides a workspace-exit tool, use it.\n\n',
        replace:
          '## Step 6: Cleanup Workspace\n\nNever remove the worktree you are working in, or switch or delete its\nbranch: Althar made them, and cleans them up once the work is merged or\ndiscarded.\n\nIf you created another worktree yourself for this work, remove it once its\nwork is committed here: `git worktree remove <path>`. If removal is refused\n(`contains modified or untracked files`), those files exist nowhere else:\nnever `--force` on your own initiative. Show your human partner\n`git -C <path> status --porcelain -uall` and ask.\n\n',
      },
      {
        file: 'SKILL.md',
        find: '| 1. Merge locally | yes | - | - | yes |\n| 2. Create PR | - | yes | yes | - |\n| 3. Keep as-is | - | - | yes | - |\n| Discard (explicit request only) | - | - | - | yes (force) |',
        replace:
          '| 1. Hand off to merge | - | - | yes | - |\n| 2. Hand off for PR | - | - | yes | - |\n| 3. Keep as-is | - | - | yes | - |\n| Discard (explicit request only) | - | - | yes | - |',
      },
      {
        file: 'SKILL.md',
        find: '| "This other worktree looks stale \u2014 I\'ll clean it too" | Clean up only worktrees under `.worktrees/` or `worktrees/`. Everything else belongs to the host. |',
        replace:
          '| "This other worktree looks stale \u2014 I\'ll clean it too" | Clean up only worktrees you created yourself. Althar\'s belong to Althar. |\n| "Merging it myself is quicker" | Althar owns the task\'s worktree and branch. Merging or switching branches yourself fights it, and the main checkout is your human partner\'s own. |',
      },
      {
        file: 'SKILL.md',
        find: '| "The merged-result failure is probably flaky" | A failing merged result stops everything. Branch and worktree stay put while you investigate. |\n',
        replace: '',
      },
      {
        file: 'SKILL.md',
        find: '| "The push was rejected \u2014 force-push will fix it" | A rejected push means the remote moved. Investigate; force-push only on your human partner\'s explicit request. |\n',
        replace: '',
      },
    ],
  },
  {
    id: 'receiving-code-review',
    from: 'superpowers',
    note: 'Replies through the pull request tool the harness gives it, not `gh`.',
    edits: [
      {
        file: 'SKILL.md',
        find: 'reply in the comment thread (`gh api repos/{owner}/{repo}/pulls/{pr}/comments/{id}/replies`), not as a top-level PR comment.',
        replace: 'reply in the comment thread (with the pull request tool your harness gives you), not as a top-level PR comment.',
      },
    ],
  },
  {
    id: 'requesting-code-review',
    from: 'superpowers',
    needs: ['subagents'],
    note: 'Kept beside code-review-and-quality: it dispatches a fresh reviewer, which needs subagents.',
  },
  {
    id: 'subagent-driven-development',
    from: 'superpowers',
    needs: ['subagents'],
    note: 'Needs subagents. Works in the worktree Althar made for the task.',
    edits: [
      {
        file: 'SKILL.md',
        find: 'Ensure the work happens in an isolated workspace: use\nsuperpowers:using-git-worktrees to create one or verify the existing one.\n',
        replace: 'The work happens in the worktree Althar made for the task: never create\nanother, nor switch its branch.\n',
      },
    ],
  },
  {
    id: 'systematic-debugging',
    from: 'superpowers',
    note: 'Kept over debugging-and-error-recovery. The notes from writing it, which nothing links, are left out.',
    drop: ['CREATION-LOG.md', 'test-academic.md', 'test-pressure-1.md', 'test-pressure-2.md', 'test-pressure-3.md'],
  },
  { id: 'test-driven-development', from: 'superpowers', note: 'Kept over agent-skills’ skill of the same name.' },
  { id: 'verification-before-completion', from: 'superpowers', note: 'As upstream.' },
  {
    id: 'writing-plans',
    from: 'superpowers',
    note: 'Kept over planning-and-task-breakdown. Its plans are not committed.',
    edits: [
      {
        file: 'SKILL.md',
        find: '**Context:** If working in an isolated worktree, it should have been created via the `superpowers:using-git-worktrees` skill at execution time.',
        replace: '**Context:** The work happens in the worktree Althar made for the task.',
      },
      {
        file: 'SKILL.md',
        find: '**Save plans to:** `docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md`',
        replace: `**Save plans to:** \`.superpowers/plans/YYYY-MM-DD-<feature-name>.md\`, ${NOT_COMMITTED_SUPERPOWERS}`,
      },
    ],
  },
  {
    id: 'writing-skills',
    from: 'superpowers',
    needs: ['subagents'],
    note: 'Its testing method needs fresh subagents. Anthropic’s authoring guide, which the upstream licence does not cover, is left out, and it ends with a hand-off instead of a push.',
    drop: ['anthropic-best-practices.md'],
    edits: [
      {
        file: 'SKILL.md',
        find: "**Personal skills live in your runtime's skills directory** (`~/.claude/skills/` on Claude Code) — see [codex-tools.md](../using-superpowers/references/codex-tools.md) or [gemini-tools.md](../using-superpowers/references/gemini-tools.md) for the path on those runtimes. Codex, Copilot CLI, and Gemini CLI all also recognize `~/.agents/skills/` as a cross-runtime alias.",
        replace:
          "**Personal skills live in your runtime's skills directory** (for example `~/.claude/skills/` on Claude Code); Codex, OpenCode and others also recognize `~/.agents/skills/`.",
      },
      {
        file: 'SKILL.md',
        find: "**Official guidance:** For Anthropic's official skill authoring best practices, see anthropic-best-practices.md. This document provides additional patterns and guidelines that complement the TDD-focused approach in this skill.\n\n",
        replace: '',
      },
      {
        file: 'SKILL.md',
        find: '- [ ] Commit skill to git and push to your fork (if configured)\n- [ ] Consider contributing back via PR (if broadly useful)',
        replace: '- [ ] Commit the skill, then stop and report; Althar pushes and opens the pull request',
      },
    ],
  },
]

/** Edits every skill from an upstream gets, beside its own. */
export const EVERYWHERE: Readonly<Record<UpstreamName, ReadonlyArray<{ readonly pattern: RegExp; readonly replace: string }>>> = {
  'agent-skills': [
    // Its root reference files are carried into each skill that links them (ROOT_REFERENCES).
    { pattern: /\.\.\/\.\.\/\.\.\/references\//g, replace: '' },
    { pattern: /\.\.\/\.\.\/references\/([a-z-]+\.md)/g, replace: 'references/$1' },
    // A skill it names that the catalog left out, by the one it carries for the same job.
    { pattern: /\bdebugging-and-error-recovery\b/g, replace: 'systematic-debugging' },
    { pattern: /\bplanning-and-task-breakdown\b/g, replace: 'writing-plans' },
    { pattern: /\binterview-me\b/g, replace: 'brainstorming' },
  ],
  superpowers: [
    // Its skills name each other as the plugin namespaces them; here they are plain names.
    { pattern: /\bsuperpowers:([a-z][a-z-]*)/g, replace: '$1' },
    { pattern: /docs\/superpowers\/(plans|specs)\//g, replace: '.superpowers/$1/' },
  ],
}

export { ROOT_REFERENCES }
