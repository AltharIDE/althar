import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { Composer, historyKey } from '../src/composer/Composer/Composer'
import { createComposerHistory, type ComposerHistory } from '../src/composer/Composer/history'

/*
 * Undo and Redo in a composer: an attachment taken off is a step of the
 * field's own history, in the order it happened. The field's word steps are
 * the browser's, which jsdom doesn't keep, so here they are played as the
 * browser plays them: a beforeinput the composer may cancel, then the input.
 */

/** A history of attachments in a list, as a consumer keeps one: what was taken off, and where it was. */
const attachments = (history: ComposerHistory, words: () => string) => {
  let list = ['a', 'b', 'c']
  const off = (one: string) => {
    const at = list.indexOf(one)
    list = list.filter((x) => x !== one)
    history.push(
      {
        undo: () => {
          list = [...list.slice(0, at), one, ...list.slice(at)]
        },
        redo: () => {
          list = list.filter((x) => x !== one)
        },
      },
      words(),
    )
  }
  return { off, now: () => list }
}

describe('the history, in the order things happened', () => {
  it('puts back what was taken off where it was, last first, and Redo takes it off again', () => {
    const history = createComposerHistory()
    const { off, now } = attachments(history, () => '')
    off('b')
    off('a')
    expect(now()).toEqual(['c'])
    expect(history.undo('')).toBe(true)
    expect(now()).toEqual(['a', 'c'])
    expect(history.undo('')).toBe(true)
    expect(now()).toEqual(['a', 'b', 'c'])
    // Nothing more of its own: the field's.
    expect(history.undo('')).toBe(false)
    expect(history.redo('')).toBe(true)
    expect(now()).toEqual(['a', 'c'])
    expect(history.redo('')).toBe(true)
    expect(now()).toEqual(['c'])
  })

  it('leaves Undo to the field while words typed after the removal are still there, then takes the attachment back', () => {
    const history = createComposerHistory()
    let words = 'Look'
    const { off, now } = attachments(history, () => words)
    off('b')
    history.edited()
    words = 'Look at this'
    // The words came last: the field's to undo.
    expect(history.undo(words)).toBe(false)
    history.native('undo')
    words = 'Look'
    // Back to how they were as it went: the attachment is next.
    expect(history.undo(words)).toBe(true)
    expect(now()).toEqual(['a', 'b', 'c'])
    // And the other way: the attachment first, then the words.
    expect(history.redo(words)).toBe(true)
    expect(now()).toEqual(['a', 'c'])
    expect(history.redo(words)).toBe(false)
  })

  it('redoes words undone after an attachment was put back before taking it off again', () => {
    const history = createComposerHistory()
    let words = 'Look'
    const { off, now } = attachments(history, () => words)
    off('b')
    expect(history.undo(words)).toBe(true)
    // Undo again: the field's words from before.
    expect(history.undo('')).toBe(false)
    history.native('undo')
    words = ''
    // Redo: those words first, where the attachment's step waits for them.
    expect(history.redo(words)).toBe(false)
    history.native('redo')
    words = 'Look'
    expect(history.redo(words)).toBe(true)
    expect(now()).toEqual(['a', 'c'])
  })

  it('takes the attachment back where the field has nothing of its own to undo, as after words put in it', () => {
    const history = createComposerHistory()
    const { off, now } = attachments(history, () => '')
    off('a')
    // The words were set, not typed: the field can't take them back.
    expect(history.undo('Written down while you were away')).toBe(false)
    expect(history.undo('Written down while you were away', true)).toBe(true)
    expect(now()).toEqual(['a', 'b', 'c'])
  })

  it('forgets what could be redone once the words change, and once something else is taken off', () => {
    const history = createComposerHistory()
    let words = ''
    const { off, now } = attachments(history, () => words)
    off('a')
    expect(history.undo(words)).toBe(true)
    history.edited()
    words = 'New words'
    expect(history.redo(words, true)).toBe(false)
    expect(now()).toEqual(['a', 'b', 'c'])
    // The field's own redo, undone before this attachment went, belongs to an older history: it is held back.
    history.native('undo')
    off('c')
    expect(history.redo(words)).toBe(true)
    expect(now()).toEqual(['a', 'b'])
  })

  it('keeps no step past a send', () => {
    const history = createComposerHistory()
    const { off, now } = attachments(history, () => '')
    off('a')
    history.clear()
    expect(history.undo('', true)).toBe(false)
    expect(now()).toEqual(['b', 'c'])
  })

  it('keeps the last fifty steps', () => {
    const history = createComposerHistory()
    const undo = vi.fn()
    for (let i = 0; i < 60; i += 1) history.push({ undo, redo: () => {} }, '')
    while (history.undo('', true));
    expect(undo).toHaveBeenCalledTimes(50)
  })
})

describe('the keys', () => {
  const key = (key: string, more: Partial<Parameters<typeof historyKey>[0]> = {}) =>
    historyKey({ key, code: `Key${key.toUpperCase()}`, metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, ...more })

  it('are ⌘Z and ⇧⌘Z on a Mac, by the letter or by where it sits', () => {
    expect(key('z')).toBe('undo')
    expect(key('Z', { shiftKey: true })).toBe('redo')
    expect(historyKey({ key: 'я', code: 'KeyZ', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false })).toBe('undo')
    expect(key('z', { altKey: true })).toBeNull()
    expect(key('x')).toBeNull()
    expect(key('z', { metaKey: false })).toBeNull()
  })
})

/** A composer with two images, as a host keeps them, and its history. */
function Host({ history }: { readonly history: ComposerHistory }) {
  const [value, setValue] = useState('')
  const [images, setImages] = useState([
    { id: 'one', name: 'one.png', src: 'data:,' },
    { id: 'two', name: 'two.png', src: 'data:,' },
  ])
  return (
    <Composer
      value={value}
      onChange={setValue}
      onSubmit={() => {}}
      placeholder="Tell the lead"
      images={images}
      onAddFiles={() => {}}
      history={history}
      onRemoveImage={(id) => {
        const at = images.findIndex((one) => one.id === id)
        const one = images[at]
        if (one === undefined) return
        const off = () => setImages((now) => now.filter((x) => x.id !== id))
        off()
        history.push({ undo: () => setImages((now) => [...now.slice(0, at), one, ...now.slice(at)]), redo: off }, value)
      }}
    />
  )
}

const field = () => screen.getByRole<HTMLTextAreaElement>('textbox')
const shown = () => screen.queryAllByRole('img').map((one) => one.getAttribute('alt'))
/** Words typed, as the browser says: an input that is no undo. */
const type = (words: string) => fireEvent.input(field(), { target: { value: words }, inputType: 'insertText' })
/** The field's own undo or redo, as the browser plays it: a beforeinput the composer may cancel, and the words, if it didn't. */
const native = (kind: 'historyUndo' | 'historyRedo', words: string) => {
  const went = fireEvent(field(), new InputEvent('beforeinput', { inputType: kind, cancelable: true, bubbles: true }))
  if (went) fireEvent.input(field(), { target: { value: words }, inputType: kind })
  return went
}

describe('the composer', () => {
  it('gives the field the focus as an image is taken off, and ⌘Z puts it back where it was', () => {
    render(<Host history={createComposerHistory()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove one.png' }))
    expect(shown()).toEqual(['two.png'])
    expect(field()).toHaveFocus()
    const undo = fireEvent.keyDown(field(), { key: 'z', code: 'KeyZ', metaKey: true })
    expect(undo).toBe(false)
    expect(shown()).toEqual(['one.png', 'two.png'])
    fireEvent.keyDown(field(), { key: 'z', code: 'KeyZ', metaKey: true, shiftKey: true })
    expect(shown()).toEqual(['two.png'])
  })

  it('leaves the field its own undo for words typed since, then puts the image back', () => {
    render(<Host history={createComposerHistory()} />)
    type('Look')
    fireEvent.click(screen.getByRole('button', { name: 'Remove two.png' }))
    type('Look at this')
    // The words came last: the key goes on to the field, which undoes them itself.
    expect(fireEvent.keyDown(field(), { key: 'z', code: 'KeyZ', metaKey: true })).toBe(true)
    expect(native('historyUndo', 'Look')).toBe(true)
    expect(shown()).toEqual(['one.png'])
    // From the menu too: the image is the next step, and the field's own is held back.
    expect(native('historyUndo', '')).toBe(false)
    expect(shown()).toEqual(['one.png', 'two.png'])
    expect(field()).toHaveValue('Look')
    // Redo, in the order they were undone back: the image first, then the words.
    expect(native('historyRedo', 'Look')).toBe(false)
    expect(shown()).toEqual(['one.png'])
    expect(native('historyRedo', 'Look at this')).toBe(true)
    expect(field()).toHaveValue('Look at this')
  })

  it('puts the image back where the field had nothing of its own to undo', () => {
    vi.useFakeTimers()
    try {
      render(<Host history={createComposerHistory()} />)
      fireEvent.click(screen.getByRole('button', { name: 'Remove one.png' }))
      // Words put in without typing, as a suggestion taken: the field keeps no step for them, and fires no beforeinput.
      fireEvent.input(field(), { target: { value: 'Taken' } })
      expect(fireEvent.keyDown(field(), { key: 'z', code: 'KeyZ', metaKey: true })).toBe(true)
      expect(shown()).toEqual(['two.png'])
      act(() => {
        vi.runAllTimers()
      })
      expect(shown()).toEqual(['one.png', 'two.png'])
    } finally {
      vi.useRealTimers()
    }
  })
})
