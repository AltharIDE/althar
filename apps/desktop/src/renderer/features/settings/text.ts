import { chord, type CoAuthorCommit, keys, modKey, type ReviewSealSample } from '@althar/ui'

import { device, platform } from '../../shared/device'

const capital = (words: string) => `${words.slice(0, 1).toUpperCase()}${words.slice(1)}`

/* What Althar's settings say, in the quick settings from the window's bar and on the Settings tab. */

export const text = {
  /** Under Remove, on a home over SSH that runs an older Althar, which lets no window but its own manage workers. */
  olderHome: (home: string) => `${home} runs an older Althar: update it to remove its workers from here.`,
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
  connecting: (where: string) => `Looking at the agents on ${where}…`,
  agentHere: (name: string, where: string) => `${name} isn’t on ${where}`,
  version: (version: string) => `Althar ${version}`,
  /** Report a problem (DEV-61), in the quick settings' foot and About Althar. */
  report: 'Report a problem',
  /* About › Storage (DEV-147). */
  storage: {
    profile: 'Profile',
    logs: 'Logs',
    worktrees: 'Task folders',
    show: platform === 'darwin' ? 'Show in Finder' : platform === 'win32' ? 'Show in Explorer' : 'Show in Files',
  },
  on: 'On',
  off: 'Off',
  everyTask: 'Every task',
  newProjects: 'New projects start with',
  newProjectsNote: 'Changing one here leaves the projects you have as they are.',
  pageBesideConversations: 'Pages beside conversations',
  dictation: 'Dictation',
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
  /** How many agents work at once, each line naming the machine it's about: this Mac, or the home the window is on. */
  atOnce: (where: string) => ({
    note: (n: number, { count, memory, cores }: { count: number; memory: number; cores: number }) => {
      if (n === count) return `Default for ${where}’s ${memory} GB and ${cores} cores`
      if (n <= count) return 'Below the default'
      if (n <= count + 2) return 'Tests may slow down'
      return 'May run hot'
    },
    mark: ({ count }: { count: number }) => `${count} · ${where}`,
    value: (n: number, { count }: { count: number }) => (n === count ? `${n}, ${where}’s default` : String(n)),
  }),
  /** The load in the window's bar: this computer's, or the home's the window is on. */
  loadTitle: (where: string) => `Show how hard ${where} works`,
  atLoginTitle: 'Open Althar at login, in the background',
  atLoginNote: 'Off, automations run only while Althar is open.',
  pauseAllTitle: 'Pause all automations',
  pauseAllNote: 'Runs under way finish.',
  /* Tasks. */
  sendMidTurnTitle: 'When I send while an agent is working',
  sendMidTurnNote: `Enter does this one; the other is a click or ${modKey('Enter')} away.`,
  sendMidTurnQueue: 'Queue it',
  sendMidTurnSteer: 'Steer the agent',
  /* Reviews and pull requests. */
  postTeamTitle: 'Post reviews of my team’s pull requests without asking',
  postTeamNote: 'Pull requests from outside the team still wait for you.',
  /** What "Run it" on code from outside the team does, as the person answers it ahead. */
  runOutsideTitle: 'When I say Run it on code from outside the team',
  runOutsideNote: 'It still runs only once you say Run it.',
  runOutsideAsk: 'Ask each time',
  runOutsideSafe: 'Run safely',
  runOutsideFull: 'Trust fully',
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
  accent: 'Accent colour',
  accentAlthar: 'Althar’s',
  accentSystem: `${capital(device.the)}’s`,
  accentNone: `${capital(device.the)} doesn’t set an accent colour, so Althar keeps its own.`,
  accentIllegible: `${capital(device.the)}’s accent colour wouldn’t be readable here, so Althar keeps its own.`,
  icon: 'App icon',
  edge: 'In other apps',
  edgeNote: 'Where what needs you shows',
  examples: 'An example, until work is under way',
  /* The editor. */
  /* Dictation. */
  noDictation: 'Dictation isn’t available on this system.',
  dictationUnreadable: 'Dictation’s settings couldn’t be read.',
  tryAgain: 'Try again',
  removeFailed: 'The speech model couldn’t be removed. Try again.',
  /* What couldn't be kept. */
  failed: 'That couldn’t be kept. Try again.',
  agentToolsOff: 'This Althar doesn’t read your agents’ settings, so their MCP servers and skills aren’t listed.',
  serversUnread: 'Your agents’ MCP servers couldn’t be read.',
  skillsUnread: 'Your skills couldn’t be read.',
  /** On another computer's home, whose MCP servers and skills a window can't show yet. */
  serversAway: (home: string) => `${home}’s MCP servers don’t show in a window yet`,
  serversAwayLine: 'Its agents still use the servers in their own settings there.',
  skillsAway: (home: string) => `${home}’s skills don’t show in a window yet`,
  skillsAwayLine: 'Its agents still use the skills in their own folders there.',
  /** A home's finished tasks keep their commits there. */
  keptOn: (home: string, n: number) => `Its ${n === 1 ? 'commit stays' : 'commits stay'} on its branch, on ${home}.`,
  skillsOff: 'Skills aren’t set up in this copy of Althar, so each lead starts without them.',
  skillsFromFolder: 'A folder you imported',
  skillsCheck: 'Check for updates',
  skillsCurrent: 'Every skill from GitHub is up to date.',
  skillsUpdate: (id: string) => `Review the update to ${id}`,
  skillsUnchecked: (id: string, why: string) => `${id} couldn’t be checked: ${why}`,
  iconFailed: 'That icon couldn’t be kept. Try again.',
}
