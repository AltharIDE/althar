import { app } from 'electron'

import { keepCompiled } from '../compileCache'
import { compiledIn, windowFolderOf } from './windowFolder'

/*
 * Where Electron's main process starts (package.json's main): V8's compiled
 * code is kept from here on (compileCache.ts), and then the main process
 * itself is loaded (main.ts), which is most of what there is to compile.
 * The load is awaited, so all of main.ts runs before the app is ready, as it
 * did when it was the entry.
 */
keepCompiled(compiledIn(windowFolderOf(process.env.ALTHAR_PROFILE, app.getPath('appData'))))
await import('./main')
