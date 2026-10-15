/*
 * What the site says, once: the claims, the links and the state of the
 * project. Drawn from the README, the brief and the glossary: the words on
 * screen are the glossary's (lead, call, notes), never worker or session.
 */

import type { Os } from '../shared/OsMark'

/** The site's public origin. A build can serve it from another with SITE_URL (scripts/prerender.ts). */
export const SITE = 'https://althar.ai'

const ORG = 'https://github.com/AltharIDE'
const REPO = `${ORG}/althar`

export const LINKS = {
  org: ORG,
  repo: REPO,
  thesis: `${REPO}/blob/main/THESIS.md`,
  architecture: `${REPO}/tree/main/docs/architecture`,
  issues: `${REPO}/issues`,
  components: `${REPO}/tree/main/packages/ui`,
  releases: `${REPO}/releases`,
  /** The latest published release's page, with its files: where a download goes when there is no installer to give. */
  latest: `${REPO}/releases/latest`,
  acp: 'https://agentclientprotocol.com',
} as const

/** GitHub's API for the latest published release: its files are what the download links give (src/lib/download.ts). Unauthenticated, 60 calls an hour per address. */
export const LATEST_RELEASE = 'https://api.github.com/repos/AltharIDE/althar/releases/latest'

/** A system the site names, what it needs, and the files a release has for it; null files where there is no build yet. */
export interface Platform {
  os: Os
  name: string
  needs: string
  files: string | null
}

/**
 * What a release can be downloaded for, and what each system needs: the
 * files .github/workflows/release.yml publishes (a dmg for Apple silicon;
 * an AppImage, deb and rpm for x64 Linux), and macOS 13, the oldest Electron
 * 44, which the app runs on, supports. Windows has no build yet: it is named
 * as coming, never as there to download. Change this when a release changes.
 */
export const PLATFORMS: readonly Platform[] = [
  { os: 'mac', name: 'macOS', needs: '13 Ventura or later, on Apple silicon', files: '.dmg' },
  { os: 'linux', name: 'Linux', needs: 'x64', files: 'AppImage, .deb or .rpm' },
  { os: 'windows', name: 'Windows', needs: 'Coming', files: null },
]

/** The same, in a line. */
export const RUNS_ON = 'For macOS 13 or later on Apple silicon, and Linux on x64. Windows is coming.'

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
  licence: 'Open source, under the Apache License 2.0.',
} as const

/** Ways in, for someone who wants to help. */
export const JOIN: readonly { k: string; t: string; href: string }[] = [
  { k: 'Argue with the thesis', t: 'Read it, then tell us where it’s wrong.', href: LINKS.thesis },
  { k: 'Tell us how you work', t: 'What breaks when you switch agents today? Open an issue.', href: LINKS.issues },
  { k: 'Read the architecture', t: 'Eight documents, from the project model to persistence and the cloud.', href: LINKS.architecture },
  { k: 'Browse the components', t: 'The interface, piece by piece, with every state as a story.', href: LINKS.components },
]
