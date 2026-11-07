// The project's data as the prototype shows it: fnt, five repositories on a
// self-hosted GitLab. Nothing here is real; it is shaped like the runtime's
// ProjectRepository, OfferedRefs and Runnable, so what the picker draws is
// what the real one could draw.

export type Direction = 'A' | 'B' | 'C'

/** The three projects the switcher offers: defaults that differ, one default for all, and one repository. */
export type Defaults = 'mixed' | 'same' | 'single'

export interface PullRequest {
  readonly number: number
  readonly title: string
  readonly branch: string
  readonly author: string
  readonly draft?: boolean
}

export interface Runnable {
  readonly name: string
  readonly command: string
  /** Where it answers, or null for something that finishes or opens a window. */
  readonly port: number | null
}

export interface Repository {
  readonly id: string
  readonly name: string
  /** As its remote says. */
  readonly defaultBranch: string
  /** Its remote's branches, its default first, as this Mac last fetched them. */
  readonly branches: readonly string[]
  readonly pullRequests: readonly PullRequest[]
  /** What Run starts here; null where the repository has nothing to run. */
  readonly runnable: Runnable | null
}

export interface Task {
  readonly id: string
  readonly title: string
  /** The repositories it touches; its worktree has one copy of each. */
  readonly repositories: readonly string[]
  readonly branch: string
}

/** The self-hosted GitLab the project's five repositories are on. */
export const HOST = 'gitlab.fnt.example'

const ENGINE: Repository = {
  id: 'engine',
  name: 'engine',
  defaultBranch: 'main',
  branches: ['main', 'fix/redirects', 'feature/turbo', 'chore/deps'],
  pullRequests: [
    { number: 12, title: 'Fix redirects after sign-in', branch: 'fix/redirects', author: 'mira' },
    { number: 31, title: 'Compile the templates ahead of time', branch: 'feature/turbo', author: 'jonas', draft: true },
  ],
  runnable: { name: 'Engine dev', command: 'bun run dev', port: 4100 },
}

const FRONTEND: Repository = {
  id: 'frontend',
  name: 'frontend',
  defaultBranch: 'main',
  branches: ['main', 'fix/redirects', 'redesign/nav', 'chore/icons'],
  pullRequests: [
    { number: 18, title: 'Show where Run runs across repositories', branch: 'redesign/nav', author: 'tomas' },
    { number: 12, title: 'Fix redirects after sign-in', branch: 'fix/redirects', author: 'mira' },
  ],
  runnable: { name: 'Frontend dev', command: 'bun run dev', port: 4200 },
}

const API: Repository = {
  id: 'api',
  name: 'api',
  defaultBranch: 'develop',
  branches: ['develop', 'feat/auth', 'fix/rate-limit'],
  pullRequests: [{ number: 7, title: 'Rotate API tokens without signing everyone out', branch: 'feat/auth', author: 'ana' }],
  runnable: { name: 'API dev', command: 'bun run dev', port: 4300 },
}

const DOCS: Repository = {
  id: 'docs',
  name: 'docs',
  defaultBranch: 'master',
  branches: ['master', 'docs/run-place', 'docs/self-host'],
  pullRequests: [],
  runnable: { name: 'Docs', command: 'bun run docs', port: 4400 },
}

const SHARED: Repository = {
  id: 'shared',
  name: 'shared',
  defaultBranch: 'main',
  branches: ['main', 'chore/deps'],
  pullRequests: [],
  runnable: null,
}

const TASKS: readonly Task[] = [
  { id: 't1', title: 'Fix redirects after sign-in', repositories: ['engine', 'frontend'], branch: 'althar/fix-redirects' },
  { id: 't2', title: 'Rotate the API tokens', repositories: ['api'], branch: 'althar/rotate-tokens' },
]

const SINGLE_TASKS: readonly Task[] = [
  { id: 't3', title: 'Tighten the engine’s logs', repositories: ['engine'], branch: 'althar/engine-logs' },
]

/** The project as the scenario says: all on one default, or each on its own. */
export const projectOf = (defaults: Defaults): { readonly repositories: readonly Repository[]; readonly tasks: readonly Task[] } => {
  if (defaults === 'single') return { repositories: [ENGINE], tasks: SINGLE_TASKS }
  if (defaults === 'same') {
    return {
      repositories: [
        ENGINE,
        FRONTEND,
        { ...API, defaultBranch: 'main', branches: ['main', 'develop', 'feat/auth', 'fix/rate-limit'] },
        { ...DOCS, defaultBranch: 'main', branches: ['main', 'master', 'docs/run-place', 'docs/self-host'] },
        SHARED,
      ],
      tasks: TASKS,
    }
  }
  return { repositories: [ENGINE, FRONTEND, API, DOCS, SHARED], tasks: TASKS }
}

export const DIRECTION_NAMES: Record<Direction, string> = {
  A: 'Name the repositories in place',
  B: 'Group by repository',
  C: 'Run board',
}

export const DIRECTION_BLURBS: Record<Direction, string> = {
  A: 'One list. Every branch and pull request says which repository it belongs to, and the top row says each repository’s default branch.',
  B: 'A section per repository: its default, its branches and its pull requests. Picking in one leaves the others on their defaults.',
  C: 'A compact grid. Repositories on the left, and on the right what Run will start where before anything is picked.',
}
