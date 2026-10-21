import { lexer, type Token, type Tokens } from 'marked'

/*
 * What an agent writes is markdown. The kit draws it with `marked` on the
 * desktop; a phone has no DOM, so this reads the same tokens into the few
 * blocks a phone draws: paragraphs, headings, lists, quotes, code, and a
 * rule. Tables and HTML come through as their text.
 */

export type Span = {
  readonly text: string
  readonly strong?: true
  readonly em?: true
  readonly code?: true
  readonly struck?: true
  readonly href?: string
}

export type Block =
  | { readonly kind: 'paragraph'; readonly spans: ReadonlyArray<Span> }
  | { readonly kind: 'heading'; readonly level: number; readonly spans: ReadonlyArray<Span> }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly start: number; readonly items: ReadonlyArray<ReadonlyArray<Span>> }
  | { readonly kind: 'quote'; readonly spans: ReadonlyArray<Span> }
  | { readonly kind: 'code'; readonly lang: string | null; readonly text: string }
  | { readonly kind: 'rule' }

type Marks = Omit<Span, 'text'>

const decode = (text: string): string =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")

const inline = (tokens: ReadonlyArray<Token> | undefined, marks: Marks = {}): Array<Span> =>
  (tokens ?? []).flatMap((token): Array<Span> => {
    switch (token.type) {
      case 'strong':
        return inline((token as Tokens.Strong).tokens, { ...marks, strong: true })
      case 'em':
        return inline((token as Tokens.Em).tokens, { ...marks, em: true })
      case 'del':
        return inline((token as Tokens.Del).tokens, { ...marks, struck: true })
      case 'codespan':
        return [{ ...marks, code: true, text: decode((token as Tokens.Codespan).text) }]
      case 'link':
        return inline((token as Tokens.Link).tokens, { ...marks, href: (token as Tokens.Link).href })
      case 'br':
        return [{ ...marks, text: '\n' }]
      case 'text': {
        const text = token as Tokens.Text
        return text.tokens === undefined ? [{ ...marks, text: decode(text.text) }] : inline(text.tokens, marks)
      }
      default:
        return 'text' in token && typeof token.text === 'string' ? [{ ...marks, text: decode(token.text) }] : []
    }
  })

/** A list item's words: its paragraphs and text, run together; a nested list follows on its own lines. */
const itemSpans = (item: Tokens.ListItem): Array<Span> =>
  item.tokens.flatMap((token, index): Array<Span> => {
    const gap = index === 0 ? [] : [{ text: '\n' }]
    if (token.type === 'list')
      return [...gap, ...(token as Tokens.List).items.flatMap((inner) => [{ text: '\n• ' }, ...itemSpans(inner)])].slice(
        index === 0 ? 0 : 1,
      )
    if (token.type === 'text' || token.type === 'paragraph') return [...gap, ...inline((token as Tokens.Text).tokens ?? [token])]
    return []
  })

export const markdownBlocks = (source: string): ReadonlyArray<Block> =>
  lexer(source).flatMap((token): Array<Block> => {
    switch (token.type) {
      case 'paragraph':
        return [{ kind: 'paragraph', spans: inline((token as Tokens.Paragraph).tokens) }]
      case 'heading':
        return [{ kind: 'heading', level: (token as Tokens.Heading).depth, spans: inline((token as Tokens.Heading).tokens) }]
      case 'list': {
        const list = token as Tokens.List
        return [
          { kind: 'list', ordered: list.ordered, start: typeof list.start === 'number' ? list.start : 1, items: list.items.map(itemSpans) },
        ]
      }
      case 'blockquote':
        return [
          {
            kind: 'quote',
            spans: (token as Tokens.Blockquote).tokens.flatMap((inner) =>
              inline('tokens' in inner ? (inner.tokens as Array<Token>) : [inner]),
            ),
          },
        ]
      case 'code': {
        const code = token as Tokens.Code
        return [{ kind: 'code', lang: code.lang === undefined || code.lang === '' ? null : code.lang, text: code.text }]
      }
      case 'hr':
        return [{ kind: 'rule' }]
      case 'space':
        return []
      default:
        return 'text' in token && typeof token.text === 'string' && token.text.trim() !== ''
          ? [{ kind: 'paragraph', spans: [{ text: decode(token.text) }] }]
          : []
    }
  })
