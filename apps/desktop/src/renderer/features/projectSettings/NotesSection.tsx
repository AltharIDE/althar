import type { ProjectNote } from '@althar/contracts'
import { type KeptNote, ProjectNotes } from '@althar/ui'

import { PartPending, pendingText } from '../../shared/Pending'
import { ago } from '../../shared/time'
import type { ProjectSettingsModel } from './useProjectSettings'

/*
 * The notes a project's coordinator keeps (ADR-031), newest first, each
 * saying who kept it and when; one that no longer holds is dropped from its
 * card, and goes back, saying why, where that didn't hold.
 */

export const text = {
  kept: { coordinator: 'Kept by the coordinator', person: 'Kept by you' } satisfies Record<ProjectNote['keptBy'], string>,
}

/** A note as its card shows it. */
export const keptOf = (note: ProjectNote, now: Date = new Date()): KeptNote => ({
  id: note.id,
  body: note.body,
  kept: `${text.kept[note.keptBy]} · ${ago(note.createdAt, now)}`,
})

export function NotesSection({ model }: { model: ProjectSettingsModel }) {
  if (model.notes === null) return <PartPending label={pendingText.page} />
  return (
    <ProjectNotes
      notes={model.notes.toReversed().map((note) => keptOf(note))}
      onRemove={(id) => void model.dropNote(id)}
      {...(model.noteFailed === null ? {} : { error: model.noteFailed })}
    />
  )
}
