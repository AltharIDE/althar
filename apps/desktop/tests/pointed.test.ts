import { describe, expect, it } from 'vitest'

import { backgroundOf, describe as describeElement, fontOf, hexOf, textOf } from '../src/overlay/describe'
import { cssString, escapeIdent, labelOf, selectorOf, shortClass, stepOf } from '../src/overlay/selector'

/*
 * Point and comment's overlay, as it reads an element in the page's isolated
 * world: the selector that finds it again, escaped so that no name a page
 * chooses can break out of its step, and what the comment's card shows.
 */

const page = (html: string) => {
  document.body.innerHTML = html
  return document
}

/** What the browser's own CSS.escape gives, as CSSOM specifies it, for the names it is checked against. */
const SPECIFIED: ReadonlyArray<readonly [string, string]> = [
  ['plain', 'plain'],
  ['with space', 'with\\ space'],
  ['1st', '\\31 st'],
  ['-1x', '-\\31 x'],
  ['-', '\\-'],
  ['--custom', '--custom'],
  ['a"b', 'a\\"b'],
  ["a'b", "a\\'b"],
  ['a\\b', 'a\\\\b'],
  ['a]b', 'a\\]b'],
  ['a>b', 'a\\>b'],
  ['a,b', 'a\\,b'],
  ['a:hover', 'a\\:hover'],
  ['w-1/2', 'w-1\\/2'],
  ['md:p-4', 'md\\:p-4'],
  ['a\nb', 'a\\a b'],
  ['a\u0000b', 'a\uFFFDb'],
  ['a\u007fb', 'a\\7f b'],
  ['café', 'café'],
  ['_x', '_x'],
]

describe('a name written as CSS reads it', () => {
  it.each(SPECIFIED)('escapes %j as CSSOM’s CSS.escape does', (name, escaped) => expect(escapeIdent(name)).toBe(escaped))

  it('quotes a value whole, whatever it holds', () => {
    expect(cssString('Runs on')).toBe('"Runs on"')
    expect(cssString('say "hi"')).toBe('"say \\"hi\\""')
    expect(cssString('C:\\Users\\')).toBe('"C:\\\\Users\\\\"')
    expect(cssString('\\"')).toBe('"\\\\\\""')
    expect(cssString('two\nlines\r\f')).toBe('"two\\a lines\\d \\c "')
    expect(cssString('nul\u0000')).toBe('"nul\uFFFD"')
  })

  it('never lets a name a page gives break out of its step: each finds its element and not the one beside it', () => {
    const hostile = ['x"], body, [y="', "x'], body, [y='", 'x\\"], body, [y=\\"', 'x\\', 'x\\"', 'a\nb', '"', '\\', '] *, [x', ']\\']
    for (const label of hostile) {
      const doc = page('<div><button></button><button aria-label="decoy">decoy</button></div>')
      const button = doc.querySelector('button')!
      button.setAttribute('aria-label', label)
      const selector = selectorOf(button)
      expect(() => doc.querySelectorAll(selector), label).not.toThrow()
      expect([...doc.querySelectorAll(selector)], label).toEqual([button])
    }
    for (const id of ['1x', 'a b', 'x"y', 'a:b', 'a.b', '#x', 'a\\b', '-', '-2']) {
      const doc = page(`<p></p><p class="decoy"></p>`)
      const p = doc.querySelector('p')!
      p.id = id
      expect([...doc.querySelectorAll(selectorOf(p))], id).toEqual([p])
    }
    for (const name of ['md:p-4', 'w-1/2', '[&>*]:mt-2', 'a"b', '1col']) {
      const doc = page('<i></i><i></i>')
      const i = doc.querySelector('i')!
      i.className = name
      expect([...doc.querySelectorAll(selectorOf(i))], name).toEqual([i])
    }
  })
})

describe('the selector of an element pointed at', () => {
  it('is its id where it has a unique one', () => {
    const doc = page('<main><h1 id="title">Hi</h1></main>')
    expect(selectorOf(doc.querySelector('h1')!)).toBe('#title')
  })

  it('names it by a test id or label before its class, and walks up only as far as it must to be unique', () => {
    const doc = page(
      '<section aria-label="Runs on"><span class="system"><span class="needs">a</span></span><span class="system"><span class="needs">b</span></span></section>',
    )
    const second = doc.querySelectorAll('.needs')[1]!
    const selector = selectorOf(second)
    expect(selector).toBe('span.system:nth-of-type(2) > span.needs')
    expect(doc.querySelector(selector)).toBe(second)
    expect(selectorOf(doc.querySelector('section')!)).toBe('section[aria-label="Runs on"]')
    const tested = page('<div><button data-testid="save" class="btn">Save</button><button class="btn">Cancel</button></div>')
    expect(selectorOf(tested.querySelector('button')!)).toBe('button[data-testid="save"]')
  })

  it('tells same-named siblings apart by their place', () => {
    const doc = page('<ul><li>one</li><li>two</li><li>three</li></ul>')
    const third = doc.querySelectorAll('li')[2]!
    expect(doc.querySelector(selectorOf(third))).toBe(third)
    expect(selectorOf(third)).toContain(':nth-of-type(3)')
  })

  it('walks up past an id the page repeats', () => {
    const doc = page('<div class="a"><b id="dup">1</b></div><div class="b"><b id="dup">2</b></div>')
    const second = doc.querySelectorAll('b')[1]!
    expect(doc.querySelector(selectorOf(second))).toBe(second)
  })

  it('names the element at a glance by its tag and the class as written', () => {
    const doc = page('<span class="RunsOn-module__needs__vPRS x">a</span><div aria-label="Close"></div><em id="e"></em><i></i>')
    expect(labelOf(doc.querySelector('span')!)).toBe('span.needs')
    expect(labelOf(doc.querySelector('div')!)).toBe('div[aria-label]')
    expect(labelOf(doc.querySelector('em')!)).toBe('em#e')
    expect(labelOf(doc.querySelector('i')!)).toBe('i')
    expect(shortClass('Bar-module__address__x1Y2')).toBe('address')
    expect(shortClass('plain')).toBe('plain')
    expect(stepOf(doc.querySelector('i')!)).toBe('i')
  })
})

describe('what a comment’s card says of the element', () => {
  it('reads its words as one line, without scripts and styles, cut short', () => {
    const doc = page('<p>  Runs   on <b>macOS</b><script>x()</script><style>.a{}</style>\n and Linux </p><img alt="A chart">')
    expect(textOf(doc.querySelector('p')!)).toBe('Runs on macOS and Linux')
    expect(textOf(doc.querySelector('img')!)).toBe('A chart')
    const long = page(`<p>${'word '.repeat(200)}</p>`)
    const text = textOf(long.querySelector('p')!)
    expect(text.length).toBe(300)
    expect(text.endsWith('…')).toBe(true)
  })

  it('writes colours as hex, with their alpha where they are see-through', () => {
    expect(hexOf('rgb(143, 136, 126)')).toBe('#8f887e')
    expect(hexOf('rgba(0, 0, 0, 0.5)')).toBe('#00000080')
    expect(hexOf('rgb(10 20 30 / 50%)')).toBe('#0a141e80')
    expect(hexOf('oklch(0.7 0.1 200)')).toBe('oklch(0.7 0.1 200)')
  })

  it('finds the colour behind it on the first ancestor that has one, white where none does', () => {
    const doc = page('<div style="background-color: rgb(10, 10, 10)"><span><b>x</b></span></div><i>y</i>')
    const style = (element: Element) => window.getComputedStyle(element)
    expect(backgroundOf(doc.querySelector('b')!, style)).toBe('#0a0a0a')
    expect(backgroundOf(doc.querySelector('i')!, style)).toBe('#ffffff')
  })

  it('says its font as size, weight and first family', () => {
    const style = { fontSize: '12px', fontWeight: '400', fontFamily: '"Inter Variable", Inter, sans-serif' } as CSSStyleDeclaration
    expect(fontOf(style)).toBe('12px · 400 · Inter Variable')
  })

  it('describes it whole, as the main process takes it', () => {
    const doc = page('<section aria-label="Runs on"><span class="needs" style="color: rgb(143, 136, 126)">x64 and arm64</span></section>')
    const described = describeElement(doc.querySelector('span')!, window)
    expect(described).toMatchObject({
      selector: 'span.needs',
      label: 'span.needs',
      text: 'x64 and arm64',
      colour: '#8f887e',
      background: '#ffffff',
      page: { width: window.innerWidth, height: window.innerHeight },
    })
  })
})
