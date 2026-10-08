/** A number as short as an SVG needs it: at most `places` decimals, no trailing zeros. */
export function num(value: number, places = 2): string {
  const rounded = Number(value.toFixed(places))
  return String(Object.is(rounded, -0) ? 0 : rounded)
}

export type Box = readonly [x: number, y: number, width: number, height: number]

/** An SVG document. `title` is its accessible name; without one it is decoration. */
export function svgDocument(box: Box, body: string, title?: string): string {
  const [x, y, w, h] = box
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(x)} ${num(y)} ${num(w)} ${num(h)}"`
  return title === undefined
    ? `${head} aria-hidden="true">${body}</svg>\n`
    : `${head} role="img" aria-label="${title}"><title>${title}</title>${body}</svg>\n`
}
