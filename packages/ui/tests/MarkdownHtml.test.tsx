import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Markdown, type MarkdownFile } from '../src/thread/Markdown/Markdown'

const file = (open = vi.fn()): MarkdownFile => ({
  folder: '',
  open,
  image: ({ path, alt, width }) => <img src={`/files/${path}`} alt={alt} style={width === undefined ? undefined : { width }} />,
})

describe('a markdown file written with HTML', () => {
  it('draws its HTML as GitHub does: a centred line, a picture, its links', () => {
    const open = vi.fn()
    render(
      <Markdown
        file={file(open)}
        source={[
          '<p align="center">',
          '  An IDE for agents.<br />',
          '  <a href="https://example.com"><b>Website</b></a> · <a href="CONTRIBUTING.md">Contributing</a>',
          '</p>',
          '',
          '<p><picture><source media="(prefers-color-scheme: dark)" srcset="brand/ink.png" /><img src="brand/light.png" width="100%" alt="Banner" /></picture></p>',
        ].join('\n')}
      />,
    )
    const line = screen.getByText(/An IDE for agents\./)
    expect(line.tagName).toBe('P')
    expect(line.style.textAlign).toBe('center')
    expect(screen.getByRole('link', { name: /Website/ }).getAttribute('href')).toBe('https://example.com/')
    fireEvent.click(screen.getByRole('button', { name: 'Contributing' }))
    expect(open).toHaveBeenCalledWith('CONTRIBUTING.md')
    const banner = screen.getByRole('img', { name: 'Banner' })
    expect(banner.getAttribute('src')).toBe('/files/brand/light.png')
    expect(banner.style.width).toBe('100%')
    expect(document.body.textContent).not.toContain('<')
  })

  it('draws a table of HTML cells, with headings and pictures sized as the file says', () => {
    render(
      <Markdown
        file={file()}
        source={
          '<table>\n  <tr>\n    <td width="20%" align="center"><img src="a.svg" width="48" alt="" /><br /><b>Claude Code</b></td>\n    <td valign="top"><h3>Tell it what.</h3><p>It picks the team.</p></td>\n  </tr>\n</table>'
        }
      />,
    )
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('cell')).toHaveLength(2)
    expect(within(table).getByRole('heading', { name: 'Tell it what.' })).toBeInTheDocument()
    expect((table.querySelector('img') as HTMLImageElement).style.width).toBe('48px')
  })

  it('never runs it: no script, no handler, no style, no frame', () => {
    const { container } = render(
      <Markdown
        file={file()}
        source={
          '<div onclick="alert(1)" style="color:red"><script>alert(1)</script><iframe src="https://example.com"></iframe>Kept</div>\n\n<a href="javascript:alert(1)">Bad</a>'
        }
      />,
    )
    expect(container.querySelector('script, iframe, [onclick], [style*="red"]')).toBeNull()
    expect(screen.getByText('Kept')).toBeInTheDocument()
    expect(container.querySelector('a[href^="javascript"]')).toBeNull()
  })

  it('keeps markdown inside an inline tag, and its words in what is said, which is no file', () => {
    const { unmount } = render(<Markdown file={file()} source="Free <sub>and **open**</sub> source" />)
    const sub = document.querySelector('sub')
    expect(sub?.querySelector('strong')?.textContent).toBe('open')
    unmount()
    render(<Markdown source={'Free <sub>and</sub> source\n\n<p align="center">Hi</p>'} />)
    expect(document.querySelector('sub')).toBeNull()
    expect(document.body.textContent).toContain('<sub>and</sub>')
    expect(document.body.textContent).toContain('<p align="center">Hi</p>')
  })

  it('keeps the document’s link definitions in an alert, in a file and in what is said', () => {
    const source = '> [!NOTE]\n> See [the guide][g].\n\n[g]: docs/guide.md'
    const open = vi.fn()
    const { unmount } = render(<Markdown file={file(open)} source={source} />)
    fireEvent.click(within(screen.getByRole('note', { name: 'Note' })).getByRole('button', { name: 'the guide' }))
    expect(open).toHaveBeenCalledWith('docs/guide.md')
    unmount()
    render(<Markdown source={'> [!NOTE]\n> See [the guide][g].\n\n[g]: https://example.com/guide'} />)
    expect(
      within(screen.getByRole('note', { name: 'Note' }))
        .getByRole('link', { name: /the guide/ })
        .getAttribute('href'),
    ).toBe('https://example.com/guide')
  })

  it('draws a GitHub alert as a callout under its name', () => {
    render(<Markdown file={file()} source={'> [!NOTE]\n> **Early.** Things will change.'} />)
    const note = screen.getByRole('note', { name: 'Note' })
    expect(within(note).getByText('Early.').tagName).toBe('STRONG')
    expect(note.textContent).not.toContain('[!NOTE]')
  })

  it('brings a heading into view from a link to it on the page', () => {
    const scroll = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scroll, configurable: true, writable: true })
    render(<Markdown file={file()} source={'<a href="#get-started"><b>Get started</b></a>\n\n## Get started\n\nHello.'} />)
    fireEvent.click(screen.getByRole('link', { name: 'Get started' }))
    expect(scroll).toHaveBeenCalledTimes(1)
  })

  it('draws the repository’s own README with none of its HTML left as text', () => {
    const readme = readFileSync(resolve(process.cwd(), '../../README.md'), 'utf8')
    const { container } = render(<Markdown file={file()} source={readme} />)
    expect(container.textContent).not.toMatch(/<\/?(p|a|img|picture|source|table|tr|td|b|br|sub|h3)\b/)
    expect(container.textContent).not.toContain('[!NOTE]')
    expect(screen.getByRole('note', { name: 'Note' })).toBeInTheDocument()
    expect(container.querySelectorAll('img').length).toBeGreaterThan(10)
    expect(screen.getByRole('heading', { name: 'Tell it what. It picks the team.' })).toBeInTheDocument()
  })
})
