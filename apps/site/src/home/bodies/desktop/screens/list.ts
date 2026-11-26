/*
 * The screens in the gallery, in the order a task goes and then what's
 * around it: each by its file in the brand pack (brand/export/screenshots),
 * its name and one line, and what it shows for someone who can't see it.
 * A few, each a screen someone would open the app for: a piece of a screen,
 * or one another already holds (the board, the plan), isn't among them.
 * scripts/screens.ts makes the pictures beside this from the brand pack's.
 * The canvas is the exception: the gallery draws it live (CanvasScreen.tsx),
 * framed the same way, with the sign-in page the carousel builds. On a phone
 * it is a picture of that same card (story/canvas-signin.webp, taken of the
 * live one on a desktop, as it isn't in the brand pack): the live one lays
 * the whole window out at its desktop size, 1664 by 1144, to show it 300px
 * wide, more than a phone's browser has room for.
 */

export interface Screen {
  file: string
  name: string
  line: string
  alt: string
}

export const SCREENS: readonly Screen[] = [
  {
    file: 'project-home',
    name: 'A project',
    line: 'Ask its coordinator. It plans who does the work, and the board fills beside you.',
    alt: 'A project in Althar: asked to fix the VAT rate on EU invoices, the coordinator answers with a plan, Opus 5 implementing and Codex reviewing, starting in 23 seconds; beside it, the board, with two tasks up next, three running and one that needs you',
  },
  {
    file: 'graph',
    name: 'A task as a graph',
    line: 'One lab builds it, another reviews it, round until it’s clean.',
    alt: 'A task as a graph, a lane for each agent: Opus 5 implements, Codex reviews with two findings, Opus 5 settles them, Codex passes it, and Althar opens draft pull request 1214',
  },
  {
    file: 'review-code',
    name: 'Review, in the code',
    line: 'Each finding under the line it’s about, the worst first.',
    alt: 'A review’s findings open over a task: the changed files, each with its findings, and a blocking finding shown under the lines of code it is about',
  },
  {
    file: 'browser',
    name: 'A browser, built in',
    line: 'The lead tries what it built in the page beside you.',
    alt: 'A task’s conversation beside its app in the built-in browser: the lead retried a failed refund, and the page confirms it was refunded',
  },
  {
    file: 'canvas',
    name: 'Canvases',
    line: 'Pages and mockups the lead draws, a new version for each comment.',
    alt: 'Tally’s sign-in page the lead drew on a canvas, split with the brand on its left, beside the conversation that asked for it',
  },
  {
    file: 'automations',
    name: 'Automations',
    line: 'Work that starts itself, on a schedule.',
    alt: 'A project’s automations: a Sunday end-to-end run, a morning review, a nightly dependency bump, a Friday changelog and a weekly flaky-test sweep, each with how its last runs went',
  },
  {
    file: 'home',
    name: 'Home',
    line: 'What needs you, in every project, on one page.',
    alt: 'Althar’s home: two things need you, a release to publish and a change ready to accept, beside the list of projects',
  },
]
