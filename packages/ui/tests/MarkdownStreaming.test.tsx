import { render } from '@testing-library/react'
import { Lexer } from 'marked'
import { describe, expect, it } from 'vitest'

import { blocksOf, type Lexed, lexOn } from '../src/thread/Markdown/lexed'
import { Markdown } from '../src/thread/Markdown/Markdown'
import { inOpenFence, streamable } from '../src/thread/Markdown/streaming'
import { headingOf, thoughtSummary } from '../src/thread/Reasoning/summary'

/*
 * Markdown cut off mid-stream: shown without what would change its mind
 * (streaming.ts), read on from where it settled (lexed.ts); and what a
 * thought was about, in a line (Reasoning/summary.ts).
 */

const ANSWER = `It doesn't yet: the wait lives in memory, so a restart forgets it.

The change, in short:

1. A column \`reset_at\` on \`change_polls\`.
2. **Follow.ts** writes it when GitHub refuses.
   - and clears it after
3. MergeLine.ts reads it back.

\`\`\`ts
const resume = (poll: ChangePoll, now: number) =>
  poll.resetAt === null ? 0 : poll.resetAt - now

\`\`\`

| Case | First poll |
| --- | --- |
| Not limited | at once |
| Limited | at the reset time |

> A quote, with a [link](https://example.com) in it.

Setext heading
--------------

- a

- b

The end, *with feeling*.`

describe('markdown cut off mid-stream', () => {
  it('holds back a line that is only the start of something', () => {
    expect(streamable('Intro\n-')).toBe('Intro')
    expect(streamable('Intro\n- ')).toBe('Intro')
    expect(streamable('Intro\n1.')).toBe('Intro')
    expect(streamable('Intro\n12')).toBe('Intro')
    expect(streamable('Intro\n##')).toBe('Intro')
    expect(streamable('Intro\n>')).toBe('Intro')
    expect(streamable('Intro\n---')).toBe('Intro')
    expect(streamable('Intro\n```ts')).toBe('Intro')
    // Once it says something, it shows.
    expect(streamable('Intro\n- a')).toBe('Intro\n- a')
  })

  it('closes a mark left open for now, and drops one with nothing after it yet', () => {
    expect(streamable('A **bold wo')).toBe('A **bold wo**')
    expect(streamable('A *soft wo')).toBe('A *soft wo*')
    expect(streamable('A ~~gone')).toBe('A ~~gone~~')
    expect(streamable('Run `bun te')).toBe('Run `bun te`')
    expect(streamable('A **')).toBe('A ')
    expect(streamable('**Done** and **more')).toBe('**Done** and **more**')
    // A list's star isn't emphasis, nor is a star with space after it, nor one in code.
    expect(streamable('- a\n* b')).toBe('- a\n* b')
    expect(streamable('2 * 3 is')).toBe('2 * 3 is')
    expect(streamable('`a*b` and c')).toBe('`a*b` and c')
    expect(streamable('An \\*escaped star')).toBe('An \\*escaped star')
  })

  it('shows a link’s words until its address closes', () => {
    expect(streamable('See [the docs](https://exa')).toBe('See the docs')
    expect(streamable('See [the do')).toBe('See the do')
    expect(streamable('See [the docs](https://example.com) now')).toBe('See [the docs](https://example.com) now')
  })

  it('holds a table back until the rule under its first row arrives', () => {
    expect(streamable('Cases:\n\n| Case | First |')).toBe('Cases:\n')
    expect(streamable('Cases:\n\n| Case | First |\n| --- | -')).toBe('Cases:\n')
    expect(streamable('Cases:\n\n| Case | First |\n| --- | --- |\n')).toBe('Cases:\n\n| Case | First |\n| --- | --- |\n')
    expect(streamable('Cases:\n\n| Case | First |\n| --- | --- |\n| Not lim')).toBe('Cases:\n\n| Case | First |\n| --- | --- |\n| Not lim')
  })

  it('leaves a code fence that is still open as it is, but for a line that may be its close', () => {
    expect(inOpenFence('```ts\nconst a = 1')).toBe(true)
    expect(inOpenFence('```ts\nconst a = 1\n```\n')).toBe(false)
    expect(inOpenFence('~~~\n```\n')).toBe(true)
    expect(streamable('```ts\nconst a = **b')).toBe('```ts\nconst a = **b')
    expect(streamable('```ts\nconst a = 1\n``')).toBe('```ts\nconst a = 1\n')
  })

  it('draws every cut of an answer without a block that turns into another: what it shows is what it will be, as far as it goes', () => {
    const kinds = (text: string) => Lexer.lex(text).flatMap((token) => (token.type === 'space' ? [] : [token.type]))
    const whole = kinds(ANSWER)
    for (let cut = 1; cut <= ANSWER.length; cut++) {
      const shown = kinds(streamable(ANSWER.slice(0, cut)))
      // Every block but the last, which may still be growing into its kind, is the kind it will be.
      expect(shown.slice(0, -1)).toEqual(whole.slice(0, Math.max(0, shown.length - 1)))
    }
  })
})

describe('markdown read as it grows', () => {
  it('reads every cut of an answer as reading all of it would, keeping what settled', () => {
    let read: Lexed | null = null
    let kept = 0
    for (let cut = 1; cut <= ANSWER.length; cut++) {
      const text = ANSWER.slice(0, cut)
      const before: Lexed | null = read
      read = lexOn(text, before)
      expect(blocksOf(read.tokens).map((token) => token.raw)).toEqual(blocksOf(Lexer.lex(text)).map((token) => token.raw))
      if (before !== null && read.settled[0] !== undefined && read.settled[0] === before.settled[0]) kept += 1
    }
    // Most cuts read on from what settled, rather than all of it.
    expect(kept).toBeGreaterThan(ANSWER.length / 2)
  })

  it('reads all of it again where it no longer begins as it did', () => {
    const first = lexOn('One.\n\nTwo.\n\nThree', null)
    const again = lexOn('Uno.\n\nTwo.\n\nThree', first)
    expect(blocksOf(again.tokens).map((token) => token.raw.trim())).toEqual(['Uno.', 'Two.', 'Three'])
  })

  it('draws a message as it streams, and whole once it stops', () => {
    const view = render(<Markdown source="A **bold wo" streaming />)
    expect(view.container.querySelector('strong')?.textContent).toBe('bold wo')
    expect(view.container.firstElementChild?.getAttribute('aria-busy')).toBe('true')
    view.rerender(<Markdown source="A **bold wo" />)
    expect(view.container.querySelector('strong')).toBeNull()
    expect(view.container.textContent).toBe('A **bold wo')
  })
})

describe('what a thought was about', () => {
  const CODEX = '**Checking how the merge line starts**\n\nLooking at MergeLine.ts.\n\n**Tracing the poll to the store**\n\nThe last poll'

  it('is its latest whole heading, as Codex titles each part', () => {
    expect(headingOf(CODEX)).toBe('Tracing the poll to the store')
    expect(thoughtSummary(CODEX)).toBe('Tracing the poll to the store')
    // A heading still being written isn't one yet: the one before stands.
    expect(headingOf(`${CODEX}.\n\n**Writing the mig`)).toBe('Tracing the poll to the store')
    expect(headingOf('## Plan\n\nFirst')).toBe('Plan')
    expect(headingOf('No heading here.')).toBeNull()
  })

  it('is its first sentence otherwise, plain and short, without the words it opens with', () => {
    expect(thoughtSummary('The person wants a back-off. First I need the poll.')).toBe('The person wants a back-off')
    expect(thoughtSummary('Okay, so `Follow.ts` schedules it.')).toBe('So Follow.ts schedules it')
    expect(thoughtSummary('Hmm, the [docs](https://x.y) say so')).toBe('The docs say so')
    const long = thoughtSummary(`The reviewer's first finding is right: ${'the jitter is added after the cap '.repeat(4)}`)
    expect(long.length).toBeLessThanOrEqual(90)
    expect(long.endsWith('…')).toBe(true)
    expect(thoughtSummary('')).toBe('')
  })
})
