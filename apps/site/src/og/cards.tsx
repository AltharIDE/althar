import type { ReactNode } from 'react'

/*
 * What each page's link preview says: a headline, set light with what
 * matters heavy, and a line under it. Pages without a card of their own
 * (pages.ts) use the home page's. After changing these, draw the cards
 * again: `bun run og`.
 */

export type OgPage = 'home' | 'shifts' | 'thesis' | 'about'

export interface OgCard {
  title: ReactNode
  lead: string
}

/** Kept on one line: a compound never breaks at its hyphen. */
const Whole = ({ children }: { children: ReactNode }) => <span style={{ whiteSpace: 'nowrap' }}>{children}</span>

export const CARDS: Record<OgPage, OgCard> = {
  home: {
    title: (
      <>
        The <Whole>next-generation</Whole>
        <br />
        <b>
          <Whole>open-source</Whole> agentic IDE
        </b>
      </>
    ),
    lead: 'A project orchestration environment for software engineering with AI agents. Bring your own subscription.',
  },
  shifts: {
    title: (
      <>
        The ground
        <br />
        <b>keeps moving.</b>
      </>
    ),
    lead: 'New models, new limits, new owners, new terms: what changed for people who code with agents, each one dated and sourced.',
  },
  thesis: {
    title: (
      <>
        The Fourth Age of
        <br />
        <b>Software Engineering</b>
      </>
    ),
    lead: 'A working thesis on how software engineering changes once coding agents are abundant.',
  },
  about: {
    title: (
      <>
        We make software
        <br />
        <b>for people.</b>
      </>
    ),
    lead: 'Why we built Althar, and what we hold to while we build it: for people, beautiful, slotted into your tools, calm.',
  },
}

export const OG_PAGES = Object.keys(CARDS) as OgPage[]
