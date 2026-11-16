import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type ColourAnswer, type ColourAsk, serveColours, SLICE } from '../src/lib/shiki'

/*
 * A file's colours worked out in a worker, as the window does where there is one. jsdom has none, so a stand-in runs the
 * worker's own side (serveColours) in place. It is held, as the fake agent is: each turn it takes colours one slice of a
 * text and tells the window, and it takes a turn only when the test gives it one, so what it tells is the same however fast
 * the machine.
 */

class Colours {
  static made: Colours[] = []
  static fails = false
  /** One the page may not start: its constructor throws, as a policy refusing it does. */
  static refused = false
  /** One whose grammars won't load: it says so of every text. */
  static plain = false
  readonly asks: ColourAsk[] = []
  readonly answers: ColourAnswer[] = []
  onmessage: ((event: MessageEvent<ColourAnswer>) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  terminated = false
  /** Its next turn, held until the test gives it. */
  next: (() => void) | null = null
  private readonly hear = serveColours(
    (answer) => {
      this.answers.push(answer)
      setTimeout(() => this.onmessage?.({ data: answer } as MessageEvent<ColourAnswer>))
    },
    (next) => {
      this.next = next
    },
    { turn: 0, told: 0 },
  )
  constructor() {
    if (Colours.refused) throw new Error('Refused to create a worker')
    Colours.made.push(this)
    // One that can't start says so once it has been made, as a worker whose script won't load does.
    if (Colours.fails) setTimeout(() => this.onerror?.(new Event('error')))
  }
  postMessage(ask: ColourAsk) {
    this.asks.push(ask)
    if (Colours.plain && ask.type === 'colour') {
      const answer: ColourAnswer = { id: ask.id, failed: true }
      this.answers.push(answer)
      setTimeout(() => this.onmessage?.({ data: answer } as MessageEvent<ColourAnswer>))
    } else if (!Colours.fails) this.hear(ask)
  }
  terminate() {
    this.terminated = true
  }
}

/** Gives the worker its next turn, once it has one. */
const turn = async (worker: Colours) => {
  await waitFor(() => expect(worker.next).not.toBeNull())
  const next = worker.next
  worker.next = null
  act(() => next?.())
}

/** Gives the worker turns until it has told the window the last of a text's lines. */
const finish = async (worker: Colours, id: number) => {
  while (!worker.answers.some((answer) => answer.id === id && 'done' in answer && answer.done)) await turn(worker)
}

const keyword = 'var(--code-keyword, var(--syn-keyword))'
const comment = 'var(--code-comment, var(--syn-comment))'
const string = 'var(--code-string, var(--syn-string))'

/** A file of `n` lines, each its own: a constant, then a comment. */
const fileOf = (n: number) => Array.from({ length: n }, (_, i) => `const line${i} = ${i} // number ${i}`).join('\n')

/** The window's side, fresh for each test, so each makes its own worker. */
const fresh = async () => {
  vi.resetModules()
  const { useTokens } = await import('../src/lib/syntax')
  /** Each line's first token's colour, and its words, as the window has them. */
  function Lines({ text }: { text: string }) {
    const tokens = useTokens(text, 'a.ts')
    return (
      <ol>
        {text.split('\n').map((row, i) => (
          <li key={i} data-testid={`line-${i}`} style={tokens?.[i]?.[0]?.style}>
            {tokens?.[i]?.map((token) => token.content).join('') ?? row}
          </li>
        ))}
      </ol>
    )
  }
  return Lines
}

beforeEach(() => {
  Colours.made = []
  Colours.fails = false
  Colours.refused = false
  Colours.plain = false
  vi.stubGlobal('Worker', Colours)
})
afterEach(() => vi.unstubAllGlobals())

describe('a file’s colours, from a worker', () => {
  it('colours a long file off the window’s thread, its first lines first, then the rest as they come', async () => {
    const Lines = await fresh()
    const text = fileOf(SLICE * 3 + 4)
    render(<Lines text={text} />)
    const worker = Colours.made[0] as Colours
    expect(worker.asks).toEqual([{ type: 'colour', id: 1, text, lang: 'typescript' }])
    // After one turn, the first slice shows coloured while the rest are plain.
    await turn(worker)
    await waitFor(() => expect(screen.getByTestId('line-0')).toHaveStyle({ color: keyword }))
    expect(screen.getByTestId(`line-${SLICE - 1}`)).toHaveStyle({ color: keyword })
    expect(screen.getByTestId(`line-${SLICE}`).getAttribute('style')).toBeNull()
    await finish(worker, 1)
    const last = screen.getByTestId(`line-${SLICE * 3 + 3}`)
    await waitFor(() => expect(last).toHaveStyle({ color: keyword }))
    // The words are the file's own, whatever their inks.
    expect(last.textContent).toBe(`const line${SLICE * 3 + 3} = ${SLICE * 3 + 3} // number ${SLICE * 3 + 3}`)
    // It told the window a slice a turn, the last saying it was all, and named each ink once, the first time it used it.
    const told = worker.answers.flatMap((answer) => ('lines' in answer ? [answer] : []))
    expect(told.map((answer) => [answer.lines.ends.length, answer.done])).toEqual([
      [SLICE, false],
      [SLICE, false],
      [SLICE, false],
      [4, false],
      [0, true],
    ])
    const named = told.flatMap((answer) => answer.inks)
    expect(named.map((ink) => ink.color)).toEqual(expect.arrayContaining([keyword, comment, string]))
    expect(new Set(named.map((ink) => JSON.stringify(ink))).size).toBe(named.length)
    expect(told.slice(1).every((answer) => answer.inks.length === 0)).toBe(true)
  })

  it('colours a text once for all that show it, and keeps it for the next', async () => {
    const Lines = await fresh()
    const text = fileOf(3)
    const { unmount } = render(
      <>
        <Lines text={text} />
        <Lines text={text} />
      </>,
    )
    const worker = Colours.made[0] as Colours
    await finish(worker, 1)
    await waitFor(() => expect(screen.getAllByTestId('line-2')[1]).toHaveStyle({ color: keyword }))
    expect(screen.getAllByTestId('line-2')[0]).toHaveStyle({ color: keyword })
    unmount()
    render(<Lines text={text} />)
    // Kept: coloured as it shows, with nothing asked again.
    expect(screen.getByTestId('line-2')).toHaveStyle({ color: keyword })
    expect(Colours.made).toHaveLength(1)
    expect(worker.asks).toEqual([expect.objectContaining({ type: 'colour', id: 1 })])
  })

  it('shows a text joined while it is coloured the lines coloured so far at once', async () => {
    const Lines = await fresh()
    const text = fileOf(SLICE * 2)
    render(<Lines text={text} />)
    const worker = Colours.made[0] as Colours
    await turn(worker)
    await waitFor(() => expect(screen.getByTestId('line-0')).toHaveStyle({ color: keyword }))
    render(<Lines text={text} />)
    expect(screen.getAllByTestId('line-0')[1]).toHaveStyle({ color: keyword })
    expect(worker.asks).toHaveLength(1)
  })

  it('stops colouring a text no one shows any more, and goes on with the rest', async () => {
    const Lines = await fresh()
    const { unmount } = render(<Lines text={fileOf(SLICE * 4)} />)
    const worker = Colours.made[0] as Colours
    await turn(worker)
    await waitFor(() => expect(screen.getByTestId('line-0')).toHaveStyle({ color: keyword }))
    unmount()
    expect(worker.asks.at(-1)).toEqual({ type: 'drop', id: 1 })
    const toldBefore = worker.answers.length
    // Another text, asked after, colours to its end, and the one dropped tells nothing more meanwhile.
    render(<Lines text={fileOf(SLICE * 2)} />)
    await finish(worker, 2)
    expect(worker.answers.slice(toldBefore).every((answer) => answer.id === 2)).toBe(true)
    expect(screen.getByTestId(`line-${SLICE * 2 - 1}`)).toBeInTheDocument()
  })

  it('colours in place where the worker can’t start, and asks no worker again', async () => {
    Colours.fails = true
    const Lines = await fresh()
    render(<Lines text={fileOf(2)} />)
    await waitFor(() => expect(screen.getByTestId('line-1')).toHaveStyle({ color: keyword }))
    expect(Colours.made[0]?.terminated).toBe(true)
    render(<Lines text={fileOf(3)} />)
    await waitFor(() => expect(screen.getAllByTestId('line-2')[0]).toHaveStyle({ color: keyword }))
    expect(Colours.made).toHaveLength(1)
  })

  it('colours in place where the page may not start a worker', async () => {
    Colours.refused = true
    const Lines = await fresh()
    render(<Lines text={fileOf(2)} />)
    await waitFor(() => expect(screen.getByTestId('line-1')).toHaveStyle({ color: keyword }))
    expect(Colours.made).toHaveLength(0)
  })

  it('leaves a text plain that the worker can’t colour, and asks again once it shows again', async () => {
    Colours.plain = true
    const Lines = await fresh()
    const text = fileOf(2)
    const { unmount } = render(<Lines text={text} />)
    const worker = Colours.made[0] as Colours
    await waitFor(() => expect(worker.answers).toEqual([{ id: 1, failed: true }]))
    expect(screen.getByTestId('line-1').getAttribute('style')).toBeNull()
    unmount()
    // Nothing kept of it: shown again, it is asked for again.
    render(<Lines text={text} />)
    expect(worker.asks.filter((ask) => ask.type === 'colour')).toHaveLength(2)
  })

  it('colours in place where there is no worker at all', async () => {
    vi.stubGlobal('Worker', undefined)
    const Lines = await fresh()
    render(<Lines text={fileOf(2)} />)
    await waitFor(() => expect(screen.getByTestId('line-1')).toHaveStyle({ color: keyword }))
  })
})

describe('the worker’s side', () => {
  const served = () => {
    const answers: ColourAnswer[] = []
    const hear = serveColours(
      (answer) => answers.push(answer),
      (next) => setTimeout(next),
      { turn: 0, told: 0 },
    )
    return { answers, hear }
  }

  it('says a text in a language it has no grammar for can’t be coloured, which leaves it plain', async () => {
    const { answers, hear } = served()
    hear({ type: 'colour', id: 7, text: 'plain words', lang: 'klingon' })
    await waitFor(() => expect(answers).toEqual([{ id: 7, failed: true }]))
  })

  it('tells nothing of a text dropped while its grammar is still read', async () => {
    const { answers, hear } = served()
    hear({ type: 'colour', id: 1, text: 'const a = 1', lang: 'typescript' })
    hear({ type: 'drop', id: 1 })
    hear({ type: 'colour', id: 2, text: 'const b = 2', lang: 'typescript' })
    await waitFor(() => expect(answers.at(-1)).toMatchObject({ id: 2, done: true }))
    expect(answers.every((answer) => answer.id === 2)).toBe(true)
  })

  it('tells nothing of a text dropped before its grammar failed', async () => {
    const { answers, hear } = served()
    hear({ type: 'colour', id: 1, text: 'x', lang: 'klingon' })
    hear({ type: 'drop', id: 1 })
    hear({ type: 'colour', id: 2, text: 'y', lang: 'klingon' })
    await waitFor(() => expect(answers).toEqual([{ id: 2, failed: true }]))
  })
})
