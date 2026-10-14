// Scrappy: every direction in order, A to E after today's, each with its live pages and its screenshots.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '../../src/styles/global.css'

import { createRoot } from 'react-dom/client'

import { Heading } from '../../src/primitives/Heading/Heading'
import { LinkButton } from '../../src/primitives/LinkButton/LinkButton'
import shots from './shots.json'

// The screenshots shoot.mjs took, in the task's scratch folder, by their id.
const taken = import.meta.glob<string>('../../../../.althar/scratch/many-runs/shots/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
})
const pictureOf = (id: string) => Object.entries(taken).find(([path]) => path.endsWith(`/${id}.png`))?.[1]

const STATES: ReadonlyArray<[string, string]> = [
  ['Project, several running', '?s=busy'],
  ['Task, several running', '?s=busy#/threads/th1'],
  ['Many, none running', '?s=many'],
  ['One', '?s=one'],
  ['Nothing known yet', '?s=empty'],
]

const DIRECTIONS = [
  {
    key: 'today',
    shot: 'T',
    title: 'Today · one Run button',
    what: 'The project’s front has one quiet “Run bun run dev”, worked out from package.json; a task has it in its ⋯ menu. What runs shows only in the Running pill over the composer.',
  },
  {
    key: 'a',
    shot: 'A',
    title: 'A · A split button',
    what: 'Today’s button becomes a split button: the main half runs the default (and, while it runs, says where it answers and opens it); the chevron lists everything, the running ones on top and checked, each one’s last ending, then Add… and Edit the list… Adding, editing and the list are dialogs, shared with C and E.',
  },
  {
    key: 'b',
    shot: 'B',
    title: 'B · A Runs panel, made like Settings',
    what: 'Beside today’s button for the default, “N running ⌄” opens a panel built from the app’s own Settings panel: every runnable a round switch, its state under it. One opens out to its command, where it runs, where it came from, and its live output, with Edit, Open and Remove. Adding opens out in place. From the project it also says what runs in tasks.',
  },
  {
    key: 'c',
    shot: 'C',
    title: 'C · Chips in the bar',
    what: 'Each runnable is a chip in the front’s bar (fewer in a task’s bar): press one to run it; a running one is raised with its port, and opens to Open, Edit and Stop. A failed one is red. The rest wait under “N more”, with the ways to add and Edit the list.',
  },
  {
    key: 'd',
    shot: 'D',
    title: 'D · A launcher on ⌘R, the list in project settings',
    what: '“Run Pitch site ⌘R” stays as today’s button, and ⌘R runs the default from anywhere. ⇧⌘R opens the app’s own ⌘K finder over what runs (to stop), what is kept (to run), all 89 package.json scripts (to run once), and the coordinator. The list is kept in the project’s Settings, as a “What it runs” module.',
  },
  {
    key: 'e',
    shot: 'E',
    title: 'E · A Runs dock, with output',
    what: '“Runs” opens a dock beside the board and conversation, or the task’s thread: the thread’s own run cards for what runs or ran here, the output of one (picked by name, a failed one dotted), the rest to run, and what runs in tasks. Add, Ask the coordinator and Edit the list at its foot.',
  },
]

function Compare() {
  return (
    <div style={{ padding: '32px 40px 80px', display: 'grid', gap: 56, maxWidth: 1440, margin: '0 auto' }}>
      <header style={{ display: 'grid', gap: 8 }}>
        <Heading level={1}>Many things to run, not one Run</Heading>
        <p style={{ margin: 0, maxWidth: 820 }}>
          Five ways to show that a project runs many things (the pitch site, Storybook, the desktop app, the public site, the UI tests, the
          desktop end-to-end tests, a one-off probe), run any of them, see what runs, and add or remove them. Each is the real app on a fake
          runtime, with this repository’s real scripts and ports; only the Run button changed. Under each page, a strip switches between
          nothing known yet, one, many, and several running, and between the project and a task.
        </p>
      </header>
      {DIRECTIONS.map((direction) => {
        const mine = shots.filter((shot) => shot.id.replace(/\d+$/, '') === direction.shot)
        return (
          <section key={direction.key} style={{ display: 'grid', gap: 12 }}>
            <Heading level={2}>{direction.title}</Heading>
            <p style={{ margin: 0, maxWidth: 860 }}>{direction.what}</p>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {STATES.map(([name, at]) => (
                <LinkButton key={name} onClick={() => window.location.assign(`./${direction.key}.html${at}`)}>
                  {name}
                </LinkButton>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 20, marginTop: 8 }}>
              {mine.map((shot) => {
                const picture = pictureOf(shot.id)
                return (
                  <figure key={shot.id} style={{ margin: 0, display: 'grid', gap: 6, alignContent: 'start' }}>
                    {picture === undefined ? (
                      <span>{shot.id}: not taken yet (node shoot.mjs)</span>
                    ) : (
                      <a href={picture} target="_blank" rel="noreferrer">
                        <img
                          src={picture}
                          alt={shot.caption}
                          style={{ width: '100%', display: 'block', border: '1px solid var(--line)', borderRadius: 8 }}
                        />
                      </a>
                    )}
                    <figcaption style={{ fontSize: 12.5, lineHeight: 1.45 }}>
                      <strong>{shot.id}</strong> {shot.caption}
                    </figcaption>
                  </figure>
                )
              })}
            </div>
          </section>
        )
      })}
      <section style={{ display: 'grid', gap: 12 }}>
        <Heading level={2}>Which I’d pick</Heading>
        <p style={{ margin: 0, maxWidth: 860 }}>
          B’s panel, opened from A’s split button. The split keeps one control in the bar, and the default one press away, as light as today
          with one runnable. Its chevron opens B’s panel rather than a menu: the panel is made like Settings, so it reads as the app’s own;
          each switch shows its state at a glance, several running at once; one opens out to its output; adding and editing happen in place;
          and from the project it says what runs in tasks. Take D’s ⌘R for the default as well. C showcases the many best, but runs out of
          room past four, and sooner in a task’s bar; D hides what runs; E is the richest but takes a third column the board’s dock already
          wants.
        </p>
      </section>
    </div>
  )
}

const root = document.getElementById('root')
if (root !== null) createRoot(root).render(<Compare />)
