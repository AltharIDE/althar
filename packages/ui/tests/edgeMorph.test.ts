import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { edgeOf, playEdge, shootEdge } from '../src/lib/edgeMorph'

/*
 * The composer's edge changing shape in place: each piece glides from where
 * it stood before, a surface reshapes at its own size and corners, what only
 * the new shape has fades in late, what only the old had fades out from a
 * still copy, and what else floats there glides to its new place. jsdom lays
 * nothing out and runs no animations, so where each stands is given, and what
 * is asked to move is heard.
 */

interface Heard {
  el: Element
  frames: Keyframe[]
  timing: KeyframeAnimationOptions
  id: string
  cancel: () => void
  /** Runs it to its end, as the page would. */
  finish: () => void
}
let heard: Heard[] = []
let reduced = false

/** Where an element stands: from its data-at, "left top width height". */
const at = (el: Element) => {
  const [left = 0, top = 0, width = 0, height = 0] = ((el as HTMLElement).dataset.at ?? '').split(' ').map(Number)
  return new DOMRect(left, top, width, height)
}
const place = (el: Element | null, where: string) => {
  ;(el as HTMLElement).dataset.at = where
}

beforeEach(() => {
  heard = []
  reduced = false
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query) => ({ matches: reduced && query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }) as never,
  )
  Element.prototype.animate = function (
    this: Element,
    frames: Keyframe[] | PropertyIndexedKeyframes | null,
    timing?: number | KeyframeAnimationOptions,
  ) {
    const listeners: Array<() => void> = []
    const one: Heard = {
      el: this,
      frames: frames as Keyframe[],
      timing: timing as KeyframeAnimationOptions,
      id: '',
      cancel: vi.fn(),
      finish: () => listeners.forEach((listener) => listener()),
    }
    heard.push(one)
    return {
      set id(value: string) {
        one.id = value
      },
      get id() {
        return one.id
      },
      cancel: one.cancel,
      addEventListener: (_: string, listener: () => void) => listeners.push(listener),
    } as unknown as Animation
  }
  Element.prototype.getAnimations = function (this: Element) {
    return heard.filter((one) => one.el === this || this.contains(one.el)) as unknown as Animation[]
  }
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return at(this)
  })
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
    return ((this as HTMLElement).dataset.at === undefined ? [] : [at(this)]) as unknown as DOMRectList
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

/** A composer's edge: the run chip, and a pill of "Merging" with one pull request's mark and number. */
const edge = () => {
  document.body.innerHTML = `
    <div data-composer-floats="" data-at="0 0 600 100">
      <div data-at="0 60 600 26">
        <span id="runs" data-at="0 60 140 26">Site dev server</span>
        <div style="display: contents">
          <button id="pill" data-m-ghost="" data-at="146 60 200 26">
            <span data-m-box="merging" data-at="146 60 200 26" style="border-radius: 13px; box-shadow: none"></span>
            <span data-m="merging-name" data-at="156 64 50 18" style="font-size: 11.5px">Merging</span>
            <span data-m="merging-mark-1" data-m-at="center" data-at="216 66 11 14" style="font-size: 11.5px">●</span>
            <span data-m="merging-label-1" data-at="230 64 40 18" style="font-size: 11.5px">#1224</span>
          </button>
        </div>
      </div>
      <div data-at="0 90 600 24"><div id="back" data-m-in="" data-m-ghost="parent" data-at="10 94 300 16">#1224 sent back.</div></div>
    </div>`
  return document.querySelector<HTMLElement>('[data-composer-floats]')!
}

/** The pill opened into its card, above the run chip, the notice gone. */
const open = (scope: HTMLElement) => {
  scope.querySelector('#back')?.parentElement?.remove()
  scope.querySelector('#pill')!.outerHTML = `
    <section id="card" data-m-ghost="" data-at="0 0 600 54">
      <span data-m-box="merging" data-at="0 0 600 54" style="border-radius: 12px; box-shadow: 0 1px 2px black"></span>
      <span data-m="merging-name" data-at="10 8 56 18" style="font-size: 12.5px">Merging</span>
      <span id="fold" data-m-in="" data-at="570 6 22 22">⌄</span>
      <span data-m="merging-mark-1" data-m-at="center" data-at="12 38 14 18" style="font-size: 12.5px">●</span>
      <span data-m="merging-label-1" data-at="34 38 44 18" style="font-size: 12.5px">#1224</span>
      <span id="title" data-m-in="" data-at="86 38 300 18">Plan card offers Runs on</span>
      <span data-m="merging-note-1" data-at="34 56 300 16" style="font-size: 12px">Its checks failed</span>
    </section>`
  place(scope.querySelector('#runs'), '0 70 140 26')
}

const moveOf = (el: Element | null) => heard.find((one) => one.el === el && 'transform' in (one.frames[0] ?? {}))

describe('the composer’s edge changing shape', () => {
  it('finds the composer’s edge from within it, and stands alone outside one', () => {
    const scope = edge()
    expect(edgeOf(scope.querySelector('#pill'))).toBe(scope)
    const alone = document.createElement('div')
    expect(edgeOf(alone)).toBe(alone)
    expect(edgeOf(null)).toBeNull()
  })

  it('glides each piece from where it stood, words by their left and middle at their old size, marks by their centres', () => {
    const scope = edge()
    const shot = shootEdge(scope)!
    open(scope)
    playEdge(shot, scope)
    const name = moveOf(scope.querySelector('[data-m="merging-name"]'))!
    // From (156, 73) to (10, 17), its left and middle, scaled from 11.5px to 12.5px about its left middle.
    expect(name.frames[0]).toEqual({ transform: `translate(146px, 56px) scale(${11.5 / 12.5})`, transformOrigin: '0 50%' })
    expect(name.frames[1]).toEqual({ transform: 'none', transformOrigin: '0 50%' })
    const mark = moveOf(scope.querySelector('[data-m="merging-mark-1"]'))!
    // Centres: (221.5, 73) then (19, 47).
    expect(mark.frames[0]?.transform).toBe(`translate(202.5px, 26px) scale(${11.5 / 12.5})`)
    expect(mark.frames[0]?.transformOrigin).toBe('50% 50%')
    expect(name.id).toBe('edge-morph')
  })

  it('reshapes the surface from the pill’s box to the card’s, at their own corners and shadows, never stretched', () => {
    const scope = edge()
    const shot = shootEdge(scope)!
    open(scope)
    playEdge(shot, scope)
    const surface = heard.find((one) => one.el === scope.querySelector('[data-m-box]'))!
    expect(surface.frames[0]).toMatchObject({ transform: 'translate(146px, 60px)', width: '200px', height: '26px', borderRadius: '13px' })
    expect(surface.frames[1]).toMatchObject({ transform: 'none', width: '600px', height: '54px', borderRadius: '12px' })
    expect(surface.frames[0]).not.toHaveProperty('scale')
  })

  it('fades in what only the card has once what travels has all but landed, a note with no match among them', () => {
    const scope = edge()
    const shot = shootEdge(scope)!
    open(scope)
    playEdge(shot, scope)
    for (const id of ['#fold', '#title']) {
      const fade = heard.find((one) => one.el === scope.querySelector(id))!
      expect(fade.frames).toEqual([{ opacity: 0 }, { opacity: 1 }])
      expect(fade.timing.delay).toBe(160)
    }
    expect(heard.find((one) => one.el === scope.querySelector('[data-m="merging-note-1"]'))?.frames[0]).toEqual({ opacity: 0 })
  })

  it('glides what else floats there to where the change put it', () => {
    const scope = edge()
    const shot = shootEdge(scope)!
    open(scope)
    playEdge(shot, scope)
    expect(moveOf(scope.querySelector('#runs'))?.frames[0]).toEqual({ transform: 'translate(0px, -10px)' })
  })

  it('fades out what only the pill had from a still copy, hiding in it what moved on, and the notice its line was all of', () => {
    const scope = edge()
    const shot = shootEdge(scope)!
    open(scope)
    playEdge(shot, scope)
    const ghosts = [...document.body.querySelectorAll<HTMLElement>('[aria-hidden="true"] > *')]
    expect(ghosts).toHaveLength(2)
    const [pill, notice] = ghosts
    expect(pill?.style.left).toBe('146px')
    expect(pill?.querySelector<HTMLElement>('[data-m="merging-name"]')?.style.visibility).toBe('hidden')
    expect(pill?.querySelector<HTMLElement>('[data-m-box]')?.style.visibility).toBe('hidden')
    // The notice line was all its bubble held: the bubble goes with it.
    expect(notice?.textContent).toBe('#1224 sent back.')
    expect(notice?.style.top).toBe('90px')
    const out = heard.find((one) => one.el === pill)!
    expect(out.frames).toEqual([{ opacity: 1 }, { opacity: 0 }])
    // Faded, it is taken away.
    out.finish()
    expect(pill?.isConnected).toBe(false)
  })

  it('turns back from where it is drawn: what it started is stopped, and the copies laid down cleared', () => {
    const scope = edge()
    const shot = shootEdge(scope)!
    open(scope)
    playEdge(shot, scope)
    const started = heard.filter((one) => one.id === 'edge-morph' && scope.contains(one.el))
    const laid = [...document.body.querySelectorAll('[aria-hidden="true"] > *')]
    playEdge(shootEdge(scope)!, scope)
    for (const one of started) expect(one.cancel).toHaveBeenCalled()
    for (const copy of laid) expect(copy.isConnected).toBe(false)
  })

  it('with reduced motion, moves nothing: what comes and goes only fades, at once', () => {
    reduced = true
    const scope = edge()
    const shot = shootEdge(scope)!
    open(scope)
    playEdge(shot, scope)
    expect(heard.filter((one) => one.frames.some((frame) => 'transform' in frame && frame.transform !== 'none'))).toEqual([])
    expect(heard.find((one) => one.el === scope.querySelector('#title'))?.timing.delay).toBe(0)
  })

  it('reads nothing where nothing can move, and plays onto no edge', () => {
    expect(shootEdge(null)).toBeNull()
    const scope = edge()
    const shot = shootEdge(scope)!
    expect(() => playEdge(shot, null)).not.toThrow()
    const still = document.createElement('div') as HTMLElement & { animate?: unknown }
    Object.defineProperty(still, 'animate', { value: undefined })
    expect(shootEdge(still)).toBeNull()
  })

  it('copies only the line where the notice holds more, so nothing else there is doubled', () => {
    const scope = edge()
    scope.querySelector('#back')!.insertAdjacentHTML('beforebegin', '<div data-at="10 94 300 16">Codex is signed out.</div>')
    const shot = shootEdge(scope)!
    open(scope)
    playEdge(shot, scope)
    const copies = [...document.body.querySelectorAll<HTMLElement>('[aria-hidden="true"] > *')]
    expect(copies.map((copy) => copy.textContent)).toContain('#1224 sent back.')
    expect(copies.some((copy) => copy.textContent?.includes('Codex is signed out.'))).toBe(false)
  })

  it('copies what goes as it was drawn: half faded where it was half faded, and not at all where it wasn’t shown', () => {
    const scope = edge()
    const pill = scope.querySelector<HTMLElement>('#pill')!
    pill.insertAdjacentHTML('beforeend', '<span id="hidden">unseen</span>')
    pill.querySelector<HTMLElement>('[data-m="merging-label-1"]')!.style.opacity = '0.5'
    const shot = shootEdge(scope)!
    open(scope)
    playEdge(shot, scope)
    const copy = document.body.querySelector<HTMLElement>('[aria-hidden="true"] > button')!
    expect(copy.querySelector<HTMLElement>('#hidden, [data-m="merging-label-1"] ~ span')?.style.display).toBe('none')
    expect(copy.querySelector<HTMLElement>('[data-m="merging-label-1"]')?.style.opacity).toBe('0.5')
  })

  it('fades in a surface with no match, as a card shown first open', () => {
    const scope = edge()
    scope.querySelector('[data-m-box]')!.remove()
    const shot = shootEdge(scope)!
    open(scope)
    playEdge(shot, scope)
    expect(heard.find((one) => one.el === scope.querySelector('[data-m-box]'))?.frames).toEqual([{ opacity: 0 }, { opacity: 1 }])
  })

  it('passes over what isn’t shown, and leaves alone what moves for something else', () => {
    const scope = edge()
    const pill = scope.querySelector<HTMLElement>('#pill')!
    pill.insertAdjacentHTML('beforeend', '<span data-m="unseen">x</span><span data-m-box="unseen"></span><span data-m-in="">y</span>')
    scope.insertAdjacentHTML('beforeend', '<div><span data-m-ghost="">gone already</span></div>')
    // A piece drawn at half its size counts at the size it is drawn.
    Object.defineProperty(scope.querySelector('[data-m="merging-name"]'), 'offsetHeight', { value: 36 })
    const other = scope.querySelector('#runs')!.animate([{ opacity: 1 }], 100)
    const shot = shootEdge(scope)!
    expect(shot.pieces.has('unseen')).toBe(false)
    expect(shot.boxes.has('unseen')).toBe(false)
    expect(shot.ghosts).toHaveLength(2)
    open(scope)
    scope
      .querySelector('#card')!
      .insertAdjacentHTML('beforeend', '<span data-m="unseen">x</span><span data-m-box="unseen"></span><span data-m-in="">y</span>')
    playEdge(shot, scope)
    expect(heard.find((one) => one.el.textContent === 'y')).toBeUndefined()
    const name = moveOf(scope.querySelector('[data-m="merging-name"]'))!
    expect(name.frames[0]?.transform).toContain(`scale(${(11.5 * 0.5) / 12.5})`)
    playEdge(shootEdge(scope)!, scope)
    expect(heard.find((one) => one.el === scope.querySelector('#runs') && one.id === '')?.cancel).not.toHaveBeenCalled()
    expect(other).toBeTruthy()
  })

  it('leaves a piece still where it stands where it stood', () => {
    const scope = edge()
    const shot = shootEdge(scope)!
    playEdge(shot, scope)
    expect(
      heard.filter((one) =>
        one.frames.some((frame) => typeof frame.transform === 'string' && frame.transform.startsWith('translate(0px, 0px) scale(1)')),
      ),
    ).toEqual([])
    expect(moveOf(scope.querySelector('[data-m="merging-name"]'))).toBeUndefined()
  })
})
