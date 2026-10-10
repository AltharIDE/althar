import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from 'react'

import { EdgeSheet, Island, ISLAND_HOVER, type NotchSize } from '@althar/ui'

import { useServices } from '../../data/services'
import { refOf, text as homeText } from '../home/HomeView'
import { needLineOf, needsOf, workOf } from '../home/needs'
import s from './Edge.module.css'
import type { EdgeModel } from './useEdge'

/*
 * Althar at the edge of the screen, while the person works in another app:
 * only what needs them. Round the notch it is the kit's Island, the notch
 * alone until something waits, and its sheet in ink; in the menu bar, the
 * sheet on paper under Althar's mark. What waits is listed as the home lists
 * it, answered here when a click will do and opened in Althar's window when
 * it needs reading; the work in progress is one line at the foot. Anything's
 * title opens its task in the window.
 */

export const text = homeText

export type EdgePlaceShown = { readonly place: 'island'; readonly notch: NotchSize } | { readonly place: 'menu' }

/** Whether the page is on screen: the menu bar's sheet is kept, hidden, between clicks. */
const useShowing = () => {
  const [showing, setShowing] = useState(() => document.visibilityState === 'visible')
  useEffect(() => {
    const on = () => setShowing(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return showing
}

export function EdgeView({ model, shown }: { model: EdgeModel; shown: EdgePlaceShown }) {
  const { host } = useServices()
  const [open, setOpen] = useState(false)
  const showing = useShowing()
  // Calls answered here stay their lines, quiet, while the edge stays open, as on the home; closed, they go.
  const away = shown.place === 'island' ? !open : !showing
  const onAway = useEffectEvent(() => model.closed())
  useEffect(() => {
    if (away) onAway()
  }, [away])
  const home = model.home
  const name = (id: string | null) => model.agents.find((agent) => agent.id === id)?.name ?? id ?? ''
  const refs = new Map((home?.projects ?? []).map((project) => [project.id, refOf(project)]))
  const tasks = home?.tasks ?? []
  const calls = (home?.calls ?? []).filter((call) => !model.answered.some((one) => one.call.id === call.id))
  const ready = tasks.filter((task) => task.phase === 'ready')
  // What has a call above isn't counted again in the work.
  const called = new Set((home?.calls ?? []).map((call) => call.threadId))
  const working = tasks.filter((task) => task.phase !== 'ready' && !called.has(task.threadId) && refs.has(task.projectId))
  const waiting = calls.length + ready.length
  const openThread = (threadId: string) => host.openInWindow(threadId)

  const needs: ReadonlyArray<ReactNode> = needsOf({ calls: home?.calls ?? [], answered: model.answered, ready, refs, agentName: name }).map(
    (need) => needLineOf(need, { onOpen: openThread, onAnswer: (call, _project, decision) => model.answer(call, decision) }),
  )

  const sheet = (
    <EdgeSheet
      tone={shown.place === 'island' ? 'ink' : 'paper'}
      waiting={waiting}
      needs={needs}
      work={workOf(working)}
      failure={model.error}
      onOpenApp={() => host.openInWindow()}
    />
  )

  if (shown.place === 'island')
    return (
      <Pointed open={open} onOpenChange={setOpen}>
        {(ref) => (
          <Island
            ref={ref}
            notch={shown.notch}
            waiting={waiting}
            saying={model.saying}
            open={open}
            onOpenChange={setOpen}
            onOpenApp={() => host.openInWindow()}
          >
            {sheet}
          </Island>
        )}
      </Pointed>
    )
  return <Measured onHeight={host.edgeSize}>{sheet}</Measured>
}

/**
 * The island, opened and closed as the pointer comes onto it and leaves, as
 * the main process watches it: from an app in the background, the page
 * isn't told itself. It says where the island draws, as that changes.
 */
function Pointed({
  open,
  onOpenChange,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: (ref: (element: HTMLElement | null) => void) => ReactNode
}) {
  const { host } = useServices()
  const [element, setElement] = useState<HTMLElement | null>(null)
  const later = useRef<ReturnType<typeof setTimeout>>(undefined)
  const change = useEffectEvent((on: boolean) => onOpenChange(on))

  useEffect(() => {
    const off = host.onEdgePointed((on) => {
      clearTimeout(later.current)
      later.current = setTimeout(() => change(on), on ? ISLAND_HOVER.open : ISLAND_HOVER.close)
    })
    return () => {
      off()
      clearTimeout(later.current)
    }
  }, [host])

  useEffect(() => {
    if (element === null) return
    const say = () => {
      const { x, y, width, height } = element.getBoundingClientRect()
      host.edgeDrawn({ x, y, width, height })
    }
    const observer = new ResizeObserver(say)
    observer.observe(element)
    say()
    return () => observer.disconnect()
  }, [element, host, open])

  return children(setElement)
}

/**
 * The menu bar's sheet, telling the main process how tall it draws, so its
 * window fits it; taller than the screen allows, it scrolls in the window.
 */
function Measured({ children, onHeight }: { children: ReactNode; onHeight: (height: number) => void }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = box.current
    if (element === null) return
    const say = () => onHeight(element.getBoundingClientRect().height)
    const observer = new ResizeObserver(say)
    observer.observe(element)
    say()
    return () => observer.disconnect()
  }, [onHeight])
  return (
    <div className={s.menu}>
      <div ref={box}>{children}</div>
    </div>
  )
}
