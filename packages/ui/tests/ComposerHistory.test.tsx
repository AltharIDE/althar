import { fireEvent, render, screen } from '@testing-library/react'
import { userEvent } from 'storybook/test'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { Composer, historyKey } from '../src/composer/Composer/Composer'
import { createComposerHistory, putBack, type ComposerHistory, type ComposerWords } from '../src/composer/Composer/history'

/*
 * Undo and Redo in a composer: one history of its words and of what is taken
 * off it, in the order they happened, kept by the composer rather than the
 * field, whose own steps can't be counted.
 */

const at = (text: string): ComposerWords => ({ text, start: text.length, end: text.length })

/** A composer's words and its attachments, as a consumer keeps them, with the steps they make. */
const composer = (history: ComposerHistory) => {
  let list = ['a', 'b', 'c']
  let words = ''
  history.wrote(at(''), at(''))
  const put = (now: ComposerWords) => {
    words = now.text
  }
  return {
    type: (next: string, typing: 'insert' | 'delete' | null = 'insert') => {
      history.wrote(at(words), at(next), typing)
      words = next
    },
    off: (one: string) => {
      const before = list.slice(0, list.indexOf(one))
      list = list.filter((x) => x !== one)
      history.push({
        undo: () => {
          list = putBack(
            list.map((id) => ({ id })),
            { id: one },
            before,
          ).map((x) => x.id)
        },
        redo: () => {
          list = list.filter((x) => x !== one)
        },
      })
    },
    undo: () => history.undo(put),
    redo: () => history.redo(put),
    now: () => ({ list, words }),
  }
}

describe('the history, in the order things happened', () => {
  it('takes back words and attachments in turn, last first, and Redo does them again the other way', () => {
    const c = composer(createComposerHistory())
    c.type('Look')
    c.off('b')
    c.type('Look at this')
    expect(c.undo()).toBe(true)
    expect(c.now()).toEqual({ list: ['a', 'c'], words: 'Look' })
    expect(c.undo()).toBe(true)
    expect(c.now()).toEqual({ list: ['a', 'b', 'c'], words: 'Look' })
    expect(c.undo()).toBe(true)
    expect(c.now()).toEqual({ list: ['a', 'b', 'c'], words: '' })
    expect(c.undo()).toBe(false)
    expect(c.redo()).toBe(true)
    expect(c.redo()).toBe(true)
    expect(c.now()).toEqual({ list: ['a', 'c'], words: 'Look' })
    expect(c.redo()).toBe(true)
    expect(c.now()).toEqual({ list: ['a', 'c'], words: 'Look at this' })
    expect(c.redo()).toBe(false)
  })

  it('takes back a letter typed and deleted after an attachment went before the attachment, though the words read the same', () => {
    let clock = 0
    const c = composer(createComposerHistory(() => (clock += 2000)))
    c.type('Look')
    c.off('b')
    c.type('Look!')
    c.type('Look', 'delete')
    expect(c.undo()).toBe(true)
    expect(c.now()).toEqual({ list: ['a', 'c'], words: 'Look!' })
    expect(c.undo()).toBe(true)
    expect(c.now()).toEqual({ list: ['a', 'c'], words: 'Look' })
    expect(c.undo()).toBe(true)
    expect(c.now()).toEqual({ list: ['a', 'b', 'c'], words: 'Look' })
  })

  it('makes one step of a run of typing, and a new one after a pause, a new line or something else done', () => {
    let clock = 0
    const c = composer(createComposerHistory(() => clock))
    c.type('L')
    c.type('Lo')
    c.type('Look')
    clock = 5000
    c.type('Look at')
    c.type('Look at\n')
    c.type('Look at\nit', null)
    expect(c.undo()).toBe(true)
    expect(c.now().words).toBe('Look at\n')
    expect(c.undo()).toBe(true)
    expect(c.now().words).toBe('Look at')
    expect(c.undo()).toBe(true)
    expect(c.now().words).toBe('Look')
    expect(c.undo()).toBe(true)
    expect(c.now().words).toBe('')
  })

  it('forgets what could be redone once the words change, or something else is taken off', () => {
    const c = composer(createComposerHistory())
    c.off('a')
    expect(c.undo()).toBe(true)
    c.type('New words')
    expect(c.redo()).toBe(false)
    expect(c.undo()).toBe(true)
    c.off('c')
    expect(c.redo()).toBe(false)
    expect(c.now()).toEqual({ list: ['a', 'b'], words: '' })
  })

  it('goes on to the step before one with nothing left to put back', () => {
    const history = createComposerHistory()
    const first = vi.fn()
    history.push({ undo: first, redo: () => {} })
    history.push({ undo: () => false, redo: () => {} })
    expect(history.undo(() => {})).toBe(true)
    expect(first).toHaveBeenCalledTimes(1)
  })

  it('keeps no step past a send, and no words, until its composer shows again', () => {
    const history = createComposerHistory()
    history.wrote(at(''), at('x'))
    history.clear()
    expect(history.known()).toBeUndefined()
    expect(history.undo(() => {})).toBe(false)
  })

  it('keeps the last hundred steps', () => {
    const history = createComposerHistory()
    const undo = vi.fn()
    for (let i = 0; i < 120; i += 1) history.push({ undo, redo: () => {} })
    while (history.undo(() => {}));
    expect(undo).toHaveBeenCalledTimes(100)
  })
})

describe('putting one back', () => {
  const ids = (...all: string[]) => all.map((id) => ({ id }))

  it('goes after the nearest of those before it still there, wherever the list has moved since', () => {
    // A, still being read, then B and C; B is taken off, then A's reading fails: B comes back before C.
    expect(putBack(ids('c'), { id: 'b' }, ['a'])).toEqual(ids('b', 'c'))
    expect(putBack(ids('a', 'new', 'c'), { id: 'b' }, ['a'])).toEqual(ids('a', 'b', 'new', 'c'))
    expect(putBack(ids('a', 'c'), { id: 'b' }, ['a'])).toEqual(ids('a', 'b', 'c'))
    expect(putBack(ids('a', 'b'), { id: 'b' }, ['a'])).toEqual(ids('a', 'b'))
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
function Host({ history, onFocusField }: { readonly history: ComposerHistory; readonly onFocusField?: () => void }) {
  const [value, setValue] = useState('Look')
  const [images, setImages] = useState([
    { id: 'one', name: 'one.png', src: 'data:,' },
    { id: 'two', name: 'two.png', src: 'data:,' },
  ])
  return (
    <div
      onFocusCapture={(e) => {
        if (e.target instanceof HTMLTextAreaElement) onFocusField?.()
      }}
    >
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
          const before = images.slice(0, at).map((x) => x.id)
          const off = () => setImages((now) => now.filter((x) => x.id !== id))
          off()
          history.push({ undo: () => setImages((now) => putBack(now, one, before)), redo: off })
        }}
      />
    </div>
  )
}

const field = () => screen.getByRole<HTMLTextAreaElement>('textbox')
const shown = () => screen.queryAllByRole('img').map((one) => one.getAttribute('alt'))
const undoKey = { key: 'z', code: 'KeyZ', metaKey: true }

describe('the composer', () => {
  it('takes the focus as an image is taken off, without going to the field, and ⌘Z puts it back where it was', () => {
    const onFocusField = vi.fn()
    const { container } = render(<Host history={createComposerHistory()} onFocusField={onFocusField} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove one.png' }))
    expect(shown()).toEqual(['two.png'])
    expect(container.querySelector('form')).toHaveFocus()
    expect(onFocusField).not.toHaveBeenCalled()
    expect(fireEvent.keyDown(container.querySelector('form') as HTMLFormElement, undoKey)).toBe(false)
    expect(shown()).toEqual(['one.png', 'two.png'])
    fireEvent.keyDown(field(), { ...undoKey, shiftKey: true })
    expect(shown()).toEqual(['two.png'])
  })

  it('takes back the words typed after an image went, the letter deleted since included, before the image', async () => {
    const user = userEvent.setup()
    render(<Host history={createComposerHistory()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove two.png' }))
    await user.type(field(), '!{Backspace}')
    expect(field()).toHaveValue('Look')
    fireEvent.keyDown(field(), undoKey)
    expect(field()).toHaveValue('Look!')
    expect(shown()).toEqual(['one.png'])
    fireEvent.keyDown(field(), undoKey)
    expect(field()).toHaveValue('Look')
    expect(shown()).toEqual(['one.png'])
    fireEvent.keyDown(field(), undoKey)
    expect(shown()).toEqual(['one.png', 'two.png'])
  })

  it('makes the field’s own Undo and Redo, from the menu, the history’s', () => {
    render(<Host history={createComposerHistory()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove one.png' }))
    const menu = (kind: string) => fireEvent(field(), new InputEvent('beforeinput', { inputType: kind, cancelable: true, bubbles: true }))
    expect(menu('historyUndo')).toBe(false)
    expect(shown()).toEqual(['one.png', 'two.png'])
    expect(menu('historyRedo')).toBe(false)
    expect(shown()).toEqual(['two.png'])
  })

  it('takes back words put in other than by typing as a step of their own', () => {
    render(<Host history={createComposerHistory()} />)
    fireEvent.input(field(), { target: { value: 'Look, pasted' }, inputType: 'insertFromPaste' })
    fireEvent.keyDown(field(), undoKey)
    expect(field()).toHaveValue('Look')
    fireEvent.keyDown(field(), { ...undoKey, shiftKey: true })
    expect(field()).toHaveValue('Look, pasted')
  })
})
