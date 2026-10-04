import { useEffect, useState } from 'react'

import { MERIDIAN, PROJECTS } from '../fixtures/chrome'
import { OPUS } from '../fixtures/models'
import { ProjectSwitcher } from '../chrome/ProjectSwitcher/ProjectSwitcher'
import { RoomSwitch } from '../chrome/RoomSwitch/RoomSwitch'
import { TitleBar } from '../chrome/TitleBar/TitleBar'
import { WorkStatus } from '../chrome/WorkStatus/WorkStatus'
import { Composer } from '../composer/Composer/Composer'
import { Listening } from '../composer/Listening/Listening'
import { Running } from '../composer/Running/Running'
import { Brand } from '../foundations/brands/brands'
import { Icon, type IconName } from '../foundations/Icon/Icon'
import { Logo } from '../foundations/Logo/Logo'
import { Room, ToolKind, ToolState } from '../foundations/vocabulary'
import { Delta } from '../primitives/FileChanges/FileChanges'
import { Tool } from '../thread/Tool/Tool'
import { Prose, Turn } from '../thread/Turn/Turn'
import { You } from '../thread/You/You'
import s from './Introduction.module.css'

/*
 * The landing page's parts: the name, a few components working together,
 * and the sections, each with how many components it holds. The counts come
 * from Storybook's own index, so they stay true; without it, they are left out.
 */

interface Section {
  title: string
  icon: IconName
  about: string
  /** The story a section's card opens. */
  story: string
}

const SECTIONS: Section[] = [
  {
    title: 'Foundations',
    icon: 'square',
    about: 'Tokens, icons, the marks of labs and sources, the logo, how a model is named.',
    story: 'foundations-logo--mark',
  },
  {
    title: 'Primitives',
    icon: 'list',
    about: 'Buttons, menus, popovers, folds: the small parts the rest is made of.',
    story: 'primitives-button--default',
  },
  {
    title: 'Chrome',
    icon: 'folder',
    about: 'The window’s bar: which project, the rooms, what needs you, the way back from a task.',
    story: 'chrome-titlebar--project-window',
  },
  {
    title: 'Thread',
    icon: 'answer',
    about: 'What a conversation holds, from a turn and its tool calls to reviews and permissions.',
    story: 'thread-thread--conversation',
  },
  {
    title: 'Coordinator',
    icon: 'agents',
    about: 'The cards for issues and tasks, launching a task, and a project’s rules.',
    story: 'coordinator-tasklaunch--about-to-start',
  },
  {
    title: 'Board',
    icon: 'work',
    about: 'Every task in the project by where it stands: next, running, yours, settled.',
    story: 'board-board--default',
  },
  {
    title: 'Dock',
    icon: 'pin',
    about: 'What opens beside the board: a call to make, a change to accept, a task at a glance.',
    story: 'dock-dock--call',
  },
  {
    title: 'Outputs',
    icon: 'pr',
    about: 'What a task hands back: the change across its repositories, with checks, and the files it made.',
    story: 'outputs-changeset--ready',
  },
  {
    title: 'Setup',
    icon: 'plug',
    about: 'Before a project: the agents on this machine, and making a project from its repositories.',
    story: 'screens-start--first-run',
  },
  {
    title: 'Onboarding',
    icon: 'pencil',
    about: 'The welcome, shown once after install: the real components on a drafting table, set working.',
    story: 'screens-welcome--opening',
  },
  {
    title: 'Composer',
    icon: 'pencil',
    about: 'The field you write in, the model picker, context, and what floats above it.',
    story: 'composer-composer--listening-and-running',
  },
]

/* the manager's address for a story, from inside the preview frame */
const href = (story: string) => `./?path=/story/${story}`

function useCounts() {
  const [counts, setCounts] = useState<Record<string, number>>({})
  useEffect(() => {
    let live = true
    fetch('./index.json')
      .then((r) => r.json() as Promise<{ entries: Record<string, { type: string; title: string }> }>)
      .then(({ entries }) => {
        const titles = new Set(
          Object.values(entries)
            .filter((e) => e.type === 'story')
            .map((e) => e.title),
        )
        const next: Record<string, number> = {}
        for (const t of titles) {
          const top = t.split('/')[0] ?? t
          next[top] = (next[top] ?? 0) + 1
        }
        if (live) setCounts(next)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])
  return counts
}

export function Hero() {
  return (
    <header className={s.hero}>
      <div className={s.name}>
        <Logo size={46} className={s.logo} />
        <h1 className={s.title}>Althar</h1>
        <span className={s.kit}>ui</span>
      </div>
      <p className={s.lede}>
        The components Althar’s desktop app is built from. Each renders what it is given and reports what happened, so every one of them
        runs here on its own, with fixtures.
      </p>
    </header>
  )
}

export function Specimen() {
  const [value, setValue] = useState('')
  const [room, setRoom] = useState(Room.Talk)
  return (
    <figure className={s.specimen}>
      <TitleBar lights="drawn" className={s.bar} end={<WorkStatus running={3} yours={1} onYours={() => setRoom(Room.Board)} />}>
        <ProjectSwitcher current={MERIDIAN} projects={PROJECTS} onPick={() => {}} />
        <span className={s.rooms}>
          <RoomSwitch value={room} onChange={setRoom} yours={1} />
        </span>
      </TitleBar>
      <div className={s.thread}>
        <You>Rate-limit refunds per partner, the way charges are.</You>
        <Turn model={OPUS}>
          <Prose>The limiter already lives in charges; refunds can share its bucket.</Prose>
          <div className={s.tools}>
            <Tool kind={ToolKind.Read} verb="Read" target="src/charges/limit.ts" />
            <Tool kind={ToolKind.Edit} verb="Edited" target="src/refunds/router.ts" meta={<Delta add={6} del={1} />} />
            <Tool kind={ToolKind.Run} verb="Running" target="pnpm test refunds" state={ToolState.Running} />
          </div>
        </Turn>
      </div>
      <div className={s.composer}>
        <Composer
          value={value}
          onChange={setValue}
          onSubmit={() => setValue('')}
          placeholder="Tell the lead"
          busy
          onStopAgent={() => {}}
          above={
            <>
              <Listening sources={[{ id: 'pr', mark: Brand.GitHub, label: 'PR 1206', what: 'review comments and checks' }]} />
              <Running processes={[{ id: 'dev', command: 'bun dev', url: 'localhost:5173', since: '12m' }]} />
            </>
          }
        />
      </div>
      <figcaption className={s.caption}>
        TitleBar, ProjectSwitcher, RoomSwitch, WorkStatus, You, Turn, Tool, Composer, Listening and Running, live.
      </figcaption>
    </figure>
  )
}

export function Sections() {
  const counts = useCounts()
  return (
    <nav aria-label="Sections" className={s.sections}>
      {SECTIONS.map((x) => (
        <a key={x.title} className={s.section} href={href(x.story)} target="_top">
          <span className={s.sectionHead}>
            <Icon name={x.icon} size={14} className={s.sectionIcon} />
            <span className={s.sectionTitle}>{x.title}</span>
            {counts[x.title] != null && <span className={s.count}>{counts[x.title]}</span>}
            <Icon name="arrow" size={12} className={s.go} />
          </span>
          <span className={s.about}>{x.about}</span>
        </a>
      ))}
    </nav>
  )
}

export function Notes() {
  return (
    <div className={s.notes}>
      <section className={s.note}>
        <h2 className={s.noteTitle}>Reading a component</h2>
        <ul className={s.noteList}>
          <li>
            The first stories are its common states. Every page ends with <b>All states</b>: each state side by side, with hover, focus and
            pressed forced so they show without a pointer.
          </li>
          <li>
            Stories named for an action, like <i>Opening</i> or <i>Choosing another</i>, play it when they open. That play is also the test.
            Stories named for a state stay in it.
          </li>
          <li>
            The <b>Accessibility</b> panel checks each story; <b>Controls</b> changes its props.
          </li>
        </ul>
      </section>
      <section className={s.note}>
        <h2 className={s.noteTitle}>Using it</h2>
        <pre className={s.code}>
          <code>{`import '@althar/ui/styles.css'\nimport { Composer } from '@althar/ui'\n\n<div className="ch-root">…</div>`}</code>
        </pre>
        <p className={s.noteText}>
          Components take their words through a <code>text</code> prop with English defaults, and their data already resolved: a model, not
          a model id. <b>Principles</b>, next in the sidebar, is how the team designs; ARCHITECTURE.md in the package holds the engineering
          rules.
        </p>
      </section>
    </div>
  )
}
