// Scrappy: a state's repositories as the runtime hands a task on today: its pull requests, its files under each repository's folder, its review.
import type { ChangeSummary, ThreadItem, ThreadSnapshot } from '../../../contracts/src/index'
import { change, items, snapshot } from '../../../../apps/desktop/tests/fixtures'
import { type Check, HOSTS, hostOf, newPullRequestOf, type Repo, type Scenario, urlOf } from './data'

const summaryOf = (checks: readonly Check[]): ChangeSummary['checks'] => {
  const count = (state: Check['state']) => checks.filter((check) => check.state === state).length
  const failed = count('failed')
  const running = count('running') + count('queued')
  return {
    outcome: failed > 0 ? 'failed' : running > 0 ? 'running' : checks.length > 0 ? 'passed' : 'none',
    passed: count('passed'),
    failed,
    running,
    total: checks.length,
    failing: checks.filter((check) => check.state === 'failed').map((check) => check.name),
    list: checks.map((check) => ({ name: check.name, state: check.state, summary: check.summary ?? null })),
  }
}

const changeOf = (scenario: Scenario, repo: Repo): ChangeSummary => {
  const host = hostOf(repo)
  return change({
    product: host.product,
    number: repo.number ?? 0,
    title: scenario.title,
    url: urlOf(repo),
    state: repo.state === 'merged' ? 'merged' : 'open',
    draft: repo.state === 'draft',
    noun: host.noun,
    short: host.short,
    prefix: host.prefix,
    repository: repo.path,
    slug: repo.slug,
    additions: repo.files.reduce((n, f) => n + f.add, 0),
    deletions: repo.files.reduce((n, f) => n + f.del, 0),
    changedFiles: repo.files.length,
    checks: summaryOf(repo.checks),
    target: 'main',
    conflicts: repo.conflict !== undefined,
    head: `head-${repo.slug}`,
    localHead: repo.state === 'merged' ? null : `head-${repo.slug}`,
    unpushed: 0,
    pushing: { held: null },
    diverged: null,
  })
}

const DESCRIPTIONS: Record<string, string> = {
  engine:
    'Adds a `promptDebug` field to chat messages in the GraphQL schema, resolved from the prompt the engine sent the model, and only for workspaces with prompt debugging turned on.',
  frontend:
    'Shows the prompt behind each assistant reply in chat, folded under the reply, read through the new `promptDebug` field. It needs engine !52 merged first.',
  sdk: 'Adds `promptDebug` to the SDK’s `Message` type.',
  proto: 'Adds `ExportInvoices` to the invoices service: a date range in, a CSV file out.',
  api: 'Implements `ExportInvoices`, streaming rows so a year of invoices doesn’t sit in memory, behind `POST /invoices/export`.',
  web: 'Adds Export as CSV to the invoices page, with the date range picker it already has.',
  ios: 'Adds the same export to the iPhone app, as a share sheet.',
}

const STORY: Record<Scenario['project'], string> = {
  fnt: 'Each chat reply can show the prompt that produced it, for workspaces with prompt debugging on: the engine resolves it, the frontend folds it under the reply.',
  meridian: 'Customers can export their invoices as CSV, for a date range, from the web and from the iPhone app.',
}

// The conversation, made once a state: read again, its items keep their ids, so the thread doesn't take them for new ones.
const made = new Map<string, ThreadItem[]>()
const itemsOf = (scenario: Scenario, story: boolean): ThreadItem[] => {
  const key = `${scenario.key}-${story}`
  const known = made.get(key)
  if (known !== undefined) return known
  const descriptions = Object.fromEntries(scenario.repos.map((repo) => [repo.slug, DESCRIPTIONS[repo.slug] ?? '']))
  const list = [
    items.you(
      scenario.project === 'fnt'
        ? 'Can we see the prompt behind a chat reply? Behind the prompt debugging flag, engine and frontend.'
        : 'Customers want their invoices as CSV, from a date range. Web and iOS.',
    ),
    ...(story ? [items.step({ step: 'implement', summary: STORY[scenario.project], built: STORY[scenario.project], descriptions })] : []),
    ...(scenario.review === null ? [] : [items.step({ step: 'review', verdict: 'pass', agentId: 'codex', summary: 'No findings.' })]),
  ]
  made.set(key, list)
  return list
}

/** The task, as the runtime would hand it on now: ready, its lead done, its pull requests as they stand. */
export const snapshotOf = (scenario: Scenario, repos: readonly Repo[], { story = true }: { story?: boolean } = {}): ThreadSnapshot => {
  const base = snapshot()
  const [first] = repos.filter((repo) => repo.number !== null)
  const host = HOSTS[first?.host ?? 'gitlab']
  return snapshot({
    project: { id: 'p1', name: scenario.project },
    host: { product: host.product, name: host.name, webUrl: host.web, connected: true },
    task: {
      ...base.task,
      id: 't1',
      title: scenario.title,
      slug: scenario.branch.slice('althar/'.length),
      branch: scenario.branch,
      worktree: `/Users/balazs/Althar/${scenario.project}/${scenario.branch.slice('althar/'.length)}`,
      phase: 'ready',
      steps: [
        { key: 'implement', agentId: 'claude-code', model: 'opus', skipped: false },
        { key: 'review', agentId: 'codex', model: 'gpt-6.1-terra', skipped: false },
      ],
      changes: repos.filter((repo) => repo.number !== null).map((repo) => changeOf(scenario, repo)),
      files: repos.flatMap((repo) =>
        repo.files.map((file) => ({
          // Under its repository's folder in a task of several, as the worktree has them; a task of one has its paths as they are.
          path: repos.length > 1 ? `${repo.slug}/${file.path}` : file.path,
          from: null,
          status: file.del === 0 ? ('added' as const) : ('modified' as const),
          add: file.add,
          del: file.del,
          binary: false,
          uncommitted: false,
        })),
      ),
      commits: 3,
      here: repos
        .filter((repo) => repo.number === null)
        .map((repo) => ({
          repository: repo.slug,
          name: repo.slug,
          branch: 'main',
          head: `head-${repo.slug}`,
          remote: {
            name: 'origin',
            branch: scenario.branch,
            pushed: true,
            ahead: 0,
            newPullRequest: newPullRequestOf(repo, scenario.branch),
          },
        })),
      actions: ['abandon'],
    },
    items: itemsOf(scenario, story),
  })
}
