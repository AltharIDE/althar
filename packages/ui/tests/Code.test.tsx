import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Lexer } from 'marked'
import { describe, expect, it, vi } from 'vitest'

import {
  decisionChange,
  decisionFound,
  decisionRead,
  limitFn,
  limitsFound,
  limitsMissing,
  limitsMoved,
  limitsRead,
  limitsRewritten,
  modelSeveral,
} from '../src/fixtures/code'
import { DiffLineKind } from '../src/foundations/vocabulary'
import { isProse, languageOf, useColoured } from '../src/lib/syntax'
import {
  codeKey,
  copyOf,
  firstMode,
  type FoundCode,
  panelMode,
  type FoundFile,
  lineToOpen,
  markOf,
  mayBeCode,
  PLAIN_PATH,
  withoutLines,
} from '../src/thread/Code/code'
import { CodeLines } from '../src/thread/Code/CodeLines'
import { CodePanel, modesOf } from '../src/thread/Code/CodeView'
import { codeNamesIn, Markdown } from '../src/thread/Markdown/Markdown'
import { type CodeShell, ThreadShellProvider } from '../src/thread/Shell/Shell'

describe('the names an agent writes', () => {
  it('asks about a path, a file’s name, its lines and a name in code, never a command, a value or a word', () => {
    for (const name of [
      'packages/runtime/src/Runs.ts:359',
      'Runs.ts',
      'src/a.ts#L3-L9',
      'listEditors()',
      'CodeHost',
      'DOCUMENT_READ',
      'default_base_ref',
      '.gitignore',
      'apps/desktop',
    ])
      expect(mayBeCode(name), name).toBe(true)
    for (const word of ['npm test', 'main', 'API', '1.2.3', '--force', 'https://github.com/a/b.ts', '"quoted"', '{a: 1}', 'void()', 'x'])
      expect(mayBeCode(word), word).toBe(false)
  })

  it('finds paths in the words, with their lines, but not inside an address or a word that isn’t one', () => {
    const paths = (text: string) => [...text.matchAll(PLAIN_PATH)].map((match) => match[0])
    expect(paths('See packages/ui/src/index.ts:12 and README.md, then retry.ts.')).toEqual([
      'packages/ui/src/index.ts:12',
      'README.md',
      'retry.ts',
    ])
    expect(paths('It is at https://github.com/althar/althar/blob/main/a.ts today')).toEqual([])
    expect(paths('Node.js, e.g. this, or 1.2.3 and ~/notes/a.md')).toEqual([])
  })

  it('collects a text’s names once, in order: in backticks and in its words, never in a link or a code block', () => {
    const source = [
      '# In `src/a.ts`',
      '',
      'Read `src/a.ts` and `npm test`, then docs/plan.md and [the `b.ts` file](https://x.test/b.ts).',
      '',
      '- `listEditors()` in a list',
      '',
      '| File | Why |',
      '| --- | --- |',
      '| `c.ts` | a table |',
      '',
      '```',
      'src/in/a/block.ts',
      '```',
    ].join('\n')
    expect(codeNamesIn(Lexer.lex(source))).toEqual(['src/a.ts', 'docs/plan.md', 'listEditors()', 'c.ts'])
  })

  it('marks the lines named where they are now, as they were when rewritten, and none past the end', () => {
    expect(markOf(limitsFound, 'now')).toEqual({ line: 22, end: 33 })
    expect(markOf(limitsMoved, 'now')).toEqual({ line: 17, end: 17 })
    expect(markOf(limitsMoved, 'then')).toEqual({ line: 13, end: 13 })
    expect(markOf(limitsRewritten, 'now')).toBeNull()
    expect(markOf(limitsRewritten, 'then')).toEqual({ line: 30, end: 30 })
    expect(markOf({ ...limitsFound, line: 400 }, 'now')).toBeNull()
    expect(markOf(decisionFound, 'now')).toBeNull()
    expect([firstMode(limitsRewritten), firstMode(limitsMoved), firstMode(modelSeveral)]).toEqual(['then', 'now', 'now'])
  })

  it('opens and copies a file at the line named, where it is now', () => {
    expect([
      lineToOpen(limitsFound),
      lineToOpen(limitsMoved),
      lineToOpen(limitsRewritten),
      lineToOpen({ ...limitsFound, line: 400 }),
    ]).toEqual([22, 17, 30, undefined])
    expect([copyOf(limitsMoved), copyOf(limitsMissing), copyOf(modelSeveral), copyOf(decisionFound)]).toEqual([
      'src/refunds/limits.ts:17',
      'src/refund/limit.ts',
      'model.ts',
      'docs/decisions/012-refund-limits.md',
    ])
  })
})

describe('a name without its lines', () => {
  it('keeps what comes before the lines it gives, however it gives them', () => {
    expect(withoutLines('src/runs/Runs.ts:359')).toBe('src/runs/Runs.ts')
    expect(withoutLines('model.ts:12-30')).toBe('model.ts')
    expect(withoutLines('model.ts#L12-L30')).toBe('model.ts')
    expect(withoutLines('model.ts')).toBe('model.ts')
  })

  it('reads a long run of what looks like lines', () => {
    // How long these take is the performance run's (Code.bench.ts): a pattern tried again from each place took seconds.
    expect(withoutLines(`a${':9'.repeat(40_000)}\n!`)).toBe('a')
    expect(withoutLines(`a${':'.repeat(100_000)}`)).toBe(`a${':'.repeat(100_000)}`)
    expect(withoutLines(`a${'#'.repeat(100_000)}`)).toBe(`a${'#'.repeat(100_000)}`)
  })
})

describe('a file’s lines', () => {
  it('knows a file’s language by its name, and prose by its kind', () => {
    expect(['a/b.ts', 'b.tsx', 'c.mjs', 'Dockerfile', 'notes.md', 'x.unknown', 'Makefile', 'README'].map(languageOf)).toEqual([
      'typescript',
      'tsx',
      'javascript',
      'dockerfile',
      'markdown',
      null,
      'make',
      null,
    ])
    expect(['a.md', 'notes.txt', 'LICENSE', 'a.ts', '.gitignore'].map(isProse)).toEqual([true, true, true, false, false])
  })

  it('colours a file in the kit’s inks, once its grammar is read', async () => {
    function Coloured() {
      const lines = useColoured('const limit = 20 // a minute\n', 'a.ts')
      return <div data-testid="lines">{lines?.[0] ?? 'plain'}</div>
    }
    render(<Coloured />)
    await waitFor(() => expect(screen.getByText('const')).toHaveStyle({ color: 'var(--code-keyword, var(--syn-keyword))' }))
    expect(screen.getByText('20')).toHaveStyle({ color: 'var(--code-string, var(--syn-string))' })
    expect(screen.getByText(/a minute/)).toHaveStyle({ fontStyle: 'italic' })
  })

  it('shows a file it doesn’t colour plain', () => {
    function Plain() {
      const lines = useColoured('just words\n', 'notes.unknown')
      return <div>{lines === null ? 'plain' : 'coloured'}</div>
    }
    render(<Plain />)
    expect(screen.getByText('plain')).toBeInTheDocument()
  })

  it('in a peek, shows the lines named and a few around, and more a press at a time', () => {
    render(<CodeLines path="src/refunds/limits.plain" read={limitsRead} mark={{ line: 30, end: 30 }} around={2} />)
    expect(screen.getAllByText(/^\d+$/).map((n) => n.textContent)).toEqual(['28', '29', '30', '31', '32'])
    fireEvent.click(screen.getByRole('button', { name: /lines below/ }))
    expect(screen.getAllByText(/^\d+$/)).toHaveLength(5 + 8)
    fireEvent.click(screen.getByRole('button', { name: /lines above/ }))
    expect(screen.getAllByText(/^\d+$/)[0]?.textContent).toBe('8')
  })

  it('says what it left out that wasn’t read, which the editor has', () => {
    render(
      <CodeLines path="big.ts" read={{ text: 'a\nb\nc\n', from: 400, total: 9000, cut: true }} mark={{ line: 401, end: 401 }} around={1} />,
    )
    expect(screen.getByText('399 lines above, in your editor')).toBeInTheDocument()
    expect(screen.getByText('8,598 lines below, in your editor')).toBeInTheDocument()
  })
})

describe('names in a message, with a host that finds code', () => {
  const host = (found: ReadonlyMap<string, FoundCode>, more: Partial<CodeShell> = {}): CodeShell => ({
    useFound: () => found,
    peek: () => null,
    open: vi.fn(),
    ...more,
  })

  it('makes what it found a name to open, and leaves the rest code text, and words in a link words', () => {
    const code = host(new Map([['checkRefundLimit', limitFn]]))
    render(
      <ThreadShellProvider value={{ code }}>
        <Markdown source="`checkRefundLimit` counts. See [`checkRefundLimit`](https://x.test). Run `npm test`." />
      </ThreadShellProvider>,
    )
    const chip = screen.getByRole('button', { name: 'Open src/refunds/limits.ts:22' })
    expect(chip).toHaveTextContent('checkRefundLimit')
    expect(screen.getAllByRole('button')).toHaveLength(1)
    fireEvent.click(chip)
    expect(code.open).toHaveBeenCalledWith(limitFn, chip)
  })

  it('opens a file in the editor on a ⌘-press, and closes the one open on a press', () => {
    const openInEditor = vi.fn()
    const close = vi.fn()
    const code = host(new Map([['src/refunds/limits.ts:22-33', limitsFound]]), {
      openInEditor,
      close,
      opened: codeKey(limitsFound),
    })
    render(
      <ThreadShellProvider value={{ code }}>
        <Markdown source="In `src/refunds/limits.ts:22-33`." />
      </ThreadShellProvider>,
    )
    const chip = screen.getByRole('button', { name: /Open src\/refunds\/limits\.ts/ })
    fireEvent.click(chip, { metaKey: true })
    expect(openInEditor).toHaveBeenCalledWith(limitsFound)
    fireEvent.click(chip)
    expect(close).toHaveBeenCalled()
    expect(code.open).not.toHaveBeenCalled()
  })

  it('tells the same name in two messages apart where it names two files, or the same lines at two times', () => {
    const inSrc: FoundFile = { ...limitsFound, name: 'limits.ts' }
    const inTest: FoundFile = { ...inSrc, path: 'test/refunds/limits.ts' }
    const open = vi.fn()
    const close = vi.fn()
    const shell = (found: FoundCode) => host(new Map([['limits.ts', found]]), { open, close, opened: codeKey(inSrc) })
    render(
      <>
        <ThreadShellProvider value={{ code: shell(inSrc) }}>
          <Markdown source="In `limits.ts`." />
        </ThreadShellProvider>
        <ThreadShellProvider value={{ code: shell(inTest) }}>
          <Markdown source="And its test’s `limits.ts`." />
        </ThreadShellProvider>
      </>,
    )
    const [first, second] = screen.getAllByRole('button')
    expect(first).toHaveAttribute('data-open')
    expect(second).not.toHaveAttribute('data-open')
    // The other file opens, rather than the one open closing.
    fireEvent.click(second as HTMLElement)
    expect(open).toHaveBeenCalledWith(inTest, second)
    expect(close).not.toHaveBeenCalled()
    const later: FoundFile = { ...limitsMoved, since: { commit: 'b0a7e11', said: '2026-10-19T09:00:00.000Z', now: { line: 19 } } }
    expect(codeKey(later)).not.toBe(codeKey(limitsMoved))
    expect(codeKey({ ...limitsFound })).toBe(codeKey(limitsFound))
  })

  it('without a host that finds code, is code text as ever', () => {
    render(<Markdown source="In `src/refunds/limits.ts:22-33`." />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('a markdown file in the panel beside the conversation', () => {
  const where = { kind: 'task', branch: 'althar/refund-limits' } as const
  const panel = (more: Partial<Parameters<typeof CodePanel>[0]> = {}) =>
    render(
      <CodePanel
        found={decisionFound}
        where={where}
        mode="rendered"
        onMode={() => {}}
        read={decisionRead}
        change={decisionChange}
        onGo={() => {}}
        onClose={() => {}}
        {...more}
      />,
    )

  it('opens as a page unless the lines named in it are what was asked for', () => {
    expect(panelMode(decisionFound)).toBe('rendered')
    expect(panelMode({ ...decisionFound, line: 4, end: 6 })).toBe('now')
    expect(panelMode(limitsFound)).toBe('now')
    expect(panelMode({ ...decisionFound, content: 'binary' })).toBe('now')
  })

  it('offers the page first, then its source, as it was when said, and what the task changed', () => {
    expect(modesOf(decisionFound).map((mode) => mode.label)).toEqual(['Rendered', 'Source', 'Change +14 −0'])
    expect(modesOf({ ...decisionFound, changed: null }).map((mode) => mode.label)).toEqual(['Rendered', 'Source'])
    expect(modesOf(limitsFound).map((mode) => mode.label)).toEqual(['File', 'Change +41 −3'])
  })

  it('shows the page with what the task changed marked, and its pictures where the host draws them', () => {
    panel({
      read: { ...decisionRead, text: 'Intro.\n# Plan\n![flow](flow.png)' },
      change: [
        { kind: DiffLineKind.Hunk, text: '@@ -1,1 +1,3 @@' },
        { kind: DiffLineKind.Context, old: 1, new: 1, text: 'Intro.' },
        { kind: DiffLineKind.Added, new: 2, text: '# Plan' },
        { kind: DiffLineKind.Added, new: 3, text: '![flow](flow.png)' },
      ],
      markdown: { image: ({ path, alt }) => <img src={`x://${path}`} alt={alt} /> },
    })
    expect(screen.getByRole('radio', { name: 'Rendered' })).toBeChecked()
    expect(within(screen.getByRole('group', { name: 'Added' })).getByRole('heading', { name: 'Plan' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'flow' })).toHaveAttribute('src', 'x://docs/decisions/flow.png')
  })

  it('waits for what the task changed before it shows the page, and shows it as it is where that could not be read', () => {
    const { unmount } = panel({ change: undefined })
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(screen.queryByRole('heading', { name: /Refunds are limited/ })).toBeNull()
    unmount()
    panel({ change: null })
    expect(screen.getByRole('heading', { name: /Refunds are limited/ })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Added' })).toBeNull()
  })

  it('opens another file in the panel when the page links to one', () => {
    const onGo = vi.fn()
    panel({ read: { ...decisionRead, text: '[the limiter](../../src/refunds/limits.ts)' }, change: null, onGo })
    fireEvent.click(screen.getByRole('button', { name: 'the limiter' }))
    expect(onGo).toHaveBeenCalledWith('src/refunds/limits.ts')
  })

  it('says it could not read the file, as for any other', () => {
    panel({ read: null })
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t read this file.')
  })
})
