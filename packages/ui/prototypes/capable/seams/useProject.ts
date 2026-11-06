// Scrappy: the project's model as the app reads it, with what was started from its composer (B) in the conversation: the person's words, then the task's card, and no reply.
import { items } from '../../../../../apps/desktop/tests/fixtures'
import { type ProjectModel, useProject as useRealProject } from '../../../../../apps/desktop/src/renderer/features/project/useProject'
import { startedCard } from '../runtime'
import { useProto } from '../state'
import type { ThreadItem } from '../deps'

export * from '../../../../../apps/desktop/src/renderer/features/project/useProject'

export const useProject = (projectId: string): ProjectModel => {
  const model = useRealProject(projectId)
  const p = useProto()
  if (model.coordinator === null || p.surface !== 'start' || p.direction !== 'B') return model
  const said: ThreadItem[] = [...p.started].reverse().flatMap((one, index, all) => {
    const first = all.findIndex((each) => each.at === one.at) === index
    const when = new Date(one.at).toISOString()
    const card = { ...items.card(startedCard(one) as never, `card-${one.id}`), createdAt: when }
    if (!first) return [card]
    const words = one.words ?? (one.issue === null ? one.title : null)
    return words === null ? [card] : [{ ...items.you(words), id: `you-${one.id}`, createdAt: when }, card]
  })
  return { ...model, coordinator: { ...model.coordinator, items: [...model.coordinator.items, ...said] } }
}
