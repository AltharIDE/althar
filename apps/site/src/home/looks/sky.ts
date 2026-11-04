import { seeded } from '../../shared/footer/random'

/*
 * Prototype (A): the stars over the planet's edge, as a tile drawn once: fine
 * points of different brightness, a few faintly blue or warm, the same every
 * time. An SVG, so they stay points at any pixel density.
 */

const SIZE = 1400
const COUNT = 150

let url = ''

export function starsUrl() {
  if (url) return url
  const r = seeded(38)
  const dots = Array.from({ length: COUNT }, () => {
    const x = (r() * SIZE).toFixed(1)
    const y = (r() * SIZE).toFixed(1)
    // Most are faint and small; a few are bright.
    const bright = r() ** 3
    const radius = (0.45 + bright * 0.95).toFixed(2)
    const alpha = (0.18 + bright * 0.72).toFixed(2)
    const hue = r()
    const fill = hue < 0.12 ? '#cfdcff' : hue > 0.93 ? '#ffe6cc' : '#ffffff'
    return `<circle cx="${x}" cy="${y}" r="${radius}" fill="${fill}" fill-opacity="${alpha}"/>`
  })
  url = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">${dots.join('')}</svg>`)}`
  return url
}
