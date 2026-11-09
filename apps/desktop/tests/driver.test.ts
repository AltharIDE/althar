import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Driver, Found, Located, Scrolled } from '../src/main/browser/driving'
import { installDriver } from '../src/overlay/driver'
import { MARK, markIn, unmarkIn } from '../src/overlay/marks'

/*
 * The lead's eyes and hands in a page beside the conversation (ADR-100): the
 * accessibility tree with references that stay with their elements, the
 * place and state of an element, filling, choosing and scrolling, counting
 * what a real device did, and the outline that shows the person where the
 * lead is. jsdom draws nothing, so where a test needs a box or what is at a
 * point, it says so.
 */

const marks: Array<unknown> = []
let driver: Driver
/* jsdom has no elementFromPoint; a test that needs what is at a point gives it one, and each gets it taken away again. */
const noElementFromPoint = (document as unknown as { elementFromPoint: unknown }).elementFromPoint

beforeEach(() => {
  marks.length = 0
  document.body.innerHTML = ''
  driver = installDriver({ mark: (rect) => marks.push(rect), unmark: () => marks.splice(0).length })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  ;(document as unknown as { elementFromPoint: unknown }).elementFromPoint = noElementFromPoint
  document.body.innerHTML = ''
})

const page = (html: string) => {
  document.body.innerHTML = html
  return document
}

/** The snapshot's lines, or the failure's words. */
const read = (html: string, limit = 1_500): string => {
  page(html)
  const snapshot = driver.snapshot(null, limit)
  if (!snapshot.ok) throw new Error(snapshot.why)
  return snapshot.text
}

const found = (located: Located): Found => {
  if (!located.ok) throw new Error(located.why)
  return located
}

/** Gives an element a box, as a laid-out page would. */
const boxed = (element: Element, box: { x: number; y: number; width: number; height: number }) => {
  element.getBoundingClientRect = () => ({
    ...box,
    top: box.y,
    left: box.x,
    right: box.x + box.width,
    bottom: box.y + box.height,
    toJSON: () => box,
  })
}

/** The page of the browser spec: a banner, a list, links, buttons. */
const REFUNDS = `<header>Acme · Refunds</header>
<main>
  <h1 id="title">Refunds</h1>
  <div class="banner" data-testid="error">Something went wrong. Try again.</div>
  <ul class="refunds"><li class="refund">re_3Pq · order 88210 · €42.00</li><li class="refund">re_3Pp · order 88211 · €35.00</li></ul>
  <p><a id="file" href="file:///etc/hosts">A file</a> · <a id="other" href="vscode://file/etc/hosts">Another app</a>
  · <button id="camera">Camera</button> · <button id="popup">Pop-up</button></p>
</main>`

describe('the snapshot of a page', () => {
  it('reads a page as its landmarks, headings, words, links and buttons, each with a reference', () => {
    expect(read(REFUNDS)).toBe(
      [
        '- banner: Acme · Refunds',
        '- main',
        '  - heading "Refunds" [level=1] [ref=e1]',
        '  - text "Something went wrong. Try again."',
        '  - list',
        '    - listitem: re_3Pq · order 88210 · €42.00',
        '    - listitem: re_3Pp · order 88211 · €35.00',
        '  - paragraph',
        '    - link "A file" [ref=e2] -> file:///etc/hosts',
        '    - text "·"',
        '    - link "Another app" [ref=e3] -> vscode://file/etc/hosts',
        '    - text "·"',
        '    - button "Camera" [ref=e4]',
        '    - text "·"',
        '    - button "Pop-up" [ref=e5]',
      ].join('\n'),
    )
  })

  it('reads a form: fields with their labels, values and states, a select with its options', () => {
    expect(
      read(`<form aria-label="Search refunds">
        <label for="q">Search</label><input id="q" type="search" placeholder="Order" value="882">
        <label><input type="checkbox" checked> Remember me</label>
        <input type="radio" aria-label="Weekly"><input type="number" aria-label="Amount" value="3">
        <input type="password" value="hunter2" aria-label="Password">
        <select aria-label="Country"><option>Austria</option><option selected>Hungary</option></select>
        <textarea aria-label="Note" required>hi</textarea>
        <input type="email" placeholder="you@acme.test" readonly>
        <button type="submit" disabled>Go</button>
        <input type="submit" value="Send"><input type="reset">
      </form>`),
    ).toBe(
      [
        '- form "Search refunds" [ref=e1]',
        '  - searchbox "Search" [ref=e2] value="882"',
        '  - checkbox "Remember me" [checked] [ref=e3]',
        '  - radio "Weekly" [ref=e4]',
        '  - spinbutton "Amount" [ref=e5] value="3"',
        '  - textbox "Password" [password] [ref=e6]',
        '  - combobox "Country" [ref=e7] value="Hungary"',
        '    - option "Austria"',
        '    - option "Hungary" [selected]',
        '  - textbox "Note" [required] [ref=e8] value="hi"',
        '  - textbox "you@acme.test" [readonly] [ref=e9]',
        '  - button "Go" [disabled] [ref=e10]',
        '  - button "Send" [ref=e11]',
        '  - button "Reset" [ref=e12]',
      ].join('\n'),
    )
  })

  it('never shows what a password field holds', () => {
    const text = read('<input type="password" value="hunter2" aria-label="Password"><input type="text" value="visible" aria-label="Name">')
    expect(text).not.toContain('hunter2')
    expect(text).toContain('[password]')
    expect(text).toContain('value="visible"')
  })

  it.each([
    ['<a href="https://acme.test/x">Docs</a>', '- link "Docs" [ref=e1] -> https://acme.test/x'],
    ['<a>Not a link</a>', '- text "Not a link"'],
    ['<h3>Third</h3>', '- heading "Third" [level=3] [ref=e1]'],
    ['<div role="heading" aria-level="4">Fourth</div>', '- heading "Fourth" [level=4] [ref=e1]'],
    ['<nav>x</nav>', '- navigation: x'],
    ['<section aria-label="Plans"><p>Pro</p></section>', '- region "Plans" [ref=e1]\n  - paragraph: Pro'],
    ['<section><p>Pro</p></section>', '- paragraph: Pro'],
    ['<div role="button" aria-pressed="true">Mute</div>', '- button "Mute" [pressed] [ref=e1]'],
    ['<div role="switch" aria-checked="true" aria-label="Dark">x</div>', '- switch "Dark" [checked] [ref=e1]'],
    ['<button aria-expanded="false">Menu</button>', '- button "Menu" [collapsed] [ref=e1]'],
    ['<button aria-expanded="true">Menu</button>', '- button "Menu" [expanded] [ref=e1]'],
    ['<button aria-label="Close">×</button>', '- button "Close" [ref=e1]'],
    ['<button><img alt="Save"> now</button>', '- button "Save now" [ref=e1]'],
    ['<span id="n">Shipping</span><input aria-labelledby="n">', '- text "Shipping"\n- textbox "Shipping" [ref=e1]'],
    ['<input title="Zip code">', '- textbox "Zip code" [ref=e1]'],
    ['<input placeholder="Zip">', '- textbox "Zip" [ref=e1]'],
    ['<img alt="A chart" src="x.png"><img alt="" src="y.png">', '- img "A chart" [ref=e1]'],
    ['<hr>', '- separator'],
    ['<progress aria-label="Upload" value="3" max="10"></progress>', '- progressbar "Upload" [ref=e1]'],
    ['<input type="range" aria-label="Volume" value="5">', '- slider "Volume" [ref=e1] value="5"'],
    [
      '<fieldset><legend>Plan</legend><input type="radio" aria-label="Pro"></fieldset>',
      '- group "Plan" [ref=e1]\n  - radio "Pro" [ref=e2]',
    ],
    ['<details><summary>More</summary><p>Hidden words</p></details>', '- group\n  - button "More" [collapsed] [ref=e1]'],
    [
      '<details open><summary>More</summary><p>Shown words</p></details>',
      '- group\n  - button "More" [expanded] [ref=e1]\n  - paragraph: Shown words',
    ],
    ['<span>Ma<b>c</b>OS and <i>Linux</i></span>', '- text "MacOS and Linux"'],
    ['<p>one<br>two</p>', '- paragraph: one two'],
    ['<div>one</div><div>two</div>', '- text "one"\n- text "two"'],
    ['<ol><li>a</li><li>b</li></ol>', '- list\n  - listitem: a\n  - listitem: b'],
    ['<button tabindex="0"> </button>', '- button [ref=e1]'],
  ])('reads %s', (html, expected) => expect(read(html)).toBe(expected))

  it('reads a table as its rows and cells, named by its caption', () => {
    expect(read('<table><caption>Totals</caption><tr><th>Month</th><th>Sum</th></tr><tr><td>Nov</td><td>€77.00</td></tr></table>')).toBe(
      [
        '- table "Totals" [ref=e1]',
        '  - rowgroup',
        '    - row',
        '      - columnheader "Month"',
        '      - columnheader "Sum"',
        '    - row',
        '      - cell: Nov',
        '      - cell: €77.00',
      ].join('\n'),
    )
  })

  it('names a page’s own clickable things: a hand cursor, or a place in the tab order', () => {
    const text = read('<div style="cursor: pointer" id="card">Open card <span>now</span></div><div tabindex="0">Tab stop</div>')
    expect(text).toBe(['- clickable "Open card now" [cursor=pointer] [ref=e1]', '- clickable "Tab stop" [ref=e2]'].join('\n'))
  })

  it('says which field has the focus', () => {
    page('<input aria-label="Name"><input aria-label="Email">')
    const email = document.querySelectorAll('input')[1]!
    email.focus()
    const text = driver.snapshot(null, 100)
    expect(text.ok && text.text).toContain('- textbox "Email" [focused] [ref=e2]')
  })

  it('names a select’s options, in groups, and stops listing a long one', () => {
    const many = Array.from({ length: 60 }, (_, i) => `<option>Option ${i + 1}</option>`).join('')
    const text = read(
      `<select aria-label="Pick">${many}</select><select multiple aria-label="Tags"><optgroup label="Colours"><option disabled>Red</option><option selected>Blue</option></optgroup></select>`,
    )
    expect(text).toContain('- combobox "Pick" [ref=e1] value="Option 1"')
    expect(text).toContain('  - option "Option 50"')
    expect(text).not.toContain('Option 51"')
    expect(text).toContain('  - … 10 more options')
    expect(text).toContain(
      '- listbox "Tags" [ref=e2] value="Blue"\n  - group "Colours"\n    - option "Red" [disabled]\n    - option "Blue" [selected]',
    )
  })

  it('reads what a script drew in a shadow root, with what is slotted into it', () => {
    page('<x-card><span slot="title">Plan</span><b>loose</b></x-card>')
    const host = document.querySelector('x-card')!
    host.attachShadow({ mode: 'open' }).innerHTML = '<h2><slot name="title"></slot></h2><button>Buy</button><slot></slot>'
    const text = driver.snapshot(null, 100)
    expect(text.ok && text.text).toBe(['- heading "Plan" [level=2] [ref=e1]', '- button "Buy" [ref=e2]', '- text "loose"'].join('\n'))
    // The reference finds it again, inside the root.
    expect(driver.describe({ ref: 'e2' })).toMatchObject({ ok: true, picked: { text: 'Buy' } })
  })

  it('lists a frame without entering it', () => {
    expect(read('<iframe src="https://acme.test/embed" title="Pay"></iframe><iframe></iframe>')).toBe(
      [
        '- iframe "Pay" [ref=e1] -> https://acme.test/embed (its contents aren’t read)',
        '- iframe [ref=e2] (its contents aren’t read)',
      ].join('\n'),
    )
  })

  it('names an svg by its label or title, and leaves a plain one out', () => {
    expect(read('<svg><title>Logo</title><path/></svg><svg aria-hidden="true"></svg><svg><path/></svg>')).toBe('- img "Logo" [ref=e1]')
  })

  it('leaves out what the page doesn’t show', () => {
    const text = read(`<p>shown</p>
      <p style="display: none">gone</p><p hidden>gone too</p><p aria-hidden="true">not for assistive technology</p>
      <div style="visibility: hidden">hidden <button style="visibility: visible">peeking</button></div>
      <details><summary>Closed</summary><p>inside a closed one</p></details>
      <dialog>closed dialog</dialog><dialog open>open dialog</dialog>
      <input type="hidden" value="secret"><script>alert(1)</script><style>p{}</style><template>tpl</template><noscript>noscript</noscript>`)
    expect(text).toBe(
      [
        '- paragraph: shown',
        '- button "peeking" [ref=e1]',
        '- group',
        '  - button "Closed" [collapsed] [ref=e2]',
        '- dialog: open dialog',
      ].join('\n'),
    )
  })

  it('leaves out the overlay’s own host', () => {
    expect(read('<p>page</p><althar-overlay>drawn by Althar</althar-overlay>')).toBe('- paragraph: page')
  })

  it('stops at the limit it is given, and says it stopped', () => {
    page(`<ul>${Array.from({ length: 30 }, (_, i) => `<li><a href="https://acme.test/${i}">Item ${i}</a></li>`).join('')}</ul>`)
    const some = driver.snapshot(null, 10)
    expect(some.ok && some.truncated).toBe(true)
    expect(some.ok && some.nodes).toBe(10)
    expect(some.ok && some.text.split('\n')).toHaveLength(10)
    const all = driver.snapshot(null, 1_000)
    expect(all.ok && all.truncated).toBe(false)
    expect(all.ok && all.nodes).toBe(61)
  })

  it('stops at a document nested deeper than it reads', () => {
    page(`${'<div>'.repeat(600)}deep${'</div>'.repeat(600)}`)
    const deep = driver.snapshot(null, 100)
    expect(deep.ok && deep.truncated).toBe(true)
  })

  it('reads one element’s subtree, named by its reference or a selector', () => {
    page(REFUNDS)
    driver.snapshot(null, 100)
    const byRef = driver.snapshot({ ref: 'e2' }, 100)
    expect(byRef).toEqual({ ok: true, text: '- link "A file" [ref=e2] -> file:///etc/hosts', nodes: 1, truncated: false })
    const list = driver.snapshot({ selector: 'ul.refunds' }, 100)
    expect(list.ok && list.text).toBe(
      ['- list', '  - listitem: re_3Pq · order 88210 · €42.00', '  - listitem: re_3Pp · order 88211 · €35.00'].join('\n'),
    )
    const scoped = driver.snapshot({ selector: 'p' }, 100)
    expect(scoped.ok && scoped.text).toContain('- button "Camera" [ref=e4]')
  })

  it('says why it can’t read what it was asked to', () => {
    page('<p style="display: none" id="gone">x</p><p id="here">y</p>')
    expect(driver.snapshot({ selector: '#gone' }, 100)).toEqual({ ok: false, why: '`#gone` is hidden, so there is nothing of it to read.' })
    expect(driver.snapshot({ selector: '#nothing' }, 100)).toEqual({ ok: false, why: 'Nothing on the page matches `#nothing`.' })
  })
})

describe('references to elements', () => {
  it('stay with their element across snapshots, new elements taking the next number', () => {
    page('<button id="a">A</button><button id="b">B</button>')
    const first = driver.snapshot(null, 100)
    expect(first.ok && first.text).toBe('- button "A" [ref=e1]\n- button "B" [ref=e2]')
    document.body.insertAdjacentHTML('afterbegin', '<button id="c">C</button>')
    const second = driver.snapshot(null, 100)
    expect(second.ok && second.text).toBe('- button "C" [ref=e3]\n- button "A" [ref=e1]\n- button "B" [ref=e2]')
    expect(driver.describe({ ref: 'e2' })).toMatchObject({ ok: true, picked: { selector: '#b' } })
  })

  it('find the element, wherever the page moved it', () => {
    page('<div id="one"><button id="a">A</button></div><div id="two"></div>')
    driver.snapshot(null, 100)
    document.getElementById('two')!.append(document.getElementById('a')!)
    expect(driver.describe({ ref: 'e1' })).toMatchObject({ ok: true, picked: { selector: '#a' } })
  })

  it('say when the element has left the page, and ask for a new snapshot', () => {
    page('<button id="a">A</button>')
    driver.snapshot(null, 100)
    document.getElementById('a')!.remove()
    expect(driver.locate({ ref: 'e1' }, false)).toEqual({ ok: false, why: 'e1 isn’t on the page any more. Take a new snapshot.' })
    expect(driver.describe({ ref: 'e1' })).toEqual({ ok: false, why: 'e1 isn’t on the page any more. Take a new snapshot.' })
    expect(driver.focus({ ref: 'e1' })).toEqual({ ok: false, why: 'e1 isn’t on the page any more. Take a new snapshot.' })
  })

  it('say when what was given was never a reference', () => {
    page('<button>A</button>')
    driver.snapshot(null, 100)
    for (const ref of ['e99', 'x1', 'button', 'e0'])
      expect(driver.locate({ ref }, false)).toEqual({
        ok: false,
        why: `${ref} isn’t a reference from a snapshot. Take a snapshot and use a ref from it, or give a selector.`,
      })
  })

  it('fall back to a selector, the first element it finds, and give it a reference too', () => {
    page('<p class="x">one</p><p class="x">two</p>')
    for (const each of document.querySelectorAll('p')) boxed(each, { x: 0, y: 0, width: 10, height: 10 })
    const one = found(driver.locate({ selector: '.x' }, false))
    expect(one.picked.text).toBe('one')
    expect(one.ref).toBe('e1')
    expect(found(driver.locate({ ref: 'e1' }, false)).picked.text).toBe('one')
    expect(found(driver.locate({ selector: '.x' }, false)).ref).toBe('e1')
  })

  it('prefer a reference to a selector given beside it', () => {
    page('<p id="a">one</p><p id="b">two</p>')
    for (const each of document.querySelectorAll('p')) boxed(each, { x: 0, y: 0, width: 10, height: 10 })
    const b = found(driver.locate({ selector: '#b' }, false))
    expect(found(driver.locate({ ref: b.ref, selector: '#a' }, false)).picked.text).toBe('two')
  })

  it('say what is wrong with a selector, in the browser’s words', () => {
    page('<p>x</p>')
    const bad = driver.locate({ selector: 'p[' }, false)
    expect(bad.ok).toBe(false)
    expect(!bad.ok && bad.why).toMatch(/^`p\[` isn’t a selector the page can read: /)
    expect(driver.locate({ selector: '#missing' }, false)).toEqual({ ok: false, why: 'Nothing on the page matches `#missing`.' })
  })

  it('ask for an element when none is named', () => {
    expect(driver.locate({}, false)).toEqual({ ok: false, why: 'Say which element: a ref from the snapshot, or a CSS selector.' })
    expect(driver.locate({ ref: ' ', selector: '' }, false)).toEqual({
      ok: false,
      why: 'Say which element: a ref from the snapshot, or a CSS selector.',
    })
  })
})

describe('where an element is and what it is like', () => {
  const place = (html: string, selector: string, box = { x: 100, y: 50, width: 80, height: 30 }) => {
    page(html)
    const element = document.querySelector(selector)!
    boxed(element, box)
    return element
  }

  it('gives its box, the point to press, its role and name, and how the comment overlay describes it', () => {
    place('<button id="save" class="btn">Save</button>', '#save')
    const button = found(driver.locate({ selector: '#save' }, false))
    expect(button).toMatchObject({
      ref: 'e1',
      role: 'button',
      name: 'Save',
      rect: { x: 100, y: 50, width: 80, height: 30 },
      at: { x: 140, y: 65 },
      covered: null,
      disabled: false,
      editable: false,
      inView: true,
      picked: { selector: '#save', label: 'button#save', text: 'Save' },
    })
  })

  it('scrolls it into view when asked, to the middle', () => {
    const element = place('<button id="save">Save</button>', '#save')
    const scrollIntoView = vi.fn()
    Object.defineProperty(element, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    driver.locate({ selector: '#save' }, false)
    expect(scrollIntoView).not.toHaveBeenCalled()
    driver.locate({ selector: '#save' }, true)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'nearest', behavior: 'instant' })
  })

  it('presses the middle of the part that shows, and says when none shows', () => {
    place('<button id="save">Save</button>', '#save', { x: window.innerWidth - 40, y: 10, width: 100, height: 20 })
    const half = found(driver.locate({ selector: '#save' }, false))
    expect(half.inView).toBe(true)
    expect(half.at).toEqual({ x: window.innerWidth - 20, y: 20 })
    place('<button id="save">Save</button>', '#save', { x: 10, y: window.innerHeight + 300, width: 100, height: 20 })
    const below = found(driver.locate({ selector: '#save' }, false))
    expect(below.inView).toBe(false)
    expect(below.at.y).toBe(window.innerHeight - 1)
  })

  it('says what covers it, as the comment overlay would name it', () => {
    place('<button id="save">Save</button><div class="modal"></div>', '#save')
    const modal = document.querySelector('.modal')!
    document.elementFromPoint = vi.fn(() => modal)
    expect(found(driver.locate({ selector: '#save' }, false)).covered).toBe('div.modal')
    // Itself, what it holds and what holds it don't cover it.
    page('<label id="wrap"><input id="in" type="checkbox"></label>')
    const input = document.getElementById('in')!
    boxed(input, { x: 0, y: 0, width: 10, height: 10 })
    document.elementFromPoint = vi.fn(() => document.getElementById('wrap'))
    expect(found(driver.locate({ selector: '#in' }, false)).covered).toBeNull()
    document.elementFromPoint = vi.fn(() => input)
    expect(found(driver.locate({ selector: '#in' }, false)).covered).toBeNull()
  })

  it('says whether it is disabled, and whether a person can type in it', () => {
    place(
      '<input id="a"><input id="b" disabled><input id="c" readonly><input id="d" type="checkbox"><textarea id="e"></textarea><div id="f" contenteditable>x</div><p id="g">y</p>',
      '#a',
    )
    for (const id of 'bcdefg') boxed(document.getElementById(id)!, { x: 0, y: 0, width: 10, height: 10 })
    const of = (id: string) => found(driver.locate({ selector: `#${id}` }, false))
    expect(of('a')).toMatchObject({ disabled: false, editable: true, role: 'textbox' })
    expect(of('b')).toMatchObject({ disabled: true, editable: false })
    expect(of('c')).toMatchObject({ disabled: false, editable: false })
    expect(of('d')).toMatchObject({ editable: false, role: 'checkbox' })
    expect(of('e')).toMatchObject({ editable: true })
    expect(of('f')).toMatchObject({ editable: true, role: 'textbox' })
    expect(of('g')).toMatchObject({ editable: false, role: 'paragraph' })
  })

  it('gives a plain container the role generic', () => {
    place('<div id="x">words</div>', '#x')
    expect(found(driver.locate({ selector: '#x' }, false)).role).toBe('generic')
  })

  it('says when it takes up no space, and so can’t be pressed', () => {
    page('<button id="save">Save</button>')
    expect(driver.locate({ selector: '#save' }, false)).toEqual({
      ok: false,
      why: '`#save` takes up no space on the page, so it can’t be pressed. It may be hidden: take a new snapshot.',
    })
  })

  it('describes an element as the comment overlay does', () => {
    page('<section aria-label="Runs on"><span class="needs" style="color: rgb(143, 136, 126)">x64 and arm64</span></section>')
    const described = driver.describe({ selector: 'span' })
    expect(described).toMatchObject({
      ok: true,
      picked: { selector: 'span.needs', label: 'span.needs', text: 'x64 and arm64', colour: '#8f887e' },
    })
    expect(driver.describe({ selector: '#nothing' }).ok).toBe(false)
  })
})

describe('focus, fields and choices', () => {
  it('gives an element the page’s focus, and a label’s control with it', () => {
    page('<label for="q">Search</label><input id="q"><button id="b">Go</button><p id="p">words</p>')
    expect(driver.focus({ selector: '#b' })).toEqual({ ok: true })
    expect(document.activeElement?.id).toBe('b')
    expect(driver.focus({ selector: 'label' })).toEqual({ ok: true })
    expect(document.activeElement?.id).toBe('q')
    expect(driver.focus({ selector: '#p' })).toEqual({ ok: false, why: '`#p` can’t take the page’s focus. Click it instead.' })
  })

  it('selects what a field holds, so text typed replaces it', () => {
    page('<input id="a" value="hello"><div id="b" contenteditable>world</div><p id="c">no</p>')
    const select = vi.spyOn(document.getElementById('a') as HTMLInputElement, 'select')
    expect(driver.selectAll({ selector: '#a' })).toEqual({ ok: true })
    expect(select).toHaveBeenCalled()
    expect(driver.selectAll({ selector: '#b' })).toEqual({ ok: true })
    expect(window.getSelection()?.toString()).toBe('world')
    expect(driver.selectAll({ selector: '#c' })).toEqual({ ok: false, why: '`#c` isn’t a field that holds text.' })
  })

  it('reads what a field holds', () => {
    page(
      '<input id="a" value="x"><textarea id="b">y</textarea><select id="c"><option>One</option><option selected>Two</option></select><input id="d" type="checkbox"><div id="e" contenteditable>z</div><p id="f">w</p>',
    )
    const value = (id: string) => driver.valueOf({ selector: `#${id}` })
    expect([value('a'), value('b'), value('c'), value('d'), value('e'), value('f'), value('nothing')]).toEqual([
      'x',
      'y',
      'Two',
      null,
      'z',
      null,
      null,
    ])
  })

  it('fills a field as typing would, and tells the page: input, then change', () => {
    page('<input id="a" value="old"><textarea id="b"></textarea>')
    const events: Array<string> = []
    const input = document.getElementById('a') as HTMLInputElement
    for (const kind of ['input', 'change'])
      input.addEventListener(kind, (event) => events.push(`${event.type}:${(event.target as HTMLInputElement).value}`))
    expect(driver.fill({ selector: '#a' }, 'new', true)).toEqual({ ok: true, value: 'new' })
    expect(events).toEqual(['input:new', 'change:new'])
    expect(driver.fill({ selector: '#a' }, '!', false)).toEqual({ ok: true, value: 'new!' })
    expect(driver.fill({ selector: '#b' }, 'line one\nline two', true)).toEqual({ ok: true, value: 'line one\nline two' })
  })

  it('fills through the value’s own setter, so a page that watches its field’s value hears the change', () => {
    page('<input id="a">')
    const input = document.getElementById('a') as HTMLInputElement
    const own = vi.fn()
    // A framework's tracker: an own property on the element that shadows the prototype's setter.
    Object.defineProperty(input, 'value', { configurable: true, get: () => 'tracked', set: own })
    driver.fill({ selector: '#a' }, 'typed', true)
    expect(own).not.toHaveBeenCalled()
    delete (input as unknown as Record<string, unknown>).value
    expect(input.value).toBe('typed')
  })

  it('fills an element made editable, by the page’s own editing where the browser has it', () => {
    page('<div id="a" contenteditable>old</div><div id="b" contenteditable>old</div>')
    expect(driver.fill({ selector: '#a' }, 'new', true)).toEqual({ ok: true, value: 'new' })
    expect(driver.fill({ selector: '#a' }, ' more', false)).toEqual({ ok: true, value: 'new more' })
    const insert = vi.fn(() => true)
    document.execCommand = insert
    driver.fill({ selector: '#b' }, 'typed', true)
    expect(insert).toHaveBeenCalledWith('insertText', false, 'typed')
    delete (document as unknown as Record<string, unknown>).execCommand
  })

  it('doesn’t show a password it filled', () => {
    page('<input id="a" type="password">')
    expect(driver.fill({ selector: '#a' }, 'hunter2', true)).toEqual({ ok: true, value: '•••••••' })
    expect((document.getElementById('a') as HTMLInputElement).value).toBe('hunter2')
  })

  it('refuses to fill what a person can’t type in, saying why', () => {
    page('<input id="a" disabled><input id="b" readonly><input id="c" type="checkbox"><p id="d">x</p>')
    expect(driver.fill({ selector: '#a' }, 'x', true)).toEqual({ ok: false, why: '`#a` isn’t a field that takes text: it is disabled.' })
    expect(driver.fill({ selector: '#b' }, 'x', true)).toEqual({ ok: false, why: '`#b` is read-only.' })
    expect(driver.fill({ selector: '#c' }, 'x', true)).toEqual({ ok: false, why: '`#c` isn’t a field that takes text.' })
    expect(driver.fill({ selector: '#d' }, 'x', true)).toEqual({ ok: false, why: '`#d` isn’t a field that takes text.' })
    expect(driver.fill({ selector: '#e' }, 'x', true)).toEqual({ ok: false, why: 'Nothing on the page matches `#e`.' })
  })

  it('chooses options by label or value, and tells the page', () => {
    page(
      '<select id="a"><option value="at">Austria</option><option value="hu">Hungary</option><option value="pl" disabled>Poland</option></select>',
    )
    const heard: Array<string> = []
    const field = document.getElementById('a') as HTMLSelectElement
    for (const kind of ['input', 'change']) field.addEventListener(kind, (event) => heard.push(event.type))
    expect(driver.select({ selector: '#a' }, ['Hungary'])).toEqual({ ok: true, chosen: ['Hungary'] })
    expect(field.value).toBe('hu')
    expect(heard).toEqual(['input', 'change'])
    expect(driver.select({ selector: '#a' }, ['at'])).toEqual({ ok: true, chosen: ['Austria'] })
    expect(driver.select({ selector: '#a' }, ['hungary'])).toEqual({ ok: true, chosen: ['Hungary'] })
    expect(driver.select({ selector: '#a' }, ['Austria', 'Hungary'])).toEqual({ ok: false, why: '`#a` takes one option; 2 were given.' })
    expect(driver.select({ selector: '#a' }, ['France'])).toEqual({
      ok: false,
      why: '`#a` has no option "France". Its options: "Austria", "Hungary", "Poland".',
    })
    expect(driver.select({ selector: '#a' }, ['Poland'])).toEqual({ ok: false, why: 'The option "Poland" is disabled.' })
  })

  it('chooses several options of a multiple select, and only those', () => {
    page('<select id="a" multiple><option selected>Red</option><option>Green</option><option>Blue</option></select>')
    expect(driver.select({ selector: '#a' }, ['Green', 'Blue'])).toEqual({ ok: true, chosen: ['Green', 'Blue'] })
    expect([...(document.getElementById('a') as HTMLSelectElement).selectedOptions].map((option) => option.text)).toEqual(['Green', 'Blue'])
  })

  it('chooses through an option of the list, and refuses what isn’t a select list', () => {
    page(
      '<select id="a"><option id="o">One</option><option>Two</option></select><select id="off" disabled><option>x</option></select><div id="menu" role="listbox">x</div>',
    )
    expect(driver.select({ selector: '#o' }, ['Two'])).toEqual({ ok: true, chosen: ['Two'] })
    expect(driver.select({ selector: '#off' }, ['x'])).toEqual({ ok: false, why: '`#off` is disabled.' })
    const menu = driver.select({ selector: '#menu' }, ['x'])
    expect(menu).toEqual({
      ok: false,
      why: '`#menu` isn’t a select list. If it is a menu the page draws, click it, then click its option.',
    })
  })
})

describe('scrolling, looking and measuring', () => {
  let top = 0
  const roomy = (contentHeight: number) => {
    top = 0
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => top })
    Object.defineProperty(window, 'scrollX', { configurable: true, get: () => 0 })
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: () => contentHeight })
    Object.defineProperty(document.documentElement, 'scrollWidth', { configurable: true, get: () => 900 })
    window.scrollTo = vi.fn((options: ScrollToOptions) => void (top = options.top ?? 0)) as typeof window.scrollTo
  }
  const ok = (scrolled: Scrolled) => {
    if (!scrolled.ok) throw new Error(scrolled.why)
    return scrolled
  }

  afterEach(() => {
    for (const name of ['scrollY', 'scrollX'] as const) delete (window as unknown as Record<string, unknown>)[name]
    for (const name of ['scrollHeight', 'scrollWidth'] as const)
      delete (document.documentElement as unknown as Record<string, unknown>)[name]
  })

  it('scrolls the page a screen at a time, to its top and to its bottom, or by pixels', () => {
    roomy(3_000)
    const step = Math.round(window.innerHeight * 0.85)
    expect(ok(driver.scroll(null, 'down', null))).toEqual({ ok: true, x: 0, y: step, atStart: false, atEnd: false })
    expect(ok(driver.scroll(null, 'down', null)).y).toBe(step * 2)
    expect(ok(driver.scroll(null, 'up', null)).y).toBe(step)
    expect(ok(driver.scroll(null, 'bottom', null))).toMatchObject({ y: 3_000 - window.innerHeight, atEnd: true })
    expect(ok(driver.scroll(null, 'down', null)).y).toBe(3_000 - window.innerHeight)
    expect(ok(driver.scroll(null, 'top', null))).toMatchObject({ y: 0, atStart: true, atEnd: false })
    expect(ok(driver.scroll(null, null, 300)).y).toBe(300)
    expect(ok(driver.scroll(null, null, -100)).y).toBe(200)
    expect(ok(driver.scroll(null, 'down', 50)).y).toBe(250)
    expect(ok(driver.scroll(null, 'up', 1_000)).y).toBe(0)
  })

  it('answers where the page is when told nothing to do', () => {
    roomy(500)
    expect(ok(driver.scroll(null, null, null))).toMatchObject({ y: 0, atStart: true, atEnd: true })
  })

  it('brings an element into view when it is named with nothing else', () => {
    roomy(3_000)
    page('<p id="far">far</p>')
    const into = vi.fn()
    Object.defineProperty(document.getElementById('far')!, 'scrollIntoView', { configurable: true, value: into })
    driver.scroll({ selector: '#far' }, null, null)
    expect(into).toHaveBeenCalledWith({ block: 'center', inline: 'nearest', behavior: 'instant' })
    expect(driver.scroll({ selector: '#nothing' }, null, null)).toEqual({ ok: false, why: 'Nothing on the page matches `#nothing`.' })
  })

  it('scrolls the scrollable box an element is in, not the page', () => {
    roomy(3_000)
    page('<div id="box" style="overflow-y: auto"><p id="in">x</p></div>')
    const box = document.getElementById('box')!
    Object.defineProperty(box, 'scrollHeight', { configurable: true, value: 1_000 })
    Object.defineProperty(box, 'clientHeight', { configurable: true, value: 200 })
    expect(ok(driver.scroll({ selector: '#in' }, 'down', null))).toMatchObject({ y: 170, atEnd: false })
    expect(box.scrollTop).toBe(170)
    expect(ok(driver.scroll({ selector: '#in' }, 'bottom', null))).toMatchObject({ y: 800, atEnd: true })
    expect(window.scrollTo).not.toHaveBeenCalled()
  })

  it('measures the viewport and the document', () => {
    roomy(2_400)
    top = 120
    expect(driver.layout()).toEqual({
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: 0,
      scrollY: 120,
      contentWidth: 900,
      contentHeight: 2_400,
    })
  })

  it('says whether what is asked for is on the page: words, an element, a reference, all that are given', () => {
    page(
      '<h1>Refunds</h1><button id="go">Go</button><p id="gone" style="display: none">Secret</p><p style="visibility: hidden" id="ghost">Ghost</p>',
    )
    boxed(document.getElementById('go')!, { x: 0, y: 0, width: 10, height: 10 })
    const go = found(driver.locate({ selector: '#go' }, false))
    expect(driver.has({ text: 'refunds' })).toBe(true)
    expect(driver.has({ text: '  Refunds  ' })).toBe(true)
    expect(driver.has({ text: 'Invoices' })).toBe(false)
    expect(driver.has({ text: 'Secret' })).toBe(false)
    expect(driver.has({ selector: '#go' })).toBe(true)
    expect(driver.has({ selector: '#gone' })).toBe(false)
    expect(driver.has({ selector: '#ghost' })).toBe(false)
    expect(driver.has({ selector: '#missing' })).toBe(false)
    expect(driver.has({ selector: 'button[' })).toBe(false)
    expect(driver.has({ ref: go.ref })).toBe(true)
    expect(driver.has({ ref: 'e99' })).toBe(false)
    expect(driver.has({ text: 'Refunds', selector: '#go', ref: go.ref })).toBe(true)
    expect(driver.has({ text: 'Refunds', selector: '#missing' })).toBe(false)
    expect(driver.has({})).toBe(false)
    expect(driver.has({ text: ' ' })).toBe(false)
    document.getElementById('go')!.remove()
    expect(driver.has({ ref: go.ref })).toBe(false)
  })
})

describe('what a real device did', () => {
  /*
   * An event a script dispatches is never trusted (isTrusted false), and jsdom
   * has no other kind, so the default check is shown to leave them out; a
   * driver given another check (the second argument, which only a test
   * passes) counts as the page would count a trusted one.
   */
  const dispatch = () => {
    window.dispatchEvent(new Event('pointerdown'))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    window.dispatchEvent(new Event('wheel'))
  }

  it('counts none of the events a page’s own scripts make, as they are never trusted', () => {
    dispatch()
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(driver.input()).toBe(0)
  })

  it('counts presses, keys and wheel turns that are, and nothing else', () => {
    const counting = installDriver({ mark: () => undefined, unmark: () => 0 }, () => true)
    expect(counting.input()).toBe(0)
    dispatch()
    expect(counting.input()).toBe(3)
    window.dispatchEvent(new Event('pointermove'))
    window.dispatchEvent(new Event('keyup'))
    window.dispatchEvent(new Event('click'))
    expect(counting.input()).toBe(3)
  })

  it('counts the person’s input in a frame of the page’s own origin too, such as Storybook’s preview, and in one within it', () => {
    const counting = installDriver({ mark: () => undefined, unmark: () => 0 }, () => true)
    document.body.innerHTML = '<iframe id="preview"></iframe>'
    const preview = (document.getElementById('preview') as HTMLIFrameElement).contentWindow!
    // A frame is listened to from when the count is next asked for: the start of each of the lead's actions, and each step.
    expect(counting.input()).toBe(0)
    preview.dispatchEvent(new Event('pointerdown'))
    preview.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    expect(counting.input()).toBe(2)
    // Asked again, it isn't listened to twice.
    preview.dispatchEvent(new Event('wheel'))
    expect(counting.input()).toBe(3)
    preview.document.body.innerHTML = '<iframe id="inner"></iframe>'
    expect(counting.input()).toBe(3)
    const inner = (preview.document.getElementById('inner') as HTMLIFrameElement).contentWindow!
    inner.dispatchEvent(new Event('pointerdown'))
    expect(counting.input()).toBe(4)
  })

  it('listens to a frame again once it loads another document, though its window stays the same', () => {
    const counting = installDriver({ mark: () => undefined, unmark: () => 0 }, () => true)
    document.body.innerHTML = '<iframe id="preview"></iframe>'
    const frame = document.getElementById('preview') as HTMLIFrameElement
    // A frame keeps its window across a navigation, but the listeners were on the window it had before, and went with it.
    let listeners = new Map<string, Array<(event: Event) => void>>()
    let loaded = document.implementation.createHTMLDocument('')
    const proxy = {
      get document() {
        return loaded
      },
      addEventListener(kind: string, listener: (event: Event) => void) {
        listeners.set(kind, [...(listeners.get(kind) ?? []), listener])
      },
    }
    Object.defineProperty(frame, 'contentWindow', { get: () => proxy })
    const press = () => {
      for (const listener of listeners.get('pointerdown') ?? []) listener(new Event('pointerdown'))
    }
    expect(counting.input()).toBe(0)
    press()
    expect(counting.input()).toBe(1)
    loaded = document.implementation.createHTMLDocument('')
    listeners = new Map()
    expect(counting.input()).toBe(1)
    press()
    expect(counting.input()).toBe(2)
    // Listened to once, not again each time the count is asked for.
    expect(counting.input()).toBe(2)
  })

  it('goes past a frame of another origin, which can’t be listened to from the page', () => {
    const counting = installDriver({ mark: () => undefined, unmark: () => 0 }, () => true)
    document.body.innerHTML = '<iframe id="other"></iframe>'
    const frame = document.getElementById('other') as HTMLIFrameElement
    Object.defineProperty(frame, 'contentWindow', {
      get: () => ({
        get document(): Document {
          throw new DOMException('Blocked a frame from accessing a cross-origin frame.', 'SecurityError')
        },
      }),
    })
    expect(counting.input()).toBe(0)
    window.dispatchEvent(new Event('pointerdown'))
    expect(counting.input()).toBe(1)
  })

  it('hears them first, whatever the page does to them below', () => {
    const counting = installDriver({ mark: () => undefined, unmark: () => 0 }, () => true)
    document.body.innerHTML = '<button id="b">x</button>'
    document.getElementById('b')!.addEventListener('pointerdown', (event) => event.stopPropagation())
    document.getElementById('b')!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(counting.input()).toBe(1)
  })

  it('asks the event itself whether it is trusted', () => {
    const asked: Array<boolean> = []
    const counting = installDriver(
      { mark: () => undefined, unmark: () => 0 },
      (event) => asked.push(event.isTrusted) > 0 && event.isTrusted,
    )
    dispatch()
    expect(asked).toEqual([false, false, false])
    expect(counting.input()).toBe(0)
  })
})

describe('the lead’s outline', () => {
  it('hands a box to the overlay to draw', () => {
    driver.mark({ x: 1, y: 2, width: 30, height: 40 })
    expect(marks).toEqual([{ x: 1, y: 2, width: 30, height: 40 }])
  })

  it('draws a box for a moment, then fades it and takes it away', () => {
    vi.useFakeTimers()
    const layer = document.createElement('div')
    const mounted = vi.fn()
    const mark = markIn(layer, mounted)
    mark({ x: 10, y: 20, width: 100, height: 30 })
    expect(mounted).toHaveBeenCalledTimes(1)
    const outline = layer.firstElementChild as HTMLElement
    expect(outline.className).toBe('lead')
    expect([outline.style.left, outline.style.top, outline.style.width, outline.style.height]).toEqual(['10px', '20px', '100px', '30px'])
    vi.advanceTimersByTime(MARK.holdMs - 1)
    expect(outline.classList.contains('fading')).toBe(false)
    vi.advanceTimersByTime(1)
    expect(outline.classList.contains('fading')).toBe(true)
    expect(layer.children).toHaveLength(1)
    vi.advanceTimersByTime(MARK.fadeMs)
    expect(layer.children).toHaveLength(0)
  })

  it('shows several at once, the oldest going when there are too many', () => {
    vi.useFakeTimers()
    const layer = document.createElement('div')
    const mark = markIn(layer, () => undefined)
    for (let i = 0; i < MARK.most + 3; i += 1) mark({ x: i, y: 0, width: 10, height: 10 })
    expect(layer.children).toHaveLength(MARK.most)
    expect((layer.firstElementChild as HTMLElement).style.left).toBe('3px')
    vi.advanceTimersByTime(MARK.holdMs + MARK.fadeMs)
    expect(layer.children).toHaveLength(0)
  })

  it('takes every outline away at once for a picture of the page alone, saying how many there were', () => {
    vi.useFakeTimers()
    const layer = document.createElement('div')
    const mark = markIn(layer, () => undefined)
    const unmark = unmarkIn(layer)
    mark({ x: 0, y: 0, width: 10, height: 10 })
    mark({ x: 20, y: 0, width: 10, height: 10 })
    expect(unmark()).toBe(2)
    expect(layer.children).toHaveLength(0)
    expect(unmark()).toBe(0)
    // Their timers find nothing left to fade or take away.
    vi.advanceTimersByTime(MARK.holdMs + MARK.fadeMs)
    expect(layer.children).toHaveLength(0)
  })

  it('draws nothing for a box that is no box', () => {
    const layer = document.createElement('div')
    const mounted = vi.fn()
    const mark = markIn(layer, mounted)
    mark({ x: 0, y: 0, width: 0, height: 10 })
    mark({ x: Number.NaN, y: 0, width: 10, height: 10 })
    mark({ x: 0, y: 0, width: 10, height: Number.POSITIVE_INFINITY })
    expect(layer.children).toHaveLength(0)
    expect(mounted).not.toHaveBeenCalled()
  })
})

describe('one injection', () => {
  const clear = () => {
    delete (globalThis as { __altharOverlay?: unknown }).__altharOverlay
    delete (globalThis as { __altharDriver?: unknown }).__altharDriver
    document.querySelector('althar-overlay')?.remove()
  }

  afterEach(clear)

  it('installs the overlay and the driver together, once a world, and the lead’s outline goes into the page’s overlay', async () => {
    clear()
    vi.resetModules()
    await import('../src/overlay/overlay')
    const first = { overlay: globalThis.__altharOverlay, driver: globalThis.__altharDriver }
    expect(first.overlay).toBeDefined()
    expect(first.driver).toBeDefined()
    // Reading the page puts nothing in it.
    page('<button>Go</button>')
    first.driver!.snapshot(null, 10)
    expect(document.querySelector('althar-overlay')).toBeNull()
    // Outlining an element does, in the overlay's closed root.
    first.driver!.mark({ x: 1, y: 2, width: 30, height: 40 })
    const host = document.querySelector('althar-overlay')
    expect(host).not.toBeNull()
    expect(host!.shadowRoot).toBeNull()
    // Run again in the same world, it finds both there.
    vi.resetModules()
    await import('../src/overlay/overlay')
    expect(globalThis.__altharOverlay).toBe(first.overlay)
    expect(globalThis.__altharDriver).toBe(first.driver)
  })
})
