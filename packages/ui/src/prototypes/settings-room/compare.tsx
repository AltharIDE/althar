// Scrappy: every direction on one page, today first, each with its shots in order and a way into it live.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '../../styles/global.css'

import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { Heading } from '../../primitives/Heading/Heading'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'

const SHOTS =
  '/@fs/Users/balazs/Charrette/althar/scrappy-prototype-app-settings-that-have-room-to/althar/.althar/scratch/settings-room/shots'

interface Shot {
  readonly id: string
  readonly file: string
  readonly caption: string
}

const DIRECTIONS: ReadonlyArray<{
  readonly key: string
  readonly title: string
  readonly what: string
  readonly round: 'today' | 'two' | 'one'
}> = [
  {
    key: 'today',
    round: 'today',
    title: 'Today',
    what: 'The Control Center from the home’s gear. Keep awake’s name opens “This Mac”, where agents at once, posting team reviews, the load meter and the editor are hidden too.',
  },
  {
    key: 'f',
    round: 'two',
    title: 'F · The panel holds only what you flip',
    what: 'Keep awake, notifications, posting team reviews and CPU and memory in the bar, as round switches, and agents at once. No glances. All settings (⌘⇧,) opens a page of sections with search, over the screen you were on.',
  },
  {
    key: 'g',
    round: 'two',
    title: 'G · Switches, and what needs you',
    what: 'Today’s panel, pruned: keep awake and notifications, the agents and code hosts at a glance (a signed-out account in violet), agents at once. App icon, In other apps and Co-author go to the page. Each glance opens the page at its section.',
  },
  {
    key: 'h',
    round: 'two',
    title: 'H · The panel grows into all of settings',
    what: 'G’s panel, but All settings grows the same panel into the whole of settings, under the gear, with search and sections, and its back arrow shrinks it again. No page; the panel never leaves.',
  },
  {
    key: 'i',
    round: 'two',
    title: 'I · You choose what’s quick',
    what: 'The panel holds what you tick under Edit, from switches to agents at once, the sound or the editor. It starts with keep awake, notifications, the agents and agents at once. New settings land on the page; anyone who wants one at hand ticks it.',
  },
  {
    key: 'a',
    round: 'one',
    title: 'A · Quick panel, and a Settings window',
    what: 'The Control Center stays as today, less Co-author. Its modules and All settings open a Settings window over the app, with the sections down its side.',
  },
  {
    key: 'b',
    round: 'one',
    title: 'B · A settings page, no panel',
    what: 'The gear and ⌘, open Settings as a page of the window, like a project’s rules: search, the two switches and the sections down the side.',
  },
  {
    key: 'c',
    round: 'one',
    title: 'C · One long panel with an index',
    what: 'A wider panel: the two switches on top, then every section in one scroll, with an index beside it that follows the scroll.',
  },
  {
    key: 'd',
    round: 'one',
    title: 'D · A wider panel with tabs',
    what: 'The two switches on top, then a tab for each section across the panel. Eight tabs already; there is little room for a ninth.',
  },
  {
    key: 'e',
    round: 'one',
    title: 'E · ⌘, finds a setting',
    what: '⌘, opens a finder: type a setting’s name, change it in place, Return flips the first. The gear opens B’s page to look around.',
  },
]

/** Every setting there is today: where it is, its section in every direction, and which second-round panels hold it. */
const SETTINGS: ReadonlyArray<readonly [string, string, string, string]> = [
  ['Keep this Mac awake while work runs', 'Round switch; and This Mac, behind Keep awake', 'Work on this Mac', 'F G H I'],
  ['On battery too', 'This Mac, behind Keep awake', 'Work on this Mac', '—'],
  ['Agents at once', 'This Mac, behind Keep awake', 'Work on this Mac', 'F G H I'],
  ['Show how hard this Mac works', 'This Mac, behind Keep awake', 'Work on this Mac', 'F (I if ticked)'],
  ['Post reviews of my team’s pull requests without asking', 'This Mac, behind Keep awake', 'Reviews and pull requests', 'F (I if ticked)'],
  ['Althar as co-author', 'A link in the foot', 'Reviews and pull requests', 'I if ticked'],
  ['Open files in', 'This Mac, behind Keep awake', 'Editor', 'I if ticked'],
  ['Notifications: calls, ready, stopped (all at once)', 'Round switch', 'Notifications', 'F G H I'],
  ['Each kind of notification; Count them on the Dock icon', 'Notifications, behind its switch', 'Notifications', '—'],
  ['Notification sound', 'Notifications, behind its switch', 'Notifications', 'I if ticked'],
  ['Agents: accounts, signing in, installing, models', 'Agents module', 'Agents', 'G H I glance'],
  ['Code hosts and trackers, and connecting one', 'Code hosts module', 'Code hosts and trackers', 'G H glance (I if ticked)'],
  ['App icon', 'Picture module', 'Appearance', '—'],
  ['In other apps (island or menu bar)', 'Picture module', 'Appearance', '—'],
  ['Version, What’s new, an update ready', 'The foot', 'About Althar', 'Version in the foot'],
]

const td = { padding: '7px 12px 7px 0', borderTop: '1px solid var(--line)', verticalAlign: 'top' } as const

function Compare() {
  const [shots, setShots] = useState<ReadonlyArray<Shot>>([])
  useEffect(() => {
    void fetch(`${SHOTS}/captions.json`)
      .then((answer) => answer.json())
      .then(setShots)
  }, [])
  const section = (round: 'two' | 'one', title: string, note: string) => (
    <>
      <header style={{ display: 'grid', gap: 6, marginTop: 24 }}>
        <Heading level={2} style={{ margin: 0, fontSize: 20 }}>
          {title}
        </Heading>
        <p style={{ margin: 0, maxWidth: 820, color: 'var(--t-2)' }}>{note}</p>
      </header>
      {DIRECTIONS.filter((one) => one.round === round).map(direction)}
    </>
  )
  const direction = (one: (typeof DIRECTIONS)[number]) => {
    const letter = one.key === 'today' ? 'T' : one.key.toUpperCase()
    return (
      <section key={one.key} style={{ display: 'grid', gap: 10 }}>
        <Heading level={3} style={{ margin: 0, fontSize: 16 }}>
          {one.title}
        </Heading>
        <p style={{ margin: 0, maxWidth: 820, color: 'var(--t-2)' }}>{one.what}</p>
        <div>
          <LinkButton onClick={() => window.location.assign(`./${one.key}.html`)}>Open it live</LinkButton>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 16 }}>
          {shots
            .filter((shot) => shot.id.startsWith(letter))
            .map((shot) => (
              <figure key={shot.file} style={{ margin: 0, display: 'grid', gap: 6 }}>
                <a href={`${SHOTS}/${shot.file}`} target="_blank" rel="noreferrer">
                  <img
                    src={`${SHOTS}/${shot.file}`}
                    alt={shot.caption}
                    style={{ width: '100%', borderRadius: 8, boxShadow: 'inset 0 0 0 1px var(--line-2), var(--lift)' }}
                  />
                </a>
                <figcaption style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--t-2)' }}>
                  <b style={{ color: 'var(--t-1)' }}>{shot.id}</b> {shot.caption}
                </figcaption>
              </figure>
            ))}
        </div>
      </section>
    )
  }
  return (
    <div style={{ padding: '32px 40px 80px', display: 'grid', gap: 28, maxWidth: 1360, margin: '0 auto' }}>
      <header style={{ display: 'grid', gap: 8 }}>
        <Heading level={1} style={{ margin: 0, fontSize: 26 }}>
          App settings that have room to grow
        </Heading>
        <p style={{ margin: 0, maxWidth: 820, color: 'var(--t-2)' }}>
          Each is the real app on a fake runtime: this Mac (36 GB, 12 cores) with Claude Code, Codex signed out, and OpenCode not
          downloaded; GitHub and Linear connected. The settings are the app’s own, live. From F on, the gear and ⌘, are on every screen, not
          only the home. Click a shot to see it full size.
        </p>
      </header>
      {direction(DIRECTIONS[0] as (typeof DIRECTIONS)[number])}
      {section(
        'two',
        'Second round: a quick panel, and the rest on a page',
        'What you asked for after the first round: the little panel stays and follows you everywhere, holding only what you change often; everything else is behind All settings.',
      )}
      {section('one', 'First round: five ways to reorganise everything', 'A, B, C, D and E, as first asked.')}
      <section style={{ display: 'grid', gap: 10 }}>
        <Heading level={2} style={{ margin: 0, fontSize: 20 }}>
          Every setting today, and where it goes
        </Heading>
        <p style={{ margin: 0, maxWidth: 820, color: 'var(--t-2)' }}>
          The sections are the same in every direction: A’s window, B’s and E’s page, C’s scroll, D’s tabs, and the page behind All settings
          in F to I. A project’s own settings (name and colour, repositories, rules, resolving conflicts, moving issues, notes, removing it)
          stay in the project; search finds them and says so.
        </p>
        <table style={{ borderCollapse: 'collapse', fontSize: 12.5, maxWidth: 1100 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--t-3)' }}>
              <th style={{ padding: '0 12px 6px 0' }}>Setting</th>
              <th style={{ padding: '0 12px 6px 0' }}>Today</th>
              <th style={{ padding: '0 12px 6px 0' }}>Its section, every direction</th>
              <th style={{ padding: '0 12px 6px 0' }}>In the quick panel (F to I)</th>
            </tr>
          </thead>
          <tbody>
            {SETTINGS.map(([name, today, home, quick]) => (
              <tr key={name}>
                <td style={{ ...td, color: 'var(--t-1)', fontWeight: 500 }}>{name}</td>
                <td style={td}>{today}</td>
                <td style={td}>{home}</td>
                <td style={td}>{quick}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

const root = document.getElementById('root')
if (root !== null) createRoot(root).render(<Compare />)
