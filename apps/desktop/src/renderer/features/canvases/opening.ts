/*
 * An artifact asked to open as itself, in its project's Artifacts (ADR-104,
 * "Talking to an artifact"): from a canvas beside a conversation, whose Open
 * takes the person to the artifact, where it is saved, downloaded and its
 * versions stepped through, rather than doing that in a task's header. The
 * Artifacts view takes the ask as it shows, or as it is asked while it shows.
 */

const asked = new Map<string, string>()
const listeners = new Set<() => void>()

/** Asks the Artifacts view of the project `projectId` to open the canvas `canvasId` as itself. */
export const askToOpen = (projectId: string, canvasId: string) => {
  asked.set(projectId, canvasId)
  for (const listener of listeners) listener()
}

/** The canvas asked to open in this project's Artifacts, taken: it opens once. */
export const takeAsked = (projectId: string): string | null => {
  const canvasId = asked.get(projectId) ?? null
  asked.delete(projectId)
  return canvasId
}

/** Hears each ask, while the view shows, to take it; gives back what stops hearing them. */
export const onAsked = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}
