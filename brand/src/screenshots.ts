/*
 * The app's screens as pictures, taken from the UI package's Storybook, where
 * every screen is drawn on the demo cast (Meridian, Halyard, Tessera): the
 * same data every time, so a new run changes only what the interface changed.
 * `bun run export:screenshots` takes them; they are not drawn from code, so
 * they are not part of `bun run export`.
 */

export interface Screenshot {
  file: string
  /** The story's id in Storybook. */
  story: string
  width: number
  height: number
  /** What it shows, for the README table. */
  shows: string
  /** Cut to what the story paints, with a margin of the ground round it, rather than the whole viewport: for a piece of a screen. */
  crop?: boolean
  /** In the framed copy, a window bar above it, for a screen that doesn't draw the window's own. */
  bar?: boolean
  /** Taken in the dark appearance, the way the toolbar's Dark shows a story. */
  dark?: boolean
}

/** The wallpaper the framed copies stand on: Aurora at night, its light rising behind each window. */
export const FRAME_WALLPAPER = 'wallpaper/aurora-dark-display.jpg'

export const SCREENSHOTS: readonly Screenshot[] = [
  {
    file: 'project-home',
    story: 'screens-projecthome--busy',
    /* Wider than the others, so the conversation and the board each have room. */
    width: 1680,
    height: 1010,
    shows: "A project's home: the coordinator's conversation, with its plan, beside the board",
  },
  {
    file: 'home',
    story: 'screens-home--busy',
    width: 1440,
    height: 900,
    shows: 'The home: what needs you, what is running, and what happened since you looked',
  },
  {
    file: 'board',
    bar: true,
    story: 'board-board--default',
    width: 1440,
    height: 900,
    shows: "A project's board: up next, running, needs you, settled",
  },
  {
    file: 'project-rules',
    bar: true,
    story: 'screens-projectrules--at-rest',
    width: 1440,
    height: 900,
    shows: 'Project rules: when agents need a yes',
  },
  {
    file: 'first-run',
    bar: true,
    story: 'screens-welcome--signed-in',
    /* A smaller window, so the card holds its agents without room to spare. */
    width: 1040,
    height: 720,
    shows: 'First run: the agents you already pay for, each signed in on its own plan',
  },
  {
    file: 'plan',
    story: 'coordinator-tasklaunch--in-the-conversation',
    width: 960,
    height: 900,
    shows: "What you asked, the coordinator's answer, and its plan: who does each step, starting on its own unless you change it",
    crop: true,
  },
  {
    file: 'graph',
    story: 'thread-stepgraph--round-until-clean',
    width: 1360,
    height: 900,
    shows: 'A task as a graph: a lane for each agent, and a card for each step, round until the review passes',
    crop: true,
  },
  {
    file: 'dictation',
    story: 'composer-composer--dictating-word-by-word',
    /* Narrow, as a composer beside a conversation, so its words read in a table cell; any narrower and the wallpaper's mark shows above it. */
    width: 760,
    height: 400,
    shows: 'Dictating to a lead: your voice as bars, and the words arriving in the field as you say them',
    crop: true,
  },
  {
    file: 'review',
    story: 'thread-review--settled-open',
    width: 960,
    height: 900,
    shows: 'A review settled: what the reviewers found, and what the lead fixed or set aside',
    crop: true,
  },
  {
    file: 'project-home-dark',
    story: 'screens-projecthome--busy',
    width: 1680,
    height: 1010,
    dark: true,
    shows: "A project's home in the dark appearance: the coordinator's conversation beside the board",
  },
  {
    file: 'at-rest',
    story: 'screens-home--at-rest-all-quiet',
    width: 1440,
    height: 900,
    shows: 'The home with nothing waiting: "Nothing needs you", the mark rising out of the launch\'s light, and the projects beside it',
  },
  {
    file: 'evidence',
    story: 'thread-finished--shown',
    width: 960,
    height: 800,
    shows: 'What a finished task hands back: what it built, before and after, the test run, and what it could not check',
    crop: true,
  },
  {
    file: 'accept',
    story: 'outputs-changeset--ready',
    width: 760,
    height: 800,
    shows: 'A change ready to accept: its checks passed, who reviewed it, the files it touched, and one button',
    crop: true,
  },
  {
    file: 'coordinator',
    story: 'coordinator-taskcard--keeping-track',
    width: 960,
    height: 900,
    shows:
      'The coordinator keeping track: asked where things stand it answers for every task, and told what to change it does, across them',
    crop: true,
  },
  {
    file: 'healing',
    story: 'thread-altharline--settled-without-you',
    width: 960,
    height: 700,
    shows: 'A conflict with main and a failing check, both settled by the lead: Althar finds them, the lead fixes them, the checks pass',
    crop: true,
  },
  {
    file: 'automations',
    story: 'screens-automations--a-good-morning',
    width: 1440,
    height: 900,
    shows: 'Automations: work that starts on a schedule, with when it runs next and how its last run went',
    crop: true,
  },
]

/** Where a story is shown, on a Storybook served at `origin`. */
export const storyUrl = (origin: string, story: string, dark = false): string =>
  `${origin}/iframe.html?id=${story}&viewMode=story${dark ? '&globals=theme:dark' : ''}`
