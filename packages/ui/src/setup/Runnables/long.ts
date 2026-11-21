import type { ListedRunnable } from './Runnables'

/*
 * What a project of many labs and prototypes runs, as Althar's own does:
 * its app and the person's few, then dozens its agents kept as they built
 * each lab and prototype. For stories of a long list.
 */

const LABS = [
  'thread',
  'preset-offer',
  'scratch',
  'new-project',
  'drafting',
  'search',
  'errand',
  'graph',
  'conversation-bar',
  'ship',
  'blockers',
  'homes',
  'import',
  'issue-part',
  'whole-team',
  'connect-home',
  'design',
  'clone-panel',
]

const PROTOTYPES = ['task-setup', 'handoff', 'clear-chat', 'capable', 'browser', 'many-repos', 'settings', 'small-change', 'branch-card']

const words = (slug: string) => slug.charAt(0).toUpperCase() + slug.slice(1).replaceAll('-', ' ')

export const LONG: ListedRunnable[] = [
  { id: 'desktop', name: 'Desktop app', command: 'bun run dev', about: 'althar · Worked out from the repository', from: 'repository' },
  {
    id: 'storybook',
    name: 'Storybook',
    command: 'bun --filter @althar/ui storybook',
    about: 'althar · Added by you',
    from: 'person',
  },
  { id: 'site', name: 'Public site', command: 'bun run site', about: 'althar · Added by you', from: 'person' },
  {
    id: 'fresh',
    name: 'Desktop app, fresh profile',
    command: 'ALTHAR_PROFILE="$(mktemp -d -t althar-fresh)" bun run dev',
    about: 'althar · Added by you',
    from: 'person',
  },
  {
    id: 'mobile',
    name: 'Mobile app',
    command: 'bunx expo start --dev-client',
    about: 'althar-mobile · Added by the coordinator',
    from: 'coordinator',
  },
  ...LABS.map((slug): ListedRunnable => ({
    id: `lab-${slug}`,
    name: `${words(slug)} lab`,
    command: `../../node_modules/.bin/vp dev --config lab/${slug}/vite.config.ts`,
    about: 'althar · Kept by an agent',
    from: 'agent',
  })),
  ...PROTOTYPES.map((slug): ListedRunnable => ({
    id: `prototype-${slug}`,
    name: `${words(slug)} prototype`,
    command: `./node_modules/.bin/vp dev --config prototypes/${slug}/vite.config.mjs`,
    about: 'althar · Kept by an agent',
    from: 'agent',
  })),
  {
    id: 'responsiveness',
    command: 'bunx vp test run --config vite.real.config.ts tests/real/responsiveness.test.ts',
    about: 'althar · Kept by an agent',
    from: 'agent',
  },
  { id: 'bench', command: 'bunx vp test bench --run', about: 'althar · Kept by an agent', from: 'agent' },
  { id: 'wrangler', name: 'Report worker', command: 'bunx wrangler dev', about: 'althar · Kept by an agent', from: 'agent' },
]
