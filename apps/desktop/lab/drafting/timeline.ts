import { useEffect, useState } from 'react'

import type { ModelInfo } from '@althar/ui'

import { CODEX, OPUS } from '../../../../packages/ui/src/fixtures/models'

/*
 * What the coordinator writes as it drafts a task, and when each part of it is
 * known, at the pace a real draft goes (about 28 s, from draft_task's first
 * token to the plan proposed). In the product, each moment is a part of
 * draft_task's or propose_plan's input arriving as the coordinator streams it.
 */

export interface Spec {
  readonly slug: string
  readonly preset: string
  readonly title: string
  readonly brief: string
  /** How big the coordinator sized it, in a few words: what the lead was picked for. */
  readonly size: string
  readonly lead: ModelInfo
  readonly leadEffort: string
  readonly review: ModelInfo | null
  /** Ends with its branch: no ending to pick. */
  readonly onBranch: boolean
  readonly estimate: string
}

export const VAT: Spec = {
  slug: '812',
  preset: 'Change',
  title: 'Fix the VAT rate on EU invoice PDFs',
  brief:
    'EU invoices show the wrong VAT rate since Monday. Find what changed in the rate lookup, fix it, and cover each EU country with a test. Done: every EU invoice PDF shows its country’s rate.',
  size: 'A small fix with tests',
  lead: OPUS,
  leadEffort: 'High',
  review: CODEX,
  onBranch: false,
  estimate: 'About 25 min · about $1 on your subscriptions',
}

/** The person's own message, which planned three tasks: drafted one after the other. */
export const THREE: ReadonlyArray<Spec> = [
  {
    slug: '813',
    preset: 'Prototype',
    title: 'Prototype: a task card that appears as it’s drafted',
    brief: 'Show the card as soon as drafting starts and fill it in as it goes. A few directions, quiet to playful.',
    size: 'A few directions to compare',
    lead: OPUS,
    leadEffort: 'Extra high',
    review: null,
    onBranch: true,
    estimate: 'About 40 min',
  },
  {
    slug: '814',
    preset: 'Small change',
    title: 'Keep the coordinator’s task briefs short',
    brief: 'Briefs say what the person wants and what done looks like. Leads do their own research.',
    size: 'A few lines of instructions',
    lead: OPUS,
    leadEffort: 'Medium',
    review: null,
    onBranch: false,
    estimate: 'About 5 min',
  },
  {
    slug: '815',
    preset: 'Change',
    title: 'No raw MCP tool names anywhere in the UI',
    brief: 'Every tool call reads in plain words. Done: no mcp__ name shows on any screen.',
    size: 'Many small changes across the app',
    lead: OPUS,
    leadEffort: 'High',
    review: CODEX,
    onBranch: false,
    estimate: 'About 50 min · about $3 on your subscriptions',
  },
]

/** When each part is known, in ms from the draft's start. */
export const AT = {
  title: 1500,
  titleDone: 3500,
  brief: 4000,
  briefDone: 13000,
  slug: 13500,
  preset: 15000,
  size: 17000,
  lead: 19000,
  review: 22000,
  end: 24500,
  estimate: 26000,
  ready: 27500,
} as const

/** What drafting is doing, as the card says it. */
export type Phase = 'starting' | 'writing' | 'sizing' | 'lead' | 'review' | 'end' | 'ready'

export const phaseWords: Readonly<Record<Phase, string>> = {
  starting: 'Drafting',
  writing: 'Writing the brief',
  sizing: 'Sizing it',
  lead: 'Choosing a lead',
  review: 'Choosing a review',
  end: 'Almost ready',
  ready: '',
}

/** A draft as far as it has come. */
export interface Draft {
  readonly spec: Spec
  readonly ms: number
  readonly started: boolean
  readonly title: string
  readonly titleDone: boolean
  readonly brief: string
  readonly briefDone: boolean
  readonly slug: boolean
  readonly preset: boolean
  readonly size: boolean
  readonly lead: boolean
  readonly review: boolean
  readonly end: boolean
  readonly estimate: boolean
  readonly ready: boolean
  readonly phase: Phase
}

/** The first share of the words, by how far a stream from `from` to `to` has come. */
const words = (text: string, ms: number, from: number, to: number): string => {
  if (ms < from) return ''
  if (ms >= to) return text
  const all = text.split(' ')
  return all.slice(0, Math.max(1, Math.round((all.length * (ms - from)) / (to - from)))).join(' ')
}

export const draftAt = (spec: Spec, ms: number): Draft => {
  const at = (key: keyof typeof AT) => ms >= AT[key]
  // Without a review to choose, its moment goes to the ending.
  const review = spec.review !== null && at('review')
  const phase: Phase = at('ready')
    ? 'ready'
    : at('end')
      ? 'end'
      : at('lead') && spec.review !== null
        ? 'review'
        : at('lead')
          ? 'end'
          : at('size')
            ? 'lead'
            : at('briefDone')
              ? 'sizing'
              : at('title')
                ? 'writing'
                : 'starting'
  return {
    spec,
    ms,
    started: ms >= 0,
    title: words(spec.title, ms, AT.title, AT.titleDone),
    titleDone: at('titleDone'),
    brief: words(spec.brief, ms, AT.brief, AT.briefDone),
    briefDone: at('briefDone'),
    slug: at('slug'),
    preset: at('preset'),
    size: at('size'),
    lead: at('lead'),
    review,
    end: at('end'),
    estimate: at('estimate'),
    ready: at('ready'),
    phase,
  }
}

/** Ms since `run` began, times `speed`, ticking every 50 ms until `until`. */
export function useElapsed(run: number, speed: number, until: number): number {
  const [state, setState] = useState({ run, ms: 0 })
  useEffect(() => {
    let last = performance.now()
    let total = 0
    const id = window.setInterval(() => {
      const now = performance.now()
      total += (now - last) * speed
      last = now
      setState({ run, ms: total })
      if (total > until) window.clearInterval(id)
    }, 50)
    return () => window.clearInterval(id)
  }, [run, speed, until])
  return state.run === run ? state.ms : 0
}
