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
import { boardNow, makeClient, TABS } from './data'
import { clock, COORDINATOR, direction, endNow, moves, playing, PROJECT, router as shared, speed } from './state'
import { answered, talk } from './talk'
import s from './lab.module.css'

/*
 * The blockers lab (README.md): the desktop app's window, whole, in the
 * browser, on a made-up runtime where tasks wait for other tasks. The bar
 * under it swaps the direction on show and runs the clock.
 */

window.localStorage.setItem('althar.tabs', JSON.stringify(TABS))
document.documentElement.dataset.theme = 'light'

const { client, emit } = makeClient()
const host = fakeHost()
Object.defineProperty(window, 'althar', { value: host, configurable: true })
const cache = makeQueryClient()
const services = { client, host, cache, feed: follow(client, cache) }
const router = makeRouter({ client, cache })
shared.current = router as unknown as (typeof shared)['current']

// For the shooting script: the clock, held still and set, and the direction.
Object.defineProperty(window, 'blockersLab', { configurable: true, value: { clock, playing, direction, moves } })

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
      if (restIn > 8) {
        restIn = 0
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
  [task.phase, task.step, task.state, task.change?.state, task.change?.checks?.outcome, task.plan?.startsAt === null].join('|')
const tell = () => {
  const board = boardNow()
  const next = new Map(board.tasks.map((task) => [task.taskId, signatureOf(task)]))
  const calls = board.calls.map((one) => one.id).join()
  for (const task of board.tasks) {
    if (seen.get(task.taskId) === next.get(task.taskId)) continue
    cursor += 1
    emit({ _tag: 'Changed', cursor, aggregateType: 'card', aggregateId: task.taskId, projectId: PROJECT, threadId: task.threadId })
  }
  if (seen.get('calls') !== calls) told()
  seen = next
  seen.set('calls', calls)
}
/* The coordinator's conversation, told to the window as it changes: what the person said, its answers, its questions. */
const told = () => {
  cursor += 1
  emit({ _tag: 'Changed', cursor, aggregateType: 'thread', aggregateId: COORDINATOR, projectId: PROJECT, threadId: COORDINATOR })
}
/* Every task's thread, read again: what it waits for, or a direction that says it otherwise. */
const everything = () => {
  seen = new Map()
  tell()
  told()
}
clock.subscribe(tell)
moves.subscribe(everything)
direction.subscribe(everything)
talk.subscribe(told)
answered.subscribe(told)

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
