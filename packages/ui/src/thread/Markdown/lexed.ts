import { Lexer, type Token } from 'marked'

/*
 * Markdown read as it grows, without reading all of it again for each word.
 *
 * A block followed by another can't change as the text grows: the next
 * words belong to the last block, or start one of their own. So what was
 * read before the last block is kept, as the same tokens, and only the
 * text from the last block on is read again. Where marked's blocks don't
 * spell out the text they were read from, nothing is kept.
 */

/** A text as read so far: its blocks, those settled among them, and how much of the text the settled ones cover. */
export interface Lexed {
  readonly text: string
  /** Every top-level token, blank space and definitions too. */
  readonly tokens: ReadonlyArray<Token>
  /** The tokens before the last that says anything: what comes next can't change them. */
  readonly settled: ReadonlyArray<Token>
  /** How much of the text the settled tokens cover, in characters. */
  readonly covers: number
}

const says = (token: Token) => token.type !== 'space' && token.type !== 'def'

/** `text` read, from where `before` was settled where it still begins the same way, else from its start. */
export const lexOn = (text: string, before: Lexed | null): Lexed => {
  const kept = before !== null && before.covers > 0 && text.startsWith(before.text.slice(0, before.covers))
  const from = kept ? before.covers : 0
  const tokens = [...(kept ? before.settled : []), ...Lexer.lex(text.slice(from))]
  const last = tokens.findLastIndex(says)
  const settled = last <= 0 ? [] : tokens.slice(0, last)
  const covers = settled.reduce((sum, token) => sum + token.raw.length, 0)
  // Settled no further, the same settled tokens, so what is read from them alone needn't be read again.
  if (kept && covers === before.covers) return { text, tokens, settled: before.settled, covers }
  const spelt = settled.map((token) => token.raw).join('') === text.slice(0, covers)
  return { text, tokens, settled: spelt ? settled : [], covers: spelt ? covers : 0 }
}

/** The blocks that say something, in order. */
export const blocksOf = (tokens: ReadonlyArray<Token>): Token[] => tokens.filter(says)
