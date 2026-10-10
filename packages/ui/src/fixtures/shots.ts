import type { ImageRef } from '../thread/Shell/Shell'

/*
 * Screenshots an agent hands back, as pictures with a src, for the stories
 * of Shots and the Lightbox: a partner's refunds page before and after the
 * change, drawn as SVG so a story needs no file.
 */

const page = (title: string, note: string, tone: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900" viewBox="0 0 1440 900">` +
      `<rect width="1440" height="900" fill="#f7f6f2"/>` +
      `<rect width="1440" height="64" fill="#ffffff"/><rect x="32" y="22" width="20" height="20" rx="5" fill="#26262b"/>` +
      `<text x="64" y="39" font-family="Helvetica, Arial" font-size="18" fill="#26262b">Acme · Refunds</text>` +
      `<text x="64" y="132" font-family="Helvetica, Arial" font-size="34" font-weight="600" fill="#26262b">${title}</text>` +
      [0, 1, 2, 3]
        .map(
          (i) =>
            `<rect x="64" y="${172 + i * 76}" width="1312" height="60" rx="8" fill="#ffffff" stroke="#e4e2dc"/>` +
            `<text x="88" y="${208 + i * 76}" font-family="Menlo, monospace" font-size="17" fill="#45454c">re_3P${'qpon'[i]} · order 8821${i}</text>` +
            `<text x="1290" y="${208 + i * 76}" font-family="Helvetica, Arial" font-size="17" fill="#45454c">€${42 - i * 7}.00</text>`,
        )
        .join('') +
      `<rect x="64" y="500" width="1312" height="72" rx="8" fill="${tone}"/>` +
      `<text x="88" y="544" font-family="Helvetica, Arial" font-size="19" fill="#26262b">${note}</text>` +
      `</svg>`,
  )}`

export const SHOT_BEFORE: ImageRef & { id: string } = {
  id: 'before',
  name: 'refund-refused-before.png',
  label: 'Before',
  meta: '1440 × 900 · 212 KB',
  alt: 'The refunds page with a generic error: Something went wrong.',
  src: page('Refunds', 'Something went wrong. Try again.', '#f6e3e1'),
  width: 1440,
  height: 900,
}

export const SHOT_AFTER: ImageRef & { id: string } = {
  id: 'after',
  name: 'refund-refused-after.png',
  label: 'After',
  meta: '1440 × 900 · 208 KB',
  alt: 'The refunds page saying too many refunds right now, sent again in 12 seconds.',
  src: page('Refunds', 'Too many refunds right now. Sent again automatically in 12 s.', '#ecebf9'),
  width: 1440,
  height: 900,
}

/** A run of screenshots, as an agent checking each state of a page takes them. */
export const SHOT_RUN: ReadonlyArray<ImageRef & { id: string }> = [
  'Empty',
  'One refund',
  'Many refunds',
  'Refused',
  'Retried',
  'Settled',
  'Mobile',
  'Dark',
  'Print',
].map((label, i) => ({
  id: `state-${i}`,
  name: `refunds-${label.toLowerCase().replace(/ /g, '-')}.png`,
  label,
  meta: '1440 × 900',
  src: page(`Refunds · ${label}`, `State ${i + 1} of 9: ${label}.`, i % 2 === 0 ? '#ecebf9' : '#eef3ea'),
  width: 1440,
  height: 900,
}))

/** One the host knows it couldn't keep: too large, say. */
export const SHOT_NOT_KEPT: ImageRef & { id: string } = {
  id: 'not-kept',
  name: 'full-page.png',
  meta: 'Not kept: larger than 20 MB',
  status: 'failed',
}

/** One whose picture is still on its way. */
export const SHOT_LOADING: ImageRef & { id: string } = { id: 'loading', name: 'checkout.png', meta: '1440 × 900', status: 'loading' }

/** One whose src doesn't load: the file went, or never was. */
export const SHOT_BROKEN: ImageRef & { id: string } = {
  id: 'broken',
  name: 'gone.png',
  meta: '1440 × 900',
  src: 'data:image/png;base64,AAAA',
  width: 1440,
  height: 900,
}
