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
}

export const SCREENSHOTS: readonly Screenshot[] = [
  {
    file: 'home',
    story: 'screens-home--busy',
    width: 1440,
    height: 900,
    shows: 'The home: what needs you, what is running, and what happened since you looked',
  },
  {
    file: 'board',
    story: 'board-board--default',
    width: 1440,
    height: 900,
    shows: "A project's board: up next, running, needs you, settled",
  },
  {
    file: 'project-rules',
    story: 'screens-projectrules--default',
    width: 1440,
    height: 900,
    shows: 'Project rules: when agents need a yes',
  },
  {
    file: 'first-run',
    story: 'screens-start--first-run',
    width: 1440,
    height: 900,
    shows: 'First run: the agents on this Mac, and a first project',
  },
]

/** Where a story is shown, on a Storybook served at `origin`. */
export const storyUrl = (origin: string, story: string): string => `${origin}/iframe.html?id=${story}&viewMode=story`
