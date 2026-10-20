import { chord, type CoAuthorCommit, keys, modKey } from '@althar/ui'

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
  awakeNote: `Work stops when ${device.the} sleeps. The display can still sleep.`,
  atOnceNote: (n: number, { count, memory, cores }: { count: number; memory: number; cores: number }) => {
    if (n === count) return `${n}: ${device.this} has ${memory} GB and ${cores} cores. More tasks than that wait their turn.`
    if (n === 1) return `1: one at a time. The calmest ${device.this} can be.`
    if (n < count) return `${n}: fewer than ${device.this} could carry.`
    if (n <= count + 2) return `${n}: a little more than ${device.this}’s ${memory} GB suggests. Tests may slow down.`
    return `${n}: well past what ${device.this}’s ${memory} GB suggests. Expect it to run hot.`
  },
  atOnceMark: ({ count }: { count: number }) => `${count} · ${device.this}`,
  atOnceValue: (n: number, { count }: { count: number }) => (n === count ? `${n}, ${device.this}’s default` : String(n)),
  loadTitle: `Show how hard ${device.this} works`,
  loadNote: 'CPU and memory in the bar, and how much of each Althar’s work uses.',
  /* Reviews and pull requests. */
  postTeamTitle: 'Post reviews of my team’s pull requests without asking',
  postTeamNote: 'As soon as a review’s lead drafts one. A review of a pull request from outside the team always waits for you to post it.',
  coAuthorTitle: 'Althar as co-author',
  coAuthorNote: 'A line on the commits and pull requests Althar sends, so the code host shows its face beside yours.',
  /** Who the person is on the commit co-author is shown on, without a GitHub account connected. */
  you: 'you',
  /** A commit to show the co-author line on, as GitHub would. */
  commit: {
    subject: 'Retry the checkout call with backoff',
    body: 'Wraps the upstream call in a jittered retry, three tries at most,\nand only for 502, 503 and timeouts.',
    sha: '4e1c07a',
    when: 'committed 12 minutes ago',
  } satisfies CoAuthorCommit,
  /* Notifications. */
  badge: `Count them on ${device.count ?? 'the icon'}`,
  soundNote:
    platform === 'darwin'
      ? 'One of this Mac’s alert sounds, with each notification.'
      : 'The system’s own sound, with each notification, or none.',
  /* Appearance. */
  icon: 'App icon',
  edge: 'In other apps',
  edgeNote: 'Where Althar shows what needs you, while you work in another app.',
  examples: 'With nothing under way yet, here is how a busy moment would look.',
  /* The editor. */
  noEditors: `No editor found on ${device.this}. Files open in ${device.files}.`,
  /* What couldn't be kept. */
  failed: 'That couldn’t be kept. Try again.',
  skillsOff: 'Skills aren’t set up in this copy of Althar, so each lead starts without them.',
  skillsFromAlthar: 'Althar',
  skillsFromFolder: 'A folder you imported',
  skillsCheck: 'Check for updates',
  skillsCurrent: 'Every skill from GitHub is up to date.',
  skillsUpdate: (id: string) => `Review the update to ${id}`,
  skillsUnchecked: (id: string, why: string) => `${id} couldn’t be checked: ${why}`,
  skillsCatalog: (revision: string) =>
    `Althar’s skills come from agent-skills (Addy Osmani) and superpowers (Jesse Vincent), both MIT, catalog ${revision}. They’re off until you turn them on, and one you turn on is given to every task’s lead. A change reaches each lead the next time it starts, in a task under way too.`,
  iconFailed: 'That icon couldn’t be kept. Try again.',
}
