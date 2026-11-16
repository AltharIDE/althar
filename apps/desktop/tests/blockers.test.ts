import { describe, expect, it } from 'vitest'

import type { TaskBlocker } from '@althar/contracts'
import { TaskStatus } from '@althar/ui'

import { blockerWords, openBlockers } from '../src/renderer/shared/blockers'
import { taskStatusOf } from '../src/renderer/shared/taskStatus'
import { statusOf } from '../src/renderer/features/task/TaskView'
import { snapshot } from './fixtures'

/*
 * A task that waits for other tasks says so the same way on its row in Up
 * next and in its header: when it starts, by what it waits for; and that it
 * waits on the person once one of them was abandoned.
 */

const blocker = (title: string, stands: TaskBlocker['stands']): TaskBlocker => ({
  taskId: `t_${title}`,
  slug: title.toLowerCase(),
  title,
  threadId: `th_${title}`,
  stands,
})

const standing = { queued: null, waits: null }

describe('a task that waits for other tasks', () => {
  it('starts when what it still waits for merges, merged ones left out', () => {
    const waitsFor = [blocker('Host service', 'merged'), blocker('Sealing', 'working'), blocker('Pairing', 'review')]
    expect(openBlockers({ phase: 'planned', waitsFor }).map((one) => one.title)).toEqual(['Sealing', 'Pairing'])
    expect(blockerWords({ phase: 'planned', waitsFor })).toBe('Starts when Sealing and Pairing merge')
    expect(blockerWords({ phase: 'planned', waitsFor: [blocker('Pairing', 'planned')] })).toBe('Starts when Pairing merges')
    expect(taskStatusOf({ ...standing, phase: 'planned', waitsFor })).toBe(TaskStatus.Queued)
  })

  it('held, it waits for the person too', () => {
    expect(blockerWords({ phase: 'held', waitsFor: [blocker('Pairing', 'working')] })).toBe('Held. Starts when Pairing merges, and you say')
  })

  it('waits on the person once one of them was abandoned', () => {
    const waitsFor = [blocker('Pairing', 'working'), blocker('Sealing', 'abandoned')]
    expect(blockerWords({ phase: 'planned', waitsFor })).toBe('Sealing was abandoned')
    expect(taskStatusOf({ ...standing, phase: 'planned', waitsFor })).toBe(TaskStatus.Yours)
  })

  it('says nothing of them once it started, or once they all merged', () => {
    expect(blockerWords({ phase: 'running', waitsFor: [blocker('Pairing', 'working')] })).toBeNull()
    expect(blockerWords({ phase: 'planned', waitsFor: [blocker('Pairing', 'merged')] })).toBeNull()
    expect(taskStatusOf({ ...standing, phase: 'planned', waitsFor: [blocker('Pairing', 'merged')] })).toBe(TaskStatus.Running)
  })

  it('says so in its header, as its row does', () => {
    const shown = snapshot()
    const waiting = { ...shown, task: { ...shown.task, phase: 'planned' as const, waitsFor: [blocker('Pairing', 'review')] } }
    expect(statusOf(waiting)).toEqual({ status: TaskStatus.Queued, state: 'Starts when Pairing merges' })
  })
})
