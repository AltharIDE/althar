/*
 * What the flight log adds to the changelog's content (src/content/changelog.ts),
 * kept here so that file stays the one the release notes are copied into:
 * when each release went out, to the second, from GitHub; and each
 * release's highlights, the changes it leads with, in the notes' own facts,
 * with the pictures that show them.
 */

/** When each release was published on GitHub, UTC. The mission's clock starts at 0.1.0's. */
export const PUBLISHED: Record<string, string> = {
  /** For now: set it to v0.6.0's publish time when it is tagged (#370). */
  '0.6.0': '2026-10-31T12:00:00Z',
  '0.5.0': '2026-10-20T18:18:17Z',
  '0.4.1': '2026-10-18T19:50:59Z',
  '0.4.0': '2026-10-18T13:05:20Z',
  '0.3.0': '2026-10-16T09:32:22Z',
  '0.2.0': '2026-10-13T23:24:37Z',
  '0.1.0': '2026-10-12T23:36:51Z',
}

/** The pictures the highlights are shown with (LogPictures.tsx). */
export type Picture = 'automations' | 'plans' | 'windows' | 'reviewer' | 'report' | 'run' | 'evidence' | 'plan'

export interface Highlight {
  /** The feature, named plainly. */
  title: string
  /** Why it matters, in a line or two. */
  why: string
  picture: Picture
  /** The release's changes it stands for, by their place in its list: its entry's lines leave them out. */
  covers: readonly number[]
}

/**
 * Each release's highlights, the first its lead. The newest release's lead
 * opens the page, so its entry shows the rest and keeps the lead's lines.
 */
export const HIGHLIGHTS: Record<string, readonly Highlight[]> = {
  '0.6.0': [
    {
      title: 'Automations',
      why: 'Work that starts by itself: a nightly dependency check, a Monday look at open pull requests, a morning triage. Each run is a task you can open, on your plans, while Althar is open.',
      picture: 'automations',
      covers: [0],
    },
    {
      title: 'Plan usage, and dark mode',
      why: 'A gauge in the window’s bar, each agent’s windows and when they reset, and new work starting on the account with the most room. And for the evenings, a warm dark made from Althar’s own paper.',
      picture: 'plans',
      covers: [1, 2],
    },
  ],
  '0.5.0': [
    {
      title: 'Windows, and seven more agents',
      why: 'An installer for x64 that installs for you alone and updates itself; it isn’t signed yet, so SmartScreen warns the first time: More info, then Run anyway. And seven more agents, each kept asking before it acts.',
      picture: 'windows',
      covers: [0, 1],
    },
  ],
  '0.4.1': [
    {
      title: 'Pull requests written for a reviewer',
      why: 'Each one Althar opens says why, what changed and how it was checked, in your repository’s template where it has one.',
      picture: 'reviewer',
      covers: [2],
    },
  ],
  '0.4.0': [
    {
      title: 'Report a problem',
      why: 'From the app’s menu, quick settings or a stuck step. What you write goes with a screenshot and Althar’s logs, with folders, names and keys taken out.',
      picture: 'report',
      covers: [0],
    },
  ],
  '0.3.0': [
    {
      title: 'Run many things',
      why: 'Run is split: a press starts the first thing, and its list starts or stops any of them, each with where it answers.',
      picture: 'run',
      covers: [0],
    },
  ],
  '0.2.0': [
    {
      title: 'Evidence',
      why: 'A finished task shows what it built, the screenshots and test runs its lead showed, and anything it couldn’t check. The reviewer reads the evidence too.',
      picture: 'evidence',
      covers: [0],
    },
  ],
  '0.1.0': [
    {
      title: 'The coordinator',
      why: 'Open a folder as a project and say what you want changed. Its coordinator plans tasks, each with a lead that implements it and a review.',
      picture: 'plan',
      covers: [0],
    },
  ],
}
