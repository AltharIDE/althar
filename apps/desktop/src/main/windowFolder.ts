import { join } from 'node:path'

/*
 * Where the window keeps what it remembers, its tabs and pinned models, and
 * where Electron keeps its own (userData). A profile of its own, as the
 * end-to-end tests give, keeps it apart from the person's. Otherwise it
 * stays in the folder it had before the app took its name, Althar
 * (productName, which also names the keychain entry sign-ins are sealed
 * with): Application Support/Althar is where a profile lives.
 */
export const windowFolderOf = (ownProfile: string | undefined, appData: string) =>
  ownProfile !== undefined && ownProfile !== '' ? join(ownProfile, 'window') : join(appData, '@althar', 'desktop')

/** Where the main process and the runtime keep V8's compiled code between launches (compileCache.ts). */
export const compiledIn = (windowFolder: string) => join(windowFolder, 'compile-cache')
