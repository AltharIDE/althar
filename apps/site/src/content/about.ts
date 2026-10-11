/*
 * The about page's words: why Althar was built, the four things we hold to
 * while we build it, and who we are.
 */

export enum PrincipleId {
  People = 'people',
  Beautiful = 'beautiful',
  SlotsIn = 'slots-in',
  Calm = 'calm',
}

export interface Principle {
  id: PrincipleId
  /** The word, set large. */
  word: string
  /** The line under it, heavier. */
  after: string
  body: string
}

export const ABOUT_HEAD = {
  kicker: 'About',
  /** The headline: a light line over a heavy one. */
  title: ['We make software', 'for people.'],
  lead: 'Althar is the app we wanted to sit with all day while a dozen agents work: calm, beautiful, and on top of the tools you already use.',
} as const

/** Why we built it: what it was like before, the turn (a light half and a heavy half), and what we did. */
export const WHY = {
  before: [
    'Our screens looked like everyone’s: Claude Code in one terminal, Codex in another, OpenCode in a third.',
    'Each on its own plan, stopping at its own limit, asking its own questions in its own window. We had become the thing passing messages between them.',
  ],
  turn: ['The work had moved up a level.', 'The tools hadn’t.'],
  so: 'So we built the one we wanted.',
} as const

export const PRINCIPLES: readonly Principle[] = [
  {
    id: PrincipleId.People,
    word: 'For people.',
    after: 'Not for terminals.',
    body: 'An agent can live in a terminal. The person running a dozen of them shouldn’t have to. Althar is a real desktop app, with windows, type and colour you can read at a glance, made for the one steering rather than the process running.',
  },
  {
    id: PrincipleId.Beautiful,
    word: 'Beautiful.',
    after: 'Down to the last detail.',
    body: 'We spend real time on how Althar feels: how a plan assembles, how a finished task settles, the last word on every screen. And it steers you toward good work: a plan before the code, a reviewer from another lab, a change you read before it lands.',
  },
  {
    id: PrincipleId.SlotsIn,
    word: 'Slots in.',
    after: 'And no more than it needs to be.',
    body: 'Althar sits on top of what you already use. Your repositories stay in plain git, your editor and terminal stay yours, issues come in from your tracker, and the agents run on the plans you already pay for. It does the coordinating and leaves the rest alone.',
  },
  {
    id: PrincipleId.Calm,
    word: 'Calm.',
    after: 'Your attention is the scarce part.',
    body: 'Agentic engineering pulls at you from a dozen places at once. Althar keeps the running to itself and comes to you only when something needs a person: once, in one place.',
  },
]

export interface Person {
  name: string
  /** How they sign their name. */
  signs: string
  does: string
}

export const TEAM_LEAD = 'A small team, building in the open.'

export const TEAM: readonly Person[] = [
  { name: 'Balázs Otakomaiya', signs: 'Balázs', does: 'Vision, design, product and code' },
  { name: 'Benjamin Olah-Grosz', signs: 'Benji', does: 'Operations and marketing' },
]
