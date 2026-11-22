import type { ComputerAsk, ComputerLatest } from '../thread/ComputerUse/ComputerUse'

/*
 * A task using this computer, for the stories of ComputerUse: Writer and
 * Reader, two apps it passes a note between, and the picture it took of
 * Reader once the note arrived, drawn as SVG so a story needs no file.
 */

const window = (width: number, height: number, title: string, body: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
      `<rect width="${width}" height="${height}" fill="#fbfaf7"/>` +
      `<rect width="${width}" height="52" fill="#ecebe6"/>` +
      [28, 52, 76].map((x) => `<circle cx="${x}" cy="26" r="7" fill="#d9d6cf"/>`).join('') +
      `<text x="${width / 2}" y="32" text-anchor="middle" font-family="Helvetica, Arial" font-size="16" fill="#5b5a57">${title}</text>` +
      body +
      `</svg>`,
  )}`

const READER =
  `<text x="72" y="128" font-family="Helvetica, Arial" font-size="30" font-weight="600" fill="#26262b">Q3 report</text>` +
  `<text x="72" y="164" font-family="Helvetica, Arial" font-size="17" fill="#77756f">Imported from Writer · just now</text>` +
  `<text x="72" y="236" font-family="Helvetica, Arial" font-size="16" fill="#5b5a57">Note</text>` +
  `<rect x="72" y="252" width="1056" height="64" rx="10" fill="#ffffff" stroke="#d9d6cf" stroke-width="2"/>` +
  `<text x="96" y="292" font-family="Helvetica, Arial" font-size="20" fill="#26262b">Reviewed report</text>` +
  `<rect x="72" y="352" width="200" height="52" rx="10" fill="#26262b"/>` +
  `<text x="172" y="385" text-anchor="middle" font-family="Helvetica, Arial" font-size="18" fill="#ffffff">Import note</text>` +
  [420, 560, 380, 500]
    .map(
      (width, i) =>
        `<rect x="72" y="${456 + i * 64}" width="1056" height="48" rx="8" fill="#f2f0eb"/>` +
        `<rect x="96" y="${474 + i * 64}" width="${width}" height="12" rx="6" fill="#d9d6cf"/>`,
    )
    .join('')

/** It asks to use the computer, to pass a note between two apps. */
export const COMPUTER_ASK: ComputerAsk = {
  id: 'ask-1',
  reason: 'Copy the reviewed note from Writer into Reader, and check that Reader shows it.',
  display: true,
}

/** Its reason runs long, as a lead's words can. */
export const COMPUTER_ASK_LONG: ComputerAsk = {
  ...COMPUTER_ASK,
  reason:
    'Reproduce the export bug in Numbers: open quarterly-report-final-v3-reviewed-by-finance-and-legal.numbers, export it as a PDF, open that in Preview and compare the totals on page 3 with the spreadsheet’s.',
}

/** Reader, as it took it once the note had arrived. */
export const COMPUTER_LATEST: ComputerLatest = {
  of: 'Reader',
  image: { name: 'Reader', src: window(1200, 760, 'Reader — Q3 report', READER), width: 1200, height: 760 },
}

/** A window taller than wide, as a phone simulator's is: it keeps its shape in the same place. */
export const COMPUTER_LATEST_TALL: ComputerLatest = {
  of: 'Simulator',
  image: {
    name: 'Simulator',
    src: window(
      430,
      900,
      'iPhone 17',
      `<rect x="32" y="96" width="366" height="64" rx="12" fill="#ffffff" stroke="#d9d6cf" stroke-width="2"/>` +
        `<text x="52" y="136" font-family="Helvetica, Arial" font-size="18" fill="#26262b">Reviewed report</text>`,
    ),
    width: 430,
    height: 900,
  },
}
