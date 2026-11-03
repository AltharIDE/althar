import type { IssueChangeState as State } from '@althar/contracts'
import { IssueChanges, IssueChangesState } from '@althar/ui'

import { productBrand } from './products'
import type { IssueChangesContent } from './thread'

/*
 * Changes to issues on the person's trackers, in the thread of whoever
 * proposed them: the coordinator, a task's lead, or Althar as a task's pull
 * request opened or merged. Nothing changes until the person applies them
 * here, or discards them, or applies them and every later change at once,
 * which the coordinator keeps as a note; a comment or a link, and changes
 * made at once, show as a line, those made at once with a way to be asked
 * first again.
 */

export interface ChangesActions {
  readonly onApply: (changesId: string) => void
  readonly onDiscard: (changesId: string) => void
  /** Issues filed and changed at once from now on, or each on a card first: said to the coordinator. */
  readonly onPrefer: (atOnce: boolean) => void
}

/** Whether a card was changed at once by an agent, as the person prefers: not a comment or link, which always are, nor a task's issue moved with its pull request. */
const madeAtOnce = (changes: IssueChangesContent) =>
  changes.direct &&
  changes.noteUrl == null &&
  changes.issues.some((issue) => issue.changes.some((line) => line.field !== 'comment' && line.field !== 'link'))

/** The kit's state, from the runtime's. */
const STATES: Readonly<Record<State, IssueChangesState>> = {
  pending: IssueChangesState.Pending,
  applying: IssueChangesState.Applying,
  applied: IssueChangesState.Applied,
  failed: IssueChangesState.Failed,
  discarded: IssueChangesState.Discarded,
}

export function ChangesCard({ changes, actions }: { changes: IssueChangesContent; actions: ChangesActions }) {
  return (
    <IssueChanges
      issues={changes.issues.map((issue) => ({
        mark: productBrand(issue.product),
        source: issue.tracker,
        key: issue.key,
        href: issue.url,
        title: issue.title,
        ...(issue.from == null ? {} : { from: issue.from }),
        ...(issue.became == null ? {} : { became: issue.became }),
        changes: issue.changes,
        applied: issue.applied,
        ...(issue.error === null ? {} : { error: issue.error }),
      }))}
      {...(changes.note === null ? {} : { note: changes.note })}
      {...(changes.noteUrl == null ? {} : { noteHref: changes.noteUrl })}
      {...(changes.task == null || changes.task === '' ? {} : { task: changes.task })}
      state={STATES[changes.state]}
      onApply={() => actions.onApply(changes.changesId)}
      onDiscard={() => actions.onDiscard(changes.changesId)}
      // Changed at once from now on: these too.
      onAlwaysAtOnce={() => {
        actions.onApply(changes.changesId)
        actions.onPrefer(true)
      }}
      {...(madeAtOnce(changes) ? { onAlwaysAsk: () => actions.onPrefer(false) } : {})}
    />
  )
}
