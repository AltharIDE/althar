import type { IssueChangeState as State } from '@althar/contracts'
import { IssueChanges, IssueChangesState } from '@althar/ui'

import { productBrand } from './products'
import type { IssueChangesContent } from './thread'

/*
 * Changes to issues on the person's trackers, in the thread of whoever
 * proposed them: the coordinator, a task's lead, or Althar as a task's pull
 * request opened or merged. Nothing changes until the person applies them
 * here, or discards them; a comment or a link, and changes a project lets
 * through, applied at once and show as a line.
 */

export interface ChangesActions {
  readonly onApply: (changesId: string) => void
  readonly onDiscard: (changesId: string) => void
}

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
        changes: issue.changes,
        applied: issue.applied,
        ...(issue.error === null ? {} : { error: issue.error }),
      }))}
      {...(changes.note === null ? {} : { note: changes.note })}
      state={STATES[changes.state]}
      onApply={() => actions.onApply(changes.changesId)}
      onDiscard={() => actions.onDiscard(changes.changesId)}
    />
  )
}
