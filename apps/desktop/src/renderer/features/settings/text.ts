import { chord, type CoAuthorCommit, keys, modKey, type ReviewSealSample } from '@althar/ui'

import { device, platform } from '../../shared/device'

/* What Althar's settings say, in the quick settings from the window's bar and on the Settings tab. */

export const text = {
  /** The gear at the end of the window's bar, which every screen has: Althar's, not a project's. */
  gear: 'Althar settings',
  /** The quick settings, as a screen reader names them. */
  quick: 'Quick settings',
  kbd: modKey(','),
  /** The Settings tab, and the way to it from the quick settings. */
  settings: 'Settings',
  all: 'All settings',
  allKbd: chord(keys.mod, keys.shift, ','),
  agents: 'Agents',
  connecting: `Looking at the agents on ${device.this}…`,
  agentHere: (name: string) => `${name} isn’t on ${device.this}`,
  /** Althar's own copy, at a version no session starts on: one it runs can take its place. */
  agentReplace: {
    missing: (name: string) => `Althar’s copy of ${name} is one it doesn’t run`,
    can: (name: string, size: string) =>
      `Althar can replace it with ${name}’s newest release that it runs, from GitHub, about ${size}, checked against the release. Your terminal stays as it is.`,
    download: (name: string) => `Replace ${name}`,
  },
  version: (version: string) => `Althar ${version}`,
  /** Report a problem (DEV-61), in the quick settings' foot and About Althar. */
  report: 'Report a problem',
  off: 'Off',
  /* The quick settings' cards. */
  awake: 'Keep awake',
  awakeOn: 'While work runs',
  notify: 'Notifications',
  notifyOn: 'When you’re away',
  sound: 'Sound',
  silent: 'Silent',
  systemSound: 'System sound',
  load: 'CPU and memory',
  loadOn: 'In the bar',
  /* Work on this computer. */
  awakeTitle: `Keep ${device.this} awake while work runs`,
  awakeNote: 'The display can still sleep.',
  atOnceNote: (n: number, { count, memory, cores }: { count: number; memory: number; cores: number }) => {
    if (n === count) return `Default for ${memory} GB and ${cores} cores`
    if (n <= count) return 'Below the default'
    if (n <= count + 2) return 'Tests may slow down'
    return 'May run hot'
  },
  atOnceMark: ({ count }: { count: number }) => `${count} · ${device.this}`,
  atOnceValue: (n: number, { count }: { count: number }) => (n === count ? `${n}, ${device.this}’s default` : String(n)),
  loadTitle: `Show how hard ${device.this} works`,
  atLoginTitle: 'Open Althar at login, in the background',
  atLoginNote: 'Off, automations run only while Althar is open.',
  pauseAllTitle: 'Pause all automations',
  pauseAllNote: 'Runs under way finish.',
  /* Reviews and pull requests. */
  postTeamTitle: 'Post reviews of my team’s pull requests without asking',
  postTeamNote: 'Pull requests from outside the team still wait for you.',
  coAuthorTitle: 'Althar as co-author',
  /** Who the person is on the commit co-author is shown on, without a GitHub account connected. */
  you: 'you',
  /** A commit to show the co-author line on, as GitHub would. */
  commit: {
    subject: 'Retry the checkout call with backoff',
    body: 'Wraps the upstream call in a jittered retry, three tries at most,\nand only for 502, 503 and timeouts.',
    sha: '4e1c07a',
    when: 'committed 12 minutes ago',
  } satisfies CoAuthorCommit,
  reviewSealTitle: 'Review seal on pull requests',
  reviewSealNote: 'Which model reviewed the change before it opened, in how many passes, and what changed after.',
  /** The pull request that commit went up in, to show the seal on, as GitHub would. */
  pullRequest: {
    title: 'Retry the checkout call with backoff',
    number: '#212',
    text: 'The checkout call failed the whole order on one dropped connection. It now retries with jittered backoff, three tries at most, and only for 502, 503 and timeouts.',
    facts: { model: 'GPT-6.1 Sol', sha: '4e1c07a', passes: 2, date: '2026-10-31' },
  } satisfies ReviewSealSample,
  /* Notifications. */
  badge: `Count them on ${device.count ?? 'the icon'}`,
  /* Appearance. */
  theme: 'Light or dark',
  themeLight: 'Light',
  themeDark: 'Dark',
  themeSystem: `Match ${device.the}`,
  icon: 'App icon',
  edge: 'In other apps',
  edgeNote: 'Where what needs you shows',
  examples: 'An example, until work is under way',
  /* The editor. */
  noEditors: `No editor found on ${device.this}. Files open in ${device.files}.`,
  /* What couldn't be kept. */
  failed: 'That couldn’t be kept. Try again.',
  iconFailed: 'That icon couldn’t be kept. Try again.',
}
