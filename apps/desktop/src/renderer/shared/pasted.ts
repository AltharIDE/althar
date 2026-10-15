import type { Unfurl } from '@althar/contracts'

/*
 * The links Althar unfurled in what the person said, where they pasted them.
 * Addresses are found as the runtime finds them (`linksIn`, in
 * @althar/connectors), and each is known by the address the runtime
 * unfurled, or, on a link unfurled before it kept that, by the card's own.
 */

/** An http(s) address, and the punctuation after one that isn't part of it. */
const ADDRESS = /https?:\/\/[^\s<>()"'`]+/g
const AFTER = /[.,;:!?)\]]+$/

/** What the person said in pieces: their words, and each link that unfurled where its address was. */
export const pastedIn = (text: string, links: ReadonlyArray<Unfurl>): ReadonlyArray<string | Unfurl> => {
  const by = new Map(
    links.flatMap((link) => [link.url, link.pasted].flatMap((address) => (address === undefined ? [] : [[address, link] as const]))),
  )
  const pieces: Array<string | Unfurl> = []
  let from = 0
  for (const found of text.matchAll(ADDRESS)) {
    const address = found[0].replace(AFTER, '')
    const link = by.get(address)
    if (link === undefined) continue
    pieces.push(text.slice(from, found.index), link)
    from = found.index + address.length
  }
  pieces.push(text.slice(from))
  return pieces.filter((piece) => piece !== '')
}

/** A link's key as running text says it: MER-231, or #1206 for a pull request, whose key is "PR #1206" in its host's words. */
export const keyOf = (link: Unfurl): string => (link.kind === 'change' ? (link.key.split(' ').at(-1) ?? link.key) : link.key)
