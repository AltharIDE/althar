import { useState } from 'react'

import type { AgentStatus, AutomationDefinition } from '@althar/contracts'
import { AutomationAsk, AutomationNote } from '@althar/ui'

import { messageOf } from '../../data/client'
import type { AutomationCardContent } from '../../shared/thread'
import { AutomationCardOf } from './AutomationCardOf'
import type { AutomationActions } from './useAutomations'
import { nextWords, whenWords } from './words'
import s from './Automations.module.css'

/*
 * An automation's card in the coordinator's thread, as the runtime keeps it
 * current. Proposed, the whole card: change it there, try it once, or turn
 * it on; nothing runs until then. Turned on, or paused, it folds to a line,
 * with the way to it in Automations. Changed by the coordinator, what it was
 * shows struck through, with Undo: a change that widens what it does waits
 * to be turned on again (the runtime puts it back to proposed); any other
 * holds from its next run. Asked to
 * resume it or run it now, one button, and once done, a line. Deleted, a
 * line saying so. What the person pressed stays pressed until the card
 * comes back changed; what couldn't be done is said under it.
 */

export const text = {
  failed: (why: string) => `That didn’t go through. ${why}`,
}

export function AutomationInThread({
  card,
  itemId,
  project,
  agents,
  actions,
  onOpen,
}: {
  card: AutomationCardContent
  /** The card's item: what turning it on, running it and undoing it name, where it asks. */
  itemId: string
  project: string
  agents: ReadonlyArray<AgentStatus>
  actions: AutomationActions
  /** Opens it in the project's Automations. */
  onOpen: (automationId: string) => void
}) {
  // What was pressed, and what was changed, until the card comes back changed: by what it was then.
  const [busy, setBusy] = useState<AutomationCardContent | null>(null)
  const [shown, setShown] = useState<{ readonly from: AutomationCardContent; readonly definition: AutomationDefinition } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pressed = busy === card
  const id = card.automationId
  const definition = shown !== null && shown.from === card ? shown.definition : card.definition
  const act = (action: () => Promise<void>, press = true) => {
    setError(null)
    if (press) setBusy(card)
    action().then(
      () => undefined,
      (failure: unknown) => {
        setBusy(null)
        setShown(null)
        setError(messageOf(failure))
      },
    )
  }
  const said =
    error === null ? null : (
      <p className={s.cardFailure} role="alert">
        {text.failed(error)}
      </p>
    )
  const next = card.nextAt === null ? undefined : nextWords(card.nextAt)

  if (card.ask !== null) {
    const ask = card.ask.what
    return (
      <>
        <AutomationAsk
          name={definition.name}
          project={project}
          ask={ask}
          schedule={whenWords(definition.schedule)}
          done={card.ask.done}
          busy={pressed}
          onAnswer={() => act(() => (ask === 'resume' ? actions.turnOn(id, itemId) : actions.runNow(id, itemId)))}
        />
        {said}
      </>
    )
  }
  if (card.state === 'deleted') return <AutomationNote name={definition.name} state="deleted" />
  if (card.was !== null)
    return (
      <>
        <AutomationCardOf
          definition={definition}
          was={card.was}
          project={project}
          nextAt={card.nextAt}
          agents={agents}
          stage="changed"
          {...(card.state === 'proposed' ? { onTurnOn: () => act(() => actions.turnOn(id, itemId)) } : { holds: true })}
          onUndo={() => act(() => actions.undo(itemId))}
          onOpen={() => onOpen(id)}
          busy={pressed}
        />
        {said}
      </>
    )
  if (card.state === 'proposed')
    return (
      <>
        <AutomationCardOf
          definition={definition}
          project={project}
          nextAt={card.nextAt}
          fromSchedule
          agents={agents}
          stage="proposed"
          onChange={(changed) => {
            setShown({ from: card, definition: changed })
            act(() => actions.change(id, changed), false)
          }}
          onTryOnce={() => act(() => actions.runNow(id, itemId))}
          onTurnOn={() => act(() => actions.turnOn(id, itemId))}
          busy={pressed}
        />
        {said}
      </>
    )
  return (
    <>
      <AutomationNote
        name={definition.name}
        state={card.state}
        {...(next === undefined ? {} : { next })}
        onOpen={() => onOpen(id)}
        onTurnOff={() => act(() => actions.pause(id))}
        onTurnOn={() => act(() => actions.turnOn(id, itemId))}
      />
      {said}
    </>
  )
}
