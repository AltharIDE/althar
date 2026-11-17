import nodeModule from 'node:module'

/*
 * V8's compiled code for the app's own processes, kept between launches:
 * Node's module compile cache, shared by the main process and the runtime's
 * (main/boot.ts, runtime/boot.ts). Each compiles its bundles once after an
 * install or an update and reads them from disk after that, which is most of
 * what a process does before its first line runs. It is kept in the
 * window's folder of the profile, never the person's temporary one. Where
 * Node has no such cache, or the folder can't be used, a process starts as
 * it always did.
 */

/** What of Node's `module` is used here: a test passes its own. */
export type CompileCaching = Partial<Pick<typeof nodeModule, 'enableCompileCache' | 'flushCompileCache' | 'constants'>>

/** Keeps what is compiled from here on in `dir`; whether it does. */
export const keepCompiled = (dir: string | undefined, node: CompileCaching = nodeModule): boolean => {
  if (dir === undefined || dir === '' || node.enableCompileCache === undefined) return false
  try {
    const { status } = node.enableCompileCache(dir)
    const said = node.constants?.compileCacheStatus
    return said !== undefined && (status === said.ENABLED || status === said.ALREADY_ENABLED)
  } catch {
    // Only ever a way to start sooner.
    return false
  }
}

/**
 * Writes what was compiled so far to the folder at once, as Node would as it
 * exits: Electron's main process quits from its own side, where Node may not
 * see an exit to write it at. Only what wasn't on disk already is written.
 */
export const keepCompiledNow = (node: CompileCaching = nodeModule) => {
  try {
    node.flushCompileCache?.()
  } catch {
    // As above.
  }
}
