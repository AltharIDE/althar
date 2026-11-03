import { useState } from 'react'

import type { IssueChangeLine, IssuePriority, IssueDraftState as State } from '@althar/contracts'
import { IssueDraft, IssueDraftState, Markdown } from '@althar/ui'

import { productBrand } from './products'
import type { IssueDraftContent } from './thread'

/*
 * An issue the coordinator or a task's lead drafted, in their thread: the tracker and where
 * it goes there, what it says and what else it is filed with, and where it
 * stands. Nothing is filed until the person files it here; they can change
 * it first, or discard it; or file it and every later one at once, which
 * the coordinator keeps as a note. Once filed, its key and its link, and
 * what its tracker left off; filed at once, a way to be asked first again.
 * Not filed, why, and filing it again; perhaps filed, its answer lost, a
 * word to look on the tracker before filing again.
 */

export interface DraftActions {
  readonly onFile: (draftId: string) => void
  readonly onChange: (
    draftId: string,
    edit: { readonly title: string; readonly body: string; readonly labels: ReadonlyArray<string> },
  ) => Promise<void>
  readonly onDiscard: (draftId: string) => void
  /** Issues filed and changed at once from now on, or each on a card first: said to the coordinator. */
  readonly onPrefer: (atOnce: boolean) => void
}

/** What else an issue is filed with, as its card says it: Project: Q4 launch, Assignees: Sam, Ana. */
export const detailOf = (line: IssueChangeLine): string => {
  if ('add' in line) return `${line.field === 'labels' ? 'Labels' : 'Assignees'}: ${line.add.join(', ')}`
  const named: Partial<Record<IssueChangeLine['field'], string>> = {
    status: 'Status',
    assignee: 'Assignee',
    project: 'Project',
    milestone: 'Milestone',
    cycle: 'Cycle',
    parent: 'Part of',
    estimate: 'Estimate',
    type: 'Type',
    components: 'Components',
    due: 'Due',
  }
  return `${named[line.field] ?? line.field}: ${line.to ?? 'none'}`
}

/** A priority as trackers show it; none shows nothing. */
const PRIORITIES: Readonly<Record<IssuePriority, string | null>> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: null,
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
      {...(draft.priority === null || PRIORITIES[draft.priority] === null ? {} : { priority: PRIORITIES[draft.priority] ?? '' })}
      details={(draft.fields ?? []).map(detailOf)}
      leftOff={draft.leftOff ?? []}
      direct={draft.direct === true}
      state={STATES[draft.state]}
      {...(draft.error === null ? {} : { error: draft.error })}
      {...(draft.issue === null ? {} : { issue: { key: draft.issue.key, href: draft.issue.url } })}
      onFile={() => actions.onFile(draft.draftId)}
      onChange={(edit) => {
        setSaving(true)
        void actions.onChange(draft.draftId, edit).finally(() => setSaving(false))
      }}
      onDiscard={() => actions.onDiscard(draft.draftId)}
      // Filed at once from now on: this one too.
      onAlwaysAtOnce={() => {
        actions.onFile(draft.draftId)
        actions.onPrefer(true)
      }}
      onAlwaysAsk={() => actions.onPrefer(false)}
      saving={saving}
    />
  )
}
