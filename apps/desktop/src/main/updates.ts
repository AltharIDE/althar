/*
 * Updates (ADR-024, Linear DEV-47). A packaged Althar asks GitHub Releases
 * for a newer version at launch and every few hours, and brings one it
 * finds down in the background, where Squirrel.Mac checks that it is signed
 * as this one is and puts it in place. Then a quiet line in the window says
 * it is ready. Althar never restarts on its own: it restarts into it when the
 * person asks, and only while no work runs, or it installs as they quit.
 *
 * This holds where the update stands and what the window is told; the
 * updater itself (electron-updater and Squirrel) is behind `UpdaterPort`,
 * wired in updater.ts.
 */

/** Where the release notes of a version are: its GitHub Release. */
export const notesOf = (version: string) => `https://github.com/AltharIDE/althar/releases/tag/v${version}`

/** Where the update stands. */
export type Update =
  /** Nothing newer was found, or no one has looked yet. */
  | { readonly kind: 'none' }
  | { readonly kind: 'checking' }
  /** Found, and coming down, or being put in place. */
  | { readonly kind: 'downloading'; readonly version: string }
  /** In place: a restart, or quitting, installs it. */
  | { readonly kind: 'ready'; readonly version: string }
  | { readonly kind: 'failed'; readonly why: string }

/** What a window shows of it: only an update that is ready, never the checking and downloading before. */
export interface UpdateGlance {
  /** The version ready to install; null while there is none. */
  readonly ready: string | null
  /** Work runs, so Althar won't restart into it now; it installs as Althar quits. */
  readonly working: boolean
  /** A restart the person asked for is under way. */
  readonly restarting: boolean
  /** Why the restart they asked for didn't happen. */
  readonly failed: string | null
}

/** The updater, as this needs it. */
export interface UpdaterPort {
  /** Asks the feed for a newer version; one found comes down on its own, and its progress comes as the events below. */
  readonly check: () => Promise<unknown>
  /** Quits, installs the update that is in place, and opens the new version. */
  readonly install: () => void
  /**
   * Waits out the runtime's gathering of changes (Nudges, 250 ms) and a
   * little more, so work that began just before the person pressed Restart
   * has said so before Althar quits.
   */
  readonly settle: () => Promise<void>
}

/** How long a restart waits for word of work that began just before it was asked for. */
export const SETTLE = 1000

/**
 * Asks the feed, as electron-updater does it: a version found starts
 * downloading, and the promise of that download fails as the `error` event
 * says it did. The event is what this listens to, so the promise's failure is
 * caught here rather than left unhandled.
 */
export const checkFor = async (updater: {
  readonly checkForUpdates: () => Promise<{ readonly downloadPromise?: Promise<unknown> | null } | null>
}) => {
  const result = await updater.checkForUpdates()
  void result?.downloadPromise?.catch(() => undefined)
  return result
}

/** The update's course, as the updater's events tell it, and the person's restart. */
export const updating = (port: UpdaterPort, changed: (glance: UpdateGlance) => void) => {
  let update: Update = { kind: 'none' }
  // Unknown until the runtime first says: then nothing restarts, as if work ran.
  let working: boolean | null = null
  let restarting = false
  let restartFailed: string | null = null

  const glance = (): UpdateGlance => ({
    ready: update.kind === 'ready' ? update.version : null,
    working: working !== false,
    restarting,
    failed: restartFailed,
  })
  let told = JSON.stringify(glance())
  const tell = () => {
    const now = glance()
    const said = JSON.stringify(now)
    if (said === told) return
    told = said
    changed(now)
  }
  const set = (next: Update) => {
    update = next
    tell()
  }

  const failed = (why: string) => {
    if (restarting) {
      restarting = false
      restartFailed = why
    }
    // An update in place stays ready: a later check failing doesn't take it away.
    if (update.kind === 'ready') tell()
    else set({ kind: 'failed', why })
  }

  return {
    /** The updater started asking the feed. */
    checking: () => {
      if (update.kind === 'none' || update.kind === 'failed') set({ kind: 'checking' })
    },
    /** The feed has a newer version, which is coming down. */
    available: (version: string) => {
      if (update.kind !== 'ready') set({ kind: 'downloading', version })
    },
    /** The feed has nothing newer. */
    none: () => {
      if (update.kind === 'checking') set({ kind: 'none' })
    },
    /** Squirrel has the update in place: a restart, or quitting, installs it. */
    staged: () => {
      if (update.kind === 'downloading') set({ kind: 'ready', version: update.version })
    },
    failed,
    /** The runtime says whether any work runs. */
    working: (now: boolean) => {
      working = now
      tell()
    },
    /**
     * Looks for a newer version, unless one is already coming or in place,
     * and says what it found. A failure is the result, not an error.
     */
    check: async (): Promise<Update> => {
      if (update.kind === 'downloading' || update.kind === 'ready') return update
      try {
        await port.check()
      } catch (error) {
        if (update.kind !== 'failed') failed(error instanceof Error ? error.message : String(error))
      }
      return update
    },
    /**
     * Restarts into the update the person asked for: only one in place, and
     * never while work runs, or while the runtime hasn't said whether any
     * does. Asked again after a pause, so a turn that began a moment before
     * the press is seen. Whether it began.
     */
    restart: async (): Promise<boolean> => {
      if (update.kind !== 'ready' || working !== false || restarting) return false
      restarting = true
      restartFailed = null
      tell()
      await port.settle()
      if (!restarting) return false
      if (update.kind !== 'ready' || working !== false) {
        restarting = false
        tell()
        return false
      }
      try {
        port.install()
      } catch (error) {
        failed(error instanceof Error ? error.message : String(error))
        return false
      }
      return true
    },
    update: () => update,
    glance,
  }
}

export type Updates = ReturnType<typeof updating>
