import { join } from 'node:path'

/*
 * Where the window keeps what it remembers, its tabs and pinned models, and
 * where Electron keeps its own (userData). A profile of its own, as the
 * end-to-end tests give, keeps it apart from the person's. Otherwise it
 * stays in the folder it had before the app took its name, Althar
 * (productName, which also names the keychain entry sign-ins are sealed
 * with): Application Support/Althar is where a profile lives.
 */
export const windowFolderOf = (ownProfile: string | undefined, appData: () => string) =>
  // The app's data folder is asked for only where no profile is given: Electron can fail to name it this early (Windows).
  ownProfile !== undefined && ownProfile !== '' ? join(ownProfile, 'window') : join(appData(), '@althar', 'desktop')

/** Where the main process and the runtime keep V8's compiled code between launches (compileCache.ts). */
export const compiledIn = (windowFolder: string) => join(windowFolder, 'compile-cache')

/**
 * Where V8's compiled code is kept as the main process starts: the profile's own window folder, else the app's; none where
 * Electron can't name the app's data folder yet, as on Windows where APPDATA names one not made. The code is then compiled
 * afresh: keeping it only makes a launch quicker, and never stops one.
 */
export const compiledFolderOf = (profile: string | undefined, appData: () => string): string | null => {
  try {
    return compiledIn(windowFolderOf(profile, appData))
  } catch {
    return null
  }
}
