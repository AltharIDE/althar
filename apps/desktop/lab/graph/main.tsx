import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import { RouterProvider } from '@tanstack/react-router'
import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'

import { follow } from '../../src/renderer/data/feed'
import { makeQueryClient } from '../../src/renderer/data/reads'
import { ServicesProvider } from '../../src/renderer/data/services'
import { makeRouter } from '../../src/renderer/router'
import { fakeHost } from '../../tests/fixtures'
import { Bar } from './Bar'
import { boardNow, COORDINATOR, makeClient, PROJECT, TABS } from './data'
import { chooseFace } from '../../src/renderer/features/task/chosenFaces'
import { plan } from './plan'
import { clock, endNow, moves, option, playing, router as shared, scenario, scenarioKey, speed, stage } from './state'
import { taskIdOf } from './view'
import s from './lab.module.css'

/*
 * The graph lab (README.md): the desktop app's window, whole, in the
 * browser, on a made-up runtime where a big request is planned with the
 * coordinator, launched, and plays out live as the graph of its tasks. The
 * bar under it swaps the options of each part (Chat, Board, Task), whether
 * it's planned or launched, which request, and the clock.
 */

window.localStorage.setItem('althar.tabs', JSON.stringify(TABS))
document.documentElement.dataset.theme = 'light'

const { client, emit } = (() => {
  const made = makeClient()
  return { client: made.client, emit: made.emit }
})()
const host = fakeHost()
Object.defineProperty(window, 'althar', { value: host, configurable: true })
const cache = makeQueryClient()
const services = { client, host, cache, feed: follow(client, cache) }
const router = makeRouter({ client, cache })
shared.current = router as unknown as (typeof shared)['current']
// `?face=request` opens each of the request's tasks on its Request view (C), for a picture of it.
if (new URLSearchParams(window.location.search).get('face') === 'request')
  for (const one of scenario().tasks) chooseFace(taskIdOf(scenario(), one.key), 'request' as 'talk')

// For the shooting script: the clock, held still and set, the options, the stage and the plan.
Object.defineProperty(window, 'graphLab', { configurable: true, value: { clock, playing, option, stage, moves, plan } })

/* The clock: a minute of work a second, times the speed. At the end it waits a moment and plays again. */
let last = performance.now()
let restIn = 0
const tick = (now: number) => {
  const dt = Math.min(0.25, (now - last) / 1000)
  last = now
  if (playing.get()) {
    const end = endNow() + 4
    if (clock.get() >= end) {
      restIn += dt
      if (restIn > 6) {
        restIn = 0
        moves.set([])
        clock.set(0)
      }
    } else clock.set(Math.min(end, clock.get() + dt * speed.get()))
  }
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)

/* Each task whose card changes, told to the window as the runtime would: its board, the home and its thread read again. */
let cursor = 10
let seen = new Map<string, string>()
const signatureOf = (task: ReturnType<typeof boardNow>['tasks'][number]) =>
  [task.phase, task.step, task.change?.state, task.change?.checks?.outcome, task.plan?.startsAt === null].join('|')
const tell = () => {
  const board = boardNow()
  const next = new Map(board.tasks.map((task) => [task.taskId, signatureOf(task)]))
  for (const task of board.tasks) {
    if (seen.get(task.taskId) === next.get(task.taskId)) continue
    cursor += 1
    emit({ _tag: 'Changed', cursor, aggregateType: 'card', aggregateId: task.taskId, projectId: PROJECT, threadId: task.threadId })
  }
  seen = next
}
clock.subscribe(tell)
moves.subscribe(tell)
stage.subscribe(tell)
plan.subscribe(tell)
/* The coordinator's conversation, told to the window as it changes: the plan talked over, launched, or drawn by another option. */
const told = () => {
  cursor += 1
  emit({ _tag: 'Changed', cursor, aggregateType: 'thread', aggregateId: COORDINATOR, projectId: PROJECT, threadId: COORDINATOR })
}
plan.subscribe(told)
stage.subscribe(told)
option.chat.subscribe(told)
// Another request is another day's work: the window starts again on it.
scenarioKey.subscribe(() => window.location.reload())

function Lab() {
  useEffect(() => {
    if (window.location.hash === '' || window.location.hash === '#/')
      void router.navigate({ to: '/projects/$projectId', params: { projectId: PROJECT } })
  }, [])
  return (
    <div className={s.lab}>
      <div className={s.window}>
        <ServicesProvider value={services}>
          <RouterProvider router={router} />
        </ServicesProvider>
      </div>
      <Bar />
    </div>
  )
}

const root = document.getElementById('root')
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <Lab />
    </StrictMode>,
  )
