// Scrappy: every direction in order, each live in its own window-sized frame.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '../../styles/global.css'

import { createRoot } from 'react-dom/client'

import { Heading } from '../../primitives/Heading/Heading'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'

const STATES: ReadonlyArray<[string, string]> = [
  ['Home', '#/'],
  ['Board', '#/projects/p1?room=board'],
  ['Conversation', '#/projects/p1?room=talk'],
  ['Task', '#/threads/th1'],
]

const DIRECTIONS = [
  {
    key: 'a',
    title: 'A · One gear in the window bar, everywhere',
    what: 'The gear at the bar’s far end is always the app’s, on every tab. A project’s settings open from its name and mark in the bar, “meridian ⌄”, before its views, on its board, its conversation and its tasks. The front page has no settings button.',
    keys: '⌘, opens the app’s settings on every tab, project tabs included.',
  },
  {
    key: 'b',
    title: 'B · One gear, one panel',
    what: 'One gear on every tab. On a project’s tab it opens one panel with a switch at its top: the project (by name) or Althar. On the home it opens straight on Althar, with no switch.',
    keys: '⌘, opens the same panel on Althar; the gear opens it on the project.',
  },
  {
    key: 'c',
    title: 'C · Project settings as a view',
    what: 'A project’s settings are a view of their own after Conversation, Board and Both, filling the page under the project’s front. The gear in the bar is always the app’s.',
    keys: '⌘, opens the app’s settings on every tab; the project’s settings are a view, picked like the board.',
  },
  {
    key: 'd',
    title: 'D · An Althar menu',
    what: 'An “Althar ⌄” menu at the bar’s end on every tab, with no gear: which agents are signed in, how many agents work at once (chosen in place), and Settings… A project keeps its own button on its front page, now “Project settings” with a folder, not a gear.',
    keys: '⌘, opens the app’s settings on every tab, as the menu’s Settings… does.',
  },
]

function Compare() {
  return (
    <div style={{ padding: '32px 40px 80px', display: 'grid', gap: 64, maxWidth: 1360, margin: '0 auto' }}>
      <header style={{ display: 'grid', gap: 8 }}>
        <Heading level={1}>App settings always at hand</Heading>
        <p style={{ margin: 0, maxWidth: 760 }}>
          Four ways for Althar’s two settings to live side by side, each the real app on a fake runtime. Each frame is live: switch tabs,
          open the panels, press ⌘, (click into the frame first).
        </p>
      </header>
      {DIRECTIONS.map((direction) => (
        <section key={direction.key} style={{ display: 'grid', gap: 12 }}>
          <Heading level={2}>{direction.title}</Heading>
          <p style={{ margin: 0, maxWidth: 820 }}>{direction.what}</p>
          <p style={{ margin: 0, maxWidth: 820 }}>{direction.keys}</p>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <LinkButton onClick={() => window.location.assign(`./${direction.key}.html`)}>Open on its own page</LinkButton>
            {STATES.map(([name, hash]) => (
              <LinkButton key={name} onClick={() => window.location.assign(`./${direction.key}.html${hash}`)}>
                {name}
              </LinkButton>
            ))}
          </div>
          <iframe
            title={direction.title}
            src={`./${direction.key}.html`}
            style={{ width: 1280, height: 800, border: '1px solid var(--line, rgba(0,0,0,.1))', borderRadius: 10, maxWidth: '100%' }}
          />
        </section>
      ))}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Compare />)
