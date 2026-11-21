import { useEffect, useState } from 'react'

import type { ComputerDecision, ComputerState } from '@althar/runtime/computerBridge'
import { Button } from '@althar/ui'

import { useServices, type Host } from '../../data/services'
import s from './ComputerUse.module.css'

type ComputerHost = NonNullable<Host['computer']>
type Answer = NonNullable<ComputerState['request']>

function ComputerRequest({ request, answer }: { readonly request: Answer; readonly answer: (decision: ComputerDecision) => void }) {
  const [selected, setSelected] = useState<ReadonlyArray<string>>([])
  const [foreground, setForeground] = useState(false)
  const [desktop, setDesktop] = useState(false)
  const toggle = (id: string, checked: boolean) => setSelected((old) => (checked ? [...old, id] : old.filter((one) => one !== id)))
  return (
    <>
      <p className={s.reason}>{request.reason}</p>
      {(request.windows.length > 0 || request.apps.length > 0) && (
        <fieldset className={s.choices}>
          <legend>Apps and windows</legend>
          {request.windows.map((one) => (
            <label key={one.id}>
              <input
                type="checkbox"
                checked={selected.includes(one.id)}
                onChange={(event) => toggle(one.id, event.currentTarget.checked)}
              />
              <span>
                <strong>{one.app}</strong> {one.title}
              </span>
            </label>
          ))}
          {request.apps.map((one) => (
            <label key={one.id}>
              <input
                type="checkbox"
                checked={selected.includes(one.id)}
                onChange={(event) => toggle(one.id, event.currentTarget.checked)}
              />
              <span>Open {one.app}</span>
            </label>
          ))}
        </fieldset>
      )}
      {request.desktop && (
        <fieldset className={s.choices}>
          <legend>Desktop access</legend>
          <label>
            <input type="checkbox" checked={foreground} onChange={(event) => setForeground(event.currentTarget.checked)} />
            <span>Allow foreground input in the selected windows</span>
          </label>
          {request.primaryDisplay ? (
            <label>
              <input type="checkbox" checked={desktop} onChange={(event) => setDesktop(event.currentTarget.checked)} />
              <span>Share and control the primary display. Other open apps may be visible to the task.</span>
            </label>
          ) : (
            <p className={s.reason}>Primary display sharing on Linux requires one connected display.</p>
          )}
        </fieldset>
      )}
      {request.windows.length === 0 && request.apps.length === 0 && !request.desktop && (
        <p className={s.reason}>Open the app you want to share and ask the task to try again.</p>
      )}
      <div className={s.actions}>
        <Button
          size="small"
          variant="quiet"
          onClick={() => answer({ requestId: request.id, windows: [], desktop: false, foreground: false })}
        >
          Decline
        </Button>
        <Button
          size="small"
          variant="signal"
          disabled={selected.length === 0 && !desktop && !foreground}
          onClick={() => answer({ requestId: request.id, windows: selected, desktop, foreground })}
        >
          Allow for this turn
        </Button>
      </div>
    </>
  )
}

function ComputerControls({ taskId, computer }: { readonly taskId: string; readonly computer: ComputerHost }) {
  const [state, setState] = useState<ComputerState | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let here = true
    let received = false
    const stop = computer.subscribe((next) => {
      if (next.taskId !== taskId) return
      received = true
      setState(next)
      setPending(null)
    })
    void computer.states().then(
      (states) => {
        if (here && !received) setState(states.find((one) => one.taskId === taskId) ?? null)
      },
      () => undefined,
    )
    return () => {
      here = false
      stop()
    }
  }, [computer, taskId])

  const send = (words: string, command: () => Promise<boolean>, rollback?: () => void) => {
    setPending(words)
    setError(null)
    void command().then(
      (answered) => {
        if (answered) return
        rollback?.()
        setPending(null)
        setError('The computer session changed. Check its current state and try again.')
      },
      () => {
        rollback?.()
        setPending(null)
        setError('Althar could not reach the computer session.')
      },
    )
  }
  if (state === null) return null
  const control = (action: 'pause' | 'resume' | 'stop') => {
    const phase = action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'stopped'
    const { preview: _preview, ...previous } = state
    const optimistic: ComputerState = { ...previous, phase }
    setState(optimistic)
    send(
      action === 'pause' ? 'Taking over…' : action === 'resume' ? 'Resuming…' : 'Stopping…',
      () => computer.control(taskId, action),
      () => setState((current) => (current === optimistic ? state : current)),
    )
  }
  const request = state.request
  return (
    <section className={s.card} aria-label="Computer use">
      <header className={s.header}>
        <strong>Computer use</strong>
        <output>{pending ?? state.action}</output>
      </header>
      {error !== null && (
        <p role="alert" className={s.reason}>
          {error}
        </p>
      )}
      {request !== undefined && pending === null && (
        <ComputerRequest
          key={request.id}
          request={request}
          answer={(decision) => send('Answering computer access…', () => computer.allow(taskId, decision))}
        />
      )}
      {state.preview !== undefined && pending === null && (
        <img
          className={s.preview}
          alt="Latest view from the task’s computer"
          src={`data:${state.preview.picture.mimeType};base64,${state.preview.picture.data}`}
        />
      )}
      {state.phase !== 'stopped' && request === undefined && (
        <div className={s.actions}>
          {state.phase === 'paused' ? (
            <Button size="small" disabled={pending !== null} onClick={() => control('resume')}>
              Resume
            </Button>
          ) : (
            <Button size="small" disabled={pending !== null} onClick={() => control('pause')}>
              Take over
            </Button>
          )}
          <Button size="small" variant="danger" onClick={() => control('stop')}>
            Stop
          </Button>
        </div>
      )}
    </section>
  )
}

export function ComputerUse({ taskId }: { readonly taskId: string }) {
  const { computer } = useServices().host
  return computer === undefined ? null : <ComputerControls key={taskId} taskId={taskId} computer={computer} />
}
