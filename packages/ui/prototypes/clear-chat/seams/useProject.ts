// Scrappy: the project's model as the app reads it, with the conversation as the direction has cleared it, and the coordinator answering on the page.
import { type ProjectModel, useProject as useRealProject } from '../../../../../apps/desktop/src/renderer/features/project/useProject'
import { proto, sessionOf, shownOf, useProto } from '../state'

export * from '../../../../../apps/desktop/src/renderer/features/project/useProject'

const NOTHING_STREAMS = new Map()

export const useProject = (projectId: string): ProjectModel => {
  const model = useRealProject(projectId)
  const p = useProto()
  if (model.coordinator === null) return model
  const talk = p.talks[p.direction]
  const shown = shownOf(p.direction, talk)
  const said = async (body: string) => {
    proto.say(body)
    return true
  }
  return {
    ...model,
    coordinator: {
      ...model.coordinator,
      items: [...shown.earlier, ...shown.current],
      earlier: false,
      session: sessionOf(talk),
    },
    streaming: NOTHING_STREAMS,
    say: said,
    sayNow: said,
    loadEarlier: async () => undefined,
  }
}
