import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Composer, type ComposerImage } from '../src/composer/Composer/Composer'

/*
 * What is attached grows in, and fades once taken off (ListMotion): only what
 * is queued, attached or said above them moves them, so a word typed reads
 * nothing of the page.
 */

afterEach(() => {
  vi.restoreAllMocks()
  delete (Element.prototype as Partial<Element>).animate
})

const shot: ComposerImage = { id: 'image-1', name: 'shot.png' }

describe('what is attached to the composer', () => {
  it('is measured as it comes, not as a word is typed', () => {
    // As in a browser, which animates: what is attached is measured only then.
    Object.defineProperty(Element.prototype, 'animate', {
      value: () => ({ addEventListener: () => {}, cancel: () => {} }),
      configurable: true,
    })
    const found = vi.spyOn(Element.prototype, 'querySelectorAll')
    const measured = () => found.mock.calls.filter(([selector]) => selector === '[data-move]').length
    const composer = (value: string, images: ReadonlyArray<ComposerImage>) => (
      <Composer value={value} placeholder="Tell the lead" onChange={() => {}} onSubmit={() => {}} images={images} />
    )
    const { rerender } = render(composer('', []))
    found.mockClear()
    rerender(composer('L', []))
    rerender(composer('Lo', []))
    expect(measured()).toBe(0)
    rerender(composer('Lo', [shot]))
    expect(screen.getByRole('img', { name: 'shot.png' })).toBeTruthy()
    expect(measured()).toBeGreaterThan(0)
  })
})
