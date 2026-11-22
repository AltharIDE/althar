import { useEffect, useState } from 'react'

import type { ComputerState } from '@althar/runtime/computerBridge'
import {
  chord,
  type ComputerAnswer,
  type ComputerAsk,
  type ComputerLatest,
  ComputerPhase,
  ComputerUse as ComputerCard,
  computerUseText,
  keys,
  unreachable,
} from '@althar/ui'

import { useServices, type Host } from '../../data/services'

/*
 * A task's use of this computer, as main says it stands, under the task's
 * thread: its one ask, answered in place; then what it does, its last picture,
 * and Take over, Resume and Stop. An answer or a press shows at once, and
 * goes back, with a line, where the session refuses it.
 */

type ComputerHost = NonNullable<Host['computer']>

const phaseOf = (phase: ComputerState['phase']): ComputerPhase => {
  switch (phase) {
    case 'asking':
      return ComputerPhase.Asking
    case 'active':
      return ComputerPhase.Active
    case 'paused':
      return ComputerPhase.Paused
    case 'stopped':
      return ComputerPhase.Stopped
    default:
      return unreachable(phase)
  }
}

const askOf = (request: NonNullable<ComputerState['request']>): ComputerAsk => ({
  id: request.id,
  reason: request.reason,
  display: request.primaryDisplay,
})

/** Its last picture, of a window by its app, or of the display. */
const latestOf = (state: ComputerState): ComputerLatest | undefined => {
  const preview = state.preview
  if (preview === undefined) return undefined
  const of =
    preview.target === 'desktop'
      ? computerUseText.primaryDisplay
      : (state.windows.find((one) => one.id === preview.target)?.app ?? state.title)
  return { of, image: { name: of, src: `data:${preview.picture.mimeType};base64,${preview.picture.data}` } }
}

function ComputerControls({
  taskId,
  computer,
  platform,
}: {
  readonly taskId: string
  readonly computer: ComputerHost
  readonly platform: Host['platform']
}) {
  const [state, setState] = useState<ComputerState | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [answered, setAnswered] = useState<ComputerAnswer | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let here = true
    let received = false
    const stop = computer.subscribe((next) => {
      if (next.taskId !== taskId) return
      received = true
      setState(next)
      setPending(null)
      setAnswered(null)
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

  const send = (command: () => Promise<boolean>, rollback: () => void) => {
    setError(null)
    void command().then(
      (taken) => {
        if (taken) return
        rollback()
        setError('The computer session changed. Check its current state and try again.')
      },
      () => {
        rollback()
        setError('Althar could not reach the computer session.')
      },
    )
  }
  if (state === null) return null
  // The ask folds to what was answered at once; the session's next state takes its place.
  const answer = (given: ComputerAnswer) => {
    setAnswered(given)
    send(
      () => computer.allow(taskId, { requestId: given.ask, allow: given.allow }),
      () => setAnswered(null),
    )
  }
  const control = (action: 'pause' | 'resume' | 'stop') => {
    const phase = action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'stopped'
    const { preview: _preview, ...previous } = state
    const optimistic: ComputerState = { ...previous, phase }
    setState(optimistic)
    setPending(action === 'pause' ? 'Taking over…' : action === 'resume' ? 'Resuming…' : 'Stopping…')
    send(
      () => computer.control(taskId, action),
      () => {
        setPending(null)
        setState((current) => (current === optimistic ? state : current))
      },
    )
  }
  const latest = latestOf(state)
  return (
    <ComputerCard
      phase={phaseOf(state.phase)}
      activity={state.action}
      {...(state.request === undefined || pending !== null ? {} : { ask: askOf(state.request) })}
      {...(answered === null ? {} : { answered })}
      {...(latest === undefined ? {} : { latest })}
      {...(pending === null ? {} : { pending })}
      {...(error === null ? {} : { error })}
      // Main stops every session on these keys, from anywhere, where the system lets it have them.
      {...(platform === 'darwin' ? { stopKeys: chord(keys.shift, keys.mod, 'Esc') } : {})}
      onAnswer={answer}
      onTakeOver={() => control('pause')}
      onResume={() => control('resume')}
      onStop={() => control('stop')}
    />
  )
}

export function ComputerUse({ taskId }: { readonly taskId: string }) {
  const { computer, platform } = useServices().host
  return computer === undefined ? null : <ComputerControls key={taskId} taskId={taskId} computer={computer} platform={platform} />
}
