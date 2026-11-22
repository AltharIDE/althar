import type { LoadWorker } from '../chrome/LoadMeter/load'
import { Brand } from '../foundations/brands/brands'
import type { CloudUse } from '../setup/Computers/Cloud'
import type { ComputerWorker } from '../setup/Computers/Computers'

/*
 * The home's workers on a Tuesday afternoon: a build box at work on one of
 * Meridian's tasks, a spare one free, one out of disk space, and one that
 * hasn't connected since the weekend. And Althar Cloud's use this month, for
 * when a home has it. Every number is made up, and the same on every run.
 */

const codex = { name: 'Codex', mark: Brand.Codex }
const claude = { name: 'Claude Code', mark: Brand.ClaudeCode }

export const WORKER_AT_WORK: ComputerWorker = {
  id: 'wrk_3f9a2c51d0e84b7a9c6e2f1a0b3c3f9a',
  name: 'Linux worker 3c3f9a',
  kind: 'Linux · arm64 · 16 cores',
  state: 'working',
  task: { id: 'task_418', title: 'Repair token refresh on privilege change', project: 'Meridian' },
  memoryFree: '41.2 GB',
  diskFree: '186 GB',
  agents: [claude, codex],
  projects: ['Meridian', 'Halyard'],
}

export const WORKER_FREE: ComputerWorker = {
  id: 'wrk_8b21d07e4c9f4a5b8e3d2c1b0a98b21d',
  name: 'Linux worker 98b21d',
  kind: 'Linux · x64 · 8 cores',
  state: 'free',
  task: null,
  memoryFree: '12.4 GB',
  diskFree: '74 GB',
  agents: [codex],
  projects: ['Meridian'],
}

export const WORKER_FULL: ComputerWorker = {
  id: 'wrk_51c0aa2e7d8b4f3c9a1e6d5b4c3e51c0',
  name: 'Linux worker 3e51c0',
  kind: 'Linux · x64 · 4 cores',
  state: 'full',
  task: null,
  memoryFree: '6.1 GB',
  diskFree: '0 MB',
  agents: [claude],
  projects: ['Tessera'],
}

export const WORKER_OFFLINE: ComputerWorker = {
  id: 'wrk_c47e19b2a6d54e8f9b0c3a2d1e0fc47e',
  name: 'Linux worker 0fc47e',
  kind: null,
  state: 'offline',
  task: null,
  memoryFree: null,
  diskFree: null,
  agents: [],
  projects: ['Halyard'],
}

export const WORKERS = [WORKER_AT_WORK, WORKER_FREE, WORKER_FULL, WORKER_OFFLINE]

/** The same workers, as the load popover lists them. */
export const LOAD_WORKERS: LoadWorker[] = [
  { id: WORKER_AT_WORK.id, name: WORKER_AT_WORK.name, state: 'working', detail: 'Repair token refresh on privilege change · Meridian' },
  { id: WORKER_FREE.id, name: WORKER_FREE.name, state: 'free', detail: '12.4 GB memory free' },
  { id: WORKER_OFFLINE.id, name: WORKER_OFFLINE.name, state: 'offline', detail: 'Not connected' },
]

const NOVEMBER = { days: 30, today: 22, name: 'November', first: '1 Nov', last: '30 Nov', next: '1 December' }

/** How a month's spend falls on its days: little at weekends, today so far. */
const SHAPE = [0.1, 0.8, 1.1, 0.9, 1.3, 0.7, 0.2, 0.1, 1.0, 1.4, 1.2, 0.8, 1.1, 0.3, 0.1, 0.9, 1.6, 1.3, 1.0, 1.2, 0.2, 0.15]
const dailyOf = (spent: number) => {
  const sum = SHAPE.reduce((n, one) => n + one, 0)
  return SHAPE.map((one) => (spent * one) / sum)
}

/** A home's use of Althar Cloud this month: two tasks running there, well under its $40. */
export const CLOUD_USE: CloudUse = {
  spent: 12.4,
  limit: 40,
  hours: 29.5,
  tasks: 23,
  daily: dailyOf(12.4),
  running: [
    { id: 'task_flaky', title: 'Find the flaky checkout test', project: 'Halyard', mark: Brand.Codex, time: '14 min' },
    { id: 'task_docs', title: 'Write the API docs for webhooks', project: 'Meridian', mark: Brand.ClaudeCode, time: '6 min' },
  ],
  auto: true,
  rate: '$0.42 an hour a task',
  month: NOVEMBER,
}

/** At its limit: nothing new starts there, so tasks wait for a worker. */
export const CLOUD_AT_LIMIT: CloudUse = { ...CLOUD_USE, spent: 40, hours: 95.2, tasks: 71, daily: dailyOf(40), running: [] }
