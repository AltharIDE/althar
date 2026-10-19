import { useState } from 'react'

import type { IssueDraftState as State } from '@althar/contracts'
import { IssueDraft, IssueDraftState, Markdown } from '@althar/ui'

import { productBrand } from './products'
import type { IssueDraftContent } from './thread'

/*
 * An issue the coordinator or a task's lead drafted, in their thread: the tracker and where
 * it goes there, what it says, and where it stands. Nothing is filed until
 * the person files it here; they can change it first, or discard it. Once
 * filed, its key and its link; not filed, why, and filing it again; perhaps
 * filed, its answer lost, a word to look on the tracker before filing again.
 */

export interface DraftActions {
  readonly onFile: (draftId: string) => void
  readonly onChange: (
    draftId: string,
    edit: { readonly title: string; readonly body: string; readonly labels: ReadonlyArray<string> },
  ) => Promise<void>
  readonly onDiscard: (draftId: string) => void
}

/** The kit's state, from the runtime's. */
const STATES: Readonly<Record<State, IssueDraftState>> = {
  pending: IssueDraftState.Pending,
  filing: IssueDraftState.Filing,
  filed: IssueDraftState.Filed,
  failed: IssueDraftState.Failed,
  uncertain: IssueDraftState.Uncertain,
  discarded: IssueDraftState.Discarded,
}

export function DraftCard({ draft, actions }: { draft: IssueDraftContent; actions: DraftActions }) {
  // A change saved shows as saving until the runtime has it; its card then reads it back.
  const [saving, setSaving] = useState(false)
  return (
    <IssueDraft
      mark={productBrand(draft.product)}
      source={draft.tracker}
      container={draft.container}
      title={draft.title}
      body={draft.body}
      bodyView={<Markdown source={draft.body} />}
      labels={draft.labels}
      state={STATES[draft.state]}
      {...(draft.error === null ? {} : { error: draft.error })}
      {...(draft.issue === null ? {} : { issue: { key: draft.issue.key, href: draft.issue.url } })}
      onFile={() => actions.onFile(draft.draftId)}
      onChange={(edit) => {
        setSaving(true)
        void actions.onChange(draft.draftId, edit).finally(() => setSaving(false))
      }}
      onDiscard={() => actions.onDiscard(draft.draftId)}
      saving={saving}
    />
  )
}
