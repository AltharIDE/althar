// Scrappy: what the address asks to have open as the page starts, for a shot: a menu, the chip, the pill, the comparison.
const params = new URLSearchParams(window.location.search)

export const page = {
  open: params.get('o'),
  bare: params.has('bare'),
}
