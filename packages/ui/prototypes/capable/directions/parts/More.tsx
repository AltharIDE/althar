// Scrappy, sketches: what the 6 Nov decisions need beyond the four surfaces, one state each, on the real screens. A small change on the fast lane; the first time someone already using Althar sees allow everything and their own servers; what agents did while the person was away; a server that fails in a task; a lead that starts several tasks at once.
import { useState } from 'react'

import { Brand } from '../../../../src/foundations/brands/brands'
import { Icon } from '../../../../src/foundations/Icon/Icon'
import { ToolKind, ToolState } from '../../../../src/foundations/vocabulary'
import { Button } from '../../../../src/primitives/Button/Button'
import { LinkButton } from '../../../../src/primitives/LinkButton/LinkButton'
import { LiveDot } from '../../../../src/primitives/LiveDot/LiveDot'
import { AltharLine } from '../../../../src/thread/AltharLine/AltharLine'
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

/** A call to the person's server that failed because the lead's agent isn't signed in: the call as it ran, and Althar's line on what is the person's, with Sign in. Once signed in, the lead makes the call again. */
export function ServerFails() {
  const [fixed, setFixed] = useState(false)
  const linear = <ServerName server={{ name: 'Linear', brand: Brand.Linear }} />
  return (
    <>
      <Tool
        kind={ToolKind.Comment}
        verb={fixed ? 'Moved' : 'Move'}
        target="DEV-188 to In Review"
        state={fixed ? ToolState.Done : ToolState.Failed}
        meta={linear}
      />
      {!fixed && (
        <AltharLine tone="warning" className={s.server}>
          Claude Code isn’t signed in to Linear, so DEV-188 wasn’t moved. <LinkButton onClick={() => setFixed(true)}>Sign in</LinkButton>
        </AltharLine>
      )}
    </>
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
