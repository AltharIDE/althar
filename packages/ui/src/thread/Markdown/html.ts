import { createElement, type CSSProperties, Fragment, type ReactNode } from 'react'

/*
 * The HTML a markdown file is written with, as GitHub draws it: a README's centred banner, its `<picture>`, its table of
 * features. Read inertly (a `<template>`'s content loads nothing and runs nothing) and drawn as React from an allow-list:
 * what makes a page's shape, a few attributes that set it out (align, width, spans), never a script, a style, a handler or a
 * frame. Its links and pictures are the markdown's own, so a link opens as any other and a picture is read where the file is.
 */

export interface HtmlParts {
  readonly link: (href: string, title: string | undefined, children: ReactNode) => ReactNode
  readonly image: (src: string, alt: string, title: string | undefined, width: string | undefined) => ReactNode
  readonly heading: (depth: number, children: ReactNode, style: CSSProperties | undefined) => ReactNode
  /** The window's theme, for a `<picture>`'s dark source. */
  readonly dark: boolean
}

/* the page's shape, drawn as itself */
const KEPT: ReadonlySet<string> = new Set([
  'p',
  'div',
  'span',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'del',
  'ins',
  'sub',
  'sup',
  'small',
  'mark',
  'kbd',
  'code',
  'pre',
  'br',
  'hr',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'caption',
  'details',
  'summary',
  'blockquote',
  'dl',
  'dt',
  'dd',
  'figure',
  'figcaption',
  'abbr',
  'cite',
  'q',
  'var',
  'samp',
  'tt',
])
/* never drawn, nor what is in them */
const DROPPED: ReadonlySet<string> = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'noscript',
  'template',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'link',
  'meta',
  'base',
  'svg',
  'math',
  'video',
  'audio',
  'canvas',
  'source',
  'track',
  'head',
  'title',
])
const VOID: ReadonlySet<string> = new Set(['br', 'hr', 'img', 'source', 'wbr', 'input', 'meta', 'link', 'col', 'area'])
/* where whitespace between tags is no text: React refuses it there, and HTML draws none */
const NO_TEXT: ReadonlySet<string> = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'ul', 'ol', 'dl', 'picture', 'colgroup'])
const ALIGNS: ReadonlySet<string> = new Set(['left', 'right', 'center', 'justify'])

const size = (value: string | null): string | undefined => {
  if (value === null) return undefined
  const v = value.trim()
  if (/^\d+(\.\d+)?$/.test(v)) return `${v}px`
  if (/^\d+(\.\d+)?(%|px|em|rem)$/.test(v)) return v
  return undefined
}

const styleOf = (el: Element): CSSProperties | undefined => {
  const style: CSSProperties = {}
  const align = el.getAttribute('align')?.toLowerCase()
  if (align !== undefined && ALIGNS.has(align)) style.textAlign = align as CSSProperties['textAlign']
  const valign = el.getAttribute('valign')?.toLowerCase()
  if (valign === 'top' || valign === 'middle' || valign === 'bottom') style.verticalAlign = valign
  if (el.tagName === 'TD' || el.tagName === 'TH' || el.tagName === 'TABLE') {
    const width = size(el.getAttribute('width'))
    if (width !== undefined) style.width = width
  }
  return Object.keys(style).length === 0 ? undefined : style
}

const span = (value: string | null): number | undefined => {
  const n = value === null ? NaN : Number.parseInt(value, 10)
  return Number.isFinite(n) && n > 1 && n < 1000 ? n : undefined
}

/** The `<img>` a `<picture>` shows: its dark source where the window is dark and it has one, else its own. */
function pictureOf(el: Element, parts: HtmlParts): ReactNode {
  const img = el.querySelector('img')
  if (img === null) return null
  let src = img.getAttribute('src') ?? ''
  if (parts.dark)
    for (const source of el.querySelectorAll('source')) {
      if (/prefers-color-scheme:\s*dark/i.test(source.getAttribute('media') ?? '')) {
        const set = source.getAttribute('srcset')?.split(',')[0]?.trim().split(/\s+/)[0]
        if (set) src = set
        break
      }
    }
  return imageOf(img, src, parts)
}

const imageOf = (img: Element, src: string, parts: HtmlParts): ReactNode =>
  src === ''
    ? null
    : parts.image(src, img.getAttribute('alt') ?? '', img.getAttribute('title') ?? undefined, size(img.getAttribute('width')))

function nodes(list: NodeListOf<ChildNode> | readonly ChildNode[], parent: string, parts: HtmlParts, pre: boolean): ReactNode[] {
  const out: ReactNode[] = []
  for (const node of list) {
    const drawn = draw(node, parent, parts, pre)
    if (drawn !== null && drawn !== '') out.push(drawn)
  }
  return out
}

/* children handed on as one, so none needs a key */
const one = (children: readonly ReactNode[]): ReactNode => createElement(Fragment, null, ...children)

function draw(node: ChildNode, parent: string, parts: HtmlParts, pre: boolean): ReactNode {
  if (node.nodeType === 3) {
    const text = node.textContent ?? ''
    if (pre) return text
    if (NO_TEXT.has(parent) && text.trim() === '') return null
    return text.replace(/\s+/g, ' ')
  }
  if (node.nodeType !== 1) return null
  const el = node as Element
  const tag = el.tagName.toLowerCase()
  if (DROPPED.has(tag)) return null
  const inner = () => nodes(el.childNodes, tag, parts, pre || tag === 'pre')
  if (tag === 'picture') return pictureOf(el, parts)
  if (tag === 'img') return imageOf(el, el.getAttribute('src') ?? '', parts)
  if (tag === 'a') {
    const href = el.getAttribute('href')
    const children = one(inner())
    return href === null || href === '' ? children : parts.link(href, el.getAttribute('title') ?? undefined, children)
  }
  const heading = /^h([1-6])$/.exec(tag)
  if (heading) return parts.heading(Number(heading[1]), one(inner()), styleOf(el))
  if (tag === 'center') return createElement('div', { style: { textAlign: 'center' } }, ...inner())
  if (!KEPT.has(tag)) return one(inner())
  const props: Record<string, unknown> = {}
  const style = styleOf(el)
  if (style !== undefined) props.style = style
  if (tag === 'td' || tag === 'th') {
    const colSpan = span(el.getAttribute('colspan'))
    const rowSpan = span(el.getAttribute('rowspan'))
    if (colSpan !== undefined) props.colSpan = colSpan
    if (rowSpan !== undefined) props.rowSpan = rowSpan
  }
  if (tag === 'details' && el.hasAttribute('open')) props.open = true
  if (tag === 'ol') {
    const start = span(el.getAttribute('start'))
    if (start !== undefined) props.start = start
  }
  if (tag === 'abbr' && el.hasAttribute('title')) props.title = el.getAttribute('title')
  if (VOID.has(tag)) return createElement(tag, props)
  // A table's rows are in a body already: the parser puts them there, as React wants them.
  return createElement(tag, props, ...inner())
}

/** HTML a markdown file is written with, drawn from the allow-list; nothing of it where it has nothing to draw. */
export function drawHtml(html: string, parts: HtmlParts): ReactNode {
  if (typeof document === 'undefined') return null
  const template = document.createElement('template')
  template.innerHTML = html
  const drawn = nodes(template.content.childNodes, '', parts, false)
  return drawn.length === 0 ? null : one(drawn)
}

/** The tag an inline HTML token opens or closes, and how: `<sub>` opens, `</sub>` closes, `<br />` stands alone. */
export const tagOf = (raw: string): { readonly name: string; readonly kind: 'open' | 'close' | 'alone' } | null => {
  const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>$/.exec(raw.trim())
  if (m === null) return null
  const name = m[2]!.toLowerCase()
  if (m[1] === '/') return { name, kind: 'close' }
  return { name, kind: m[3] === '/' || VOID.has(name) ? 'alone' : 'open' }
}
