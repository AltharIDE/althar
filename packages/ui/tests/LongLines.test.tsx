import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DiffLineKind } from '../src/foundations/vocabulary'
import { CHUNK, widthOf } from '../src/lib/chunks'
import { CodeLines } from '../src/thread/Code/CodeLines'
import { Diff, type DiffLine } from '../src/thread/Diff/Diff'

/*
 * A long file or diff in chunks, which a browser lays out and paints only near the screen: every line still in the page,
 * numbered and in order, each chunk saying how many lines it holds and how wide its longest is, for the size it holds
 * until drawn, and in its colours once near. jsdom lays nothing out, so what is checked is what the browser is given.
 */

const keyword = 'var(--code-keyword, var(--syn-keyword))'

/** An observer that sees only what the test says comes near, as a chunk scrolled to would. */
class Sees {
  static made: Sees[] = []
  readonly watched: Element[] = []
  constructor(private readonly seen: IntersectionObserverCallback) {
    Sees.made.push(this)
  }
  observe(target: Element) {
    this.watched.push(target)
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
  /** Brings an element near the screen. */
  static bring(target: Element) {
    for (const one of Sees.made)
      if (one.watched.includes(target))
        one.seen([{ target, isIntersecting: true } as IntersectionObserverEntry], one as unknown as IntersectionObserver)
  }
}

/** Sees only what is brought near, for one test. */
const seeOnlyWhatIsBrought = () => {
  Sees.made = []
  vi.stubGlobal('IntersectionObserver', Sees)
}
afterEach(() => vi.unstubAllGlobals())

/** Whether a line's first word is in its keyword ink. */
const inks = (line: Element | undefined) => line?.querySelector('span[style]')?.getAttribute('style')?.includes('syn-keyword') ?? false

/** A file of `n` lines, each its own. */
const fileOf = (n: number, line = (i: number) => `const line${i} = ${i}`) =>
  `${Array.from({ length: n }, (_, i) => line(i + 1)).join('\n')}\n`

const readOf = (text: string, from = 1) => ({ text, from, total: from + text.split('\n').length - 2, cut: from > 1 })

const chunks = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>('.chunk'))
const numbers = (within: Element) => Array.from(within.querySelectorAll('.n')).map((n) => Number(n.textContent))

describe('a long file’s lines', () => {
  it('draws a file no longer than a chunk as it is', () => {
    const { container } = render(<CodeLines path="a.plain" read={readOf(fileOf(CHUNK))} />)
    expect(chunks(container)).toHaveLength(0)
    expect(numbers(container)).toHaveLength(CHUNK)
  })

  it('draws a longer one in chunks, every line in the page in order, each chunk saying its lines and its widest', () => {
    const text = fileOf(CHUNK * 2 + 10, (i) => (i === CHUNK + 5 ? `${'x'.repeat(90)}\t\t` : `line ${i}`))
    const { container } = render(<CodeLines path="a.plain" read={readOf(text)} />)
    const [first, second, third] = chunks(container)
    expect(chunks(container)).toHaveLength(3)
    expect(numbers(container)).toEqual(Array.from({ length: CHUNK * 2 + 10 }, (_, i) => i + 1))
    expect(numbers(first as HTMLElement).at(-1)).toBe(CHUNK)
    expect(first?.style.getPropertyValue('--rows')).toBe(String(CHUNK))
    expect(first?.style.getPropertyValue('--cols')).toBe(String('line 200'.length))
    // a tab counts as two, the kit's tab size
    expect(second?.style.getPropertyValue('--cols')).toBe('94')
    expect(third?.style.getPropertyValue('--rows')).toBe('10')
    // what is copied is the file's own text, line by line, its numbers apart
    expect(Array.from(container.querySelectorAll('.text')).map((one) => one.textContent)).toEqual(text.replace(/\n$/, '').split('\n'))
  })

  it('chunks a file by where its lines are in it, so lines a peek shows later join their own chunk', () => {
    const text = fileOf(CHUNK * 3)
    const { container } = render(
      <CodeLines path="a.plain" read={readOf(text)} mark={{ line: CHUNK * 2, end: CHUNK * 2 }} around={CHUNK / 2} />,
    )
    // from line 300 to 500, which a chunk ends at 400
    expect(chunks(container).map((chunk) => numbers(chunk)[0])).toEqual([CHUNK / 2 + CHUNK, CHUNK * 2 + 1])
    fireEvent.click(screen.getByRole('button', { name: /lines above/ }))
    expect(chunks(container).map((chunk) => numbers(chunk)[0])).toEqual([CHUNK / 2 + CHUNK - 20, CHUNK * 2 + 1])
  })

  it('marks the lines named in whichever chunk they are in', () => {
    const { container } = render(<CodeLines path="a.plain" read={readOf(fileOf(CHUNK * 2))} mark={{ line: CHUNK - 1, end: CHUNK + 1 }} />)
    expect(Array.from(container.querySelectorAll('[data-named]')).map((one) => one.querySelector('.n')?.textContent)).toEqual([
      String(CHUNK - 1),
      String(CHUNK),
      String(CHUNK + 1),
    ])
    expect(container.querySelectorAll('.chunk')[1]?.querySelector('[data-named]')).not.toBeNull()
  })

  it('numbers lines from where a cut read starts', () => {
    const { container } = render(<CodeLines path="a.plain" read={readOf(fileOf(CHUNK + 1), 401)} />)
    expect(numbers(container)[0]).toBe(401)
    expect(chunks(container).map((chunk) => chunk.style.getPropertyValue('--rows'))).toEqual([String(CHUNK), '1'])
  })

  it('colours the chunks where it opens, and the rest as they come near the screen', async () => {
    seeOnlyWhatIsBrought()
    const { container } = render(<CodeLines path="long.ts" read={readOf(fileOf(CHUNK * 3 + 100))} />)
    const line = (n: number) => container.querySelectorAll('.text')[n - 1]
    // It opens at its top: the first chunks are in their colours as soon as they come.
    await waitFor(() => expect(within(line(1) as HTMLElement).getByText('const')).toHaveStyle({ color: keyword }))
    expect(inks(line(CHUNK * 2))).toBe(true)
    // Coloured too, but far from the screen: plain until it comes near.
    expect(inks(line(CHUNK * 3 + 50))).toBe(false)
    act(() => Sees.bring(chunks(container)[3] as Element))
    expect(inks(line(CHUNK * 3 + 50))).toBe(true)
    expect(inks(line(CHUNK * 2 + 50))).toBe(false)
  })

  it('colours the chunks about the lines named, where it opens', async () => {
    seeOnlyWhatIsBrought()
    const { container } = render(
      <CodeLines path="named.ts" read={readOf(fileOf(CHUNK * 4))} mark={{ line: CHUNK * 3 + 10, end: CHUNK * 3 + 10 }} />,
    )
    const line = (n: number) => container.querySelectorAll('.text')[n - 1]
    await waitFor(() => expect(inks(line(CHUNK * 3 + 10))).toBe(true))
    expect([inks(line(1)), inks(line(CHUNK + 1)), inks(line(CHUNK * 2 + 1)), inks(line(CHUNK * 4))]).toEqual([false, false, true, true])
  })

  it('counts a line’s width as monospace draws it', () => {
    expect([widthOf(''), widthOf('abc'), widthOf('\ta\t')]).toEqual([0, 3, 5])
  })
})

const context = (n: number): DiffLine => ({ kind: DiffLineKind.Context, old: n, new: n, text: `line ${n}` })

describe('a long diff’s rows', () => {
  /** A whole file's diff: a change every hundred lines. */
  const file: DiffLine[] = Array.from({ length: CHUNK * 3 }, (_, i): DiffLine =>
    i % 100 === 50 ? { kind: DiffLineKind.Added, new: i + 1, text: `added ${i + 1}` } : context(i + 1),
  )

  it('draws a diff of no more rows than a chunk as it is', () => {
    const { container } = render(<Diff lines={file.slice(0, CHUNK)} />)
    expect(chunks(container)).toHaveLength(0)
  })

  it('draws a longer one in chunks by where its lines are, each saying its lines, folds, notes and widest', () => {
    const { container } = render(<Diff lines={file} notes={[{ key: 'a', line: CHUNK + 51, node: 'About the change' }]} />)
    const shown = chunks(container)
    expect(shown).toHaveLength(3)
    expect(shown.map((chunk) => chunk.style.getPropertyValue('--rows'))).toEqual([String(CHUNK), String(CHUNK), String(CHUNK)])
    expect(shown.map((chunk) => chunk.style.getPropertyValue('--notes'))).toEqual(['0', '1', '0'])
    expect(shown[1]?.textContent).toContain('About the change')
    expect(shown[0]?.style.getPropertyValue('--cols')).toBe(String('added 151'.length))
  })

  it('opens a fold into the chunk its lines are in, leaving the others as they were', () => {
    // A change every ten lines, each folded to two lines either side: six rows to ten lines.
    const lines = Array.from({ length: CHUNK * 6 }, (_, i): DiffLine =>
      i % 10 === 5 ? { kind: DiffLineKind.Added, new: i + 1, text: `added ${i + 1}` } : context(i + 1),
    )
    const { container } = render(<Diff lines={lines} fold={2} />)
    const before = chunks(container)
    expect(before.map((chunk) => chunk.style.getPropertyValue('--folds'))).toEqual(['21', '20', '20', '20', '20', '20'])
    expect(numbers(before[1] as HTMLElement).slice(0, 6)).toEqual([204, 205, 206, 207, 208, 214])
    const [opening] = within(before[1] as HTMLElement).getAllByRole('button')
    fireEvent.click(opening as HTMLElement)
    const after = chunks(container)
    expect(after[0]).toBe(before[0])
    expect(after[1]?.style.getPropertyValue('--folds')).toBe('19')
    expect(numbers(after[1] as HTMLElement).slice(0, 11)).toEqual([204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214])
  })

  it('colours a long diff’s first chunks as each side’s colours come, and the rest as they come near the screen', async () => {
    seeOnlyWhatIsBrought()
    const { container } = render(
      <Diff lines={file.map((line) => ({ ...line, text: `const ${line.kind}${'new' in line ? line.new : 0} = 1` }))} path="a.ts" />,
    )
    const [first, second, last] = chunks(container) as [HTMLElement, HTMLElement, HTMLElement]
    await waitFor(() => expect(within(second).getAllByText('const').at(-1)).toHaveStyle({ color: keyword }))
    expect(inks(first.querySelector('.line') ?? undefined)).toBe(true)
    expect(last.querySelector('span[style*="syn-"]')).toBeNull()
    act(() => Sees.bring(last))
    expect(within(last).getAllByText('const').at(-1)).toHaveStyle({ color: keyword })
  })
})
