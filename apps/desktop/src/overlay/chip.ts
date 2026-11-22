/*
 * A page canvas's chip beside a conversation (ADR-104): what it is, floating
 * on it, as a canvas of boards' ground draws it beside its zoom, never in the
 * conversation's header. Its name opens the artifact itself; its × closes
 * the canvas. Nothing of Althar's window can be drawn over the page's own
 * view, so the main process runs this in an isolated world of the page, as
 * it runs the ground in a canvas of boards': it draws in a closed shadow root
 * over the page, which the page's own scripts can't reach, and the main
 * process hears what was pressed by asking `next`, which answers once
 * something was. Its look is the kit's chip, in the kit's colours, light or
 * dark as the system's scheme is.
 */

export interface Chip {
  /** Shows the chip with the canvas's name, or takes it away with null; the news so far. */
  readonly show: (title: string | null) => { readonly seq: number }
  /** What was pressed after `seq`: at once where something was, else once it is, or after a while with nothing. */
  readonly next: (seq: number) => Promise<{ readonly seq: number; readonly events: ReadonlyArray<'open' | 'close'> }>
}

/** How long `next` waits with nothing pressed before it answers anyway. */
const QUIET_MS = 20_000

const STYLE = `
  :host { all: initial !important; position: fixed !important; top: 12px !important; right: 12px !important;
    z-index: 2147483647 !important; display: block !important; }
  :host([hidden]) { display: none !important; }
  .chip { --float: #ffffff; --line: rgba(20, 20, 28, 0.07); --t-1: #141417; --t-3: #63636b; --sunk: rgba(20, 20, 28, 0.04);
    --signal: #7a3ff0; --lift: 0 1px 2px rgba(60, 50, 30, 0.06), 0 10px 24px -12px rgba(60, 50, 30, 0.28);
    display: inline-flex; align-items: center; gap: 2px; height: 38px; padding: 0 4px 0 6px; box-sizing: border-box;
    border: 1px solid var(--line); border-radius: 10px; background: var(--float); box-shadow: var(--lift);
    font: 600 13px/1 'Inter Variable', Inter, system-ui, -apple-system, sans-serif; color: var(--t-1);
    -webkit-font-smoothing: antialiased; }
  @media (prefers-color-scheme: dark) {
    .chip { --float: #39352f; --line: rgba(255, 240, 215, 0.075); --t-1: #efeae1; --t-3: #aca699; --sunk: rgba(255, 240, 215, 0.055);
      --lift: 0 0 0 0.5px rgba(255, 240, 215, 0.1), 0 1px 2px rgba(0, 0, 0, 0.4), 0 10px 24px -12px rgba(0, 0, 0, 0.5); }
  }
  button { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center;
    height: 28px; border-radius: 7px; cursor: pointer; color: inherit; }
  button:hover { background: var(--sunk); }
  button:focus-visible { outline: 1.5px solid var(--signal); outline-offset: 1px; }
  .name { gap: 6px; padding: 0 8px 0 6px; max-width: 260px; }
  .name span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .close { width: 28px; color: var(--t-3); }
  .close:hover { color: var(--t-1); }
  svg { flex: none; color: var(--t-3); }
`

/* The kit's icons, as it draws them (iconoir's Palette, Expand and Xmark): the canvas, opening it, and closing it. */
const ICON = (d: string, size = 14) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
const CANVAS = ICON(
  '<path d="M20.5096 9.54C20.4243 9.77932 20.2918 9.99909 20.12 10.1863C19.9483 10.3735 19.7407 10.5244 19.5096 10.63C18.2796 11.1806 17.2346 12.0745 16.5002 13.2045C15.7659 14.3345 15.3733 15.6524 15.3696 17C15.3711 17.4701 15.418 17.9389 15.5096 18.4C15.5707 18.6818 15.5747 18.973 15.5215 19.2564C15.4682 19.5397 15.3588 19.8096 15.1996 20.05C15.0649 20.2604 14.8877 20.4403 14.6793 20.5781C14.4709 20.7158 14.2359 20.8085 13.9896 20.85C13.4554 20.9504 12.9131 21.0006 12.3696 21C11.1638 21.0006 9.97011 20.7588 8.85952 20.2891C7.74893 19.8194 6.74405 19.1314 5.90455 18.2657C5.06506 17.4001 4.40807 16.3747 3.97261 15.2502C3.53714 14.1257 3.33208 12.9252 3.36959 11.72C3.4472 9.47279 4.3586 7.33495 5.92622 5.72296C7.49385 4.11097 9.60542 3.14028 11.8496 3H12.3596C14.0353 3.00042 15.6777 3.46869 17.1017 4.35207C18.5257 5.23544 19.6748 6.49885 20.4196 8C20.6488 8.47498 20.6812 9.02129 20.5096 9.52V9.54Z"/><path d="M8 16.01L8.01 15.9989"/><path d="M6 12.01L6.01 11.9989"/><path d="M8 8.01L8.01 7.99889"/><path d="M12 6.01L12.01 5.99889"/><path d="M16 8.01L16.01 7.99889"/>',
)
const OPEN = ICON(
  '<path d="M9 9L4 4M4 4V8M4 4H8"/><path d="M15 9L20 4M20 4V8M20 4H16"/><path d="M9 15L4 20M4 20V16M4 20H8"/><path d="M15 15L20 20M20 20V16M20 20H16"/>',
  12,
)
const CLOSE = ICON(
  '<path d="M6.75827 17.2426L12.0009 12M17.2435 6.75736L12.0009 12M12.0009 12L6.75827 6.75736M12.0009 12L17.2435 17.2426"/>',
)

const install = (): Chip => {
  const host = document.createElement('althar-chip')
  host.hidden = true
  const root = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = STYLE
  const chip = document.createElement('div')
  chip.className = 'chip'
  const name = document.createElement('button')
  name.type = 'button'
  name.className = 'name'
  const words = document.createElement('span')
  name.innerHTML = CANVAS
  name.append(words)
  name.insertAdjacentHTML('beforeend', OPEN)
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'close'
  close.setAttribute('aria-label', 'Close')
  close.title = 'Close'
  close.innerHTML = CLOSE
  chip.append(name, close)
  root.append(style, chip)

  let seq = 0
  let events: Array<{ readonly seq: number; readonly event: 'open' | 'close' }> = []
  let waiting: Array<() => void> = []
  const tell = (event: 'open' | 'close') => {
    seq += 1
    events.push({ seq, event })
    if (events.length > 20) events = events.slice(-20)
    const ready = waiting
    waiting = []
    for (const wake of ready) wake()
  }
  // A press is the chip's alone: the page under it never sees it.
  for (const [button, event] of [
    [name, 'open'],
    [close, 'close'],
  ] as const)
    button.addEventListener('click', (pressed) => {
      pressed.stopPropagation()
      tell(event)
    })
  host.addEventListener('pointerdown', (pressed) => pressed.stopPropagation())

  return {
    show: (title) => {
      // A page that rewrites its document takes the chip with it: it goes back.
      if (!host.isConnected) document.documentElement.append(host)
      host.hidden = title === null
      words.textContent = title ?? ''
      name.title = title === null ? '' : `Open ${title}`
      name.setAttribute('aria-label', title === null ? '' : `Open ${title}`)
      return { seq }
    },
    next: (after) =>
      new Promise((done) => {
        const answer = () => {
          clearTimeout(quiet)
          done({ seq, events: events.filter((one) => one.seq > after).map((one) => one.event) })
        }
        const quiet = setTimeout(() => {
          waiting = waiting.filter((one) => one !== answer)
          answer()
        }, QUIET_MS)
        if (seq > after) answer()
        else waiting.push(answer)
      }),
  }
}

declare global {
  // The chip's handle, in its isolated world's own global: the page's world never sees it.
  var __altharChip: Chip | undefined
}

/* Made once a world: the first run installs it, and a later run in the same world finds it there. */
globalThis.__altharChip ??= install()
