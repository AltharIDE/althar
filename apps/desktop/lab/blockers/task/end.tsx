import type { AgentStatus } from '@althar/contracts'

import { Card } from '../../../src/renderer/features/project/Card'
import { cardOf } from '../data'
import { move, option, PROJECT, openTask, useStore, useWorld } from '../state'
import { listed, openBlockers, shortOf, specOf, type TaskNow, unstarted, type WorldNow } from '../world'
import { Glyph, taskBySlug, troubled } from './chain'
import c from './task.module.css'

/*
 * What the end of a task's thread holds while it hasn't started: in B, a
 * line for each task it still waits for, where its lead's first words will
 * land, saying how that one stands now (a stuck or abandoned one is said in
 * its own line above); in C, its plan, the card the coordinator showed, as
 * live, until it starts.
 */
export function LabThreadEnd({ slug, agents }: { slug: string; agents: ReadonlyArray<AgentStatus> }) {
  const world = useWorld()
  const way = useStore(option.task)
  const task = taskBySlug(world, slug)
  if (task === undefined || !unstarted(task)) return null
  if (way === 'c')
    return (
      <div className={c.plan}>
        <Card
          card={cardOf(task)}
          actions={{
            project: 'althar',
            projectId: PROJECT,
            agents,
            agentName: (id) => (id === 'codex' ? 'Codex' : 'Claude Code'),
            onStart: () => move({ kind: 'start', key: task.key }),
            onHold: () => move({ kind: 'hold', key: task.key }),
            onChange: () => undefined,
            onCreateBranch: () => undefined,
            onOpen: (threadId) => openTask(threadId.replace(/^th_/, '')),
            onStopBackground: () => undefined,
          }}
        />
      </div>
    )
  if (way !== 'b' || task.phase !== 'waits') return null
  const going = openBlockers(world, task).filter((one) => !troubled(one))
  if (going.length === 0) return null
  return (
    <ul className={c.end} aria-label="What it waits for, now">
      {going.map((one) => (
        <li key={one.key} className={c.endLine}>
          <span className={c.endGlyph}>
            <Glyph task={one} />
          </span>
          <button type="button" className={c.endName} onClick={() => openTask(one.key)} title={specOf(one.key).title}>
            {shortOf(one.key)}
          </button>
          <span>{endWords(world, one)}</span>
        </li>
      ))}
    </ul>
  )
}

const endWords = (world: WorldNow, one: TaskNow): string => {
  switch (one.phase) {
    case 'implement':
      return 'is being implemented'
    case 'review':
      return 'is in review'
    case 'checks':
      return 'is running its checks'
    case 'ready':
      return 'is ready to merge'
    case 'starting':
      return 'is starting'
    default: {
      const before = openBlockers(world, one)
      return before.length > 0 ? `waits for ${listed(before.map((it) => shortOf(it.key)))}` : one.held ? 'is held' : 'hasn’t started'
    }
  }
}
