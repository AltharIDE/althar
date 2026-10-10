import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { ProjectId } from '@althar/domain'
import type { SessionEvent } from '@althar/provider-adapters'
import { SCREENSHOT_PNG } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { artifactPath, Artifacts } from '../src/Artifacts'
import {
  countLines,
  exitIn,
  filesOf,
  handedNow,
  OUTPUT_KEPT,
  OUTPUT_STREAMED,
  Output,
  outputOf,
  PICTURE_KEPT,
  picturesOf,
} from '../src/handed'
import { Sessions } from '../src/Sessions'
import { recorder } from '../src/threads'
import { items, runtime, task, turns, until } from './support'

const PNG = Buffer.from(SCREENSHOT_PNG, 'base64')

/** A thread with a session on it, and a folder the agent works in, for the recorder to write into. */
const place = Effect.gen(function* () {
  const sessions = yield* Sessions
  const { project, task: created } = yield* task()
  const sessionId = yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
  yield* until(turns(created.threadId), (rows) => rows[0]?.state === 'completed')
  const before = (yield* items(created.threadId)).length
  const folder = mkdtempSync(join(tmpdir(), 'althar-handed-'))
  return { projectId: project.projectId as ProjectId, threadId: created.threadId, sessionId, before, folders: [folder], folder }
})

/** The newest item of the thread with a tool call's id. */
const toolItem = (threadId: string, toolCallId: string) =>
  Effect.map(items(threadId), (rows) => rows.findLast((row) => row.toolCallId === toolCallId)?.content)

/** The pictures a tool call's item keeps, or none. */
const picturesOn = (threadId: string, toolCallId: string) =>
  Effect.map(toolItem(threadId, toolCallId), (content) =>
    Array.isArray(content?.pictures) ? (content.pictures as ReadonlyArray<Record<string, unknown>>) : [],
  )

/** What a stored list holds, or nothing. */
const listOf = (value: unknown): ReadonlyArray<Record<string, unknown>> =>
  Array.isArray(value) ? (value as ReadonlyArray<Record<string, unknown>>) : []

const artifactRows = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  return yield* sql<{ id: string; sha256: string; kind: string; sensitivity: string; mediaType: string; links: number }>`
    SELECT a.id, a.sha256, a.kind, a.sensitivity, a.media_type,
      (SELECT count(*) FROM artifact_links l WHERE l.artifact_id = a.id) AS links
    FROM artifacts a ORDER BY a.created_at, a.rowid`
})

const shot = (toolCallId: string, data = SCREENSHOT_PNG): ReadonlyArray<SessionEvent> => [
  { _tag: 'ToolCall', toolCallId, title: 'browser_take_screenshot', kind: 'other', status: 'in_progress' },
  {
    _tag: 'ToolCallUpdate',
    toolCallId,
    status: 'completed',
    content: [
      { _tag: 'Text', text: 'Took a screenshot.' },
      { _tag: 'Image', data, mimeType: 'image/png' },
    ],
  },
]

describe('what agents hand back', () => {
  it.live('keeps a picture in the artifact store, once, and names it on its item by its digest and size', () =>
    Effect.gen(function* () {
      const where = yield* place
      const record = recorder(where)
      for (const event of [...shot('one'), ...shot('two')]) yield* record.record(event)
      const [first, second] = [yield* toolItem(where.threadId, 'one'), yield* toolItem(where.threadId, 'two')]
      const pictures = first?.pictures as ReadonlyArray<Record<string, unknown>>
      assert.strictEqual(pictures.length, 1)
      assert.deepInclude(pictures[0], { mediaType: 'image/png', bytes: PNG.length, width: 480, height: 300, name: null })
      assert.match(String(pictures[0]?.sha256), /^[0-9a-f]{64}$/)
      assert.deepStrictEqual(second?.pictures, first?.pictures)
      // One artifact, kept once on disk, referred to from both items; nothing of the picture in a row.
      const rows = yield* artifactRows
      assert.deepStrictEqual(
        rows.map((row) => [row.kind, row.sensitivity, row.mediaType, row.links]),
        [['image', 'may_contain_secrets', 'image/png', 2]],
      )
      const root = (yield* Artifacts).root ?? ''
      assert.isTrue(existsSync(artifactPath(root, rows[0]?.sha256 ?? '')))
      const sql = yield* SqlClient.SqlClient
      const stored = yield* sql<{ content: string }>`SELECT content FROM thread_items WHERE thread_id = ${where.threadId}`
      assert.isFalse(stored.some((row) => row.content.includes(SCREENSHOT_PNG.slice(0, 40))))
      // The same picture said again on the same call is still one.
      yield* record.record(shot('one')[1] as SessionEvent)
      assert.strictEqual((yield* picturesOn(where.threadId, 'one')).length, 1)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('says why a picture wasn’t kept: too large, or a kind the window doesn’t draw', () =>
    Effect.gen(function* () {
      const where = yield* place
      const record = recorder(where)
      const huge = 'A'.repeat(Math.ceil((PICTURE_KEPT * 4) / 3) + 8)
      for (const event of shot('huge', huge)) yield* record.record(event)
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')
      for (const event of shot('svg', svg)) yield* record.record(event)
      yield* record.record({ _tag: 'ToolCall', toolCallId: 'blob', title: 'Fetch', kind: 'fetch', status: 'completed' })
      yield* record.record({
        _tag: 'ToolCallUpdate',
        toolCallId: 'blob',
        content: [
          { _tag: 'Embedded', uri: 'file:///w/a.png', mimeType: 'image/png', blob: SCREENSHOT_PNG },
          { _tag: 'Embedded', uri: 'file:///w/a.md', mimeType: 'text/markdown', text: '# A secret' },
        ],
      })
      assert.deepInclude((yield* picturesOn(where.threadId, 'huge'))[0], {
        why: 'too_large',
        sha256: null,
      })
      assert.deepInclude((yield* picturesOn(where.threadId, 'svg'))[0], {
        why: 'unsupported',
        sha256: null,
      })
      const embedded = yield* toolItem(where.threadId, 'blob')
      assert.deepInclude(listOf(embedded?.pictures)[0], { name: 'a.png', width: 480 })
      assert.isFalse(JSON.stringify(embedded).includes('secret'))
    }).pipe(Effect.provide(runtime())),
  )

  it.live('reads a picture a link points at only from inside the folders the agent works in', () =>
    Effect.gen(function* () {
      const where = yield* place
      const record = recorder(where)
      writeFileSync(join(where.folder, 'shot.png'), PNG)
      writeFileSync(join(where.folder, 'report.csv'), 'a,b\n1,2\n')
      const outside = mkdtempSync(join(tmpdir(), 'althar-outside-'))
      writeFileSync(join(outside, 'private.png'), PNG)
      symlinkSync(join(outside, 'private.png'), join(where.folder, 'linked.png'))
      writeFileSync(join(where.folder, 'big.png'), Buffer.alloc(PICTURE_KEPT + 1))
      mkdirSync(join(where.folder, 'folder.png'))
      yield* record.record({ _tag: 'ToolCall', toolCallId: 'view', title: 'View Image shot.png', kind: 'read', status: 'completed' })
      yield* record.record({
        _tag: 'ToolCallUpdate',
        toolCallId: 'view',
        content: [
          { _tag: 'Link', uri: join(where.folder, 'shot.png'), name: join(where.folder, 'shot.png') },
          { _tag: 'Link', uri: pathToFileURL(join(outside, 'private.png')).href, name: 'private.png', mimeType: 'image/png' },
          { _tag: 'Link', uri: 'linked.png', name: 'linked.png' },
          { _tag: 'Link', uri: 'big.png', name: 'big.png' },
          { _tag: 'Link', uri: 'folder.png', name: 'folder.png' },
          { _tag: 'Link', uri: 'https://example.com/a.png', name: 'a.png' },
          { _tag: 'Link', uri: 'file://%zz', name: 'broken.png' },
          { _tag: 'Link', uri: `data:image/png;base64,${SCREENSHOT_PNG}`, name: 'image', title: 'Inline' },
          { _tag: 'Link', uri: 'report.csv', name: 'report.csv', mimeType: 'text/csv', size: 8, title: 'The report' },
          { _tag: 'Link', uri: 'missing.txt', name: 'missing.txt' },
        ],
      })
      const viewed = yield* toolItem(where.threadId, 'view')
      const pictures = viewed?.pictures as ReadonlyArray<Record<string, unknown>>
      assert.deepStrictEqual(
        pictures.map((picture) => [picture.name, picture.why ?? 'kept']),
        [
          ['shot.png', 'kept'],
          ['big.png', 'too_large'],
          // The data address's picture is the same picture as the file's: one is enough.
        ],
      )
      assert.deepStrictEqual(viewed?.files, [
        { path: join(where.folder, 'report.csv'), how: 'linked', mediaType: 'text/csv', bytes: 8, title: 'The report' },
      ])
    }).pipe(Effect.provide(runtime())),
  )

  it.live('keeps a picture and a file in a message with its words, written as they come', () =>
    Effect.gen(function* () {
      const where = yield* place
      const record = recorder(where)
      writeFileSync(join(where.folder, 'notes.md'), '# Notes\n')
      // A picture before any words starts the message.
      yield* record.record({ _tag: 'AgentContent', content: { _tag: 'Image', data: SCREENSHOT_PNG, mimeType: 'image/png' } })
      yield* record.record({ _tag: 'AgentMessage', text: 'Here ' })
      yield* record.record({
        _tag: 'AgentContent',
        content: { _tag: 'Link', uri: 'notes.md', name: 'notes.md', mimeType: 'text/markdown' },
      })
      // A link that leads nowhere adds nothing.
      yield* record.record({ _tag: 'AgentContent', content: { _tag: 'Link', uri: 'https://example.com', name: 'example' } })
      const [written] = (yield* items(where.threadId)).slice(where.before)
      assert.strictEqual(listOf(written?.content.pictures).length, 1)
      yield* record.record({ _tag: 'AgentMessage', text: 'it is.' })
      // A thought between closes the message, which keeps what it had.
      yield* record.record({ _tag: 'AgentThought', text: 'Done' })
      yield* record.flush
      const [message, thought] = (yield* items(where.threadId)).slice(where.before)
      assert.strictEqual(message?.content.text, 'Here it is.')
      assert.deepStrictEqual(
        listOf(message?.content.files).map((file) => [file.path, file.how]),
        [[join(where.folder, 'notes.md'), 'linked']],
      )
      assert.deepStrictEqual(thought?.content, { text: 'Done' })
    }).pipe(Effect.provide(runtime())),
  )

  it.live('notes the files a tool made or wrote whole, by path, and nothing for an edit', () =>
    Effect.gen(function* () {
      const where = yield* place
      const record = recorder(where)
      yield* record.record({
        _tag: 'ToolCall',
        toolCallId: 'made',
        title: 'Write docs/plan.md',
        kind: 'edit',
        status: 'completed',
        content: [
          { _tag: 'Diff', path: '/w/docs/plan.md', created: true },
          { _tag: 'Diff', path: '/w/src/a.ts', created: false },
        ],
      })
      // OpenCode's write: its whole content in its input, and no diff.
      yield* record.record({
        _tag: 'ToolCall',
        toolCallId: 'whole',
        title: 'docs/notes.md',
        kind: 'edit',
        status: 'completed',
        rawInput: { filePath: '/w/docs/notes.md', content: '# Notes' },
      })
      yield* record.record({
        _tag: 'ToolCall',
        toolCallId: 'edit',
        title: 'Edit README.md',
        kind: 'edit',
        status: 'completed',
        rawInput: { file_path: '/w/README.md', old_string: 'a', new_string: 'b', content: 'x' },
      })
      const paths = (toolCallId: string) =>
        Effect.map(toolItem(where.threadId, toolCallId), (content) =>
          ((content?.files ?? []) as ReadonlyArray<Record<string, unknown>>).map((file) => [file.path, file.how]),
        )
      assert.deepStrictEqual(yield* paths('made'), [['/w/docs/plan.md', 'wrote']])
      assert.deepStrictEqual(yield* paths('whole'), [['/w/docs/notes.md', 'wrote']])
      assert.deepStrictEqual(yield* paths('edit'), [])
    }).pipe(Effect.provide(runtime())),
  )
})

describe('a command’s output', () => {
  it.live('streams as it comes, and its end is kept with its exit once it ends', () =>
    Effect.gen(function* () {
      const where = yield* place
      const record = recorder(where)
      yield* record.record({
        _tag: 'ToolCall',
        toolCallId: 'run',
        title: 'npm test',
        kind: 'execute',
        status: 'in_progress',
        rawInput: { command: 'npm test' },
        content: [{ _tag: 'Terminal', terminalId: 'run' }],
      })
      assert.deepStrictEqual(record.outputsSoFar(), [])
      yield* record.record({ _tag: 'ToolCallUpdate', toolCallId: 'run', terminal: { output: ' ✓ a\n' } })
      yield* record.record({ _tag: 'ToolCallUpdate', toolCallId: 'run', terminal: { output: ' ✓ b\n' } })
      const item = (yield* items(where.threadId)).findLast((row) => row.toolCallId === 'run')
      const [soFar] = record.outputsSoFar()
      assert.deepStrictEqual(soFar?.text, ' ✓ a\n ✓ b\n')
      assert.strictEqual(soFar?.dropped, 0)
      // Nothing new since: nothing to send.
      assert.deepStrictEqual(record.outputsSoFar(), [])
      // Not in the row while it runs.
      assert.isUndefined(item?.content.output)
      yield* record.record({
        _tag: 'ToolCallUpdate',
        toolCallId: 'run',
        status: 'completed',
        terminal: { exit: { code: 0, signal: null } },
      })
      const done = yield* toolItem(where.threadId, 'run')
      assert.deepInclude(done?.output as object, { lines: 2, bytes: Buffer.byteLength(' ✓ a\n ✓ b\n'), dropped: 0 })
      assert.strictEqual(done?.exit, 0)
      const kept = (yield* artifactRows).find((row) => row.kind === 'log')
      assert.deepStrictEqual([kept?.sensitivity, kept?.mediaType], ['may_contain_secrets', 'text/plain; charset=utf-8'])
      const bytes = yield* (yield* Artifacts).read(kept?.sha256 ?? '')
      assert.strictEqual(new TextDecoder().decode(bytes ?? new Uint8Array()), ' ✓ a\n ✓ b\n')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('takes OpenCode’s output whole each time, and its exit from its raw output; and Claude Code’s fenced output unfenced', () =>
    Effect.gen(function* () {
      const where = yield* place
      const record = recorder(where)
      yield* record.record({ _tag: 'ToolCall', toolCallId: 'words', title: 'git status', kind: 'execute', status: 'pending' })
      yield* record.record({
        _tag: 'ToolCallUpdate',
        toolCallId: 'words',
        status: 'in_progress',
        content: [{ _tag: 'Text', text: ' M a\n' }],
      })
      yield* record.record({
        _tag: 'ToolCallUpdate',
        toolCallId: 'words',
        // A command that exits with a code of its own is a completed call to OpenCode, the code in its metadata.
        status: 'completed',
        content: [{ _tag: 'Text', text: ' M a\n?? b\n' }],
        rawOutput: { output: ' M a\n?? b\n', metadata: { exit: 3 } },
      })
      const words = yield* toolItem(where.threadId, 'words')
      assert.deepInclude(words?.output as object, { lines: 2 })
      assert.strictEqual(words?.exit, 3)
      yield* record.record({ _tag: 'ToolCall', toolCallId: 'fenced', title: 'ls', kind: 'execute', status: 'pending' })
      yield* record.record({
        _tag: 'ToolCallUpdate',
        toolCallId: 'fenced',
        status: 'completed',
        content: [{ _tag: 'Text', text: '```console\na\nb\n```' }],
      })
      const fenced = yield* toolItem(where.threadId, 'fenced')
      assert.deepInclude(fenced?.output as object, { lines: 2, bytes: 4 })
      // A read's words are its file's contents: not output, and not kept.
      yield* record.record({
        _tag: 'ToolCall',
        toolCallId: 'read',
        title: 'Read .env',
        kind: 'read',
        status: 'completed',
        content: [{ _tag: 'Text', text: 'TOKEN=secret' }],
      })
      assert.isUndefined((yield* toolItem(where.threadId, 'read'))?.output)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('keeps what a command printed when OpenCode says it failed or was stopped, and what it said of that beside it', () =>
    Effect.gen(function* () {
      const where = yield* place
      const record = recorder(where)
      // Its output so far, whole each time; then its error report, which is the error and not its output.
      yield* record.record({ _tag: 'ToolCall', toolCallId: 'aborted', title: 'npm run build', kind: 'execute', status: 'pending' })
      yield* record.record({
        _tag: 'ToolCallUpdate',
        toolCallId: 'aborted',
        status: 'in_progress',
        content: [{ _tag: 'Text', text: 'compiling\nwarning: unused import\n' }],
        rawOutput: { output: '', metadata: { output: 'compiling\nwarning: unused import\n' } },
      })
      yield* record.record({
        _tag: 'ToolCallUpdate',
        toolCallId: 'aborted',
        status: 'failed',
        content: [{ _tag: 'Text', text: 'Tool execution aborted' }],
        rawOutput: { error: 'Tool execution aborted', metadata: {} },
      })
      const aborted = yield* toolItem(where.threadId, 'aborted')
      assert.deepInclude(aborted?.output as object, { lines: 2, error: 'Tool execution aborted' })
      const kept = (yield* artifactRows).find((row) => row.kind === 'log')
      const bytes = yield* (yield* Artifacts).read(kept?.sha256 ?? '')
      assert.strictEqual(new TextDecoder().decode(bytes ?? new Uint8Array()), 'compiling\nwarning: unused import\n')
      // An error report that carries its output whole, in its metadata: that is its output.
      yield* record.record({ _tag: 'ToolCall', toolCallId: 'failed', title: 'npm test', kind: 'execute', status: 'pending' })
      yield* record.record({
        _tag: 'ToolCallUpdate',
        toolCallId: 'failed',
        status: 'failed',
        content: [{ _tag: 'Text', text: 'Command timed out' }],
        rawOutput: { error: 'Command timed out', metadata: { output: 'a\nb\nc\n' } },
      })
      assert.deepInclude((yield* toolItem(where.threadId, 'failed'))?.output as object, { lines: 3, error: 'Command timed out' })
      // On success, its metadata's output is the whole of it, over the words it gave.
      yield* record.record({ _tag: 'ToolCall', toolCallId: 'ok', title: 'ls', kind: 'execute', status: 'pending' })
      yield* record.record({
        _tag: 'ToolCallUpdate',
        toolCallId: 'ok',
        status: 'completed',
        content: [{ _tag: 'Text', text: 'b\n\n<bash_metadata>truncated</bash_metadata>' }],
        rawOutput: { output: 'b', metadata: { output: 'a\nb\n', exit: 0 } },
      })
      assert.deepInclude((yield* toolItem(where.threadId, 'ok'))?.output as object, { lines: 2, error: null })
    }).pipe(Effect.provide(runtime())),
  )

  it.live('says a command printed nothing, keeps what a stopped turn left, and keeps a long one’s end', () =>
    Effect.gen(function* () {
      const where = yield* place
      const record = recorder(where)
      yield* record.record({ _tag: 'ToolCall', toolCallId: 'quiet', title: 'true', kind: 'execute', status: 'pending' })
      yield* record.record({
        _tag: 'ToolCallUpdate',
        toolCallId: 'quiet',
        status: 'completed',
        terminal: { exit: { code: 0, signal: null } },
      })
      assert.deepStrictEqual((yield* toolItem(where.threadId, 'quiet'))?.output, {
        artifactId: null,
        sha256: null,
        lines: 0,
        bytes: 0,
        dropped: 0,
        error: null,
      })
      yield* record.record({ _tag: 'ToolCall', toolCallId: 'dev', title: 'npm run dev', kind: 'execute', status: 'in_progress' })
      yield* record.record({ _tag: 'ToolCallUpdate', toolCallId: 'dev', terminal: { output: 'ready\n' } })
      yield* record.end
      const left = yield* toolItem(where.threadId, 'dev')
      assert.deepInclude(left?.output as object, { lines: 1 })
      assert.strictEqual(left?.status, 'in_progress')
      assert.deepStrictEqual(record.outputsSoFar(), [])
    }).pipe(Effect.provide(runtime())),
  )

  it.live('keeps what an ended command printed whatever comes after, in its turn or a later one', () =>
    Effect.gen(function* () {
      const where = yield* place
      const record = recorder(where)
      yield* record.record({ _tag: 'ToolCall', toolCallId: 'done', title: 'npm test', kind: 'execute', status: 'in_progress' })
      yield* record.record({ _tag: 'ToolCallUpdate', toolCallId: 'done', terminal: { output: 'passed\n' } })
      yield* record.record({
        _tag: 'ToolCallUpdate',
        toolCallId: 'done',
        status: 'completed',
        terminal: { exit: { code: 0, signal: null } },
      })
      // What an agent says of a call after it ended: its name again, its status again.
      yield* record.record({ _tag: 'ToolCallUpdate', toolCallId: 'done', title: 'npm test' })
      yield* record.record({ _tag: 'ToolCallUpdate', toolCallId: 'done', status: 'completed', terminal: { output: 'late\n' } })
      yield* record.end
      const kept = yield* toolItem(where.threadId, 'done')
      assert.deepInclude(kept?.output as object, { lines: 1, bytes: 7 })
      assert.strictEqual(kept?.exit, 0)
      // A later turn's recorder hears of it too, and changes nothing.
      const next = recorder(where)
      yield* next.record({ _tag: 'ToolCallUpdate', toolCallId: 'done', title: 'npm test' })
      yield* next.end
      assert.deepInclude((yield* toolItem(where.threadId, 'done'))?.output as object, { lines: 1, bytes: 7 })
      assert.isUndefined(next.outputOf('anything'))
    }).pipe(Effect.provide(runtime())),
  )

  it.live('names a file written by a relative path from where the agent works', () =>
    Effect.gen(function* () {
      const where = yield* place
      const record = recorder(where)
      yield* record.record({
        _tag: 'ToolCall',
        toolCallId: 'relative',
        title: 'Write README.md',
        kind: 'edit',
        status: 'completed',
        content: [{ _tag: 'Diff', path: 'README.md', created: true }],
      })
      assert.deepStrictEqual(
        listOf((yield* toolItem(where.threadId, 'relative'))?.files).map((file) => file.path),
        [join(where.folder, 'README.md')],
      )
    }).pipe(Effect.provide(runtime())),
  )

  it('keeps a long output to its limit in bytes, and counts each line that goes once', () => {
    const wide = new Output('wide')
    // Three bytes a character: the limit is bytes, as it is kept.
    for (let i = 0; i < 3; i += 1) wide.add(`${'✓'.repeat(100_000)}\n`)
    assert.isAtMost(Buffer.byteLength(wide.text), OUTPUT_KEPT)
    assert.strictEqual(wide.dropped, 2)
    // One line that never ends, cut again and again, is one line when it ends.
    const long = new Output('long')
    for (let i = 0; i < 10; i += 1) long.add('z'.repeat(OUTPUT_KEPT / 2))
    assert.strictEqual(long.dropped, 0)
    long.add('\nnext\n')
    long.add('w'.repeat(OUTPUT_KEPT))
    assert.strictEqual(long.dropped, 2)
    // Cut part way through a character, it starts at the next whole one.
    const cut = new Output('cut')
    cut.add('é'.repeat(OUTPUT_KEPT))
    assert.isFalse(cut.text.startsWith('\uFFFD'))
    assert.isAtMost(Buffer.byteLength(cut.text), OUTPUT_KEPT)
  })

  it('keeps a long output’s end, cut at a line, and sends watchers its last lines', () => {
    const output = new Output('item')
    const line = `${'x'.repeat(99)}\n`
    for (let i = 0; i < 3_000; i += 1) output.add(line)
    assert.isAtMost(output.text.length, OUTPUT_KEPT)
    assert.isTrue(output.text.startsWith('x'))
    assert.strictEqual(output.dropped + countLines(output.text), 3_000)
    const tail = output.tail()
    assert.strictEqual(countLines(tail.text), OUTPUT_STREAMED)
    assert.strictEqual(tail.dropped + OUTPUT_STREAMED, 3_000)
    // One long line with no end in sight is cut where it must be.
    const wide = new Output('wide')
    wide.add('y'.repeat(OUTPUT_KEPT + 10))
    assert.strictEqual(wide.text.length, OUTPUT_KEPT)
    // Replaced whole, it starts again.
    wide.replace('a\nb')
    assert.deepStrictEqual([wide.text, wide.dropped, countLines(wide.text)], ['a\nb', 0, 2])
  })

  it.live('without a store, says what it can and keeps nothing', () =>
    Effect.gen(function* () {
      const where = yield* place
      const record = recorder(where)
      for (const event of shot('unkept')) yield* record.record(event)
      assert.deepInclude((yield* picturesOn(where.threadId, 'unkept'))[0], {
        why: 'unkept',
        width: 480,
        height: 300,
      })
      yield* record.record({ _tag: 'ToolCall', toolCallId: 'run', title: 'ls', kind: 'execute', status: 'pending' })
      yield* record.record({ _tag: 'ToolCallUpdate', toolCallId: 'run', status: 'completed', terminal: { output: 'a\n' } })
      assert.deepInclude((yield* toolItem(where.threadId, 'run'))?.output as object, { sha256: null, lines: 1 })
      assert.isNull(yield* (yield* Artifacts).read('0'.repeat(64)))
      assert.deepStrictEqual(yield* artifactRows, [])
    }).pipe(Effect.provide(runtime(':memory:', {}, { artifactsRoot: null }))),
  )

  it.live('keeps nothing where its file can’t be written, and goes on', () =>
    Effect.gen(function* () {
      const where = yield* place
      const record = recorder(where)
      for (const event of shot('blocked')) yield* record.record(event)
      assert.deepInclude((yield* picturesOn(where.threadId, 'blocked'))[0], { why: 'unkept' })
    }).pipe(
      Effect.provide(
        runtime(
          ':memory:',
          {},
          {
            artifactsRoot: (() => {
              // A file where the store's folder should be.
              const blocked = join(mkdtempSync(join(tmpdir(), 'althar-blocked-')), 'store')
              writeFileSync(blocked, 'not a folder')
              return blocked
            })(),
          },
        ),
      ),
    ),
  )
})

describe('what an item keeps, as a screen reads it', () => {
  it('reads pictures by digest, says why one wasn’t kept, and passes over what isn’t one', () => {
    assert.deepStrictEqual(picturesOf('none'), [])
    assert.deepStrictEqual(
      picturesOf([
        { sha256: 'a'.repeat(64), mediaType: 'image/png', bytes: 10, width: 4, height: 3, name: 'a.png' },
        { sha256: null, why: 'too_large', bytes: 'lots', width: Number.NaN },
        { sha256: null },
        'not a picture',
        null,
      ]),
      [
        { digest: 'a'.repeat(64), mediaType: 'image/png', bytes: 10, width: 4, height: 3, name: 'a.png', unkept: null },
        { digest: null, mediaType: '', bytes: 0, width: null, height: null, name: null, unkept: 'too_large' },
      ],
    )
  })

  it('reads files by path and how, and an output once it ended', () => {
    assert.deepStrictEqual(filesOf({}), [])
    assert.deepStrictEqual(
      filesOf([
        { path: '/w/a.md', how: 'wrote' },
        { path: '', how: 'wrote' },
        { path: '/w/b.md', how: 'read' },
        { path: '/w/c.csv', how: 'linked', mediaType: 'text/csv', bytes: 4, title: 'C' },
      ]),
      [
        { path: '/w/a.md', how: 'wrote', mediaType: null, bytes: null, title: null },
        { path: '/w/c.csv', how: 'linked', mediaType: 'text/csv', bytes: 4, title: 'C' },
      ],
    )
    assert.isNull(outputOf(undefined))
    assert.isNull(outputOf(null))
    assert.deepStrictEqual(outputOf({ sha256: 'a'.repeat(64), lines: 2, bytes: 4, dropped: 1, error: 'Aborted' }), {
      kept: true,
      lines: 2,
      bytes: 4,
      dropped: 1,
      error: 'Aborted',
    })
    assert.deepStrictEqual(outputOf('odd'), { kept: false, lines: 0, bytes: 0, dropped: 0, error: null })
  })

  it('finds OpenCode’s exit code only where it is', () => {
    assert.strictEqual(exitIn({ metadata: { exit: 2 } }), 2)
    assert.isNull(exitIn({ metadata: { exit: '2' } }))
    assert.isNull(exitIn({ metadata: null }))
    assert.isNull(exitIn('2'))
    assert.isNull(exitIn(null))
  })

  it.live('names a picture too large to keep by where it came from, and follows no link without a folder', () =>
    Effect.gen(function* () {
      const where = { projectId: 'prj_0' as ProjectId, itemId: 'item_0', folders: [] }
      const huge = 'A'.repeat(Math.ceil((PICTURE_KEPT * 4) / 3) + 8)
      const named = yield* handedNow(where, { _tag: 'Image', data: huge, mimeType: 'image/png', uri: '/w/shots/full.png' })
      assert.deepInclude(named.pictures[0], { name: 'full.png', why: 'too_large' })
      assert.deepStrictEqual(yield* handedNow(where, { _tag: 'Link', uri: 'shot.png', name: 'shot.png' }), { pictures: [], files: [] })
      assert.deepStrictEqual(yield* handedNow(where, { _tag: 'Embedded', uri: 'a.png', blob: 'AAAA' }), { pictures: [], files: [] })
    }).pipe(Effect.provide(runtime())),
  )
})
