import { NOTE_LENGTH, type ProjectNote } from '@althar/contracts'
import { type KeptNote, ProjectNotes } from '@althar/ui'

import { PartPending, pendingText } from '../../shared/Pending'
import { ago } from '../../shared/time'
import type { ProjectSettingsModel } from './useProjectSettings'

/*
 * The notes a project's coordinator keeps (ADR-031), newest first, each
 * saying who kept it and when; one is said in the person's words, or dropped
 * when it no longer holds, from its card, and goes back as it was, saying
 * why, where that didn't hold.
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
      onEdit={(id, body) => void model.editNote(id, body)}
      onRemove={(id) => void model.dropNote(id)}
      limit={NOTE_LENGTH}
      {...(model.noteFailed === null ? {} : { error: model.noteFailed })}
    />
  )
}
