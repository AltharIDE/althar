import type { DomMessagePort } from '@althar/contracts'

import type { HomeState } from '../../homes'
import { receivePort } from './client'
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
            state.current.kind === 'ssh'
              ? 'The home did not connect. Check its service and SSH configuration.'
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
          if (state.current.kind === 'ssh' && state.connection === 'disconnected')
            reject(new Error(state.problem ?? 'The home disconnected.'))
        }) ?? (() => {})
    })
    state = (await Promise.race([host.homes?.state(), failed, stopped])) ?? state
    if (state.current.kind === 'ssh' && state.connection === 'disconnected') throw new Error(state.problem ?? 'The home disconnected.')
    if (state.current.kind === 'ssh') deadline(60_000)
    const port = await Promise.race([given, failed, stopped])
    const home = (await Promise.race([host.homes?.state(), failed, stopped])) ?? state
    if (home.current.kind === 'ssh' && (home.connection !== 'connected' || home.identity === undefined))
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
