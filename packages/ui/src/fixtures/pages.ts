import type { CommentFact, ComposerComment } from '../composer/Comments/Comments'

/*
 * A page beside the conversation, for the stories of the browser's parts: a
 * task's run of a partner's refunds page, as a picture the window would show
 * in the page's place, drawn as SVG so a story needs no file; a spot of it
 * cropped for a comment; and the comments made on it.
 */

const svg = (width: number, height: number, body: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`,
  )}`

const rows = (width: number, top: number, n: number) =>
  Array.from({ length: n }, (_, i) => {
    const y = top + i * 64
    return (
      `<rect x="24" y="${y}" width="${width - 48}" height="52" rx="8" fill="#ffffff" stroke="#e4e2dc"/>` +
      `<text x="44" y="${y + 32}" font-family="Menlo, monospace" font-size="14" fill="#45454c">re_3P${'qponmlk'[i]} · order 8821${i}</text>` +
      `<text x="${width - 96}" y="${y + 32}" font-family="Helvetica, Arial" font-size="14" fill="#45454c">€${42 - i * 7}.00</text>`
    )
  }).join('')

/** The run's refunds page, at a width: as the panel shows it, or as a phone does. */
export const pageAt = (width: number, height: number) =>
  svg(
    width,
    height,
    `<rect width="${width}" height="${height}" fill="#f7f6f2"/>` +
      `<rect width="${width}" height="56" fill="#ffffff"/><rect x="24" y="18" width="20" height="20" rx="5" fill="#26262b"/>` +
      `<text x="54" y="34" font-family="Helvetica, Arial" font-size="15" fill="#26262b">Acme · Refunds</text>` +
      `<text x="24" y="104" font-family="Helvetica, Arial" font-size="26" font-weight="600" fill="#26262b">Refunds</text>` +
      `<rect x="24" y="124" width="${width - 48}" height="56" rx="8" fill="#f6e3e1"/>` +
      `<text x="44" y="157" font-family="Helvetica, Arial" font-size="15" fill="#26262b">Something went wrong. Try again.</text>` +
      rows(width, 200, Math.max(1, Math.floor((height - 220) / 64))),
  )

/** The page as the panel shows it, at its own size. */
export const PAGE = pageAt(640, 700)
/** The page laid out as a phone shows it. */
export const PHONE_PAGE = pageAt(390, 844)

/** The banner a comment was made on, as its crop. */
export const CROP = svg(
  616,
  80,
  `<rect width="616" height="80" fill="#f7f6f2"/><rect x="12" y="12" width="592" height="56" rx="8" fill="#f6e3e1"/>` +
    `<text x="32" y="45" font-family="Helvetica, Arial" font-size="15" fill="#26262b">Something went wrong. Try again.</text>`,
)

/** A row a comment was made on, as its crop. */
export const ROW_CROP = svg(
  616,
  76,
  `<rect width="616" height="76" fill="#f7f6f2"/><rect x="12" y="12" width="592" height="52" rx="8" fill="#ffffff" stroke="#e4e2dc"/>` +
    `<text x="32" y="44" font-family="Menlo, monospace" font-size="14" fill="#45454c">re_3Pq · order 88210</text>` +
    `<text x="532" y="44" font-family="Helvetica, Arial" font-size="14" fill="#45454c">€42.00</text>`,
)

const facts = (element: string, text: string, size: string, selector: string, page: string): ReadonlyArray<CommentFact> => [
  { label: 'Element', value: element, kind: 'code' },
  { label: 'Text', value: text, kind: 'quote' },
  { label: 'Size', value: size },
  { label: 'Font', value: '15px · 400 · Inter Variable' },
  { label: 'Colour', value: '#26262b', kind: 'colour' },
  { label: 'Background', value: '#f6e3e1', kind: 'colour' },
  { label: 'Page', value: page },
  { label: 'Selector', value: selector, kind: 'code' },
]

/** The comments the person made on the page, waiting in the composer. */
export const COMMENTS: ReadonlyArray<ComposerComment> = [
  {
    id: 'c1',
    n: 1,
    note: 'Say what happened: too many refunds at once, and that it’s sent again by itself.',
    place: 'div.banner',
    crop: { src: CROP, width: 616, height: 80 },
    facts: facts('div.banner', 'Something went wrong. Try again.', '592 × 56', 'main > div.banner', 'localhost:5173/refunds at 640 × 700'),
  },
  {
    id: 'c2',
    n: 2,
    note: 'The amount should line up with the header’s.',
    place: 'li.refund',
    crop: { src: ROW_CROP, width: 616, height: 76 },
    facts: facts(
      'li.refund',
      're_3Pq · order 88210 €42.00',
      '592 × 52',
      'ul.refunds > li.refund:nth-of-type(1)',
      'localhost:5173/refunds at 390 × 844',
    ),
  },
]
