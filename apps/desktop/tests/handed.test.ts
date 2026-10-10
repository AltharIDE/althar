import type { Picture, ThreadItem } from '@althar/contracts'
import { ToolState } from '@althar/ui'
import { describe, expect, it } from 'vitest'

import {
  bytesText,
  editorPath,
  handedBy,
  kindOf,
  lastTouches,
  linesOf,
  LINES_SHOWN,
  NOTHING_HANDED,
  outputsCaughtUp,
  ranOf,
  shownPath,
  wholePath,
  withOutput,
} from '../src/renderer/shared/handed'
import { blocksOf } from '../src/renderer/shared/thread'
import { items } from './fixtures'

const at = () => 'just now'
const DIGEST = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)

const picture = (overrides: Partial<Picture> = {}): Picture => ({
  digest: DIGEST,
  mediaType: 'image/png',
  bytes: 212 * 1024,
  width: 1440,
  height: 900,
  name: null,
  unkept: null,
  ...overrides,
})

const turnOf = (thread: ReadonlyArray<ThreadItem>, turnRunning = false, outputs = new Map()) => {
  const turn = blocksOf({ items: thread, turnRunning, worktree: '/w/meridian', outputs }, new Map(), at).find(
    (block) => block.kind === 'turn',
  )
  if (turn?.kind !== 'turn') throw new Error('Expected a turn')
  return turn
}

describe('what a turn hands back', () => {
  it('gathers its pictures once each, in order, at their smaller and full size, named by what made them', () => {
    const turn = turnOf([
      items.tool({ title: 'Read assets/logo.png', locations: [{ path: '/w/meridian/assets/logo.png' }], pictures: [picture()] }),
      items.tool({
        title: 'browser_take_screenshot',
        toolKind: 'other',
        pictures: [picture(), picture({ digest: OTHER, name: 'after.png' })],
      }),
      items.hands('Before and after.', { pictures: [picture({ digest: null, unkept: 'too_large', width: null, height: null })] }),
    ])
    expect(turn.handed.pictures).toEqual([
      {
        id: DIGEST,
        name: 'logo.png',
        src: `althar-picture://shot/${DIGEST}`,
        thumb: `althar-picture://shot/${DIGEST}?w=1120`,
        meta: '1440 × 900 · 212 KB',
        width: 1440,
        height: 900,
      },
      expect.objectContaining({ id: OTHER, name: 'after.png' }),
      // One that wasn't kept says why, and doesn't open.
      { id: expect.stringContaining(':0'), name: 'Image 3', status: 'failed', meta: 'Not kept: larger than 20 MB' },
    ])
  })

  it('cards the markdown documents it wrote or pointed at, and other files it pointed at, but not files written in passing', () => {
    const turn = turnOf([
      items.tool({
        title: 'Write docs/plan.md',
        toolKind: 'edit',
        files: [
          { path: '/w/meridian/docs/plan.md', how: 'wrote', mediaType: null, bytes: null, title: null },
          { path: '/w/meridian/src/new.ts', how: 'wrote', mediaType: null, bytes: null, title: null },
        ],
      }),
      // A write that was declined wrote nothing.
      items.tool({
        title: 'Write docs/denied.md',
        toolKind: 'edit',
        declined: true,
        status: 'failed',
        files: [{ path: '/w/meridian/docs/denied.md', how: 'wrote', mediaType: null, bytes: null, title: null }],
      }),
      items.hands('Here.', {
        files: [
          { path: 'file:///w/meridian/report.csv', how: 'linked', mediaType: 'text/csv', bytes: 48 * 1024, title: null },
          { path: '/w/meridian/docs/plan.md', how: 'linked', mediaType: 'text/markdown', bytes: null, title: null },
          { path: '/elsewhere/notes', how: 'linked', mediaType: null, bytes: null, title: null },
        ],
      }),
    ])
    expect(turn.handed.documents.map((file) => [file.shown, file.kind])).toEqual([['docs/plan.md', 'Markdown']])
    expect(turn.handed.files.map((file) => [file.shown, file.kind, file.size])).toEqual([
      ['report.csv', 'CSV', '48 KB'],
      ['/elsewhere/notes', 'File', null],
    ])
  })

  it('hands back nothing for a turn that only worked', () => {
    expect(turnOf([items.tool(), items.says('Done.')]).handed).toBe(NOTHING_HANDED)
    expect(handedBy([], null)).toBe(NOTHING_HANDED)
  })
})

describe('a command in its tool call', () => {
  it('streams while it runs, says how much it printed once it ended, and is nothing for a call that isn’t one', () => {
    const running = items.tool({ title: 'npm test', toolKind: 'execute', status: 'in_progress', command: 'npm test' })
    const streamed = new Map([[running.id, { text: ' ✓ a\n ✓ b', dropped: 3 }]])
    const part = turnOf([running], true, streamed).parts[0]
    expect(part).toMatchObject({
      kind: 'tool',
      state: ToolState.Running,
      ran: { kind: 'running', text: ' ✓ a\n ✓ b', dropped: 3, heard: true },
    })
    // Before the window has heard any of it, what it printed so far is read.
    expect(turnOf([running], true).parts[0]).toMatchObject({ ran: { kind: 'running', text: '', dropped: 0, heard: false } })
    const ended = items.tool({
      title: 'npm test',
      toolKind: 'execute',
      status: 'failed',
      output: { kept: true, lines: 2, bytes: 10, dropped: 0, error: null },
      exit: 1,
    })
    expect(turnOf([ended]).parts[0]).toMatchObject({ ran: { kind: 'ended', output: { lines: 2 } }, exit: 1, state: ToolState.Failed })
    // A read isn't a command; nor is a command from before output was kept, once it ended.
    expect(ranOf({ toolKind: 'read', output: null }, ToolState.Running, undefined)).toBeNull()
    expect(ranOf({ toolKind: 'execute', output: null }, ToolState.Done, undefined)).toBeNull()
    // Output heard for a call of another kind still streams.
    expect(ranOf({ toolKind: 'other', output: null }, ToolState.Running, { text: 'x', dropped: 0 })).toEqual({
      kind: 'running',
      text: 'x',
      dropped: 0,
      heard: true,
    })
  })

  it('shows its last lines, those before them a click away', () => {
    const many = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n')
    const { lines, earlier } = linesOf(`${many}\n`)
    expect(lines).toHaveLength(LINES_SHOWN)
    expect(lines.at(-1)).toBe('line 30')
    expect(earlier).toHaveLength(30 - LINES_SHOWN)
    expect(linesOf('one')).toEqual({ lines: ['one'], earlier: [] })
    expect(linesOf('')).toEqual({ lines: [], earlier: [] })
  })

  it('keeps a command’s output so far until the store has it whole', () => {
    const running = items.tool({ toolKind: 'execute', status: 'in_progress' })
    const outputs = withOutput(new Map(), { itemId: running.id, text: 'a', dropped: 0 })
    expect(outputsCaughtUp(outputs, [running])).toBe(outputs)
    const ended = {
      ...running,
      content: { ...running.content, output: { kept: true, lines: 1, bytes: 1, dropped: 0, error: null } },
    } as ThreadItem
    expect(outputsCaughtUp(outputs, [ended, items.says('x')]).size).toBe(0)
  })
})

describe('files, as people read them', () => {
  it('names paths from the worktree, kinds from their names, and sizes in words', () => {
    expect(shownPath('/w/meridian/docs/a.md', '/w/meridian')).toBe('docs/a.md')
    expect(shownPath('file:///w/meridian/docs/a%20b.md', '/w/meridian')).toBe('docs/a b.md')
    expect(shownPath('/elsewhere/a.md', '/w/meridian')).toBe('/elsewhere/a.md')
    expect(shownPath('docs/a.md', null)).toBe('docs/a.md')
    expect([kindOf('a.md'), kindOf('a.MDX'), kindOf('a.parquet'), kindOf('Makefile')]).toEqual(['Markdown', 'MDX', 'PARQUET', 'File'])
    expect([bytesText(512), bytesText(2048), bytesText(3.5 * 1024 * 1024)]).toEqual(['512 B', '2 KB', '3.5 MB'])
  })

  it('knows a file by its whole path, wherever it was named from', () => {
    expect(wholePath('docs/a.md', '/w/meridian')).toBe('/w/meridian/docs/a.md')
    expect(wholePath('file:///t/web/a%20b.md', '/w/meridian')).toBe('/t/web/a b.md')
    expect(wholePath('/t/web/c.md', null)).toBe('/t/web/c.md')
    expect(wholePath('docs/a.md', null)).toBe('docs/a.md')
  })

  it('opens a file in the editor by its whole path, only inside the task’s folder, where its worktrees are', () => {
    expect(editorPath('docs/a.md', '/t/meridian/task/api')).toBe('/t/meridian/task/api/docs/a.md')
    // Another of the task's repositories is beside the first, in the same folder.
    expect(editorPath('/t/meridian/task/web/b.md', '/t/meridian/task/api')).toBe('/t/meridian/task/web/b.md')
    expect(editorPath('file:///t/meridian/task/web/c%20d.md', '/t/meridian/task/api')).toBe('/t/meridian/task/web/c d.md')
    expect(editorPath('/elsewhere/e.md', '/t/meridian/task/api')).toBeNull()
    expect(editorPath('docs/a.md', null)).toBeNull()
    expect(editorPath('a.md', 'api')).toBeNull()
  })

  it('knows where each file was last touched, so a document is read again after an edit', () => {
    const touched = lastTouches(
      [
        { kind: 'tool', id: 'one', state: 'done', touches: ['/w/meridian/docs/a.md'] },
        { kind: 'message', id: 'two' },
        { kind: 'tool', id: 'three', state: 'running', touches: ['/w/meridian/docs/a.md', '/w/meridian/b.ts'] },
      ],
      '/w/meridian',
    )
    // By which file it is: its whole path.
    expect([...touched]).toEqual([
      ['/w/meridian/docs/a.md', 'three:running'],
      ['/w/meridian/b.ts', 'three:running'],
    ])
  })
})
