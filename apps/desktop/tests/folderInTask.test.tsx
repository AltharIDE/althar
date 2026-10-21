import { describe, expect, it } from 'vitest'

import type { ThreadItem } from '@althar/contracts'
import { TaskStatus } from '@althar/ui'

import { statusOf } from '../src/renderer/features/task/TaskView'
import { roundsOf } from '../src/renderer/shared/rounds'
import { items, snapshot } from './fixtures'

/*
 * A task whose folder went (ADR-056): its thread marks the folder going and
 * coming back as lines across it, apart from Althar's own words and from
 * any round; and while it comes back, the header's chip says so, in blue.
 */

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 21, 12, minutes)).toISOString()
const when = (item: ThreadItem, minutes: number): ThreadItem => ({ ...item, createdAt: at(minutes) })

describe('a task whose folder went', () => {
  it('reads its folder going and coming back as lines of their own, never Althar’s words or a round', () => {
    const blocks = roundsOf(
      {
        items: [
          when(items.notice({ title: 'Merged PR #241 into main.', source: 'runtime' }, null), 1),
          when(
            items.notice({ title: 'Folder removed 3 days after the task finished · 2.3 GB', source: 'runtime', role: 'folder' }, null),
            2,
          ),
          when(items.notice({ title: 'Folder back from its branch', source: 'runtime', role: 'folder' }, null), 3),
        ],
        turnRunning: false,
        worktree: '/w/meridian',
      },
      new Map(),
      () => 'just now',
      at(10),
    )
    expect(blocks.map((block) => [block.kind, 'text' in block ? block.text : null])).toEqual([
      ['althar', 'Merged PR #241 into main.'],
      ['folder', 'Folder removed 3 days after the task finished · 2.3 GB'],
      ['folder', 'Folder back from its branch'],
    ])
  })

  it('says in the header’s chip that its folder is coming back, in blue', () => {
    const settled = snapshot({ task: { ...snapshot().task, phase: 'settled', state: 'done', folder: 'returning' } })
    expect(statusOf(settled)).toEqual({ status: TaskStatus.Running, state: 'Bringing its folder back' })
    const gone = snapshot({ task: { ...snapshot().task, phase: 'settled', state: 'done', folder: 'removed' } })
    expect(statusOf(gone)).toEqual({ status: TaskStatus.Done, state: 'Done' })
  })
})
