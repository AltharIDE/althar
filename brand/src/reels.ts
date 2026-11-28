/*
 * Short loops of the app for the README: GIFs recorded from the UI package's
 * Storybook on the demo cast, with the pointer doing what a person would.
 * `bun run export:reels` records them; like the screenshots, they are not
 * drawn from code, so they are not part of `bun run export`.
 *
 * The README's feature table has one loop for each row, zoomed into the
 * feature, in the app's light and its dark (`name.gif`, `name-dark.gif`), small
 * enough for GitHub to load at once: about 800 px across, a dozen frames a second.
 */

/** A region of the page, in CSS pixels. */
export interface Region {
  x: number
  y: number
  width: number
  height: number
}

/** One thing the pointer does, or a pause. Times are as the reel shows them. */
export type Step =
  | { wait: number }
  /** Click the button whose accessible name starts with this. */
  | { click: string }
  /** Rest the pointer on the button whose accessible name starts with this. */
  | { hover: string }
  /** Take the pointer away. */
  | { leave: true }
  /** Type into the field that has focus, a key at a time. */
  | { type: string }
  /** Press a key, such as Escape. */
  | { press: string }

export interface Scene {
  /** The story's id in Storybook. */
  story: string
  width: number
  height: number
  /** The part of the page to record; all of it by default. */
  region?: Region
  /** How dense to record: 2 for a small region, to stay sharp when it's scaled to the reel. */
  density?: number
  /** Played slower while recording, then sped back up, so short transitions get enough frames. CSS and Web Animations only. */
  slow?: number
  /** Styles laid over the story, such as a wallpaper behind it. `{wallpaper}` is replaced with the Aurora wallpaper, light. */
  css?: string
  /** The same for the dark, where it differs; `{wallpaper}` is the Aurora wallpaper at night. */
  cssDark?: string
  /** Draw a pointer that glides to what a step clicks or hovers, with a ripple where it clicks. */
  cursor?: boolean
  /** Done before the recording starts, so a loop can begin, and end, in the state its feature is in at rest. */
  prelude?: readonly Step[]
  steps: readonly Step[]
}

export interface Reel {
  file: string
  width: number
  height: number
  /** What shows round a scene smaller than the reel. */
  ground: string
  scenes: readonly Scene[]
  /** What it shows, for the README's alternative text. */
  shows: string
  /** The app's looks to record it in: `file.gif` for the light, `file-dark.gif` for the dark. Light only by default. */
  themes?: readonly Theme[]
  /** Frames a second in the GIF: 16 by default. A whole number of hundredths keeps every frame its time (12.5, 20, 25). */
  fps?: number
  /** Colours in the GIF's palette: 256 by default. Fewer makes it smaller. */
  colors?: number
  /** How the palette is dithered, as ffmpeg's `paletteuse` says: `sierra2_4a` by default; `none` or `bayer:bayer_scale=5` is smaller for flat colour. */
  dither?: string
}

export type Theme = 'light' | 'dark'

/** The cross-fade between scenes, in seconds. */
export const FADE = 0.45

/** One row of the README's feature table: 800 × 500, in the app's light and its dark, a few hundred KB each. */
const row = (reel: Omit<Reel, 'width' | 'height' | 'ground' | 'themes' | 'fps' | 'colors' | 'dither'> & Partial<Reel>): Reel => ({
  width: 800,
  height: 500,
  ground: '#f4f2ec',
  themes: ['light', 'dark'],
  fps: 12.5,
  colors: 128,
  dither: 'bayer:bayer_scale=5',
  ...reel,
})

export const REELS: readonly Reel[] = [
  row({
    file: 'coordinator',
    height: 586,
    shows: 'Opening a plan the coordinator drew: who leads, which other lab reviews, how it ends',
    scenes: [
      {
        story: 'screens-projecthome--busy',
        width: 1680,
        height: 1010,
        region: { x: 40, y: 530, width: 560, height: 410 },
        density: 2,
        slow: 0.5,
        cursor: true,
        steps: [{ wait: 900 }, { click: 'Review: Codex' }, { wait: 2400 }, { press: 'Escape' }, { wait: 1400 }],
      },
    ],
  }),
  row({
    file: 'review',
    height: 525,
    shows: 'A review settled: what the reviewers found, and what the lead fixed or set aside',
    scenes: [
      {
        story: 'thread-review--settled',
        width: 672,
        height: 600,
        region: { x: 0, y: 0, width: 672, height: 441 },
        density: 2,
        slow: 0.5,
        cursor: true,
        prelude: [{ wait: 600 }, { click: 'Findings' }, { wait: 1800 }],
        steps: [{ wait: 1800 }, { click: 'Findings' }, { wait: 1400 }, { click: 'Findings' }, { wait: 2600 }],
      },
    ],
  }),
  row({
    file: 'board',
    /* the lanes move all at once, so every frame is new: fewer, flatter ones keep it small */
    fps: 8,
    colors: 64,
    dither: 'none',
    shows: "A project's board: up next, running, needs you, settled, whichever lab's agent has each task",
    scenes: [
      {
        story: 'board-board--default',
        width: 1000,
        height: 625,
        density: 1.5,
        slow: 0.5,
        cursor: true,
        steps: [{ wait: 1400 }, { click: 'Collapse Up next' }, { wait: 2200 }, { click: 'Expand Up next' }, { wait: 2200 }],
      },
    ],
  }),
  row({
    file: 'usage',
    height: 443,
    shows: 'A task that ran out of usage carries on with another agent, on the same thread',
    scenes: [
      {
        story: 'thread-ratelimit--two-accounts',
        width: 560,
        height: 400,
        region: { x: 0, y: 20, width: 560, height: 310 },
        density: 2,
        slow: 0.5,
        cursor: true,
        steps: [{ wait: 900 }, { click: 'Choose another model' }, { wait: 1200 }, { click: 'Gemini 3 Pro' }, { wait: 1800 }],
      },
    ],
  }),
  row({
    file: 'dictation',
    shows: 'Dictating to a lead: your voice as bars, and the words arriving in the field as you say them',
    scenes: [
      {
        story: 'composer-composer--dictating-word-by-word',
        width: 520,
        height: 325,
        density: 2,
        /* the composer in the middle of the frame, rather than at the top of an empty story */
        css: `body { margin: 0 !important; } #storybook-root { min-height: 100vh; display: flex; align-items: center; } .ch-root { width: 100%; }`,
        steps: [{ wait: 5400 }],
      },
    ],
  }),
  row({
    file: 'automations',
    height: 507,
    shows: 'Asking for work on a schedule: when it runs, and what each run ends in, until you turn it on',
    scenes: [
      {
        story: 'screens-automationpage--proposed',
        width: 640,
        height: 480,
        region: { x: 20, y: 44, width: 600, height: 380 },
        density: 2,
        slow: 0.5,
        cursor: true,
        steps: [
          { wait: 900 },
          { click: 'Every weekday at 9:00' },
          { wait: 1800 },
          { press: 'Escape' },
          { wait: 500 },
          { click: 'Review each new pull request' },
          { wait: 1800 },
          { press: 'Escape' },
          { wait: 900 },
        ],
      },
    ],
  }),
  row({
    file: 'skills',
    height: 625,
    shows: 'A skill added once, with who gets it: leads, reviewers, the coordinator, and every agent',
    scenes: [
      {
        story: 'setup-tooltiles-skilltiles--opens-in-place',
        width: 640,
        height: 500,
        density: 2,
        slow: 0.5,
        cursor: true,
        steps: [{ wait: 900 }, { click: 'release-checklist' }, { wait: 3000 }],
      },
    ],
  }),
  row({
    file: 'workers',
    height: 525,
    shows: "Your workers in Settings: one opens to the task it's running and what it has free",
    scenes: [
      {
        story: 'setup-computers--default',
        width: 980,
        height: 660,
        density: 2,
        /* the settings' column from the top of the page, its home and its workers */
        region: { x: 0, y: 0, width: 932, height: 612 },
        slow: 0.5,
        cursor: true,
        steps: [{ wait: 1400 }, { click: 'Linux worker 3c3f9a' }, { wait: 2800 }, { click: 'Computers' }, { wait: 1800 }],
      },
    ],
  }),
  row({
    file: 'canvas',
    height: 640,
    shows: 'A diagram a lead drew on the canvas: you comment on it, and the next version answers',
    scenes: [
      {
        story: 'thread-canvas--commenting',
        width: 700,
        height: 560,
        density: 2,
        slow: 0.5,
        cursor: true,
        steps: [
          { wait: 900 },
          { click: 'Comment' },
          { wait: 800 },
          { type: 'Make B the first option' },
          { wait: 700 },
          { click: 'Add to message' },
          { wait: 1800 },
        ],
      },
    ],
  }),
  row({
    file: 'island',
    shows: 'The island round the notch: two calls wait, and pointing at it drops it open to answer them',
    scenes: [
      {
        story: 'home-island--needs-you',
        width: 960,
        height: 600,
        /* the top of the screen, where the island hangs, closer */
        region: { x: 160, y: 0, width: 640, height: 400 },
        density: 2,
        slow: 0.4,
        cursor: true,
        /* the story's screen, made a desktop on the Aurora wallpaper, with a menu bar, in the light and in the dark */
        css: `body, #storybook-root { padding: 0 !important; margin: 0 !important; }
              [class*='screen'] { width: 960px !important; background: url({wallpaper}) center 78% / cover !important; }
              [class*='menuBar'] { background: rgba(255, 255, 255, 0.6) !important; backdrop-filter: blur(20px); }`,
        cssDark: `body, #storybook-root { padding: 0 !important; margin: 0 !important; }
              [class*='screen'] { width: 960px !important; background: url({wallpaper}) center 78% / cover !important; }
              [class*='menuBar'] { background: rgba(0, 0, 0, 0.35) !important; backdrop-filter: blur(20px); }`,
        steps: [
          { wait: 1200 },
          { hover: '2 need you' },
          { wait: 1800 },
          { click: 'Allow once' },
          { wait: 1800 },
          { leave: true },
          { wait: 800 },
        ],
      },
    ],
  }),
  {
    file: 'details',
    width: 960,
    height: 600,
    ground: '#f4f2ec',
    shows: 'Details: the launch rising out of its own light, the agents and their accounts, choosing the app icon, and the home at rest',
    scenes: [
      { story: 'screens-launch--opening', width: 1440, height: 900, steps: [{ wait: 2500 }] },
      {
        story: 'setup-controlcenter--at-rest',
        width: 1000,
        height: 625,
        density: 2,
        slow: 0.5,
        steps: [
          { wait: 900 },
          { click: 'Agents' },
          { wait: 1500 },
          { click: 'Claude Code' },
          { wait: 1400 },
          { click: 'Codex' },
          { wait: 1600 },
        ],
      },
      {
        story: 'setup-controlcenter--at-rest',
        width: 1000,
        height: 625,
        /* the settings' corner, where the icon is picked and the Dock shows it */
        region: { x: 440, y: 20, width: 560, height: 350 },
        density: 3,
        slow: 0.5,
        steps: [{ wait: 700 }, { click: 'App icon' }, { wait: 1300 }, { click: 'Ink' }, { wait: 1500 }, { click: 'Paper' }, { wait: 1800 }],
      },
      { story: 'screens-home--at-rest-all-quiet', width: 1440, height: 900, steps: [{ wait: 3200 }] },
    ],
  },
]
