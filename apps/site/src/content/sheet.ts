import { Stage, STATUS } from './facts'

/*
 * What the drawing set's pieces carry beyond the shared facts: the date it
 * was issued, the roadmap as a revision block, and the word itself.
 */

export const DATE = '2026-09-28'

export interface Revision {
  rev: string
  date: string
  what: string
  stage: Stage
}

/** The roadmap as a revision block: what's issued has a date, what isn't has a dash. */
export const REVISIONS: readonly Revision[] = [
  { rev: 'A', date: '2026-09-18', what: 'The thesis', stage: Stage.Done },
  { rev: 'B', date: '2026-09-22', what: 'The brief and the research note', stage: Stage.Done },
  { rev: 'C', date: '2026-09-27', what: 'The architecture, and the interface primitives in @althar/ui', stage: Stage.Done },
  ...STATUS.filter((m) => m.stage !== Stage.Done).map((m, i) => ({
    rev: String.fromCharCode(68 + i),
    date: '—',
    what: `${m.what}. ${m.detail}`,
    stage: m.stage,
  })),
]

export const DEFINITION = {
  word: 'althar',
  // Said like "altar".
  say: '/ˈɔːltə/',
  kind: 'noun',
  sense: 'An open-source desktop app for running a software project with AI coding agents.',
} as const
