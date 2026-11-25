/*
 * The lab's scenes: three directions, six touchpoints, and the states each
 * touchpoint has in each direction, with a caption each. The page's bar reads
 * it, and so does shoot.ts, which shoots every scene in order.
 */

export const DIRECTIONS = [
  { key: 'a', name: 'A home on this PC', line: 'Each distro is a home, beside This PC and the servers, in a window of its own.' },
  { key: 'b', name: 'One window', line: 'No new home: This PC’s projects live on Windows or in a distro, and run where their code is.' },
  {
    key: 'c',
    name: 'Work where your code is',
    line: 'Asked once: the distro becomes the PC’s own window, and Windows a home you can open.',
  },
] as const

export const TOUCHPOINTS = [
  { key: '1', name: 'First run' },
  { key: '2', name: 'Choosing a distro' },
  { key: '3', name: 'Setting it up' },
  { key: '4', name: 'Among the homes' },
  { key: '5', name: 'Asleep or stopped' },
  { key: '6', name: 'The other side’s folders' },
] as const

export type DirectionKey = (typeof DIRECTIONS)[number]['key']
export type TouchpointKey = (typeof TOUCHPOINTS)[number]['key']

interface Variant {
  readonly key: string
  readonly label: string
  readonly caption: string
}

const SETUP = (d: DirectionKey): Variant[] => {
  const where = d === 'a' ? 'In Connect a home, ' : d === 'b' ? 'On the first run’s agents, ' : 'On the first run, '
  return [
    {
      key: 'running',
      label: 'Under way',
      caption:
        d === 'b'
          ? 'Setting Ubuntu up is one quiet line over its agents, which wait as Checking; the steps are behind Details.'
          : `${where}Althar sets the distro up over wsl.exe, step by step: no SSH, no keys, no systemd, and althar-host comes from this PC, not the internet.`,
    },
    {
      key: 'done',
      label: 'Done',
      caption:
        d === 'a'
          ? 'Set up: Open Ubuntu. GitHub and Linear come over from This PC rather than being connected again, and the host updates with the app.'
          : d === 'b'
            ? 'Set up: Ubuntu’s agents are on the list like any of this PC’s, each saying it runs in Ubuntu.'
            : 'Set up: the first run goes on to the first project, in Ubuntu.',
    },
    {
      key: 'agents',
      label: 'Agents not ready there',
      caption:
        d === 'b'
          ? 'Ubuntu’s Claude Code is signed out and its Codex missing: the first run’s own rows, Sign in and Download, act inside Ubuntu.'
          : 'Set up, but Claude Code is signed out inside Ubuntu and Codex isn’t there: the kit’s agent rows, each with the press that fixes it in Ubuntu.',
    },
    {
      key: 'wsl1',
      label: 'A WSL 1 distro',
      caption:
        d === 'b'
          ? 'A WSL 1 distro, said on the agents’ step with the command; Check again after converting.'
          : 'A WSL 1 distro stops it at the first step: Althar converts it itself (Convert to WSL 2), its files kept.',
    },
    {
      key: 'nostart',
      label: 'It won’t start',
      caption:
        d === 'b'
          ? 'Ubuntu won’t start: Windows’ own reason, the command that fixes it, and Check again.'
          : 'Ubuntu won’t start: Windows’ own reason, the command (it needs an administrator), and Try again once it’s done.',
    },
    {
      key: 'stopped',
      label: 'Stopped midway',
      caption: 'The distro stopped while it was being set up (wsl --shutdown, an update): Resume starts it and picks up where it got to.',
    },
  ]
}

export const VARIANTS: Record<DirectionKey, Record<TouchpointKey, readonly Variant[]>> = {
  a: {
    '1': [
      {
        key: 'first',
        label: 'Agents only in Ubuntu',
        caption: 'First run on a PC whose agents are only in Ubuntu: nothing on Windows, and an offer to set Ubuntu up as a home.',
      },
    ],
    '2': [
      {
        key: 'distros',
        label: 'Several distros',
        caption:
          'Connect a home on a PC: WSL comes first, and each distro says what it has. The default is picked; a WSL 1 one is converted first.',
      },
      {
        key: 'none',
        label: 'WSL isn’t installed',
        caption: 'No WSL: what a distro would be here, and the command that installs it. Check again after the restart.',
      },
    ],
    '3': SETUP('a'),
    '4': [
      {
        key: 'menu',
        label: 'The homes menu',
        caption: 'The homes menu: Ubuntu under On this PC with This PC, apart from the servers elsewhere.',
      },
      {
        key: 'manage',
        label: 'Manage homes',
        caption: 'Manage homes: Ubuntu between This PC and vps, by its projects, live while its window is open.',
      },
      {
        key: 'welcome',
        label: 'Its first window',
        caption:
          'Ubuntu’s window the first time, on the kit’s home welcome: its machine is WSL’s share of the PC, and the words say it runs while the PC is awake.',
      },
      { key: 'window', label: 'Its window', caption: 'Ubuntu’s own window after: its projects, and its chip at the end of the bar.' },
    ],
    '5': [
      {
        key: 'asleep',
        label: 'Asleep',
        caption: 'Nothing working, and WSL let Ubuntu sleep: the menu says Asleep. Opening it wakes it.',
      },
      {
        key: 'waking',
        label: 'Waking',
        caption: 'Ubuntu’s window opens at once on what it last read, while its chip says it’s waking.',
      },
      {
        key: 'stopped',
        label: 'Stopped with work running',
        caption: 'Stopped with 2 tasks working: the chip says so, Start Ubuntu beside it, the window readable as it was.',
      },
    ],
    '6': [
      {
        key: 'wsl',
        label: 'A \\\\wsl$ folder on This PC',
        caption:
          'A folder from \\\\wsl.localhost\\Ubuntu added in This PC’s window: an offer to make the project in Ubuntu, or keep it here.',
      },
      {
        key: 'windows',
        label: 'A C:\\ folder in Ubuntu',
        caption: 'A folder on Windows’ disk added in Ubuntu’s window: an offer to copy it into Ubuntu, or use it where it is.',
      },
    ],
  },
  b: {
    '1': [
      {
        key: 'first',
        label: 'Agents only in Ubuntu',
        caption: 'First run: Ubuntu’s agents are this PC’s agents, each saying where it runs; Althar says it puts its host there.',
      },
    ],
    '2': [
      {
        key: 'found',
        label: 'Repositories in each',
        caption:
          'No distro to choose: New project finds repositories in every running distro and on Windows, each with where it is. A stopped one is a press away.',
      },
    ],
    '3': SETUP('b'),
    '4': [
      {
        key: 'menu',
        label: 'The homes menu',
        caption: 'The homes menu: This PC holds Windows and Ubuntu; only the servers are other homes.',
      },
      {
        key: 'manage',
        label: 'Manage homes',
        caption: 'Manage homes: This PC’s projects, each saying whether it lives in Ubuntu or on Windows.',
      },
      { key: 'window', label: 'The window', caption: 'One window, one Home, one Needs you, across both sides.' },
    ],
    '5': [
      {
        key: 'asleep',
        label: 'Asleep',
        caption:
          'Asleep shows nothing: the board, conversations and history are on This PC’s side, and Ubuntu wakes when a task starts there.',
      },
      {
        key: 'stopped',
        label: 'Stopped with work running',
        caption: 'Stopped with 2 tasks working: a line in Needs you, Start Ubuntu on it; Ledger, on Windows, works on.',
      },
    ],
    '6': [
      {
        key: 'wsl',
        label: 'A \\\\wsl$ folder',
        caption: 'A folder from \\\\wsl.localhost\\Ubuntu just works: it reads as Ubuntu’s, and the project runs there.',
      },
      {
        key: 'mixed',
        label: 'Folders on both sides',
        caption: 'One folder in Ubuntu and one on Windows: a project runs in one place, so one of them moves or goes.',
      },
    ],
  },
  c: {
    '1': [
      {
        key: 'first',
        label: 'Where you work',
        caption:
          'First run asks once where you work, Ubuntu picked where the agents and code are; the list under it is that side’s agents.',
      },
    ],
    '2': [
      {
        key: 'crowded',
        label: 'Several distros',
        caption: 'The same question with several distros: each with what it has; a WSL 1 one is converted first.',
      },
    ],
    '3': SETUP('c'),
    '4': [
      { key: 'menu', label: 'The homes menu', caption: 'The homes menu from Ubuntu’s window: Windows is a home on this PC beside it.' },
      { key: 'manage', label: 'Manage homes', caption: 'Manage homes: Ubuntu first, Windows quiet with its one project, then vps.' },
      { key: 'window', label: 'The window', caption: 'The PC’s window is Ubuntu’s: its chip at the end of the bar, its projects on Home.' },
    ],
    '5': [
      {
        key: 'asleep',
        label: 'Opened asleep',
        caption: 'Althar keeps Ubuntu awake while its window is open; opened asleep, it shows what it last read while Ubuntu wakes.',
      },
      {
        key: 'stopped',
        label: 'Stopped with work running',
        caption: 'Stopped with 2 tasks working: Althar starts it again at once, and the chip says so; nothing asks.',
      },
    ],
    '6': [
      {
        key: 'wsl',
        label: 'A \\\\wsl$ folder',
        caption:
          'A folder picked in Windows’ folder picker under \\\\wsl.localhost\\Ubuntu reads as Ubuntu’s own ~/code/meridian; nothing to ask.',
      },
      {
        key: 'windows',
        label: 'A C:\\ folder',
        caption: 'A folder on Windows’ disk: copying it into Ubuntu is the way on, with using it in place a link beside.',
      },
    ],
  },
}

export const variantsOf = (d: DirectionKey, t: TouchpointKey) => VARIANTS[d][t]
