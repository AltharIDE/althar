import { useState } from 'react'

import { SettingChange, Problem } from '@althar/ui'

import { messageOf } from '../data/client'
import { useServices } from '../data/services'
import type { SettingChangeContent } from './thread'

/*
 * An agent's change to a setting, in its thread, as the runtime keeps it
 * (ADR-097): Undo on its line puts back what was there, and a card that
 * waits for the person makes the change as they press it. What was pressed
 * stays pressed until the line comes back changed; what couldn't be done is
 * said under it.
 */

export const text = {
  failed: (why: string) => `That didn’t go through. ${why}`,
}

export function SettingChangeOf({ change, itemId }: { change: SettingChangeContent; itemId: string }) {
  const { client } = useServices()
  const [busy, setBusy] = useState<SettingChangeContent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = (pressed: Promise<void>) => {
    setError(null)
    setBusy(change)
    pressed.then(
      () => undefined,
      (failure: unknown) => {
        setBusy(null)
        setError(messageOf(failure))
      },
    )
  }
  return (
    <>
      <SettingChange
        section={change.title}
        project={change.project}
        moves={change.moves}
        state={change.state}
        {...(change.words === null ? {} : { words: change.words })}
        {...(change.why === null ? {} : { why: change.why })}
        {...(change.said === null ? {} : { said: change.said })}
        busy={busy === change}
        onAnswer={(yes) => run(client.answerSettingChange(itemId, yes))}
        {...(busy === change ? {} : { onUndo: () => run(client.undoSettingChange(itemId)) })}
      />
      {error !== null && <Problem size="small">{text.failed(error)}</Problem>}
    </>
  )
}
