/*
 * What the flight log adds to the changelog's content (src/content/changelog.ts),
 * kept here so that file stays the one the release notes are copied into:
 * when each release went out and when main last moved, to the second, from
 * GitHub; and each release's highlight, the change it leads with, in the
 * notes' own facts, with the picture that shows it.
 */

/** When each release was published on GitHub, UTC. The mission's clock starts at 0.1.0's. */
export const PUBLISHED: Record<string, string> = {
  '0.5.0': '2026-10-20T18:18:17Z',
  '0.4.1': '2026-10-18T19:50:59Z',
  '0.4.0': '2026-10-18T13:05:20Z',
  '0.3.0': '2026-10-16T09:32:22Z',
  '0.2.0': '2026-10-13T23:24:37Z',
  '0.1.0': '2026-10-12T23:36:51Z',
}

/** When each pull request on main since the last release was merged, UTC. */
export const MERGED: Record<number, string> = {
  405: '2026-10-30T18:31:40Z',
  395: '2026-10-30T09:36:21Z',
  385: '2026-10-28T23:03:08Z',
  388: '2026-10-29T08:54:37Z',
  380: '2026-10-28T23:50:33Z',
  390: '2026-10-28T23:46:03Z',
  386: '2026-10-28T23:05:23Z',
  358: '2026-10-28T18:00:25Z',
  378: '2026-10-28T19:29:36Z',
  372: '2026-10-28T18:12:56Z',
  371: '2026-10-28T11:07:37Z',
  324: '2026-10-27T19:59:49Z',
  339: '2026-10-27T18:37:54Z',
}

/** The pictures the highlights are shown with (LogPictures.tsx). */
export type Picture = 'windows' | 'reviewer' | 'report' | 'run' | 'evidence' | 'plan' | 'automations'

export interface Highlight {
  /** What it gives you, in a few words. */
  title: string
  /** Why it matters, in a line. */
  why: string
  picture: Picture
  /** The release's changes it stands for, by their place in its list: the log lines leave them out. */
  covers: readonly number[]
}

/** Each release's highlight. 0.5.0's opens the page, so its own entry keeps every line. */
export const HIGHLIGHT: Record<string, Highlight> = {
  '0.5.0': {
    title: 'Now on Windows, with seven more agents.',
    why: 'An x64 installer that updates itself, with no administrator’s prompt. And seven more agents, each kept asking before it acts.',
    picture: 'windows',
    covers: [],
  },
  '0.4.1': {
    title: 'A pull request that explains itself',
    why: 'Each one Althar opens says why, what changed and how it was checked, in your repository’s template where it has one.',
    picture: 'reviewer',
    covers: [2],
  },
  '0.4.0': {
    title: 'Say what happened. The screenshot and logs go with it.',
    why: 'From the app’s menu, quick settings or a stuck step. What you write goes with a screenshot and Althar’s logs, with folders, names and keys taken out.',
    picture: 'report',
    covers: [0],
  },
  '0.3.0': {
    title: 'The app, the API and the worker, from one button',
    why: 'Run is split: a press starts the first thing, and its list starts or stops any of them, each with where it answers.',
    picture: 'run',
    covers: [0],
  },
  '0.2.0': {
    title: 'Screenshots and test runs, with every finished task',
    why: 'What it built, the screenshots and test runs its lead showed, and anything it couldn’t check. The reviewer reads the evidence too.',
    picture: 'evidence',
    covers: [0],
  },
  '0.1.0': {
    title: 'Say what you want changed. The coordinator plans it.',
    why: 'Open a folder as a project. Its coordinator plans tasks, each with a lead that implements it and a review.',
    picture: 'plan',
    covers: [0],
  },
}

/** What main is bringing to the next release, shown at its tail. */
export const COMING: Highlight & { pr: number } = {
  title: 'Work that starts itself',
  why: 'Automations run what you ask on a schedule, on your computer, while Althar is open.',
  picture: 'automations',
  covers: [],
  pr: 339,
}
