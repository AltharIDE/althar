import type { ReactNode } from 'react'

import type { Brand } from '../../foundations/brands/brands'
import { Icon } from '../../foundations/Icon/Icon'
import { BrandMark } from '../../foundations/Marks/Marks'
import { cx } from '../../lib/cx'
import { Rhythm } from '../../lib/rhythm'
import s from './McpAct.module.css'

/*
 * A call to one of the person's MCP servers that acted on the outside world
 * (ADR-097): a review posted, an issue moved, a message sent. It stands out
 * of the folded work as a card of its own, naming the server, what it did,
 * the words it posted, and Open, where its result says where to see it.
 * Reads stay rows of the work, each naming its server too (`McpServer`).
 */

/** A server, as a call names it: its mark where it is a host's or tracker's, else the plug, and its name. */
export function McpServer({ name, brand, className }: { name: string; brand?: Brand | undefined; className?: string }) {
  return (
    <span className={cx(s.server, className)}>
      {brand === undefined ? <Icon name="plug" size={11} /> : <BrandMark brand={brand} size={11} />}
      {name}
    </span>
  )
}

export interface McpActProps {
  server: string
  brand?: Brand | undefined
  /** What it did, in a few words: Posted on #612. */
  did: ReactNode
  /** The words it posted, where it posted some. */
  words?: string | undefined
  /** Where to see what it did. */
  link?: string | undefined
  /** Open's words. */
  open?: string
  className?: string
}

export function McpAct({ server, brand, did, words, link, open = 'Open', className }: McpActProps) {
  return (
    <div className={cx(s.card, className)} data-rhythm={Rhythm.Card}>
      <p className={s.head}>
        <McpServer name={server} brand={brand} />
        <span className={s.did}>{did}</span>
        {link !== undefined && (
          <a className={s.open} href={link} target="_blank" rel="noreferrer">
            {open}
          </a>
        )}
      </p>
      {words !== undefined && <p className={s.words}>{words}</p>}
    </div>
  )
}
