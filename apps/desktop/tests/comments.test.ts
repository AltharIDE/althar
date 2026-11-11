import { afterEach, describe, expect, it } from 'vitest'

import type { CanvasAnchor } from '@althar/contracts'

import type { Picked } from '../src/main/browser/picked'
import {
  canvasCommentsOf,
  canvasPlace,
  commentsOf,
  commentsText,
  composerComment,
  cropOf,
  cropsOf,
  drop,
  forgetComments,
  gather,
  type GatheredComment,
  giveBack,
  type PageSpot,
  pageCommentsOf,
  rewrite,
  takeAll,
  withComments,
} from '../src/renderer/shared/comments'
import type { ReadImage } from '../src/renderer/shared/images'

/*
 * Comments gathered for a conversation's agent (ADR-100): kept by the
 * thread's draft, numbered by their place, and sent after the person's
 * words, each with what it is on, the page and its size, and its crop.
 */

afterEach(forgetComments)

const be32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
/** A PNG's signature and header: enough for its kind and size. */
const png = (width: number, height: number) =>
  new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...be32(13),
    0x49,
    0x48,
    0x44,
    0x52,
    ...be32(width),
    ...be32(height),
    8,
    6,
    0,
    0,
    0,
  ])
const dataUrl = (bytes: Uint8Array) => `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`

const picked: Picked = {
  selector: 'main > div.banner',
  label: 'div.banner',
  text: 'Something went wrong. Try again.',
  rect: { x: 24, y: 124, width: 592, height: 56 },
  font: '15px · 400 · Inter Variable',
  colour: '#26262b',
  background: '#f6e3e1',
  page: { width: 639, height: 702 },
}

const crop: ReadImage = {
  name: 'comment-1.png',
  mediaType: 'image/png',
  data: 'AAAA',
  digest: 'a'.repeat(64),
  bytes: 3,
  width: 616,
  height: 80,
  src: 'data:image/png;base64,AAAA',
}

const comment = (id: string, note: string, more: Partial<GatheredComment> = {}): GatheredComment => ({
  id,
  note,
  on: { kind: 'page', picked, address: 'http://localhost:5173/refunds', viewport: 'fit' },
  crop,
  ...more,
})

describe('comments waiting in a draft', () => {
  it('gather in order, numbered by their place, and move up a number when one before goes', () => {
    gather('task:t', comment('a', 'First'))
    gather('task:t', comment('b', 'Second'))
    gather('task:other', comment('c', 'Elsewhere'))
    expect(commentsOf('task:t').map((one) => one.note)).toEqual(['First', 'Second'])
    drop('task:t', 'a')
    expect(commentsOf('task:t').map((one, index) => composerComment(one, index + 1).n)).toEqual([1])
    expect(commentsOf('task:other')).toHaveLength(1)
  })

  it('change their words, and their spot where it was found again', () => {
    gather('task:t', comment('a', 'First'))
    rewrite('task:t', 'a', 'First, again')
    expect(commentsOf('task:t')[0]?.note).toBe('First, again')
    rewrite('task:t', 'a', 'Moved', { on: { ...(comment('a', '').on as PageSpot), viewport: 'phone' }, crop: null })
    expect(commentsOf('task:t')[0]).toMatchObject({ note: 'Moved', crop: null, on: { viewport: 'phone' } })
  })

  it('are taken as their message goes, and come back first where Althar didn’t take it', () => {
    gather('task:t', comment('a', 'First'))
    const taken = takeAll('task:t')
    expect(commentsOf('task:t')).toEqual([])
    gather('task:t', comment('b', 'Made since'))
    giveBack('task:t', taken)
    expect(commentsOf('task:t').map((one) => one.id)).toEqual(['a', 'b'])
  })
})

describe('a comment’s chip and card', () => {
  it('show its crop small, its number and words, and every fact of the element as the lead gets it', () => {
    expect(composerComment(comment('a', 'Say what happened'), 2)).toEqual({
      id: 'a',
      n: 2,
      note: 'Say what happened',
      place: 'div.banner',
      crop: { src: crop.src, width: 616, height: 80 },
      facts: [
        { label: 'Element', value: 'div.banner', kind: 'code' },
        { label: 'Text', value: 'Something went wrong. Try again.', kind: 'quote' },
        { label: 'Size', value: '592 × 56' },
        { label: 'Font', value: '15px · 400 · Inter Variable' },
        { label: 'Colour', value: '#26262b', kind: 'colour' },
        { label: 'Background', value: '#f6e3e1', kind: 'colour' },
        { label: 'Page', value: 'localhost:5173/refunds at 639 × 702' },
        { label: 'Selector', value: 'main > div.banner', kind: 'code' },
      ],
    })
  })

  it('say the device’s size a comment was made at, and leave out words an element hasn’t', () => {
    const made = composerComment(
      comment('a', 'Too wide', {
        on: { kind: 'page', picked: { ...picked, text: '' }, address: 'https://althar.ai/', viewport: 'phone' },
        crop: null,
      }),
      1,
    )
    expect(made.crop).toBeUndefined()
    expect(made.facts.find((fact) => fact.label === 'Text')).toBeUndefined()
    expect(made.facts.find((fact) => fact.label === 'Page')?.value).toBe('althar.ai at 390 × 844')
  })
})

describe('what the agent reads', () => {
  it('is the person’s words first, then each comment with what it is on, its page and size, and which picture is its crop', () => {
    const phone = comment('b', 'Line the amount up\nwith the header’s.', {
      on: {
        kind: 'page',
        picked: { ...picked, label: 'li.refund', selector: 'ul > li.refund', text: '' },
        address: 'http://localhost:5173/refunds',
        viewport: 'phone',
      },
    })
    expect(withComments('Two things on the refunds page.', [comment('a', 'Say what happened.'), phone], 1, true)).toBe(
      [
        'Two things on the refunds page.',
        '2 comments on pages:',
        [
          '1. Say what happened.',
          '   - On `div.banner` (“Something went wrong. Try again.”), 592 × 56',
          '   - Selector: `main > div.banner`',
          '   - Page: http://localhost:5173/refunds at 639 × 702',
          '   - Picture 2 of those attached.',
        ].join('\n'),
        [
          '2. Line the amount up',
          '   with the header’s.',
          '   - On `li.refund`, 592 × 56',
          '   - Selector: `ul > li.refund`',
          '   - Page: http://localhost:5173/refunds at 390 × 844 (phone)',
          '   - Picture 3 of those attached.',
        ].join('\n'),
      ].join('\n\n'),
    )
  })

  it('says no picture where pictures don’t go, or a comment has no crop, and is the comments alone with no words', () => {
    const said = withComments('  ', [comment('a', 'Say what happened.', { crop: null }), comment('b', 'And this.')], 0, false)
    expect(said.startsWith('2 comments on pages:')).toBe(true)
    expect(said).not.toContain('Picture')
    expect(commentsText([comment('a', 'One.', { crop: null }), comment('b', 'Two.')], 0, true)).toContain('Picture 1 of those attached.')
    expect(withComments('Just words', [], 0, true)).toBe('Just words')
  })

  it('gets the crops after the person’s own pictures, by their bytes', () => {
    const { sent, pictures } = cropsOf([comment('a', 'One.'), comment('b', 'Two.', { crop: null })])
    expect(sent).toEqual([{ data: 'AAAA', name: 'comment-1.png' }])
    expect(pictures).toEqual([
      { digest: 'a'.repeat(64), mediaType: 'image/png', bytes: 3, width: 616, height: 80, name: 'comment-1.png', unkept: null },
    ])
  })
})

describe('a crop the main process drew', () => {
  it('is read as an image to send, by its own bytes', async () => {
    const read = await cropOf(dataUrl(png(616, 80)), 1, async () => null)
    expect(read).toMatchObject({ name: 'comment-1.png', mediaType: 'image/png', width: 616, height: 80 })
    expect(read?.digest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is none where there was none, or it isn’t a PNG’s data address', async () => {
    expect(await cropOf(null, 1)).toBeNull()
    expect(await cropOf('data:image/svg+xml;base64,PHN2Zy8+', 1)).toBeNull()
    expect(await cropOf('https://example.com/x.png', 1)).toBeNull()
  })
})

describe('a comment on a canvas', () => {
  const onCanvas = (id: string, note: string, anchor: CanvasAnchor = { kind: 'whole' }): GatheredComment => ({
    id,
    note,
    on: { kind: 'canvas', canvasId: 'cnv_1', name: 'sign-in-flow', title: 'Sign-in flow', version: 2, anchor },
    crop: null,
  })
  const passage = onCanvas('b', 'Say Sign in', { kind: 'passage', text: 'Continue', heading: 'Sign in' })

  it('says where it points: the whole canvas, the words it is on, an area, or the element by its label', () => {
    expect(canvasPlace({ kind: 'whole' })).toBe('Whole canvas')
    expect(canvasPlace({ kind: 'passage', text: 'Continue', heading: null })).toBe('“Continue”')
    expect(canvasPlace({ kind: 'area', x: 0, y: 0, width: 0.5, height: 0.5 })).toBe('An area of it')
    expect(canvasPlace({ kind: 'element', selector: 'main > button', label: 'button.continue', text: 'Continue' })).toBe('button.continue')
  })

  it('shows on its chip and card the canvas’s title, its name and version, and the words it is on', () => {
    expect(composerComment(passage, 1)).toEqual({
      id: 'b',
      n: 1,
      note: 'Say Sign in',
      place: 'Sign-in flow',
      facts: [
        { label: 'Canvas', value: 'sign-in-flow v2', kind: 'code' },
        { label: 'On', value: 'Continue', kind: 'quote' },
      ],
    })
    expect(composerComment(onCanvas('a', 'Shorter'), 2).facts).toEqual([{ label: 'Canvas', value: 'sign-in-flow v2', kind: 'code' }])
  })

  it('is sent for the runtime to keep with the message, apart from those on pages, which a page pins', () => {
    const page = comment('p', 'On the page')
    const all = [onCanvas('a', 'Shorter'), page, passage]
    expect(canvasCommentsOf(all)).toEqual([
      { canvasId: 'cnv_1', version: 2, anchor: { kind: 'whole' }, body: 'Shorter' },
      { canvasId: 'cnv_1', version: 2, anchor: { kind: 'passage', text: 'Continue', heading: 'Sign in' }, body: 'Say Sign in' },
    ])
    expect(pageCommentsOf(all).map((one) => one.id)).toEqual(['p'])
  })

  it('is read by the agent with the canvas, its version and where it points, among those on pages', () => {
    expect(commentsText([passage], 0, true)).toBe(
      ['A comment on a canvas:', '1. Say Sign in\n   - On canvas sign-in-flow v2: “Continue”'].join('\n\n'),
    )
    const said = commentsText([onCanvas('a', 'Shorter,\nplease'), comment('p', 'On the page')], 0, true)
    expect(said.startsWith('2 comments:')).toBe(true)
    expect(said).toContain('1. Shorter,\n   please\n   - On canvas sign-in-flow v2: Whole canvas')
    expect(said).toContain('   - Picture 1 of those attached.')
  })
})
