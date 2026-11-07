// Scrappy, sketches: what the 6 Nov decisions need beyond the four surfaces, one state each, on the real screens. A small change on the fast lane; the first time someone already using Althar sees allow everything and their own servers; what agents did while the person was away; a server that fails in a task; a lead that starts several tasks at once.
import { useState } from 'react'

import { Brand } from '../../../../src/foundations/brands/brands'
import { Icon, type IconName } from '../../../../src/foundations/Icon/Icon'
import { BrandMark } from '../../../../src/foundations/Marks/Marks'
import { ToolKind, ToolState } from '../../../../src/foundations/vocabulary'
import { Button } from '../../../../src/primitives/Button/Button'
import { IconButton } from '../../../../src/primitives/IconButton/IconButton'
import { LinkButton } from '../../../../src/primitives/LinkButton/LinkButton'
import { LiveDot } from '../../../../src/primitives/LiveDot/LiveDot'
import { Tool } from '../../../../src/thread/Tool/Tool'
import { ServerName } from '../tools/Calls'
import s from './more.module.css'

/** A small change, from the person's words to merged: what it skipped, and each step with its time. */
export function FastLane() {
  const steps: ReadonlyArray<readonly [string, string, boolean]> = [
    ['Started', '14:02', true],
    ['Changed 1 line in RunMenu.tsx', '14:03', true],
    ['Checks pass', '14:05', true],
    ['Merged', '', false],
  ]
  const [merged, setMerged] = useState(false)
  return (
    <div className={s.card}>
      <p className={s.head}>
        <Icon name="after" size={13} />
        <span>
          <strong>Small change</strong> · Sonnet 5.5, no plan, reviewed after it merges
        </span>
        <LinkButton className={s.aside}>Make it a full task</LinkButton>
      </p>
      <ol className={s.steps}>
        {steps.map(([what, when, done]) => {
          const isDone = done || merged
          return (
            <li key={what} data-done={isDone || undefined}>
              <span className={s.dot}>{isDone && <Icon name="check" size={9} />}</span>
              <span className={s.stepWhat}>{what}</span>
              <span className={s.when}>{what === 'Merged' && merged ? '14:06' : when}</span>
            </li>
          )
        })}
      </ol>
      {!merged && (
        <div className={s.acts}>
          <Button size="small" variant="signal" onClick={() => setMerged(true)}>
            Merge
          </Button>
        </div>
      )}
    </div>
  )
}

/** The first time after the change: what is different, each line with where to change it, and a project the person had set to ask stays so. */
export function CapableNow() {
  const [gone, setGone] = useState(false)
  if (gone) return null
  const to = (hash: string) => () => window.location.assign(hash)
  return (
    <div className={s.card} data-tone="signal">
      <p className={s.head}>
        <span className={s.title}>Agents can do more now</span>
        <IconButton icon="close" label="Close" size="small" tooltipAlign="end" className={s.close} onClick={() => setGone(true)} />
      </p>
      <ul className={s.lines}>
        <li>
          <span>
            They go ahead without asking. Only what can’t be undone asks: lost work, publishing and merging, speaking for you, secrets.
          </span>
          <LinkButton onClick={to('#/projects/p1?room=settings&section=rules')}>What asks</LinkButton>
        </li>
        <li>
          <span>
            Your <strong>7 MCP servers</strong> and <strong>9 skills</strong> load in every role.
          </span>
          <LinkButton onClick={to('#/settings/mcp')}>Choose which</LinkButton>
        </li>
        <li>
          <span>Leads can start tasks. Each shows under the task that started it.</span>
        </li>
        <li>
          <span>
            <strong>site</strong> still asks first, as you set it.
          </span>
          <LinkButton onClick={to('#/projects/p2?room=settings&section=rules')}>Change</LinkButton>
        </li>
      </ul>
    </div>
  )
}

interface Done {
  readonly id: string
  readonly icon: IconName | Brand
  readonly what: string
  readonly task: string
  readonly when: string
  /** How to take it back, where it can be. */
  readonly undo?: string
}

const DONE: ReadonlyArray<Done> = [
  { id: 'merge', icon: 'pr', what: 'Merged #635 into main', task: 'Runs stay in the pill', when: '13:10', undo: 'Revert it' },
  {
    id: 'post',
    icon: Brand.GitHub,
    what: 'Posted a review on dana’s #612',
    task: 'Design review of #612',
    when: '12:52',
    undo: 'Delete it',
  },
  { id: 'move', icon: Brand.Linear, what: 'Moved DEV-188 to In Review', task: 'Design review of #612', when: '12:52', undo: 'Undo' },
  { id: 'start', icon: 'create', what: 'Started “Codex leads reach the network”', task: 'ADR: agents work as yours', when: '12:40' },
  { id: 'set', icon: 'gear', what: 'Turned on worktrees for new tasks', task: 'The coordinator', when: '11:58', undo: 'Undo' },
]
const isBrand = (icon: Done['icon']): icon is Brand => (Object.values(Brand) as string[]).includes(icon)

/** What agents did outside their worktrees since the person last looked, across the project, with Undo where it can be. */
export function WhileAway() {
  const [undone, setUndone] = useState<ReadonlyArray<string>>([])
  return (
    <div className={s.card}>
      <p className={s.title}>
        While you were away <span className={s.count}>since 11:40</span>
      </p>
      <ul className={s.done}>
        {DONE.map((one) => (
          <li key={one.id} data-undone={undone.includes(one.id) || undefined}>
            <span className={s.glyph}>
              {isBrand(one.icon) ? <BrandMark brand={one.icon} size={12} /> : <Icon name={one.icon} size={13} />}
            </span>
            <span className={s.doneWhat}>{one.what}</span>
            <span className={s.doneTask}>{one.task}</span>
            <span className={s.when}>{one.when}</span>
            {one.undo !== undefined &&
              (undone.includes(one.id) ? (
                <span className={s.undone}>Undone</span>
              ) : (
                <LinkButton className={s.undo} onClick={() => setUndone((now) => [...now, one.id])}>
                  {one.undo}
                </LinkButton>
              ))}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A call to the person's server that failed because the lead's agent isn't signed in: the call, in red, and the fix under it. Once signed in, the lead tries it again. */
export function ServerFails() {
  const [fixed, setFixed] = useState(false)
  const linear = <ServerName server={{ name: 'Linear', brand: Brand.Linear }} />
  return (
    <div className={s.call} data-failed={!fixed || undefined}>
      <Tool
        kind={ToolKind.Comment}
        verb={fixed ? 'Moved' : 'Move'}
        target="DEV-188 to In Review"
        state={fixed ? ToolState.Done : ToolState.Failed}
        meta={linear}
      />
      {!fixed && (
        <p className={s.fix}>
          <span>Claude Code isn’t signed in to Linear.</span>
          <Button size="small" onClick={() => setFixed(true)}>
            Sign in
          </Button>
        </p>
      )}
    </div>
  )
}

interface Started {
  readonly id: string
  readonly title: string
  readonly model: string
  /** Where it stands: running, planning, or waiting on another. */
  readonly stands: string
  readonly live?: boolean
}

const STARTED: ReadonlyArray<Started> = [
  { id: 'net', title: 'Codex leads reach the network in their shell', model: 'Sonnet 5.5', stands: 'Running · 3m', live: true },
  { id: '013', title: 'ADR-013: leads start tasks', model: 'Opus 5.5', stands: 'Planning', live: true },
  { id: '088', title: 'ADR-088: the coordinator directs leads', model: 'Opus 5.5', stands: 'Planning', live: true },
  { id: 'judge', title: 'Drop the judge from allow everything', model: 'Sonnet 5.5', stands: 'After ADR-013 merges' },
]

/** A lead that started several tasks from the person's words: one call, each task a row that opens it, and Stop on the one not wanted. */
export function Batch() {
  const [stopped, setStopped] = useState<ReadonlyArray<string>>([])
  const toggle = (id: string) => setStopped((now) => (now.includes(id) ? now.filter((one) => one !== id) : [...now, id]))
  return (
    <div className={s.started}>
      <p className={s.startedHead}>
        <Icon name="create" size={13} />
        <span>
          <strong>{`Started ${STARTED.length} tasks`}</strong> from your “split it by ADR”
        </span>
      </p>
      <ul className={s.startedList}>
        {STARTED.map((one) => {
          const off = stopped.includes(one.id)
          return (
            <li key={one.id} data-off={off || undefined}>
              <button type="button" className={s.startedOpen} onClick={() => window.location.assign('#/threads/th-codex-net')}>
                <span className={s.startedDot}>{one.live && !off ? <LiveDot ping /> : <span className={s.restDot} />}</span>
                <span className={s.startedTitle}>{one.title}</span>
                <span className={s.startedModel}>{one.model}</span>
                <span className={s.startedStands}>{off ? 'Stopped' : one.stands}</span>
              </button>
              <LinkButton className={s.startedStop} onClick={() => toggle(one.id)}>
                {off ? 'Start again' : 'Stop'}
              </LinkButton>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
