import { useCallback, useEffect, useRef, useState } from 'react'

import type { ReportDraft } from '@althar/ui'

import type { Opened, ReportPreview, Sent } from '../../../main/report/bundle'
import type { ProblemAbout, ReportHost } from '../../data/services'
import { contextOf } from './reportWords'

/*
 * Report a problem's view model (DEV-61). Asked to open, it lets the window
 * settle first (Settings' panel closing, say), then asks the main process to
 * open a report, which takes the window's picture before the dialog draws
 * over it. What goes with the report is read while the person writes. Sent,
 * or saved for their mail app, it says so; not sent, it says why and keeps
 * what they wrote. One report at a time: asked again while one is open, it
 * stays on that one.
 */

export type ReportState =
  | { readonly phase: 'closed' }
  | { readonly phase: 'opening' }
  | {
      readonly phase: 'open'
      readonly about: ProblemAbout
      readonly opened: Opened
      /** What goes with it; null while it is read. */
      readonly preview: ReportPreview | null
      readonly sending: boolean
      readonly error: string | null
      /** Sent, or saved for the mail app. */
      readonly done: Extract<Sent, { kind: 'sent' | 'saved' }> | null
    }

/** How long the window is let settle before its picture is taken: a panel that was open closes in about this. */
export const SETTLE = { frames: 2, afterPanel: 240 }

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export const useReport = (host: ReportHost | undefined, place: () => string = () => window.location.hash) => {
  const [state, setState] = useState<ReportState>({ phase: 'closed' })
  const busy = useRef(false)

  const open = useCallback(
    async (about: ProblemAbout) => {
      if (host === undefined || busy.current) return
      busy.current = true
      setState({ phase: 'opening' })
      // The picture is of the window as the person saw it: what was closing as they asked has gone first.
      if (about.kind === 'asked' && about.from === 'settings') await pause(SETTLE.afterPanel)
      for (let i = 0; i < SETTLE.frames; i++) await nextFrame()
      let opened: Opened
      try {
        opened = await host.open(contextOf(about, place()))
      } catch {
        busy.current = false
        setState({ phase: 'closed' })
        return
      }
      setState({ phase: 'open', about, opened, preview: null, sending: false, error: null, done: null })
      host.preview(opened.reportId).then(
        (preview) => setState((now) => (now.phase === 'open' && now.opened.reportId === opened.reportId ? { ...now, preview } : now)),
        // What goes couldn't be read: the list says what it can, which is nothing more.
        () => undefined,
      )
    },
    [host, place],
  )

  const send = useCallback(
    async (draft: ReportDraft) => {
      if (host === undefined || state.phase !== 'open' || state.sending) return
      const { reportId } = state.opened
      setState({ ...state, sending: true, error: null })
      const sent = await host
        .send(reportId, {
          text: draft.text,
          email: draft.email === '' ? null : draft.email,
          screenshot: draft.screenshot,
          logs: draft.logs,
        })
        .catch((): Sent => ({ kind: 'failed', reason: 'Althar couldn’t send the report.' }))
      setState((now) =>
        now.phase !== 'open' || now.opened.reportId !== reportId
          ? now
          : sent.kind === 'failed'
            ? { ...now, sending: false, error: sent.reason }
            : { ...now, sending: false, done: sent },
      )
    },
    [host, state],
  )

  const close = useCallback(() => {
    if (state.phase === 'open') host?.close(state.opened.reportId)
    busy.current = false
    setState({ phase: 'closed' })
  }, [host, state])

  // Asked from anywhere: the page's Report this and Report a problem, and Help in the app's menu.
  useEffect(() => host?.onAsked((about) => void open(about)), [host, open])

  return { state, open, send, close }
}

export type ReportModel = ReturnType<typeof useReport>
