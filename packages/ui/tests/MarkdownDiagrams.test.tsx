import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Markdown } from '../src/thread/Markdown/Markdown'
import { clean, drawDiagram, type DiagramColours } from '../src/thread/Markdown/drawDiagram'
import { closedFence } from '../src/thread/Markdown/drawing'

const FLOW = '```mermaid\nflowchart LR\n  A[Plan] --> B{Checks pass?}\n  B -->|yes| C[Merge]\n  B -->|no| A\n```'
const BROKEN = '```mermaid\nflowchart LR\n  A --> \n```'

const COLOURS: DiagramColours = {
  dark: false,
  font: 'sans-serif',
  paper: '#ffffff',
  fill: '#f4f2ec',
  edge: '#d6d1c6',
  ink: '#141417',
  ink2: '#45454c',
  line: '#6f6f77',
  fill2: '#e7e3da',
  fill3: '#fbfaf7',
}

/* anything that could leave the window: a fetch, a request, or an element that loads from an address (a link loads nothing until it is followed) */
const network = { fetch: vi.fn(), open: vi.fn() }
const LOADS = 'img, image, script, link, iframe, frame, embed, object, source, video, audio, use, feImage'
let watching: MutationObserver
const loaded: string[] = []
const loadsFrom = (el: Element) =>
  ['src', 'href', 'xlink:href', 'srcset', 'data']
    .map((name) => el.getAttribute(name))
    .filter((value): value is string => value !== null && !value.trim().startsWith('#'))

beforeEach(() => {
  vi.stubGlobal('fetch', network.fetch)
  vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(network.open)
  watching = new MutationObserver((changes) => {
    for (const change of changes)
      for (const node of change.addedNodes)
        if (node instanceof Element)
          for (const el of [node, ...node.querySelectorAll('*')])
            if (el.matches(LOADS)) for (const from of loadsFrom(el)) loaded.push(`${el.tagName} ${from}`)
  })
  watching.observe(document, { childList: true, subtree: true })
})
afterEach(() => {
  watching.disconnect()
  const seen = [...loaded]
  loaded.length = 0
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  expect(network.fetch).not.toHaveBeenCalled()
  expect(network.open).not.toHaveBeenCalled()
  network.fetch.mockClear()
  network.open.mockClear()
  expect(seen).toEqual([])
})

/** What in a drawing could reach anything: its elements' addresses, and the addresses in its CSS. */
const reaches = (svg: string) => {
  const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement
  const all = [root, ...root.querySelectorAll('*')]
  const css = [...root.querySelectorAll('style')]
    .map((style) => style.textContent ?? '')
    .concat(all.map((el) => el.getAttribute('style') ?? ''))
  return {
    tags: all.map((el) => el.localName).filter((tag) => /^(img|image|a|script|foreignObject|iframe|use)$/i.test(tag)),
    addresses: all.flatMap(loadsFrom),
    handlers: all.flatMap((el) => [...el.attributes].map((a) => a.name)).filter((name) => name.startsWith('on')),
    fetches: css.flatMap((text) => [...text.matchAll(/@import|url\(\s*(?!['"]?#)[^)]*\)/gi)].map((m) => m[0])),
  }
}

describe('Markdown diagrams', () => {
  it('draws a ```mermaid block as a diagram', async () => {
    const { container } = render(<Markdown source={`How a change lands:\n\n${FLOW}`} />)
    const drawn = await screen.findByRole('img', { name: 'Diagram' })
    expect(drawn.querySelector('svg')).not.toBeNull()
    expect(drawn).toHaveTextContent('Checks pass?')
    expect(container.querySelector('pre')).toBeNull()
  })

  it('switches to its source and back, and copies the source', async () => {
    const write = vi.fn((_text: string) => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true })
    render(<Markdown source={FLOW} />)
    await screen.findByRole('img', { name: 'Diagram' })
    fireEvent.click(screen.getByRole('button', { name: 'Source' }))
    expect(screen.queryByRole('img', { name: 'Diagram' })).toBeNull()
    expect(screen.getByText(/A\[Plan\]/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(write).toHaveBeenCalledWith(FLOW.slice('```mermaid\n'.length, -'\n```'.length)))
    fireEvent.click(screen.getByRole('button', { name: 'Diagram' }))
    expect(screen.getByRole('img', { name: 'Diagram' })).toBeInTheDocument()
  })

  it('opens bigger, over the window', async () => {
    render(<Markdown source={FLOW} />)
    await screen.findByRole('img', { name: 'Diagram' })
    fireEvent.click(screen.getByRole('button', { name: 'Open bigger' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.querySelector('svg')).not.toBeNull()
  })

  it('shows a diagram that doesn’t parse as its source, with mermaid’s error under it', async () => {
    const { container } = render(<Markdown source={BROKEN} />)
    const note = await screen.findByRole('note')
    expect(note).toHaveTextContent('Couldn’t draw this diagram')
    expect(note).toHaveTextContent(/Parse error/)
    expect(container.querySelector('pre code')).toHaveTextContent('flowchart LR A -->')
    expect(screen.queryByRole('img', { name: 'Diagram' })).toBeNull()
  })

  it('leaves other code blocks as code', async () => {
    const { container } = render(<Markdown source={'```ts\nconst a = 1\n```\n\n```\nflowchart LR\n  A --> B\n```'} />)
    await act(() => new Promise((done) => setTimeout(done, 50)))
    expect(container.querySelectorAll('pre code')).toHaveLength(2)
    expect(screen.queryByRole('img', { name: 'Diagram' })).toBeNull()
  })

  it('shows a block still streaming in as its source, and draws it once its fence closes', async () => {
    const open = FLOW.slice(0, -'\n```'.length)
    const { container, rerender } = render(<Markdown source={open} />)
    await act(() => new Promise((done) => setTimeout(done, 50)))
    expect(screen.queryByRole('img', { name: 'Diagram' })).toBeNull()
    expect(container.querySelector('pre code')).toHaveTextContent('A[Plan]')
    rerender(<Markdown source={FLOW + '\n\nAnd then'} />)
    expect(await screen.findByRole('img', { name: 'Diagram' })).toBeInTheDocument()
  })

  it('knows a closed fence from one still open', () => {
    expect(closedFence('```mermaid\nflowchart LR\n```')).toBe(true)
    expect(closedFence('```mermaid\nflowchart LR\n```\n\n')).toBe(true)
    expect(closedFence('~~~mermaid\nflowchart LR\n~~~')).toBe(true)
    expect(closedFence('```mermaid\nflowchart LR\n  A --> B')).toBe(false)
    expect(closedFence('```mermaid\nflowchart LR\n``')).toBe(false)
    expect(closedFence('```mermaid')).toBe(false)
  })
})

describe('drawDiagram', () => {
  it('keeps nothing that runs or fetches, whatever the source asks for', async () => {
    const hostile = [
      '%%{init: {"securityLevel": "loose", "htmlLabels": true, "themeCSS": "@import url(https://evil.example/x.css); .node { background: url(https://evil.example/y.png) }"}}%%',
      'flowchart LR',
      '  A["<img src=https://evil.example/z.png onerror=alert(1)>"] --> B',
      '  click A href "https://evil.example/go"',
      '  click B call alert(1)',
    ].join('\n')
    const { svg } = await drawDiagram(hostile, COLOURS)
    expect(reaches(svg)).toEqual({ tags: [], addresses: [], handlers: [], fetches: [] })
    /* the label's markup is its words, drawn as text */
    expect(svg).toContain('&lt;img')
  })

  it('takes out of a drawing whatever runs or fetches, in case mermaid lets one through', () => {
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 200 100" onload="alert(1)">',
      '<style>@import url("https://evil.example/a.css"); .n { fill: url(https://evil.example/b.svg#p); background: u\\72l(https://evil.example/c.png) } .m { marker-end: url(#arrow) }</style>',
      '<script>alert(1)</script>',
      '<image href="https://evil.example/d.png" width="10" height="10"/>',
      '<a href="https://evil.example/e"><text>link</text></a>',
      '<use xlink:href="https://evil.example/f.svg#g"/><use href="#arrow"/>',
      '<rect style="fill: url(\'https://evil.example/h.png\')" onclick="alert(1)"/>',
      '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><img src="https://evil.example/i.png"/><iframe src="https://evil.example"></iframe></div></foreignObject>',
      '<set attributeName="href" to="https://evil.example/j"/>',
      '</svg>',
    ].join('')
    const drawn = clean(svg)
    expect(reaches(drawn.svg)).toMatchObject({ addresses: [], handlers: [], fetches: [] })
    expect(drawn.svg).not.toMatch(/<script|<image|<img|<iframe|<set|<a /)
    /* an escape that spelled url( out is left meaningless */
    expect(drawn.svg).not.toMatch(/url\(\s*['"]?https?:/)
    /* what points within the drawing stays */
    expect(drawn.svg).toContain('url(#arrow)')
    expect(drawn).toMatchObject({ width: 200, height: 100 })
  })

  it('draws at the diagram’s own size, not stretched to the width it is in', async () => {
    const drawn = await drawDiagram('sequenceDiagram\n  Lead->>Worker: start\n  Worker-->>Lead: done', COLOURS)
    expect(drawn.width).toBeGreaterThan(0)
    expect(drawn.svg).toMatch(new RegExp(`<svg[^>]* width="${drawn.width}"`))
    expect(drawn.svg).not.toMatch(/max-width/)
  })

  /* the repository's own: every diagram its architecture docs draw */
  const docs = [
    'README',
    '01-concepts-and-project-model',
    '02-desktop-runtime',
    '03-agent-runtime-and-auth',
    '04-coordinator',
    '05-workflow-engine',
    '06-integrations-and-skills',
  ]
  const fixtures = docs.flatMap((doc) => {
    const text = readFileSync(join(process.cwd(), `../../docs/architecture/${doc}.md`), 'utf8')
    return [...text.matchAll(/```mermaid\n([\s\S]*?)\n```/g)].map((m, i) => ({ name: `${doc} #${i + 1}`, source: m[1] ?? '' }))
  })

  it('finds the diagrams in docs/architecture', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(10)
  })

  it.each(fixtures)('draws $name', async ({ source }) => {
    const { svg } = await drawDiagram(source, COLOURS)
    expect(svg).toMatch(/^<svg/)
    expect(reaches(svg)).toEqual({ tags: [], addresses: [], handlers: [], fetches: [] })
  })
})
