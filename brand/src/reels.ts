/*
 * Short loops of the app for the README: GIFs recorded from the UI package's
 * Storybook on the demo cast, with the pointer doing what a person would.
 * `bun run export:reels` records them; like the screenshots, they are not
 * drawn from code, so they are not part of `bun run export`.
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
}

/** The cross-fade between scenes, in seconds. */
export const FADE = 0.45

export const REELS: readonly Reel[] = [
  {
    file: 'island',
    width: 960,
    height: 600,
    ground: '#f4f2ec',
    shows: 'The island round the notch: two calls wait, and pointing at it drops it open to answer them',
    scenes: [
      {
        story: 'home-island--needs-you',
        width: 960,
        height: 600,
        /* the top of the screen, where the island hangs, closer */
        region: { x: 160, y: 0, width: 640, height: 400 },
        density: 3,
        slow: 0.4,
        /* the story's screen, made a light desktop on the Aurora wallpaper, with a light menu bar */
        css: `body, #storybook-root { padding: 0 !important; margin: 0 !important; }
              [class*='screen'] { width: 960px !important; background: url({wallpaper}) center 78% / cover !important; }
              [class*='menuBar'] { background: rgba(255, 255, 255, 0.6) !important; backdrop-filter: blur(20px); }`,
        steps: [{ wait: 1400 }, { hover: '2 need you' }, { wait: 3200 }, { leave: true }, { wait: 1400 }],
      },
    ],
  },
  {
    file: 'details',
    width: 960,
    height: 600,
    ground: '#f4f2ec',
    shows: 'Details: the launch rising out of its own light, the agents and their accounts, choosing the app icon, and the home at rest',
    scenes: [
      { story: 'screens-launch--opening', width: 1440, height: 900, steps: [{ wait: 2500 }] },
      {
        story: 'setup-controlcenter--at-a-glance',
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
        story: 'setup-controlcenter--at-a-glance',
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
