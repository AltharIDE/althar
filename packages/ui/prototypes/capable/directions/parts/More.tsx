// Scrappy, sketches: what the 6 Nov decisions need beyond the four surfaces, one state each, on the real screens. A small change on the fast lane; the first time someone already using Althar sees allow everything and their own servers; what agents did while the person was away; a server that fails in a task; a lead that starts several tasks at once.
import { useState } from 'react'

import { Brand } from '../../../../src/foundations/brands/brands'
import { Icon, type IconName } from '../../../../src/foundations/Icon/Icon'
import { BrandMark } from '../../../../src/foundations/Marks/Marks'
import { Button } from '../../../../src/primitives/Button/Button'
import { LinkButton } from '../../../../src/primitives/LinkButton/LinkButton'
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

/** The first time a project opens after the change: what is different, and the one way back. */
export function CapableNow() {
  const [gone, setGone] = useState(false)
  if (gone) return null
  return (
    <div className={s.card} data-tone="signal">
      <p className={s.title}>Agents now go ahead without asking</p>
      <ul className={s.list}>
        <li>
          In <strong>althar</strong> and <strong>site</strong>. Only what can’t be undone still asks: lost work, publishing and merging,
          speaking for you, secrets.
        </li>
        <li>
          Your <strong>7 MCP servers</strong> and <strong>9 skills</strong> load in every role, from Claude Code, Codex and OpenCode.
        </li>
        <li>Leads can start tasks of their own. You see each under the task that started it.</li>
      </ul>
      <div className={s.acts}>
        <Button size="small" onClick={() => setGone(true)}>
          Got it
        </Button>
        <Button size="small" variant="quiet" onClick={() => window.location.assign('#/projects/p1?room=settings&section=rules')}>
          What still asks
        </Button>
        <Button size="small" variant="quiet" onClick={() => window.location.assign('#/settings/mcp')}>
          Servers and skills
        </Button>
        <LinkButton className={s.aside}>Ask as before in althar</LinkButton>
      </div>
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

/** A server the lead reached for and couldn't use, and the one click that lets it go on. */
export function ServerFails() {
  const [fixed, setFixed] = useState(false)
  return (
    <div className={s.card} data-tone={fixed ? undefined : 'warn'}>
      <p className={s.head}>
        <BrandMark brand={Brand.Linear} size={13} />
        <span>
          {fixed ? (
            <>
              <strong>linear</strong> is signed in again. The lead went on.
            </>
          ) : (
            <>
              <strong>linear</strong> is signed out in Codex, so the lead couldn’t move DEV-188.
            </>
          )}
        </span>
      </p>
      {!fixed && (
        <div className={s.acts}>
          <Button size="small" variant="signal" onClick={() => setFixed(true)}>
            Sign in to Codex
          </Button>
          <Button size="small" variant="quiet">
            Go on without it
          </Button>
          <span className={s.note}>The lead waits for one of these, and goes on with the rest meanwhile.</span>
        </div>
      )}
    </div>
  )
}

/** A lead starting several tasks at once, from the person's words: one card, a hold for all, each to open. */
export function Batch() {
  const [held, setHeld] = useState(false)
  const tasks = [
    ['Codex leads reach the network in their shell', 'Sonnet 5.5', 'Started'],
    ['ADR-013: leads start tasks', 'Opus 5.5', held ? 'Held' : 'In 18s'],
    ['ADR-088: the coordinator directs leads', 'Opus 5.5', held ? 'Held' : 'In 18s'],
    ['Drop the judge from allow everything', 'Sonnet 5.5', held ? 'Held' : 'In 18s'],
  ] as const
  return (
    <div className={s.card}>
      <p className={s.head}>
        <Icon name="create" size={13} />
        <span>
          <strong>Starting 4 tasks</strong> from your “split it by ADR”
        </span>
      </p>
      <ul className={s.batch}>
        {tasks.map(([title, model, when]) => (
          <li key={title} data-started={when === 'Started' || undefined}>
            <span className={s.doneWhat}>{title}</span>
            <span className={s.doneTask}>{model}</span>
            <span className={s.when}>{when}</span>
          </li>
        ))}
      </ul>
      <div className={s.acts}>
        <Button size="small" variant={held ? 'signal' : 'default'} onClick={() => setHeld(!held)}>
          {held ? 'Start them' : 'Hold the rest'}
        </Button>
        <Button size="small" variant="quiet">
          Change one
        </Button>
      </div>
    </div>
  )
}
