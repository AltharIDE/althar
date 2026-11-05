import type { ComponentType, ReactNode } from 'react'

import { AskOnce } from '../home/bodies/desktop/AskOnce'
import { AtWork } from '../home/bodies/desktop/AtWork'
import { Bento } from '../home/bodies/desktop/Bento'
import { Review } from '../home/bodies/desktop/Review'
import { EdgeTour } from '../home/bodies/kit/EdgeTour'

/*
 * PROTOTYPE, deleted once a direction is picked. The developer page's
 * claims, as the takes share them: the same words and the same pictures,
 * so the takes differ only in how the page flows. Each picture is the one
 * the page has now, unchanged.
 */

export interface Chapter {
  id: string
  /** Its short name, for a chapter mark. */
  name: string
  title: ReactNode
  lead: ReactNode
  Picture: ComponentType
  /** What the picture is drawn for: a dark ground, paper, or both. */
  ground: 'dark' | 'paper' | 'both'
}

const Edge = () => <EdgeTour tone="ink" />

export const CHAPTERS: readonly Chapter[] = [
  {
    id: 'independent',
    name: 'Independent',
    title: (
      <>
        Usage gets cut.
        <br />
        Models get pulled.
        <br />
        <b>Althar stays.</b>
      </>
    ),
    lead: 'Open source, local-first, your data on your computer, any agent you have. None of the industry’s bullshit touches it.',
    Picture: AtWork,
    ground: 'dark',
  },
  {
    id: 'coordinator',
    name: 'The coordinator',
    title: (
      <>
        Every project <b>has a manager.</b>
      </>
    ),
    lead: 'It’s called the coordinator. It knows your whole project, and puts a team of agents on every ask.',
    Picture: AskOnce,
    ground: 'paper',
  },
  {
    id: 'review',
    name: 'Review',
    title: (
      <>
        No more <b>meat proxying.</b>
      </>
    ),
    lead: 'Every change is reviewed by a model from another lab, and fixed until it’s clean.',
    Picture: Review,
    ground: 'dark',
  },
  {
    id: 'flow',
    name: 'Flow',
    title: (
      <>
        Fall in love <b>with building again.</b>
      </>
    ),
    lead: 'Tired of juggling terminals, re-explaining your project and babysitting agents? So were we.',
    Picture: Bento,
    ground: 'both',
  },
  {
    id: 'edge',
    name: 'In reach',
    title: (
      <>
        Wherever you are, <b>still in reach.</b>
      </>
    ),
    lead: 'Althar sits round your Mac’s notch, in whatever you’re doing: point at it to answer a permission or open a pull request, and carry on.',
    Picture: Edge,
    ground: 'dark',
  },
]

export const END = {
  line: 'The craft of a paid app.',
  bold: 'The freedom of open source.',
} as const
