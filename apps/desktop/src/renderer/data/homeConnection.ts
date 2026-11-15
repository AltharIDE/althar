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
  const given = receivePort(target, abort.signal)
  void given.catch(() => undefined)
  let off = () => {}
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const failed = new Promise<never>((_, reject) => {
      off =
        host.homes?.onState((state) => {
          if (state.current.kind === 'ssh' && state.connection === 'disconnected')
            reject(new Error(state.problem ?? 'The home disconnected.'))
        }) ?? (() => {})
    })
    void failed.catch(() => undefined)
    const state: HomeState = (await host.homes?.state()) ?? { current: { kind: 'local' }, connection: 'local' }
    if (state.current.kind === 'ssh' && state.connection === 'disconnected') throw new Error(state.problem ?? 'The home disconnected.')
    const stopped = new Promise<never>((_, reject) => {
      timeout = setTimeout(
        () =>
          reject(
            new Error(
              state.current.kind === 'ssh'
                ? 'The home did not connect. Check its service and SSH configuration.'
                : 'The runtime didn’t start.',
            ),
          ),
        state.current.kind === 'ssh' ? 60_000 : 15_000,
      )
    })
    const port = await Promise.race([given, failed, stopped])
    const home = (await host.homes?.state()) ?? state
    if (home.current.kind === 'ssh' && (home.connection !== 'connected' || home.identity === undefined))
      throw new Error('The home did not establish a verified connection.')
    return { port, home }
  } finally {
    off()
    clearTimeout(timeout)
    abort.abort()
  }
}
