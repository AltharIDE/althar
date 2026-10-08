/*
 * Althar's colours, as the interface defines them (packages/ui/src/styles/
 * tokens.css). Cobalt is Althar's own: the work running right now. Violet
 * means one thing: this needs a person. Everything else is ink on paper.
 */

export interface Colour {
  name: string
  hex: string
  role: string
}

export const COBALT = '#2b3bff'
export const COBALT_ON_INK = '#5563ff'
export const VIOLET = '#7a3ff0'
export const INK = '#141417'
export const PAPER = '#f4f2ec'
export const BLACK = '#000000'
export const WHITE = '#ffffff'

/** The two inks of the printed banners, and the stock they are printed on. */
export const PRINT = { stock: '#efeadf', black: '#1b1b20' } as const

export const PALETTE: readonly Colour[] = [
  { name: 'Cobalt', hex: COBALT, role: "Althar's own colour: the work running right now. The ground of the app icon." },
  { name: 'Cobalt on ink', hex: COBALT_ON_INK, role: "Cobalt lifted to read on ink: the mark's point on a dark ground." },
  { name: 'Violet', hex: VIOLET, role: 'This needs a person. Never decoration, and never part of the mark.' },
  { name: 'Ink', hex: INK, role: 'Text, and the mark on paper.' },
  { name: 'Paper', hex: PAPER, role: 'The page, and the mark on cobalt or ink.' },
  { name: 'Print stock', hex: PRINT.stock, role: 'The paper the printed banners are made on.' },
  { name: 'Print black', hex: PRINT.black, role: 'The black ink of the printed banners.' },
]

/** The palette as the file marketing opens. */
export function paletteJson(): string {
  return JSON.stringify(
    Object.fromEntries(PALETTE.map((c) => [c.name.toLowerCase().replaceAll(' ', '-'), { hex: c.hex, role: c.role }])),
    null,
    2,
  )
}
