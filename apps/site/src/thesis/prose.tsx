import { Lexer, type Token, type Tokens } from 'marked'
import type { ReactNode } from 'react'

import { LINKS } from '../content/facts'
import s from './Thesis.module.css'

/*
 * THESIS.md, compiled into the page: marked's lexer splits it into tokens,
 * and each token is drawn as the site's own element. Nothing is inserted as
 * HTML. Links into the document go to its sections here; links to other
 * files in the repository go to them on GitHub. A proposition, a quote set
 * all in bold, reads as a claim; the diagrams in code blocks sit on grid
 * paper, like the site's drawings.
 */

/** A heading's anchor, as GitHub makes it, so the document's own links still land. */
const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-')

export const plain = (t: Token): string => ('tokens' in t && t.tokens ? t.tokens.map(plain).join('') : 'text' in t ? String(t.text) : '')

/** The file's contents links already use GitHub's anchors, which the sections here share. */
function href(to: string): string {
  if (to.startsWith('#') || /^https?:/.test(to)) return to
  return `${LINKS.repo}/blob/main/${to.replace(/^\.\//, '')}`
}

function inline(tokens: readonly Token[] | undefined, key = ''): ReactNode {
  return (tokens ?? []).map((t, i) => {
    const k = `${key}${i}`
    switch (t.type) {
      case 'strong':
        return <strong key={k}>{inline((t as Tokens.Strong).tokens, k)}</strong>
      case 'em':
        return <em key={k}>{inline((t as Tokens.Em).tokens, k)}</em>
      case 'codespan':
        return <code key={k}>{(t as Tokens.Codespan).text}</code>
      case 'del':
        return <del key={k}>{inline((t as Tokens.Del).tokens, k)}</del>
      case 'br':
        return <br key={k} />
      case 'link': {
        const l = t as Tokens.Link
        const to = href(l.href)
        const out = /^https?:/.test(to)
        return (
          <a key={k} href={to} {...(out ? { target: '_blank', rel: 'noreferrer' } : {})}>
            {inline(l.tokens, k)}
          </a>
        )
      }
      case 'text': {
        const x = t as Tokens.Text
        return x.tokens ? <span key={k}>{inline(x.tokens, k)}</span> : x.text
      }
      case 'escape':
        return (t as Tokens.Escape).text
      default:
        return 'raw' in t ? String(t.raw) : null
    }
  })
}

const allStrong = (q: Tokens.Blockquote) =>
  q.tokens.every((p) => p.type === 'space' || (p.type === 'paragraph' && (p as Tokens.Paragraph).tokens.every((x) => x.type === 'strong')))

export function block(t: Token, key: string, depth = 0): ReactNode {
  switch (t.type) {
    case 'paragraph':
      return <p key={key}>{inline((t as Tokens.Paragraph).tokens, key)}</p>
    case 'heading': {
      const h = t as Tokens.Heading
      const Tag = h.depth <= 2 ? 'h3' : 'h4'
      return (
        <Tag key={key} id={slug(h.text)} className={h.depth <= 2 ? s.h3 : s.h4}>
          {inline(h.tokens, key)}
        </Tag>
      )
    }
    case 'list': {
      const l = t as Tokens.List
      const items = l.items.map((it, i) => (
        <li key={`${key}-${i}`}>
          {it.tokens.map((c, j) =>
            c.type === 'text' ? inline((c as Tokens.Text).tokens ?? [c], `${key}-${i}-${j}`) : block(c, `${key}-${i}-${j}`, depth + 1),
          )}
        </li>
      ))
      return l.ordered ? (
        <ol key={key} className={s.ol} start={typeof l.start === 'number' ? l.start : undefined}>
          {items}
        </ol>
      ) : (
        <ul key={key} className={s.ul}>
          {items}
        </ul>
      )
    }
    case 'blockquote': {
      const q = t as Tokens.Blockquote
      return (
        <blockquote key={key} className={allStrong(q) ? s.claim : s.quote}>
          {q.tokens.map((c, i) => block(c, `${key}-${i}`, depth + 1))}
        </blockquote>
      )
    }
    case 'code':
      return (
        <figure key={key} className={s.diagram}>
          <pre>{(t as Tokens.Code).text}</pre>
        </figure>
      )
    case 'table': {
      const tb = t as Tokens.Table
      return (
        <div key={key} className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                {tb.header.map((c, i) => (
                  <th key={i} scope="col">
                    {inline(c.tokens, `${key}h${i}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tb.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j}>{inline(c.tokens, `${key}r${i}${j}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
    case 'space':
    case 'hr':
    case 'html':
    case 'def':
      return null
    default:
      return 'text' in t ? <p key={key}>{String(t.text)}</p> : null
  }
}

export interface Part {
  id: string
  no: string
  title: string
  body: Token[]
}

export interface Thesis {
  status: string
  title: string
  intro: Token[]
  parts: Part[]
}

/**
 * The document in its parts: the status line, the title and its opening,
 * then each numbered section. The file's own table of contents is left
 * out; the page draws its own.
 */
export function compile(source: string): Thesis {
  const tokens = Lexer.lex(source).filter((t) => t.type !== 'space')
  let status = ''
  let title = ''
  const intro: Token[] = []
  const parts: Part[] = []
  let where: 'head' | 'intro' | 'contents' | 'parts' = 'head'
  for (const t of tokens) {
    const h = t.type === 'heading' ? (t as Tokens.Heading) : null
    const numbered = h?.depth === 1 ? /^(\d+)\.\s+(.*)$/.exec(h.text) : null
    if (numbered) {
      where = 'parts'
      parts.push({ id: slug(h?.text ?? ''), no: String(numbered[1]).padStart(2, '0'), title: numbered[2] ?? '', body: [] })
      continue
    }
    if (where === 'head') {
      if (t.type === 'blockquote') status = plain(t).trim()
      else if (h?.depth === 1 && h.text !== 'Thesis') {
        title = h.text
        where = 'intro'
      }
      continue
    }
    if (where === 'intro') {
      if (h?.depth === 1 && /contents/i.test(h.text)) where = 'contents'
      else intro.push(t)
      continue
    }
    if (where === 'contents') continue
    parts.at(-1)?.body.push(t)
  }
  return { status, title, intro, parts }
}
