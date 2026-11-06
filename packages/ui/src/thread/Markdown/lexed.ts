import { Lexer, type Links, type MarkedToken, type Token } from 'marked'

/*
 * Markdown read as it grows, without reading all of it again for each word.
 *
 * A block followed by another can't change as the text grows: the next
 * words belong to the last block, or start one of their own. So what was
 * read before the last block is kept, as the same tokens, and only the
 * text from the last block on is read again. Where marked's blocks don't
 * spell out the text they were read from, nothing is kept.
 *
 * A link may name a definition anywhere in the text ([docs][ref], then
 * `[ref]: https://…`), before it or after. So the text after the kept
 * blocks is read knowing the definitions among them, and where the text's
 * definitions are no longer those the kept blocks were read with, as one
 * is written, all of it is read again.
 */

/** A text as read: its tokens, and the definitions its links were read with, in a word, to tell whether two read alike. */
export interface Read {
  /** Every top-level token, blank space and definitions too. */
  readonly tokens: ReadonlyArray<Token>
  /** The text's reference definitions, in a word: tokens of the same source read with the same ones are drawn alike. */
  readonly defs: string
}

/** A text as read so far: its blocks, those settled among them, and how much of the text the settled ones cover. */
export interface Lexed extends Read {
  readonly text: string
  /** The tokens before the last that says anything: what comes next can't change them. */
  readonly settled: ReadonlyArray<Token>
  /** How much of the text the settled tokens cover, in characters. */
  readonly covers: number
  /** The definitions among the settled tokens: what the text after them is read with. */
  readonly settledLinks: Links
}

const says = (token: Token) => token.type !== 'space' && token.type !== 'def'

const noLinks = (): Links => Object.create(null) as Links

/** The definitions among tokens, in quotes and lists too, the first of a name holding, as marked reads them. */
const linksIn = (tokens: ReadonlyArray<Token>, into: Links = noLinks()): Links => {
  for (const token of tokens as ReadonlyArray<MarkedToken>) {
    if (token.type === 'def') into[token.tag] ??= { href: token.href, title: token.title }
    else if (token.type === 'blockquote') linksIn(token.tokens, into)
    else if (token.type === 'list') for (const item of token.items) linksIn(item.tokens, into)
  }
  return into
}

/** Text read, knowing the definitions before it. */
const lex = (text: string, links?: Links) => {
  const lexer = new Lexer()
  if (links !== undefined) Object.assign(lexer.tokens.links, links)
  return lexer.lex(text)
}

/** A text read whole, as it is once it is done. */
export const lexAll = (text: string): Read => {
  const tokens = lex(text)
  return { tokens, defs: JSON.stringify(tokens.links) }
}

/** `text` read, from where `before` was settled where it still begins the same way and links alike, else from its start. */
export const lexOn = (text: string, before: Lexed | null): Lexed => {
  if (before !== null && before.covers > 0 && text.startsWith(before.text.slice(0, before.covers))) {
    const tail = lex(text.slice(before.covers), before.settledLinks)
    const defs = JSON.stringify(tail.links)
    if (defs === before.defs) return settle(text, [...before.settled, ...tail], defs, before)
  }
  const { tokens, defs } = lexAll(text)
  return settle(text, tokens, defs, null)
}

/** Its tokens, those before the last that says anything settled; `before`'s kept, where they are the same. */
const settle = (text: string, tokens: ReadonlyArray<Token>, defs: string, before: Lexed | null): Lexed => {
  const last = tokens.findLastIndex(says)
  const settled = last <= 0 ? [] : tokens.slice(0, last)
  const covers = settled.reduce((sum, token) => sum + token.raw.length, 0)
  // Settled no further, the same settled tokens, so what is read from them alone needn't be read again.
  if (before !== null && covers === before.covers)
    return { text, tokens, defs, settled: before.settled, covers, settledLinks: before.settledLinks }
  const spelt = settled.map((token) => token.raw).join('') === text.slice(0, covers)
  return spelt
    ? { text, tokens, defs, settled, covers, settledLinks: linksIn(settled) }
    : { text, tokens, defs, settled: [], covers: 0, settledLinks: noLinks() }
}

/** The blocks that say something, in order. */
export const blocksOf = (tokens: ReadonlyArray<Token>): Token[] => tokens.filter(says)
