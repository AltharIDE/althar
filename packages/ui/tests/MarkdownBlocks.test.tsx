import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Markdown, markdownBlocks } from '../src/thread/Markdown/Markdown'

describe('Markdown headings', () => {
  it('ranks a # heading at the level given, and each # more one below, down to the last rank', () => {
    render(<Markdown source={'# Plan\n\n## Steps\n\n#### Detail\n\n###### Footnote'} headingLevel={3} />)
    expect(screen.getByRole('heading', { name: 'Plan' }).tagName).toBe('H3')
    expect(screen.getByRole('heading', { name: 'Steps' }).tagName).toBe('H4')
    expect(screen.getByRole('heading', { name: 'Detail' }).tagName).toBe('H6')
    // Past the last rank it stays at the last.
    expect(screen.getByRole('heading', { name: 'Footnote' }).tagName).toBe('H6')
  })

  it('sets the # heading apart as the title', () => {
    render(<Markdown source={'# Plan\n\n## Steps'} headingLevel={1} />)
    expect(screen.getByRole('heading', { name: 'Plan', level: 1 }).className).toMatch(/title/)
    expect(screen.getByRole('heading', { name: 'Steps', level: 2 }).className).not.toMatch(/title/)
  })
})

describe('Markdown lists', () => {
  it('numbers an ordered list from where it starts', () => {
    const { container } = render(<Markdown source={'3. Third\n4. Fourth\n\n---\n\n1. First\n2. Second'} />)
    const [later, first] = Array.from(container.querySelectorAll('ol'))
    expect(later?.getAttribute('start')).toBe('3')
    expect(first?.hasAttribute('start')).toBe(false)
    expect(
      within(later!)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Third', 'Fourth'])
  })

  it('reads out which of a task list’s items are done', () => {
    render(<Markdown source={'- [x] Write the test\n- [ ] Ship it'} text={{ done: 'ticked', notDone: 'open' }} />)
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['ticked: Write the test', 'open: Ship it'])
  })

  it('draws a loose item’s paragraphs and a nested list inside it', () => {
    render(<Markdown source={'- One\n\n  More of one\n- Two\n  - Under two'} />)
    const [one, two] = screen.getAllByRole('listitem')
    expect(
      within(one!)
        .getAllByText(/one/i)
        .map((p) => p.tagName),
    ).toEqual(['P', 'P'])
    expect(within(two!).getByRole('list')).toHaveTextContent('Under two')
  })
})

describe('Markdown inline', () => {
  it('draws emphasis, strong, struck out and code as themselves', () => {
    const { container } = render(<Markdown source="Some *care*, **force**, ~~old~~ and `a < b`." />)
    expect(container.querySelector('em')).toHaveTextContent('care')
    expect(container.querySelector('strong')).toHaveTextContent('force')
    expect(container.querySelector('del')).toHaveTextContent('old')
    expect(container.querySelector('code')).toHaveTextContent('a < b')
  })

  it('keeps a hard line break, and shows escaped characters as the characters', () => {
    const { container } = render(<Markdown source={'First line  \nSecond \\*line\\* &amp; more'} />)
    const paragraph = container.querySelector('p')!
    expect(paragraph.querySelector('br')).not.toBeNull()
    expect(paragraph.textContent).toBe('First lineSecond *line* & more')
  })

  it('links only to the web, reading out that it opens outside', () => {
    render(<Markdown source={'[The docs](https://example.com/docs "Read them") and [a script](javascript:alert(1))'} />)
    const link = screen.getByRole('link', { name: /^The docs ?\(opens in a new tab\)$/ })
    expect(link).toHaveAttribute('href', 'https://example.com/docs')
    expect(link).toHaveAttribute('title', 'Read them')
    expect(link).toHaveAttribute('target', '_blank')
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.getByText(/and a script/)).toBeInTheDocument()
  })

  it('shows an image’s words, never fetching it', () => {
    const { container } = render(<Markdown source="See ![the chart of builds](https://example.com/chart.png)." />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toBe('See the chart of builds.')
  })

  it('shows raw HTML as text, never running it', () => {
    const { container } = render(<Markdown source={'<div onclick="x()">Block</div>\n\nAn <b>inline</b> tag.'} />)
    expect(container.querySelector('div[onclick]')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    const [block, line] = Array.from(container.querySelectorAll('p'))
    expect(block?.textContent).toBe('<div onclick="x()">Block</div>')
    expect(line?.textContent).toBe('An <b>inline</b> tag.')
  })
})

describe('Markdown blocks', () => {
  it('draws a quote, a rule and a table, the table named as asked', () => {
    const { container } = render(
      <Markdown
        source={'> Quoted **words**\n\n***\n\n| Step | State |\n| :-- | --: |\n| Build | *done* |'}
        text={{ table: { label: 'Steps' } }}
      />,
    )
    expect(container.querySelector('blockquote strong')).toHaveTextContent('words')
    expect(container.querySelector('hr')).not.toBeNull()
    const table = screen.getByRole('region', { name: 'Steps' })
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Step', 'State'])
    expect(within(table).getByText('done').tagName).toBe('EM')
  })

  it('names a table plainly where no name is given', () => {
    render(<Markdown source={'| A | B |\n| - | - |\n| 1 | 2 |'} />)
    expect(screen.getByRole('region', { name: 'Table' })).toBeInTheDocument()
  })

  it('shows only the blocks asked for, counted without the blank space between them', () => {
    const source = 'One.\n\n\n\nTwo.\n\n[ref]: https://example.com\n\nThree.'
    expect(markdownBlocks(source)).toBe(3)
    const { container, rerender } = render(<Markdown source={source} to={1} />)
    expect(Array.from(container.querySelectorAll('p')).map((p) => p.textContent)).toEqual(['One.'])
    rerender(<Markdown source={source} from={1} size="panel" />)
    expect(Array.from(container.querySelectorAll('p')).map((p) => p.textContent)).toEqual(['Two.', 'Three.'])
    expect(container.firstElementChild?.className).toMatch(/panel/)
  })
})
