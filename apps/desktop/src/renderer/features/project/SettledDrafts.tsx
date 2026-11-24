import { useState } from 'react'

import type { DraftLeft } from '@althar/contracts'
import { DraftsLeft } from '@althar/ui'

import { DraftCard, type DraftActions } from '../../shared/DraftCard'

/*
 * The issue drafts the project's finished tasks left (`BoardSnapshot.drafts`), at the end of the coordinator's
 * conversation: a task done, merged or abandoned doesn't wait in Needs you on them. Each is the card its task's thread
 * shows, under the task it came from, and acts as that card does: filed or discarded here, it is so there too.
 *
 * A press shows at once (the UI is instant): a draft discarded leaves the list, one filed shows as being filed, from the
 * press until the board reads it again in another state. One the runtime refused stands as it was, the screen saying why.
 */

type Pressed = ReadonlyMap<string, { readonly to: 'filing' | 'discarded'; readonly from: string }>

export function SettledDrafts({
  drafts,
  actions,
  onTask,
}: {
  drafts: ReadonlyArray<DraftLeft> | undefined
  actions: DraftActions
  onTask: (threadId: string) => void
}) {
  const [pressed, setPressed] = useState<Pressed>(new Map())
  const press = (draft: DraftLeft, to: 'filing' | 'discarded') =>
    setPressed((was) => new Map(was).set(draft.draft.draftId, { to, from: draft.draft.state }))
  // What the person pressed, while the board still has the draft as it was then.
  const shown = (drafts ?? []).flatMap((one) => {
    const mine = pressed.get(one.draft.draftId)
    if (mine === undefined || mine.from !== one.draft.state) return [one]
    return mine.to === 'discarded' ? [] : [{ ...one, draft: { ...one.draft, state: 'filing' as const } }]
  })
  const acting: DraftActions = {
    ...actions,
    onFile: (draftId) => {
      const draft = drafts?.find((one) => one.draft.draftId === draftId)
      if (draft !== undefined) press(draft, 'filing')
      actions.onFile(draftId)
    },
    onDiscard: (draftId) => {
      const draft = drafts?.find((one) => one.draft.draftId === draftId)
      if (draft !== undefined) press(draft, 'discarded')
      actions.onDiscard(draftId)
    },
  }
  return (
    <DraftsLeft
      drafts={shown.map((one) => ({
        key: one.draft.draftId,
        task: one.taskTitle,
        onOpenTask: () => onTask(one.threadId),
        card: <DraftCard draft={one.draft} actions={acting} />,
      }))}
    />
  )
}
