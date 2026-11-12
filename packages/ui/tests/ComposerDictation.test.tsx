import { fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Composer, type ComposerProps, type DictationInput } from '../src/composer/Composer/Composer'

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

describe('interrupt shortcut', () => {
  it('interrupts from the field only while the stop button is shown', () => {
    const stop = vi.fn()
    const props = { placeholder: 'Tell the lead', value: '', onChange: vi.fn(), onSubmit: vi.fn(), busy: true, onStopAgent: stop }
    const { getByRole, rerender } = render(<Composer {...props} />)
    const press = () => fireEvent.keyDown(getByRole('textbox'), { key: '.', metaKey: true, ctrlKey: true })
    press()
    expect(stop).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(getByRole('textbox'), { key: '.' })
    expect(stop).toHaveBeenCalledTimes(1)
    rerender(<Composer {...props} value="draft" />)
    press()
    rerender(<Composer {...props} busy={false} />)
    press()
    expect(stop).toHaveBeenCalledTimes(1)
  })
})

describe('sending while dictating', () => {
  const props = (dictation: Partial<NonNullable<ComposerProps['dictation']>>, value = '') => ({
    placeholder: 'Tell the lead',
    value,
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    images: [{ id: 'i1', name: 'shot.png' }],
    dictation: { elapsed: null, onStart: vi.fn(), onStop: vi.fn(), ...dictation },
  })
  const enter = (c: HTMLElement) => fireEvent.keyDown(c, { key: 'Enter' })

  it('stops the recording, and sends once what was said is in the field', () => {
    const p = props({ elapsed: '0:05' })
    const { getByRole, queryByRole, rerender } = render(<Composer {...p} />)
    enter(getByRole('textbox'))
    expect(p.dictation.onStop).toHaveBeenCalledTimes(1)
    expect(p.onSubmit).not.toHaveBeenCalled()
    // Being written down: it waits, and the button says so.
    rerender(<Composer {...p} dictation={{ ...p.dictation, elapsed: null, busy: true }} />)
    expect(getByRole('button', { name: 'Finishing the transcription' })).toBeTruthy()
    expect(p.onSubmit).not.toHaveBeenCalled()
    rerender(<Composer {...p} value="Check the retry path." dictation={{ ...p.dictation, elapsed: null, busy: false }} />)
    expect(p.onSubmit).toHaveBeenCalledTimes(1)
    expect(p.onSubmit).toHaveBeenCalledWith('Check the retry path.')
    expect(queryByRole('button', { name: 'Finishing the transcription' })).toBeNull()
  })

  it('does not stop what is already being written down, and waits for it', () => {
    const p = props({ busy: true }, 'Typed.')
    const { getByRole, rerender } = render(<Composer {...p} />)
    fireEvent.click(getByRole('button', { name: 'Send' }))
    expect(p.dictation.onStop).not.toHaveBeenCalled()
    expect(p.onSubmit).not.toHaveBeenCalled()
    rerender(<Composer {...p} value="Typed. And said." dictation={{ ...p.dictation, busy: false }} />)
    expect(p.onSubmit).toHaveBeenCalledWith('Typed. And said.')
  })

  it('sends nothing when it ended in a new failure, and says why until it is dealt with', () => {
    const kept = {}
    const p = props({ elapsed: '0:05', failed: kept }, 'Typed.')
    const { getByRole, queryByRole, rerender } = render(<Composer {...p} />)
    enter(getByRole('textbox'))
    rerender(<Composer {...p} dictation={{ ...p.dictation, elapsed: null, busy: true, failed: kept }} />)
    // A second one failed: the kept one and it, as a new one.
    rerender(<Composer {...p} dictation={{ ...p.dictation, elapsed: null, busy: false, failed: {} }} />)
    expect(p.onSubmit).not.toHaveBeenCalled()
    expect(getByRole('alert').textContent).toContain('Not sent')
    rerender(<Composer {...p} dictation={{ ...p.dictation, elapsed: null, failed: undefined }} />)
    expect(queryByRole('alert')).toBeNull()
  })

  it('goes on with what is there when it ended with an earlier failure still kept', () => {
    const kept = {}
    const p = props({ elapsed: '0:05', failed: kept }, 'Typed.')
    const { getByRole, rerender } = render(<Composer {...p} />)
    enter(getByRole('textbox'))
    rerender(<Composer {...p} value="Typed. Said." dictation={{ ...p.dictation, elapsed: null, failed: kept }} />)
    expect(p.onSubmit).toHaveBeenCalledWith('Typed. Said.')
  })

  it('sends now with ⌘Enter when the voice note is all there is, once it is written down', () => {
    const onSendNow = vi.fn()
    const p = { ...props({ elapsed: '0:05' }), images: [], busy: true, onSendNow }
    const { getByRole, rerender } = render(<Composer {...p} />)
    fireEvent.keyDown(getByRole('textbox'), { key: 'Enter', metaKey: true, ctrlKey: true })
    expect(p.dictation.onStop).toHaveBeenCalledTimes(1)
    rerender(<Composer {...p} value="Said." dictation={{ ...p.dictation, elapsed: null }} />)
    expect(onSendNow).toHaveBeenCalledWith('Said.')
    expect(p.onSubmit).not.toHaveBeenCalled()
  })

  it('sends at once when nothing dictates', () => {
    const p = props({}, 'Typed.')
    const { getByRole } = render(<Composer {...p} />)
    enter(getByRole('textbox'))
    expect(p.onSubmit).toHaveBeenCalledWith('Typed.')
    expect(p.dictation.onStop).not.toHaveBeenCalled()
  })
})
