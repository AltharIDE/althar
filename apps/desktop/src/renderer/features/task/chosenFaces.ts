/** The face the person picked for each task, kept while the app is open: for the tasks picked in last. */
export const chosenFaces = new Map<string, 'talk' | 'out' | 'graph'>()

/** How many tasks' faces are kept: one long left opens on its own again. */
const FACES_KEPT = 200

/** Keeps the face picked for a task, as the latest picked. */
export const chooseFace = (taskId: string, face: 'talk' | 'out' | 'graph') => {
  chosenFaces.delete(taskId)
  chosenFaces.set(taskId, face)
  for (const oldest of chosenFaces.keys()) {
    if (chosenFaces.size <= FACES_KEPT) break
    chosenFaces.delete(oldest)
  }
}

/** Forgets what was picked, for tests. */
export const forgetChosenFaces = () => chosenFaces.clear()
