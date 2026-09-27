import type { ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { Caret, Disclosure, DisclosureTrigger, Fold, type Disclosable } from '../../primitives/Fold/Fold'
import { KeyValues } from '../../primitives/KeyValues/KeyValues'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import { Rhythm } from '../../lib/rhythm'
import s from './External.module.css'

/*
 * Things from outside the repository sit in a light outline, one line each,
 * so they read as a different source from the file reads around them
 * without standing up off the page. Several pages read in a row fold into one.
 */

export interface ExternalText {
  read: string
  searched: string
  pages: (n: number) => string
  results: (n: number) => string
  /** Hosts beyond the first two. */
  more: (n: number) => string
  /** Read after a link that opens a new tab. */
  newTab: string
}

export const externalText: ExternalText = {
  read: 'Read',
  searched: 'Searched',
  pages: (n) => `${n} web pages`,
  results: (n) => `${n} results`,
  more: (n) => `+${n}`,
  newTab: '(opens in a new tab)',
}

export const hostOf = (url: string) =>
  url
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0] ?? url

function Favicon({ host, small }: { host: string; small?: boolean }) {
  return (
    <span className={cx(s.fav, small && s.small)} aria-hidden="true">
      {host[0]?.toUpperCase()}
    </span>
  )
}

function NewTab({ href, className, children, t }: { href: string; className?: string; children: ReactNode; t: ExternalText }) {
  return (
    <a className={className} href={href} target="_blank" rel="noreferrer">
      {children}
      <VisuallyHidden> {t.newTab}</VisuallyHidden>
    </a>
  )
}

interface OutlineProps extends Disclosable {
  lead: ReactNode
  kind: string
  title: ReactNode
  mono?: boolean
  aside: ReactNode
  children: ReactNode
}

function Outline({ lead, kind, title, mono, aside, children, ...disclosure }: OutlineProps) {
  return (
    <Disclosure {...disclosure} rhythm={Rhythm.External} className={s.ext}>
      <DisclosureTrigger>
        <button type="button" className={s.row}>
          {lead}
          <span className={s.kind}>{kind}</span>
          <span className={cx(s.title, mono && s.mono)}>{title}</span>
          <span className={s.aside}>{aside}</span>
          <Caret />
        </button>
      </DisclosureTrigger>
      <Fold bleed={false}>{children}</Fold>
    </Disclosure>
  )
}

export interface WebFetchProps extends Disclosable {
  title: string
  url: string
  /** The part of the page it used. */
  excerpt: string
  text?: Partial<ExternalText>
}

export function WebFetch({ title, url, excerpt, text, ...disclosure }: WebFetchProps) {
  const t = { ...externalText, ...text }
  const host = hostOf(url)
  return (
    <Outline lead={<Favicon host={host} />} kind={t.read} title={title} aside={host} {...disclosure}>
      <div className={s.body}>
        <blockquote className={s.quote} cite={url}>
          {excerpt}
        </blockquote>
        <NewTab className={s.link} href={url} t={t}>
          {url.replace(/^https?:\/\//, '')} ↗
        </NewTab>
      </div>
    </Outline>
  )
}

export interface WebPage {
  title: string
  url: string
}

export interface WebReadsProps extends Disclosable {
  pages: WebPage[]
  text?: Partial<ExternalText>
}

export function WebReads({ pages, text, ...disclosure }: WebReadsProps) {
  const t = { ...externalText, ...text }
  const hosts = [...new Set(pages.map((p) => hostOf(p.url)))]
  return (
    <Outline
      lead={
        <span className={s.stack}>
          {hosts.slice(0, 3).map((h) => (
            <Favicon key={h} host={h} />
          ))}
        </span>
      }
      kind={t.read}
      title={t.pages(pages.length)}
      aside={`${hosts.slice(0, 2).join(', ')}${hosts.length > 2 ? ` ${t.more(hosts.length - 2)}` : ''}`}
      {...disclosure}
    >
      <ul className={s.list}>
        {pages.map((p) => (
          <li key={p.url}>
            <NewTab className={s.result} href={p.url} t={t}>
              <Favicon host={hostOf(p.url)} small />
              <span className={s.resultTitle}>{p.title}</span>
              <span className={s.aside}>{hostOf(p.url)}</span>
            </NewTab>
          </li>
        ))}
      </ul>
    </Outline>
  )
}

export interface SearchResult {
  title: string
  host: string
  url?: string
}

export interface WebSearchProps extends Disclosable {
  query: string
  results: SearchResult[]
  text?: Partial<ExternalText>
}

export function WebSearch({ query, results, text, ...disclosure }: WebSearchProps) {
  const t = { ...externalText, ...text }
  return (
    <Outline
      lead={
        <span className={cx(s.fav, s.icon)}>
          <Icon name="search" size={11} />
        </span>
      }
      kind={t.searched}
      title={query}
      aside={t.results(results.length)}
      {...disclosure}
    >
      <ul className={s.list}>
        {results.map((r) => (
          <li key={r.title}>
            <NewTab className={s.result} href={r.url ?? `https://${r.host}`} t={t}>
              <Favicon host={r.host} small />
              <span className={s.resultTitle}>{r.title}</span>
              <span className={s.aside}>{r.host}</span>
            </NewTab>
          </li>
        ))}
      </ul>
    </Outline>
  )
}

export interface McpCallProps extends Disclosable {
  server: string
  tool: string
  args: string
  result: { summary: string; fields: [string, ReactNode][] }
}

/** An MCP call names the server first, then the tool, in the same outline. */
export function McpCall({ server, tool, args, result, ...disclosure }: McpCallProps) {
  return (
    <Outline
      lead={
        <span className={cx(s.fav, s.icon)}>
          <Icon name="plug" size={11} />
        </span>
      }
      kind={server}
      mono
      title={
        <>
          {tool}
          <span className={s.args}>({args})</span>
        </>
      }
      aside={result.summary}
      {...disclosure}
    >
      <div className={s.body}>
        <KeyValues items={result.fields} />
      </div>
    </Outline>
  )
}
