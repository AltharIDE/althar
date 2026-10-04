/*
 * What the site says, once: the claims, the links and the state of the
 * project. Drawn from the README, the brief and the glossary: the words on
 * screen are the glossary's (lead, call, notes), never worker or session.
 */

const REPO = 'https://github.com/thetastemakers/althar'

export const LINKS = {
  repo: REPO,
  thesis: `${REPO}/blob/main/THESIS.md`,
  architecture: `${REPO}/tree/main/docs/architecture`,
  issues: `${REPO}/issues`,
  components: `${REPO}/tree/main/packages/ui`,
  releases: `${REPO}/releases`,
} as const

/** How to install it. Not published yet: the release, the cask and the clone URL are placeholders until it ships. */
export const INSTALL = {
  brew: 'brew install --cask althar',
  clone: 'git clone github.com/thetastemakers/althar',
  platforms: 'macOS first. Linux and Windows after.',
} as const

export const LINE = {
  come: 'Agents come and go.',
  stay: 'The project stays.',
} as const

/** One sentence on what it is, for under a headline. */
export const WHAT =
  'Althar is an open-source desktop app for running a software project with AI coding agents. The project keeps its rules, notes, decisions and history. The agents you already use do the work, on your own plans.'

/** The agents it is built to run. Adapters are planned, not shipped: say so wherever these are listed. */
export const AGENTS = ['Claude Code', 'Codex', 'Gemini CLI', 'Cursor', 'GitHub Copilot', 'Ollama', 'OpenRouter'] as const

export enum Stage {
  Done = 'done',
  Now = 'now',
  Next = 'next',
  Later = 'later',
}

export const STAGE_WORD: Record<Stage, string> = {
  [Stage.Done]: 'Done',
  [Stage.Now]: 'Now',
  [Stage.Next]: 'Next',
  [Stage.Later]: 'Later',
}

export interface Milestone {
  id: string
  stage: Stage
  what: string
  detail: string
}

/** Where it stands. Honest: there is no runnable Althar yet. */
export const STATUS: readonly Milestone[] = [
  {
    id: 'thesis',
    stage: Stage.Done,
    what: 'The thesis and research note',
    detail: 'The argument, the questions it raises, and the prior art.',
  },
  { id: 'arch', stage: Stage.Done, what: 'The architecture', detail: 'A local-first desktop app, with seams for a later cloud.' },
  {
    id: 'ui',
    stage: Stage.Done,
    what: 'The interface primitives',
    detail: 'Board, conversation, calls and steps, in @althar/ui with a Storybook.',
  },
  {
    id: 'proto',
    stage: Stage.Now,
    what: 'The first runnable prototype',
    detail: 'A desktop app anyone can install and point at a real project.',
  },
  {
    id: 'memory',
    stage: Stage.Next,
    what: 'Notes with status and source',
    detail: 'And adapters for the major agent tools, with review and repair across labs.',
  },
  { id: 'cloud', stage: Stage.Later, what: 'Teams', detail: 'Shared notes, hosted agents, and approvals from your phone.' },
]

export const EARLY = {
  title: 'Very early. Come and shape it.',
  body: 'There is no runnable Althar yet. The repository holds the thesis, the architecture, the interface primitives and the brief. The model, and the words for it, will change as we prototype, which makes now the time to have a say.',
  licence: 'Meant to be open source. The licence is still to be chosen.',
} as const

/** Ways in, for someone who wants to help. */
export const JOIN: readonly { k: string; t: string; href: string }[] = [
  { k: 'Argue with the thesis', t: 'Read it, then tell us where it’s wrong.', href: LINKS.thesis },
  { k: 'Tell us how you work', t: 'What breaks when you switch agents today? Open an issue.', href: LINKS.issues },
  { k: 'Read the architecture', t: 'Eight documents, from the project model to persistence and the cloud.', href: LINKS.architecture },
  { k: 'Browse the components', t: 'The interface, piece by piece, with every state as a story.', href: LINKS.components },
]
