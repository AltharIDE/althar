import { useState } from 'react'

import { TaskAsk } from '@althar/ui'

import { messageOf } from '../../data/client'
import { useServices } from '../../data/services'
import type { TaskAskContent } from '../../shared/thread'
import s from './TaskAskOf.module.css'

/*
 * The coordinator's card asking the person to stop, hold, restart or settle a
 * task, as the runtime keeps it: its button does it as the task's own would,
 * Not now leaves it, and its title opens the task. What was pressed stays
 * pressed until the card comes back answered; what couldn't be done is said
 * under it.
 */

export const text = {
  failed: (why: string) => `That didn’t go through. ${why}`,
}

export function TaskAskOf({
  ask,
  itemId,
  onOpen,
}: {
  ask: TaskAskContent
  /** The card's item, which answering it names. */
  itemId: string
  /** Opens the task, by its thread. */
  onOpen: (threadId: string) => void
}) {
  const { client } = useServices()
  // Pressed, until the card comes back changed: by what it was then.
  const [busy, setBusy] = useState<TaskAskContent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const answer = (yes: boolean) => {
    setError(null)
    setBusy(ask)
    client.answerTaskAsk(itemId, yes).then(
      () => undefined,
      (failure: unknown) => {
        setBusy(null)
        setError(messageOf(failure))
      },
    )
  }
  return (
    <>
      <TaskAsk
        title={ask.title}
        move={ask.move}
        {...(ask.why === null ? {} : { why: ask.why })}
        state={ask.state}
        {...(ask.said === null ? {} : { said: ask.said })}
        busy={busy === ask}
        onAnswer={answer}
        onOpen={() => onOpen(ask.threadId)}
      />
      {error !== null && (
        <p className={s.failure} role="alert">
          {text.failed(error)}
        </p>
      )}
    </>
  )
}
