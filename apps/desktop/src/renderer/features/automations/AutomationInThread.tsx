import { useEffect, useRef, useState } from 'react'

import type { AgentStatus } from '@althar/contracts'
import { AutomationAsk, AutomationNote, Problem } from '@althar/ui'

import { messageOf } from '../../data/client'
import type { AutomationCardContent } from '../../shared/thread'
import { AutomationCardOf } from './AutomationCardOf'
import { type AutomationActions, shownAs } from './useAutomations'
import { nextAtAfter, nextWords, whenWords } from './words'
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
 * line saying so. What the person pressed shows from the press, as its page
 * shows it (turned on or off, its change undone, its ask done), held until
 * the card comes back changed after the answer; what can't be foreseen, a
 * run tried once, stays pressed until then. What couldn't be done is said
 * under it, and the card goes back to what it was.
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
  // What was pressed, until the card comes back changed: by what it was then.
  const [busy, setBusy] = useState<AutomationCardContent | null>(null)
  // What a press made of it, from the press: held through any card that comes back before its answer, and gone with the
  // first after it (`after`, the card as it was when the answer came), which says it from then.
  const [shown, setShown] = useState<{
    readonly card: AutomationCardContent
    readonly press: number
    readonly after: AutomationCardContent | null
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(card)
  const presses = useRef(0)
  // Read by an answer, not in render: the card as the last render had it.
  useEffect(() => {
    latest.current = card
  })
  if (shown !== null && shown.after !== null && shown.after !== card) setShown(null)
  const pressed = busy === card
  const id = card.automationId
  const now = shown?.card ?? card
  const { definition } = now
  const act = (action: () => Promise<void>, show?: (was: AutomationCardContent) => AutomationCardContent, press = show === undefined) => {
    setError(null)
    const mine = ++presses.current
    if (show !== undefined) setShown({ card: show(now), press: mine, after: null })
    if (press) setBusy(card)
    action().then(
      () => setShown((held) => (held?.press === mine ? { ...held, after: latest.current } : held)),
      (failure: unknown) => {
        setBusy(null)
        setShown((held) => (held?.press === mine ? null : held))
        setError(messageOf(failure))
      },
    )
  }
  const turnOn = () =>
    act(
      () => actions.turnOn(id, itemId),
      (was) => ({ ...was, ...shownAs.on }),
    )
  const said = error === null ? null : <Problem className={s.cardFailure}>{text.failed(error)}</Problem>
  const next = now.nextAt === null ? undefined : nextWords(now.nextAt)

  if (now.ask !== null) {
    const ask = now.ask.what
    return (
      <>
        <AutomationAsk
          name={definition.name}
          project={project}
          ask={ask}
          schedule={whenWords(definition.schedule)}
          done={now.ask.done}
          busy={pressed}
          onAnswer={() =>
            act(
              () => (ask === 'resume' ? actions.turnOn(id, itemId) : actions.runNow(id, itemId)),
              (was) => (was.ask === null ? was : { ...was, ask: { ...was.ask, done: true } }),
            )
          }
        />
        {said}
      </>
    )
  }
  if (now.state === 'deleted') return <AutomationNote name={definition.name} state="deleted" />
  if (now.was !== null)
    return (
      <>
        <AutomationCardOf
          definition={definition}
          was={now.was}
          project={project}
          nextAt={now.nextAt}
          agents={agents}
          stage="changed"
          {...(now.state === 'proposed' ? { onTurnOn: turnOn } : { holds: true })}
          // Undone, it is what it was before the coordinator changed it.
          onUndo={() =>
            act(
              () => actions.undo(itemId),
              (was) => (was.was === null ? was : { ...was, definition: was.was, was: null }),
            )
          }
          onOpen={() => onOpen(id)}
          busy={pressed}
        />
        {said}
      </>
    )
  if (now.state === 'proposed')
    return (
      <>
        <AutomationCardOf
          definition={definition}
          project={project}
          nextAt={now.nextAt}
          fromSchedule
          agents={agents}
          stage="proposed"
          onChange={(changed) =>
            act(
              () => actions.change(id, changed),
              (was) => ({ ...was, definition: changed, nextAt: nextAtAfter(was.nextAt, was.definition.schedule, changed.schedule) }),
            )
          }
          onTryOnce={() => act(() => actions.runNow(id, itemId))}
          onTurnOn={turnOn}
          busy={pressed}
        />
        {said}
      </>
    )
  return (
    <>
      <AutomationNote
        name={definition.name}
        state={now.state}
        {...(next === undefined ? {} : { next })}
        onOpen={() => onOpen(id)}
        onTurnOff={() =>
          act(
            () => actions.pause(id),
            (was) => ({ ...was, ...shownAs.paused }),
          )
        }
        onTurnOn={turnOn}
      />
      {said}
    </>
  )
}
