import automations from '../../../../../brand/export/screenshots/framed/automations.jpg'
import board from '../../../../../brand/export/screenshots/framed/board.jpg'
import browser from '../../../../../brand/export/screenshots/framed/browser.jpg'
import canvas from '../../../../../brand/export/screenshots/framed/canvas.jpg'
import dictation from '../../../../../brand/export/screenshots/framed/dictation.jpg'
import firstRun from '../../../../../brand/export/screenshots/framed/first-run.jpg'
import graph from '../../../../../brand/export/screenshots/framed/graph.jpg'
import home from '../../../../../brand/export/screenshots/framed/home.jpg'
import plan from '../../../../../brand/export/screenshots/framed/plan.jpg'
import projectHome from '../../../../../brand/export/screenshots/framed/project-home.jpg'
import rules from '../../../../../brand/export/screenshots/framed/project-rules.jpg'
import review from '../../../../../brand/export/screenshots/framed/review.jpg'
import automationsWindow from '../../../../../brand/export/screenshots/automations.png'
import boardWindow from '../../../../../brand/export/screenshots/board.png'
import browserWindow from '../../../../../brand/export/screenshots/browser.png'
import canvasWindow from '../../../../../brand/export/screenshots/canvas.png'
import dictationWindow from '../../../../../brand/export/screenshots/dictation.png'
import firstRunWindow from '../../../../../brand/export/screenshots/first-run.png'
import graphWindow from '../../../../../brand/export/screenshots/graph.png'
import homeWindow from '../../../../../brand/export/screenshots/home.png'
import planWindow from '../../../../../brand/export/screenshots/plan.png'
import projectHomeWindow from '../../../../../brand/export/screenshots/project-home.png'
import reviewWindow from '../../../../../brand/export/screenshots/review.png'
import rulesWindow from '../../../../../brand/export/screenshots/project-rules.png'

/*
 * The brand pack's framed screenshots (brand/export/screenshots/framed): each
 * a window of the app on its demo projects, on the Aurora wallpaper at night,
 * at twice its size; opened whole, the window alone (brand/export/screenshots),
 * to read. Each with its name and one line, and what it shows for someone who
 * can't see it.
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
    'Ask its coordinator; the tasks it plans fill the board beside you.',
    'A project in Althar: the conversation with its coordinator, which has planned two tasks, beside its board of tasks up next, running and needing you',
    { src: projectHomeWindow, w: 3360, h: 2020 },
  ),
  board: shot(
    'board',
    board,
    3328,
    2340,
    'The board',
    'Every task, across every agent, by where it stands.',
    'The board: tasks up next, running, needing you and settled, each with its agent and its progress',
    { src: boardWindow, w: 2880, h: 1800 },
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
  plan: shot(
    'plan',
    plan,
    1704,
    1180,
    'A plan',
    'One ask, planned: who leads, who reviews, and what it will cost.',
    'The coordinator’s plan for a fix: Opus 5 implements, Codex reviews, then a draft pull request; about 25 minutes and a dollar on your subscriptions',
    { src: planWindow, w: 1480, h: 916 },
  ),
  graph: shot(
    'graph',
    graph,
    2944,
    1264,
    'A task’s steps',
    'One lab builds it, another reviews it, and Althar opens the pull request.',
    'A task’s steps as a graph: Opus 5 implements, Codex reviews with two findings, Opus 5 settles them, Codex passes it, and Althar opens the pull request',
    { src: graphWindow, w: 2720, h: 1000 },
  ),
  browser: shot(
    'browser',
    browser,
    3328,
    2340,
    'A browser, built in',
    'The lead tries what it built in the page beside you.',
    'A task’s conversation beside its app in the built-in browser: the lead retried a failed refund and the page confirms it',
    { src: browserWindow, w: 2880, h: 1800 },
  ),
  canvas: shot(
    'canvas',
    canvas,
    3328,
    2340,
    'Canvases',
    'Pages and mockups the lead draws, a new version for each comment.',
    'A launch page the lead drew on a canvas, beside the conversation that asked for a bigger, bolder headline',
    { src: canvasWindow, w: 2880, h: 1800 },
  ),
  review: shot(
    'review',
    review,
    1704,
    1132,
    'Review',
    'Findings from another lab’s models, each fixed or kept with a reason.',
    'A review’s findings by severity, from Sonnet 5 and Gemini 3 Pro, each fixed by the lead in a later round',
    { src: reviewWindow, w: 1480, h: 868 },
  ),
  automations: shot(
    'automations',
    automations,
    2248,
    1920,
    'Automations',
    'Work that starts itself, on a schedule.',
    'Automations on a schedule: a morning review, a nightly dependency bump, a Friday changelog and a weekly flaky-test sweep',
    { src: automationsWindow, w: 1800, h: 1380 },
  ),
  rules: shot(
    'rules',
    rules,
    3328,
    2340,
    'Rules',
    'What agents may do, in plain words.',
    'A project’s rules: what agents never do, ask first, go ahead with, and what their sandbox reaches',
    { src: rulesWindow, w: 2880, h: 1800 },
  ),
  firstRun: shot(
    'first-run',
    firstRun,
    2528,
    1980,
    'First run',
    'The agents you already use, found and signed in.',
    'Althar’s first run: the agents found on this Mac, each signed in with its plan, and the ones not installed yet',
    { src: firstRunWindow, w: 2080, h: 1440 },
  ),
  dictation: shot(
    'dictation',
    dictation,
    1704,
    494,
    'Dictation',
    'Say it instead of typing it.',
    'The composer, dictating a message to the lead',
    { src: dictationWindow, w: 1480, h: 230 },
  ),
} satisfies Record<string, Shot>

/** The tabs' few: the screens someone opens the app for, the most telling first. */
export const FEW: readonly Shot[] = [
  SHOTS.project,
  SHOTS.board,
  SHOTS.home,
  SHOTS.plan,
  SHOTS.browser,
  SHOTS.canvas,
  SHOTS.review,
  SHOTS.rules,
]

/** Every screen, in the order a task goes: the strip's and the wall's. */
export const ALL: readonly Shot[] = [
  SHOTS.project,
  SHOTS.board,
  SHOTS.plan,
  SHOTS.graph,
  SHOTS.browser,
  SHOTS.canvas,
  SHOTS.review,
  SHOTS.home,
  SHOTS.automations,
  SHOTS.rules,
  SHOTS.firstRun,
  SHOTS.dictation,
]
