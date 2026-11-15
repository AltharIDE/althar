import automations from '../../../../../brand/export/screenshots/framed/automations.jpg'
import browser from '../../../../../brand/export/screenshots/framed/browser.jpg'
import canvas from '../../../../../brand/export/screenshots/framed/canvas.jpg'
import graph from '../../../../../brand/export/screenshots/framed/graph.jpg'
import home from '../../../../../brand/export/screenshots/framed/home.jpg'
import projectHome from '../../../../../brand/export/screenshots/framed/project-home.jpg'
import reviewCode from '../../../../../brand/export/screenshots/framed/review-code.jpg'
import automationsWindow from '../../../../../brand/export/screenshots/automations.png'
import browserWindow from '../../../../../brand/export/screenshots/browser.png'
import canvasWindow from '../../../../../brand/export/screenshots/canvas.png'
import graphWindow from '../../../../../brand/export/screenshots/graph.png'
import homeWindow from '../../../../../brand/export/screenshots/home.png'
import projectHomeWindow from '../../../../../brand/export/screenshots/project-home.png'
import reviewCodeWindow from '../../../../../brand/export/screenshots/review-code.png'

/*
 * The brand pack's framed screenshots (brand/export/screenshots/framed): each
 * a whole window of the app on its demo projects, on the Aurora wallpaper at
 * night, at twice its size; opened whole, the window alone
 * (brand/export/screenshots), to read. A few, each a screen someone would open
 * the app for: a piece of a screen, or one another already holds (the board,
 * the plan), isn't among them. Each with its name and one line, and what it
 * shows for someone who can't see it.
 */

export interface Shot {
  id: string
  src: string
  /** Its size in pixels, so its place is kept before it loads. */
  w: number
  h: number
  /** The window alone, without the wallpaper round it, and its size. */
  window: { src: string; w: number; h: number }
  name: string
  line: string
  alt: string
}

const shot = (id: string, src: string, w: number, h: number, name: string, line: string, alt: string, window: Shot['window']): Shot => ({
  id,
  src,
  w,
  h,
  window,
  name,
  line,
  alt,
})

export const SHOTS = {
  project: shot(
    'project',
    projectHome,
    3808,
    2500,
    'A project',
    'Ask its coordinator. It plans who does the work, and the board fills beside you.',
    'A project in Althar: asked to fix the VAT rate on EU invoices, the coordinator answers with a plan, Opus 5 implementing and Codex reviewing, starting in 23 seconds; beside it, the board, with two tasks up next, three running and one that needs you',
    { src: projectHomeWindow, w: 3360, h: 2020 },
  ),
  graph: shot(
    'graph',
    graph,
    3328,
    1680,
    'A task as a graph',
    'One lab builds it, another reviews it, round until it’s clean.',
    'A task as a graph, a lane for each agent: Opus 5 implements, Codex reviews with two findings, Opus 5 settles them, Codex passes it, and Althar opens draft pull request 1214',
    { src: graphWindow, w: 2880, h: 1200 },
  ),
  review: shot(
    'review',
    reviewCode,
    3328,
    2280,
    'Review, in the code',
    'Each finding under the line it’s about, the worst first.',
    'A review’s findings open over a task: the changed files, each with its findings, and a blocking finding shown under the lines of code it is about',
    { src: reviewCodeWindow, w: 2880, h: 1800 },
  ),
  browser: shot(
    'browser',
    browser,
    3328,
    2280,
    'A browser, built in',
    'The lead tries what it built in the page beside you.',
    'A task’s conversation beside its app in the built-in browser: the lead retried a failed refund, and the page confirms it was refunded',
    { src: browserWindow, w: 2880, h: 1800 },
  ),
  canvas: shot(
    'canvas',
    canvas,
    3328,
    2280,
    'Canvases',
    'Pages and mockups the lead draws, a new version for each comment.',
    'A launch page the lead drew on a canvas, beside the conversation that asked for a bigger, bolder headline',
    { src: canvasWindow, w: 2880, h: 1800 },
  ),
  automations: shot(
    'automations',
    automations,
    3008,
    2200,
    'Automations',
    'Work that starts itself, on a schedule.',
    'A project’s automations: a Sunday end-to-end run, a morning review, a nightly dependency bump, a Friday changelog and a weekly flaky-test sweep, each with how its last runs went',
    { src: automationsWindow, w: 2560, h: 1720 },
  ),
  home: shot(
    'home',
    home,
    3328,
    2280,
    'Home',
    'What needs you, in every project, on one page.',
    'Althar’s home: two things need you, a release to publish and a change ready to accept, beside the list of projects',
    { src: homeWindow, w: 2880, h: 1800 },
  ),
} satisfies Record<string, Shot>

/** Every screen, in the order a task goes, then what's around it: the strip's, the wall's and the tabs'. */
export const ALL: readonly Shot[] = [SHOTS.project, SHOTS.graph, SHOTS.review, SHOTS.browser, SHOTS.canvas, SHOTS.automations, SHOTS.home]

/** The tabs' few: all of them, now that they are few. */
export const FEW: readonly Shot[] = ALL
