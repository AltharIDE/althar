import { keepCompiled } from '../compileCache'

/*
 * Where the runtime's utility process starts: V8's compiled code is kept
 * from here on, in the folder the main process names (compileCache.ts), and
 * then the runtime itself is loaded (runtime.ts), its bundles and the
 * packages it runs, most of what there is to compile.
 */
keepCompiled(process.env.ALTHAR_COMPILE_CACHE)
await import('./runtime')
