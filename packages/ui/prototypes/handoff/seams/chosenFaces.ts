// Scrappy: the face a task opens on, kept per direction: B opens on where it stands, A and C on the conversation, Today as the app does.
import { proto } from '../state'

type Face = 'talk' | 'out' | 'graph'

const kept = new Map<string, Face>()
const keyOf = (taskId: string) => `${proto.get().direction}:${taskId}`

export const chosenFaces = {
  get: (taskId: string): Face | undefined => {
    const own = kept.get(keyOf(taskId))
    if (own !== undefined) return own
    const { direction } = proto.get()
    return direction === 'B' ? 'out' : direction === 'Today' ? undefined : 'talk'
  },
}

export const chooseFace = (taskId: string, face: Face) => kept.set(keyOf(taskId), face)
export const forgetChosenFaces = () => kept.clear()
