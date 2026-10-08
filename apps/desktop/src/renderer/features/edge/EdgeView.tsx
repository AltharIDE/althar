import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from 'react'

import type { HomeTask } from '@althar/contracts'
import {
  AskAnswered,
  AskNote,
  Button,
  EdgeRow,
  EdgeSheet,
  Island,
  ISLAND_HOVER,
  NeedCommand,
  type NotchSize,
  type ProjectRef,
  TaskStatus,
} from '@althar/ui'

import { useServices } from '../../data/services'
import { waitsWords } from '../../shared/agents'
import { kindWords } from '../../shared/calls'
import { productName } from '../../shared/products'
import { ago, clock, running, useNow } from '../../shared/time'
import { trackOf } from '../board/BoardView'
import { refOf, text as homeText } from '../home/HomeView'
import { text as stuckText } from '../task/StuckCall'
import s from './Edge.module.css'
import type { EdgeModel } from './useEdge'

/*
 * Althar at the edge of the screen, while the person works in another app:
 * the home in small. Round the notch it is the kit's Island, and its sheet
 * in ink; in the menu bar, the sheet on paper under Althar's mark. What
 * waits on the person comes first, answered here when a click will do, and
 * opened in Althar's window when it needs reading; then what is in
 * progress. Anything's title opens its task in the window.
 */

export const text = {
  ...homeText,
  /** A ready task's pull request: its host, its number, and its lines. */
  change: (host: string, number: string, add: number | null, del: number | null) =>
    add === null || del === null ? `${host} ${number}` : `${host} ${number} · +${add} −${del}`,
}

export type EdgePlaceShown = { readonly place: 'island'; readonly notch: NotchSize } | { readonly place: 'menu' }

/** Where a task in progress stands: running, held for a usage limit, stopped, or waiting on a call. */
const statusOf = (task: HomeTask): TaskStatus => {
  switch (task.phase) {
    case 'waiting':
      return TaskStatus.Yours
    case 'stopped':
      return TaskStatus.Stopped
    default:
      return task.waits === null ? TaskStatus.Running : TaskStatus.Paused
  }
}

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
  // Times move only while they show: the island open, or the menu bar's sheet on screen.
  const now = new Date(useNow(showing && (shown.place === 'menu' || open)))
  const home = model.home
  const name = (id: string | null) => model.agents.find((agent) => agent.id === id)?.name ?? id ?? ''
  const refs = new Map((home?.projects ?? []).map((project) => [project.id, refOf(project)]))
  const tasks = home?.tasks ?? []
  const calls = (home?.calls ?? []).filter((call) => !model.answered.some((one) => one.id === call.id))
  const ready = tasks.filter((task) => task.phase === 'ready')
  const working = tasks.filter((task) => task.phase !== 'ready')
  const waiting = calls.length + ready.length
  const underway = working.filter((task) => task.phase === 'running' && task.waits === null).length
  const openThread = (threadId: string) => host.openInWindow(threadId)

  const row = (id: string, project: ProjectRef, props: Omit<Parameters<typeof EdgeRow>[0], 'project'>) => (
    <EdgeRow key={id} project={project} fresh={model.fresh === id} {...props} />
  )

  const needs: ReadonlyArray<ReactNode> = [
    ...calls.flatMap((call) => {
      const project = refs.get(call.projectId)
      if (project === undefined) return []
      const shared = { status: TaskStatus.Yours, meta: ago(call.createdAt, now), onOpen: () => openThread(call.threadId) }
      const what = call.command ?? call.title
      return [
        call.stuck === null
          ? row(call.id, project, {
              ...shared,
              kind: kindWords.permission,
              title: call.title,
              detail: <NeedCommand command={what} />,
              actions: (
                <>
                  <Button size="small" onClick={() => model.answer(call, 'reject', text.denied(what))}>
                    {text.deny}
                  </Button>
                  <Button size="small" variant="signal" onClick={() => model.answer(call, 'allow', text.allowed(what))}>
                    {text.allow}
                  </Button>
                </>
              ),
            })
          : row(call.id, project, {
              ...shared,
              kind: kindWords.stuck,
              title: call.taskTitle,
              detail: stuckText.what(call.stuck, name(call.stuck.agentId) || 'The agent'),
              actions: (
                <Button size="small" onClick={shared.onOpen}>
                  {text.look}
                </Button>
              ),
            }),
      ]
    }),
    ...ready.flatMap((task) => {
      const project = refs.get(task.projectId)
      if (project === undefined) return []
      const change = task.change
      return [
        row(task.taskId, project, {
          status: TaskStatus.Yours,
          kind: kindWords.ready,
          title: task.title,
          detail:
            change !== null
              ? text.change(productName(change.product), `${change.prefix}${change.number}`, change.additions, change.deletions)
              : task.changed === null
                ? text.onBranch
                : text.branchSize(task.changed.files, task.changed.add, task.changed.del),
          onOpen: () => openThread(task.threadId),
          actions: (
            <Button size="small" onClick={() => openThread(task.threadId)}>
              {text.review}
            </Button>
          ),
        }),
      ]
    }),
    ...model.answered.map((one) => (
      <AskAnswered key={one.id} said={one.said} denied={one.denied}>
        <AskNote>{text.answeredIn(one.project)}</AskNote>
      </AskAnswered>
    )),
  ]

  const work = working.flatMap((task) => {
    const project = refs.get(task.projectId)
    if (project === undefined) return []
    const status = statusOf(task)
    const { steps, at } = trackOf(task)
    const lead = name(task.lead)
    const meta =
      task.waits !== null
        ? waitsWords(name(task.waits.agentId), clock(task.waits.until, now))
        : status === TaskStatus.Stopped
          ? text.stopped
          : status === TaskStatus.Yours
            ? text.waiting
            : [steps[at], lead, task.startedAt === null ? '' : running(task.startedAt, now.toISOString())].filter(Boolean).join(' · ')
    return [row(task.taskId, project, { status, title: task.title, meta, onOpen: () => openThread(task.threadId) })]
  })

  const sheet = (
    <EdgeSheet
      tone={shown.place === 'island' ? 'ink' : 'paper'}
      waiting={waiting}
      working={work.length}
      needs={needs}
      work={work}
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
            running={underway}
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

/** The menu bar's sheet, telling the main process how tall it draws, so its window fits it. */
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
    <div ref={box} className={s.menu}>
      {children}
    </div>
  )
}
