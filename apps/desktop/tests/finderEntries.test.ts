import { expect, it } from 'vitest'
import type { SearchDocument } from '@althar/contracts'
import { Room } from '@althar/ui'

import { entriesFor, withTaskActions } from '../src/renderer/features/finder/entries'
import type { Context } from '../src/renderer/features/finder/model'
import { change, project, snapshot } from './fixtures'

const context: Context = { project: 'p1', task: 't1', projects: [{ id: 'p1', name: 'Project' }], usage: {} }
const doc = (over: Partial<SearchDocument> = {}): SearchDocument => ({
  id: 'task:t1',
  kind: 'task',
  projectId: 'p1',
  taskId: 't1',
  threadId: 'th1',
  itemId: null,
  title: 'Task',
  body: '',
  ref: 'task',
  url: null,
  changedAt: '2026-09-29T12:00:00Z',
  state: 'running',
  ...over,
})

it('uses the latest task snapshot for commands and merges, with each change’s stable URL and head', () => {
  const entries = entriesFor([doc(), doc({ id: 'task:t2', taskId: 't2' })], [project], context, [], null)
  expect(withTaskActions(entries, undefined)).toBe(entries)
  const base = snapshot()
  const latest = {
    ...base,
    task: {
      ...base.task,
      id: 't1',
      phase: 'ready' as const,
      actions: ['resume' as const],
      changes: [
        change({ url: 'https://github.com/a/repo/pull/1', number: 1, head: 'first', queued: false }),
        change({ url: 'https://github.com/a/repo/pull/2', number: 2, head: 'second', queued: false }),
        change({ url: 'https://github.com/a/repo/pull/3', number: 3, head: null }),
        change({ url: 'https://github.com/a/repo/pull/4', number: 4, head: 'queued', queued: true }),
        change({ url: 'https://github.com/a/repo/pull/5', number: 5, state: 'closed', head: 'closed' }),
      ],
    },
  }
  const updated = withTaskActions(entries, latest)
  const task = updated.find((entry) => entry.id === 'task:t1')!
  expect(task.acts?.filter((act) => act.go.to === 'merge').map((act) => act.go)).toEqual([
    { to: 'merge', taskId: 't1', head: 'first', url: 'https://github.com/a/repo/pull/1' },
    { to: 'merge', taskId: 't1', head: 'second', url: 'https://github.com/a/repo/pull/2' },
  ])
  expect(task.acts?.map((act) => act.id)).toContain('resume')
  expect(task.acts?.map((act) => act.id)).not.toContain('stop')
  expect(updated.find((entry) => entry.id === 'task:t2')).toBe(entries.find((entry) => entry.id === 'task:t2'))
  const busy = withTaskActions(entries, { ...latest, task: { ...latest.task, phase: 'running', mergeable: undefined, actions: [] } })
  expect(busy.find((entry) => entry.id === 'task:t1')?.acts?.some((act) => act.go.to === 'merge')).toBe(false)
  const mergeable = withTaskActions(entries, { ...latest, task: { ...latest.task, phase: 'running', mergeable: true } })
  expect(mergeable.find((entry) => entry.id === 'task:t1')?.acts?.filter((act) => act.go.to === 'merge')).toHaveLength(2)
})

it('routes notes to settings, project conversations to their exact item, and task messages to their thread item', () => {
  const documents = [
    doc({ id: 'note', kind: 'note', taskId: null, ref: '' }),
    doc({ id: 'conversation', kind: 'conversation', taskId: null, itemId: 'project-message', threadId: 'coordinator' }),
    doc({ id: 'said', kind: 'said', itemId: 'task-message' }),
    doc({ id: 'issue', kind: 'issue', state: 'In progress', url: 'https://linear.app/issue/1', ref: 'DEV-1' }),
    doc({ id: 'pull', kind: 'pull', state: 'open', ref: '#1' }),
  ]
  const entries = entriesFor(documents, [], context, ['src/file.ts'], 'th1')
  const one = (id: string) => entries.find((entry) => entry.id === id)!
  expect(one('note').go).toEqual({ to: 'project', project: 'p1', room: Room.Settings, section: 'notes' })
  expect(one('conversation').go).toEqual({ to: 'project', project: 'p1', room: Room.Talk, at: 'project-message', threadId: 'coordinator' })
  expect(one('said').go).toEqual({ to: 'task', slug: 'th1', at: 'task-message' })
  expect(one('issue').stand?.word).toBe('In progress')
  expect(one('issue').acts?.find((act) => act.id === 'host')?.go).toEqual({ to: 'external', url: 'https://linear.app/issue/1' })
  expect(one('file:th1:src/file.ts')).toMatchObject({ title: 'file.ts', go: { to: 'file', threadId: 'th1', path: 'src/file.ts' } })
  expect(one('file:th1:src/file.ts').acts?.find((act) => act.id === 'copy')?.go).toEqual({ to: 'copy', text: 'src/file.ts' })
})

it('finds a task by all linked issue and PR keys while keeping unlinked records distinct', () => {
  const entries = entriesFor(
    [
      doc({ state: 'stopped' }),
      doc({ id: 'pull', kind: 'pull', ref: '#11' }),
      doc({ id: 'issue', kind: 'issue', ref: 'DEV-12', state: '' }),
      doc({ id: 'unlinked', kind: 'issue', taskId: null, ref: 'DEV-13', state: '' }),
    ],
    [project],
    context,
    [],
    null,
  )
  const task = entries.find((entry) => entry.id === 'task:t1')!
  expect(task.keys).toEqual(['task', '#11', 'DEV-12'])
  expect(task.facts).toEqual(['#11', 'DEV-12'])
  expect(task.acts?.map((act) => act.id)).toContain('resume')
  expect(entries.find((entry) => entry.id === 'unlinked')?.stand).toBeUndefined()
  expect(entries.find((entry) => entry.id === 'action:task:t1:resume')?.go).toEqual({ to: 'command', command: 'resume', taskId: 't1' })
})

it('exposes permissions by their attention id, using the title where no command was supplied', () => {
  const entries = entriesFor([doc()], [project], context, [], null)
  const base = snapshot()
  const permission = {
    id: 'permission',
    kind: 'permission' as const,
    stuck: null,
    title: 'Use tool',
    reason: 'Asked',
    command: null,
    held: true,
    createdAt: '2026-09-29T12:00:00Z',
  }
  const updated = withTaskActions(entries, { ...base, attention: [permission, { ...permission, id: 'command', command: 'git status' }] })
  const actions = updated.find((entry) => entry.id === 'task:t1')?.acts
  expect(actions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'allow:permission', title: 'Allow Use tool', go: { to: 'allow', attentionId: 'permission' } }),
      expect.objectContaining({ id: 'allow:command', title: 'Allow git status', go: { to: 'allow', attentionId: 'command' } }),
    ]),
  )
})
