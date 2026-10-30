import { type Kind, RELEASES, type Release } from '../../content/changelog'

/*
 * How the Spreads direction lays each release out: which words of its title
 * are set heavy, which picture shows its biggest change, and how that
 * picture reads to assistive technology. The words are the releases' own
 * (content/changelog.ts); this only says how they are set.
 */

/** The picture a spread opens on: a drawing in Althar's light, or a piece of the app. */
export type Art = 'keys' | 'masked' | 'report' | 'run' | 'evidence' | 'plan'

export interface Look {
  /** The title, with the words that matter between asterisks: set heavy, as the homepage's titles are. */
  headline: string
  art: Art
  /** What the picture shows, in a sentence. */
  label: string
}

export const LOOKS: Record<string, Look> = {
  '0.5.0': {
    headline: '*Windows*, and *seven more agents*',
    art: 'keys',
    label:
      'Keys lit from below: Windows, GitHub Copilot, Junie, Grok Build, Kimi Code, Mistral Vibe, Qwen Code and Google Antigravity, beside Claude Code, Codex and OpenCode',
  },
  '0.4.1': {
    headline: '*Crash reports*, and pull requests written for a reviewer',
    art: 'masked',
    label:
      'A crash report as it leaves: the path in the home folder, the repository’s name, the email address and the key each replaced before it goes',
  },
  '0.4.0': {
    headline: 'Tell us what broke, *from anywhere*',
    art: 'report',
    label:
      'Report a problem, opened from the app’s menu, quick settings or a stuck step: what happened, with a screenshot of the window and the logs',
  },
  '0.3.0': {
    headline: '*Run many things*, allow everything',
    art: 'run',
    label:
      'The split Run button’s list: the API server and the webhooks worker running, the dashboard starting, the ledger tests failed; beside it, Allow everything switched on for the project',
  },
  '0.2.0': {
    headline: 'Tasks that *show their evidence*',
    art: 'evidence',
    label: 'A finished task: what it built, then its evidence, screenshots before and after and the test run, and what it couldn’t check',
  },
  '0.1.0': {
    headline: 'The *first build*',
    art: 'plan',
    label: 'The lead’s plan for a task: its lead implements, a reviewer from another lab reviews, and the lead repairs',
  },
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** 2026-10-20 as 20 October 2026, the same on the server and in the browser. */
export const longDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`
}

/** 2026-10-30 as Friday 30 October. */
export const dayDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  const day = new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, d ?? 1)).getUTCDay()
  return `${DAYS[day]} ${d} ${MONTHS[(m ?? 1) - 1]}`
}

/** A version as its spread's numeral: 0.5.0 as 0.5, 0.4.1 whole. */
export const numeral = (version: string) => version.replace(/\.0$/, '')

/** A release's changes by kind, in the order the columns stand, leaving out a kind it has none of. */
export const byKind = (release: Release) =>
  (['new', 'improved', 'fixed'] as const satisfies readonly Kind[])
    .map((kind) => ({ kind, changes: release.changes.filter((change) => change.kind === kind) }))
    .filter((column) => column.changes.length > 0)

/** The releases with their looks, newest first. */
export const SPREADS = RELEASES.map((release) => ({ release, look: LOOKS[release.version] }))
