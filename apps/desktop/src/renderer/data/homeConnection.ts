import type { DomMessagePort } from '@althar/contracts'

import type { HomeState } from '../../homes'
import { type Client, receivePort } from './client'
import type { Host } from './services'

/** Local-only capabilities cannot interpret paths or localhost URLs originating on a remote home. */
export const hostForHome = (host: Host, state: HomeState): Host => {
  if (state.current.kind === 'local') return host
  const { pages: _pages, canvases: _canvases, dictation: _dictation, report: _report, reportProblem: _reportProblem, ...native } = host
  const unavailable = () => Promise.reject(new Error('File transfers and local previews are not available on this connection.'))
  return {
    ...native,
    pickFolder: unavailable,
    pickFolders: unavailable,
    pickPlace: unavailable,
    grantDropped: unavailable,
    attach: unavailable,
    attachPasted: unavailable,
    grantFound: unavailable,
    findRepositories: unavailable,
    showBackup: unavailable,
    tryAgain: unavailable,
    clipboardToken: () => Promise.resolve(null),
    editorPicture: () => Promise.resolve(null),
  }
}

/**
 * A window on another computer makes a project from what the home finds on
 * its own disk: its repositories, each by a grant the home made, which is
 * the id it's found by, and the place a clone or a new repository goes. There
 * is no folder picker there, and nothing dropped from this computer is on it.
 */
export const foldersOnHome = (host: Host, client: Pick<Client, 'findHomeFolders'>): Host => {
  const place = async () => (await client.findHomeFolders()).place
  return {
    ...host,
    findRepositories: async () => {
      const found = await client.findHomeFolders()
      return { lookedIn: found.lookedIn, repositories: found.repositories.map(({ grant, ...one }) => ({ ...one, id: grant })) }
    },
    grantFound: async (id) => id,
    clonePlace: place,
    pickClonePlace: place,
    pickPlace: async () => (await place()).grant,
    openFolderAccess: async () => false,
  }
}

/** Listen before any async metadata read; a fast port or connection failure must not disappear during startup. */
export const receiveHomeConnection = async (
  host: Host,
  target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
): Promise<{ port: DomMessagePort; home: HomeState }> => {
  const abort = new AbortController()
  let received: DomMessagePort | undefined
  let opened = false
  const given = receivePort(target, abort.signal).then((port) => {
    received = port
    return port
  })
  void given.catch(() => undefined)
  let off = () => {}
  let timeout: ReturnType<typeof setTimeout> | undefined
  let state: HomeState = { current: { kind: 'local' }, connection: 'local' }
  let stop: (reason: Error) => void = () => {}
  const stopped = new Promise<never>((_, reject) => {
    stop = reject
  })
  const deadline = (milliseconds: number) => {
    clearTimeout(timeout)
    timeout = setTimeout(
      () =>
        stop(
          new Error(
            state.current.kind !== 'local'
              ? 'The home did not connect. Check its service and network connection.'
              : 'The runtime didn’t start.',
          ),
        ),
      milliseconds,
    )
  }
  deadline(15_000)
  try {
    const failed = new Promise<never>((_, reject) => {
      off =
        host.homes?.onState((state) => {
          if (state.current.kind !== 'local' && state.connection === 'disconnected')
            reject(new Error(state.problem ?? 'The home disconnected.'))
        }) ?? (() => {})
    })
    state = (await Promise.race([host.homes?.state(), failed, stopped])) ?? state
    if (state.current.kind !== 'local' && state.connection === 'disconnected') throw new Error(state.problem ?? 'The home disconnected.')
    if (state.current.kind !== 'local') deadline(60_000)
    const port = await Promise.race([given, failed, stopped])
    const home = (await Promise.race([host.homes?.state(), failed, stopped])) ?? state
    if (home.current.kind !== 'local' && (home.connection !== 'connected' || home.identity === undefined))
      throw new Error('The home did not establish a verified connection.')
    opened = true
    return { port, home }
  } finally {
    off()
    clearTimeout(timeout)
    abort.abort()
    if (!opened) received?.postMessage([1])
  }
}
