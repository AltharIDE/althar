// Scrappy: the face a task opens on, kept per take: the conversation in every take, as the app does in Today.
import { proto } from '../state'

type Face = 'talk' | 'out' | 'graph'

const kept = new Map<string, Face>()
const keyOf = (taskId: string) => `${proto.get().direction}:${taskId}`

export const chosenFaces = {
  get: (taskId: string): Face | undefined => kept.get(keyOf(taskId)) ?? (proto.get().direction === 'Today' ? undefined : 'talk'),
}

export const chooseFace = (taskId: string, face: Face) => kept.set(keyOf(taskId), face)
export const forgetChosenFaces = () => kept.clear()
