/** The face the person picked for each task, kept while the app is open. */
export const chosenFaces = new Map<string, 'talk' | 'out'>()

/** Forgets what was picked, for tests. */
export const forgetChosenFaces = () => chosenFaces.clear()
