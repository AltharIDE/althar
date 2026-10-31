import { fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Composer, type DictationInput } from '../src/composer/Composer/Composer'

/*
 * A long dictation past the composer's max height. jsdom lays nothing out, so
 * the overlay is given a 600px page seen through 200px, and its scroll offset
 * is kept here.
 */
const PAGE = 600
const VIEW = 200
const WORDS_TOP = 540 // the arriving words' last line ends at the page's end

let tops = new WeakMap<Element, number>()
const proto = HTMLElement.prototype
const saved = Object.getOwnPropertyDescriptors(proto)

beforeEach(() => {
  tops = new WeakMap()
  Object.defineProperties(proto, {
    scrollHeight: { configurable: true, get: () => PAGE },
    clientHeight: { configurable: true, get: () => VIEW },
    offsetHeight: { configurable: true, get: () => 60 },
    offsetTop: { configurable: true, get: () => WORDS_TOP },
    scrollTop: {
      configurable: true,
      get(this: Element) {
        return tops.get(this) ?? 0
      },
      set(this: Element, v: number) {
        tops.set(this, Math.max(0, Math.min(PAGE - VIEW, v)))
      },
    },
  })
})
afterEach(() => {
  for (const key of ['scrollHeight', 'clientHeight', 'offsetHeight', 'offsetTop', 'scrollTop'] as const) {
    const was = saved[key]
    if (was) Object.defineProperty(proto, key, was)
    else delete (proto as unknown as Record<string, unknown>)[key]
  }
})

const inputs: readonly DictationInput[] = []
function composer(interim: string, value = 'Written before.') {
  const dictation = {
    elapsed: '0:09',
    levels: [],
    interim,
    kbd: '⌘⇧D',
    inputs,
    input: null,
    onChooseInput: vi.fn(),
    onStart: vi.fn(),
    onStop: vi.fn(),
  }
  return <Composer value={value} onChange={vi.fn()} onSubmit={vi.fn()} placeholder="Tell the lead" dictation={dictation} />
}
const overlay = (c: HTMLElement) => c.querySelector<HTMLElement>('[aria-hidden="true"][class*="interim"]')!

describe('a long dictation', () => {
  it('keeps the newest words in view as they arrive', () => {
    const { container, rerender } = render(composer('one two'))
    expect(overlay(container).scrollTop).toBe(PAGE - VIEW)
    rerender(composer('one two three'))
    expect(overlay(container).scrollTop).toBe(PAGE - VIEW)
  })

  it('scrolls the arriving words when the wheel turns over the field', () => {
    const { container, getByRole } = render(composer('one two'))
    fireEvent.wheel(getByRole('textbox'), { deltaY: -150 })
    expect(overlay(container).scrollTop).toBe(PAGE - VIEW - 150)
  })

  it('does not pull back down on each word once scrolled up, and follows again at the end', () => {
    const { container, getByRole, rerender } = render(composer('one two'))
    const field = getByRole('textbox')
    fireEvent.wheel(field, { deltaY: -300 })
    fireEvent.scroll(overlay(container))
    rerender(composer('one two three'))
    expect(overlay(container).scrollTop).toBe(100)
    fireEvent.wheel(field, { deltaY: 500 })
    fireEvent.scroll(overlay(container))
    rerender(composer('one two three four'))
    expect(overlay(container).scrollTop).toBe(PAGE - VIEW)
  })

  it('hands what was read to the field when the words are written down', () => {
    const { container, getByRole, rerender } = render(composer('one two'))
    fireEvent.wheel(getByRole('textbox'), { deltaY: -100 })
    fireEvent.scroll(overlay(container))
    rerender(composer(''))
    expect(getByRole('textbox').scrollTop).toBe(PAGE - VIEW - 100)
  })
})

describe('back to a composer', () => {
  const back = (arrived: boolean) => (
    <Composer
      value="Keep the limiter. Also check the retry path."
      onChange={vi.fn()}
      onSubmit={vi.fn()}
      placeholder="Tell the lead"
      dictation={{ elapsed: null, arrived, onStart: vi.fn(), onStop: vi.fn() }}
    />
  )

  it('puts the cursor after the draft it comes back with', () => {
    const { getByRole } = render(back(false))
    const field = getByRole('textbox', { name: 'Tell the lead' }) as HTMLTextAreaElement
    expect(field.selectionStart).toBe(field.value.length)
    expect(field.selectionEnd).toBe(field.value.length)
  })

  it('says, quietly, when what was said was written down while you were away', () => {
    const { queryByText, rerender } = render(back(true))
    expect(queryByText('Written down while you were away')).not.toBeNull()
    rerender(back(false))
    expect(queryByText('Written down while you were away')).toBeNull()
  })
})
