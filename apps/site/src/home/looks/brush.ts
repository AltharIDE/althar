/*
 * Prototype (F): the cyanotype's paper. Its tooth shows through the blue as
 * a tile of faint light specks, drawn once.
 */

let tooth = ''

export function toothUrl() {
  if (tooth) return tooth
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220">' +
    '<filter id="t"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" stitchTiles="stitch"/>' +
    '<feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0.13 0 0 0 -0.035"/></filter>' +
    '<rect width="100%" height="100%" filter="url(#t)"/></svg>'
  tooth = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
  return tooth
}
