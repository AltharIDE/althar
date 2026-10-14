// Scrappy: each direction's message with links, put together from the app's own You and LinkView cards, and the kit's marks and glyphs.
import type { Unfurl } from '@althar/contracts'
import { cloneElement, Fragment, type ReactElement, type ReactNode, useRef, useState } from 'react'

import { BrandMark, Icon, IssueRef, Popover, StatusGlyph, type YouProps } from '@althar/ui'
import inline from '../../../../packages/ui/src/thread/Inline/Inline.module.css'

import { issueStatus, productBrand, productName } from '../../src/renderer/shared/products'
import type { Block } from '../../src/renderer/shared/thread'
import { text } from '../../src/renderer/shared/ThreadBlocks'
import css from './parts.module.css'
import type { Direction } from './state'

type YouBlock = Extract<Block, { kind: 'you' }>

/** The key as running text says it: DEV-68, #131 (the unfurl's is "PR #131", in the host's words). */
const keyOf = (link: Unfurl) => (link.kind === 'change' ? (link.key.split(' ').at(-1) ?? link.key) : link.key)

/** The text, with each link's address in it given to `as`. */
const withLinks = (said: string, links: ReadonlyArray<Unfurl>, as: (link: Unfurl, at: number) => ReactNode): ReactNode[] => {
  const pieces: ReactNode[] = [said]
  links.forEach((link, at) => {
    for (let i = pieces.length - 1; i >= 0; i -= 1) {
      const piece = pieces[i]
      if (typeof piece !== 'string' || !piece.includes(link.url)) continue
      const [before, ...after] = piece.split(link.url)
      pieces.splice(i, 1, before, <Fragment key={link.url}>{as(link, at)}</Fragment>, after.join(link.url))
    }
  })
  return pieces.filter((piece) => piece !== '')
}

/** A link's address as the kit says where something came from: its mark and key. */
const Ref = (link: Unfurl) => (
  <IssueRef mark={productBrand(link.product)} id={keyOf(link)} {...(link.product === 'linear' ? { linear: true } : {})} />
)

/** What a pull request's state is, or an issue's status, in a word. */
const stateOf = (link: Unfurl) => (link.kind === 'issue' ? link.status.name : text.change[link.state])

export function Linked({
  direction,
  short,
  block,
  you,
  cards,
}: {
  direction: Exclude<Direction, 'T'>
  short: boolean
  block: YouBlock
  /** The app's You for this message, as ThreadBlocks made it. */
  you: ReactElement<YouProps>
  /** The app's LinkView for each link, in order. */
  cards: ReadonlyArray<ReactElement>
}) {
  const shortened = withLinks(block.text, block.links, Ref)
  switch (direction) {
    // A: the cards inside the bubble, under the words; the address in the words is its key.
    case 'A':
      return cloneElement(
        you,
        {},
        <>
          {shortened}
          <span className={css.inBubble}>{cards}</span>
        </>,
      )
    // B: the cards above the bubble, at its width, as what was sent with it.
    case 'B':
      return (
        <div data-rhythm="you" className={css.above}>
          <div className={css.cards}>{cards}</div>
          {short ? cloneElement(you, {}, shortened) : you}
        </div>
      )
    // C: the cards under the bubble, in the kit's own unfurl slot: the same message, before its time.
    case 'C':
      return cloneElement(you, { unfurl: <span className={css.stack}>{cards}</span> }, ...(short ? [shortened] : []))
    // D: each address becomes a chip in the words; pointing at it shows its card, pressing it keeps the card open.
    case 'D':
      return cloneElement(
        you,
        {},
        withLinks(block.text, block.links, (link, at) => <Chip link={link} card={cards[at]} />),
      )
    // E: one quiet line per link along the bubble's foot, before its time; the address in the words is its key.
    case 'E':
      return cloneElement(
        you,
        {
          unfurl: (
            <span className={css.lines}>
              {block.links.map((link) => (
                <Line key={link.url} link={link} />
              ))}
            </span>
          ),
        },
        shortened,
      )
  }
}

/** D's chip: the tracker's mark, the key and the title, in the words; its card above it while pointed at, or once pressed. */
function Chip({ link, card }: { link: Unfurl; card: ReactNode }) {
  const [open, setOpen] = useState(() => new URLSearchParams(window.location.search).get('open') === link.url)
  const [kept, setKept] = useState(false)
  const over = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  const later = (fn: () => void, ms: number) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(fn, ms)
  }
  const enter = () => {
    over.current = true
    later(() => setOpen(true), 160)
  }
  const leave = () => {
    over.current = false
    if (!kept) later(() => setOpen(false), 200)
  }
  return (
    <Popover
      label={`${keyOf(link)}: ${link.title}`}
      placement="above"
      align="end"
      width={440}
      padded={false}
      initialFocus="panel"
      className={css.peek}
      open={open}
      onOpenChange={(next) => {
        // Pressing a chip whose card is open because it is pointed at keeps it open.
        if (!next && !kept && over.current) return setKept(true)
        setOpen(next)
        setKept(next)
      }}
      trigger={
        <button type="button" className={`${inline.ref} ${css.chip}`} onPointerEnter={enter} onPointerLeave={leave}>
          <BrandMark brand={productBrand(link.product)} size={12} {...(link.product === 'linear' ? { className: css.linear } : {})} />
          <span className={css.key}>{keyOf(link)}</span>
          <span className={css.title}>{link.title}</span>
        </button>
      }
    >
      <div onPointerEnter={enter} onPointerLeave={leave}>
        {card}
      </div>
    </Popover>
  )
}

/** E's line: mark, key, title, and where it stands; it opens the link. */
function Line({ link }: { link: Unfurl }) {
  return (
    <a
      className={css.line}
      href={link.url}
      target="_blank"
      rel="noreferrer"
      aria-label={`${productName(link.product)} ${link.key}: ${link.title}`}
    >
      <BrandMark brand={productBrand(link.product)} size={12} {...(link.product === 'linear' ? { className: css.linear } : {})} />
      <span className={css.key}>{keyOf(link)}</span>
      <span className={css.title}>{link.title}</span>
      <span className={css.state}>
        {link.kind === 'issue' && <StatusGlyph status={issueStatus(link.status.category)} />}
        {stateOf(link)}
      </span>
      <Icon name="external" size={11} className={css.go} />
    </a>
  )
}
