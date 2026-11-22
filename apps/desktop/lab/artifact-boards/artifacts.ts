import type { CanvasKind } from '@althar/ui'

import { DEVICES } from '../../src/main/browser/devices'

/*
 * kiln's artifacts, as the lab has them: what its agents drew to keep. A
 * design is a canvas of boards, each a screen of Kiln running (kiln.html,
 * at the address it names) at a device's size, on pages of their own. The
 * rest are what agents also draw (a diagram, a brief, a chart): one board
 * each, drawn by Althar as it draws them today.
 */

/** The sizes a board is laid out at: the page beside a conversation's own (src/main/browser/devices.ts). */
export type Size = keyof typeof DEVICES
export const SIZES: ReadonlyArray<Size> = ['phone', 'tablet', 'laptop', 'desktop']
export const SIZE_WORDS: Readonly<Record<Size, string>> = { phone: 'Phone', tablet: 'Tablet', laptop: 'Laptop', desktop: 'Desktop' }

/** What an artifact is, as a person would say it; and how Althar draws it today (the table's Kind). */
export type ArtifactKind = 'design' | 'diagram' | 'document' | 'chart'
export const KIND_WORDS: Readonly<Record<ArtifactKind, string>> = {
  design: 'Design',
  diagram: 'Diagram',
  document: 'Document',
  chart: 'Chart',
}
export const CANVAS_KIND: Readonly<Record<ArtifactKind, CanvasKind>> = {
  design: 'html',
  diagram: 'mermaid',
  document: 'markdown',
  chart: 'svg',
}

export interface BoardDef {
  readonly id: string
  readonly name: string
  /** A screen of Kiln, as kiln.html's address says it: s=gift&dir=a&v=3. */
  readonly shows?: string
  /** What Althar draws in place of a screen, for what isn't a design. */
  readonly draw?: 'flow' | 'brief' | 'chart'
  readonly size?: Size
  /** What it tried, in a line, for a take the lead drew beside another. */
  readonly tried?: string
  /** The board a take was drawn from: keeping it changes that one. */
  readonly from?: string
  /** A take, or a board new since the person last looked: marked so until it is kept or looked at. */
  readonly fresh?: boolean
  /** How a part looks on it, where it differs from the screen's own (Kiln's `look`). */
  readonly look?: Readonly<Record<string, string>>
}

export interface PageDef {
  readonly id: string
  readonly name: string
  readonly boards: ReadonlyArray<BoardDef>
}

/** A repository an artifact can be kept in: the project's own, or one the team keeps for designs. */
export interface Repo {
  readonly name: string
  readonly what: string
  /** Its default branch. */
  readonly main: string
  /** Where an artifact goes in it unless the person says otherwise. */
  readonly folder: string
}
export const REPOS: ReadonlyArray<Repo> = [
  { name: 'kiln', what: 'The project’s code', main: 'main', folder: 'design/' },
  { name: 'kiln-design', what: 'The team’s designs', main: 'main', folder: '' },
]

/**
 * Where an artifact is kept in git: a folder in a repository, and how its
 * versions go in. An artifact nobody saved has none: it lives in Althar only.
 */
export interface Kept {
  readonly repo: string
  /** Its folder, or for what is one file (a document, a diagram, a chart), that file. */
  readonly path: string
  /** With its task's change (on the task's branch, in its pull request), a pull request of its own, or straight to the default branch. */
  readonly how: 'task' | 'pr' | 'main'
  /** Each new version committed as it is made; else only when someone saves. */
  readonly follow: boolean
  /** The version in git now. */
  readonly version: number
}

export interface Artifact {
  readonly id: string
  readonly name: string
  readonly title: string
  readonly kind: ArtifactKind
  /** The task whose lead drew it; null for the coordinator. */
  readonly task: string | null
  readonly by: string
  /** Minutes since its latest version. */
  readonly ago: number
  readonly version: number
  readonly comments: number
  readonly pages: ReadonlyArray<PageDef>
  /** In git already, as the lab starts. */
  readonly kept?: Kept
  /** Found in a repository, where a person committed it: no task drew it. */
  readonly found?: boolean
  /** Who sees it beyond the chat it was drawn in, as the lab starts; a draft if not said. */
  readonly reach?: Reach
}

/**
 * Who sees an artifact: a draft is only for the chat it's drawn in (you and
 * its lead); shared, the people on the project, in their Althar; published,
 * anyone with its link, as a page on the web.
 */
export type Reach = 'draft' | 'shared' | 'published'
export const REACH: Readonly<Record<Reach, { readonly label: string; readonly line: string }>> = {
  draft: { label: 'Draft', line: 'Only you and its lead' },
  shared: { label: 'Shared', line: 'People on kiln, in their Althar' },
  published: { label: 'Published', line: 'Anyone with the link, on the web' },
}

export const GIFT = 'cv_gift'

export const ARTIFACTS: ReadonlyArray<Artifact> = [
  {
    id: GIFT,
    name: 'gift-a-class',
    title: 'Gift a class',
    kind: 'design',
    task: 'Gift a class',
    by: 'Lead of Gift a class',
    ago: 4,
    version: 4,
    comments: 1,
    pages: [
      {
        id: 'directions',
        name: 'Directions',
        boards: [
          { id: 'a', name: 'A present first', shows: 's=gift&dir=a&v=3', size: 'laptop' },
          { id: 'ab', name: 'The card leads', shows: 's=gift&dir=ab', size: 'laptop' },
          { id: 'b', name: 'Pick the class', shows: 's=gift&dir=b', size: 'laptop' },
          { id: 'c', name: 'A letter', shows: 's=gift&dir=c', size: 'laptop' },
        ],
      },
      {
        id: 'sizes',
        name: 'A present first, every size',
        boards: [
          { id: 'a-phone', name: 'Phone', shows: 's=gift&dir=a&v=3', size: 'phone' },
          { id: 'a-tablet', name: 'Tablet', shows: 's=gift&dir=a&v=3', size: 'tablet' },
          { id: 'a-laptop', name: 'Laptop', shows: 's=gift&dir=a&v=3', size: 'laptop' },
          { id: 'a-desktop', name: 'Desktop', shows: 's=gift&dir=a&v=3', size: 'desktop' },
        ],
      },
      {
        id: 'history',
        name: 'How it got here',
        boards: [
          { id: 'v1', name: 'v1 · A gift card form', shows: 's=gift&dir=a&v=1', size: 'laptop' },
          { id: 'v2', name: 'v2 · The card first', shows: 's=gift&dir=a&v=2', size: 'laptop' },
          { id: 'v3', name: 'v3 · Named amounts', shows: 's=gift&dir=a&v=3', size: 'laptop' },
        ],
      },
    ],
  },
  {
    id: 'cv_classes',
    name: 'bigger-photos',
    title: 'Bigger photos on Classes',
    kind: 'design',
    task: 'Bigger photos on Classes',
    by: 'Lead of Bigger photos on Classes',
    ago: 9,
    version: 2,
    comments: 0,
    pages: [
      {
        id: 'classes',
        name: 'Classes',
        boards: [
          { id: 'classes', name: 'Classes', shows: 's=classes', size: 'laptop' },
          { id: 'classes-phone', name: 'Classes on a phone', shows: 's=classes', size: 'phone' },
          { id: 'class', name: 'A class', shows: 's=class', size: 'laptop' },
        ],
      },
    ],
  },
  {
    id: 'cv_brief',
    name: 'gift-brief',
    title: 'Gift a class: the brief',
    kind: 'document',
    task: 'Gift a class',
    by: 'Lead of Gift a class',
    ago: 31,
    version: 2,
    comments: 0,
    pages: [{ id: 'brief', name: 'Brief', boards: [{ id: 'brief', name: 'The brief', draw: 'brief' }] }],
  },
  {
    id: 'cv_checkout',
    name: 'calmer-checkout',
    title: 'A calmer checkout',
    kind: 'design',
    task: 'A calmer checkout',
    by: 'Lead of A calmer checkout',
    ago: 52,
    version: 3,
    comments: 1,
    kept: { repo: 'kiln', path: 'design/calmer-checkout/', how: 'task', follow: true, version: 3 },
    reach: 'shared',
    pages: [
      {
        id: 'checkout',
        name: 'Checkout',
        boards: [
          { id: 'card', name: 'Card only', shows: 's=checkout', size: 'laptop' },
          { id: 'door', name: 'Card or at the door', shows: 's=checkout&door=1', size: 'laptop' },
          { id: 'door-phone', name: 'At the door, on a phone', shows: 's=checkout&door=1', size: 'phone' },
        ],
      },
    ],
  },
  {
    id: 'cv_flow',
    name: 'booking-flow',
    title: 'How a booking flows',
    kind: 'diagram',
    task: 'A calmer checkout',
    by: 'Lead of A calmer checkout',
    ago: 58,
    version: 1,
    comments: 0,
    kept: { repo: 'kiln', path: 'docs/flows/booking.mmd', how: 'task', follow: true, version: 1 },
    reach: 'published',
    pages: [{ id: 'flow', name: 'Flow', boards: [{ id: 'flow', name: 'How a booking flows', draw: 'flow' }] }],
  },
  {
    id: 'cv_bookings',
    name: 'your-bookings',
    title: 'Your bookings, every state',
    kind: 'design',
    task: null,
    by: 'Coordinator',
    ago: 60 * 26,
    version: 2,
    comments: 0,
    pages: [
      {
        id: 'states',
        name: 'States',
        boards: [
          { id: 'empty', name: 'Nothing booked', shows: 's=bookings&state=empty', size: 'laptop' },
          { id: 'booked', name: 'Two booked', shows: 's=bookings&state=booked', size: 'laptop' },
          { id: 'full', name: 'A full week', shows: 's=bookings&state=full', size: 'laptop' },
          { id: 'empty-phone', name: 'Nothing booked, on a phone', shows: 's=bookings&state=empty', size: 'phone' },
        ],
      },
    ],
  },
  {
    id: 'cv_week',
    name: 'bookings-by-week',
    title: 'Bookings by week',
    kind: 'chart',
    task: null,
    by: 'Coordinator',
    ago: 60 * 50,
    version: 1,
    comments: 0,
    pages: [{ id: 'chart', name: 'Chart', boards: [{ id: 'chart', name: 'Bookings by week', draw: 'chart' }] }],
  },
  // No task drew it: Ana committed it to the designs repository, and Althar found it there.
  {
    id: 'cv_class',
    name: 'class-page',
    title: 'A class, by hand',
    kind: 'design',
    task: null,
    by: 'Ana',
    ago: 60 * 5,
    version: 1,
    comments: 0,
    found: true,
    reach: 'shared',
    kept: { repo: 'kiln-design', path: 'class-page/', how: 'main', follow: true, version: 1 },
    pages: [
      {
        id: 'class',
        name: 'A class',
        boards: [
          { id: 'class', name: 'A class', shows: 's=class', size: 'laptop' },
          { id: 'class-phone', name: 'A class, on a phone', shows: 's=class', size: 'phone' },
        ],
      },
    ],
  },
]

export const artifactOf = (id: string): Artifact => ARTIFACTS.find((one) => one.id === id) ?? (ARTIFACTS[0] as Artifact)

/** In a few words, how long ago: “4m ago”, “2h ago”, “yesterday”. */
export const agoWords = (minutes: number) =>
  minutes < 1
    ? 'just now'
    : minutes < 60
      ? `${minutes}m ago`
      : minutes < 60 * 24
        ? `${Math.round(minutes / 60)}h ago`
        : minutes < 60 * 48
          ? 'yesterday'
          : `${Math.round(minutes / 60 / 24)} days ago`

/** How many boards an artifact has, on every page. */
export const boardCount = (artifact: Artifact) => artifact.pages.reduce((sum, page) => sum + page.boards.length, 0)

/** The words drawn on what isn't a design. */
export const BRIEF = `# Gift a class

Giving a class should feel like a present, not a checkout.

## What it has to do

- **The card comes first.** What Jo gets is what Sam is choosing; the form is beside it, filling it in as Sam types.
- **Amounts are named after what they buy.** An evening on the wheel, not £35.
- **Jo picks the day.** Any day in the next year; Sam picks when the card arrives.

## Open

- Whether the note is in Sam's own hand, or Kiln's type.
- Phones: the card above the form, or a step of its own.
`

export const FLOW = `flowchart LR
  A[Classes] --> B[A class]
  B --> C{Signed in?}
  C -- yes --> D[Book your place]
  C -- no --> E[Email only] --> D
  D --> F{How you pay}
  F -- card --> G[Paid]
  F -- at the door --> H[Held for you]
  G --> I[Your bookings]
  H --> I`
