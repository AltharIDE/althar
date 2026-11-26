import { Component, createRef, type ReactNode } from 'react'

import s from './crossfade.module.css'

/*
 * Words that change, crossfaded rather than swapped. Wrapped round a screen
 * of the app drawn from its story (HomeAtWork), it reads, just before each
 * update, every piece of text on it and every button: where each stands and
 * what it says. Once the update is in, what went, or now says something
 * else, is laid back where it stood, as it was, fading out, while what took
 * its place fades in; what is new fades in. So a call answered, a count
 * that drops, a button that gives way to what was said, each passes from
 * one to the other, and nothing on the screen just snaps.
 *
 * Its copies are drawn on a layer of its own, over the screen, in the
 * screen's own px (a page shows it scaled), and gone once faded. With
 * reduced motion, or the story held still, nothing fades.
 */

/** How long what goes takes to fade, and what comes; what comes starts a moment after, so the two pass rather than blur. */
const OUT = 240
const IN = 320
const AFTER = 70

interface Piece {
  el: HTMLElement
  text: string
  html: string
  x: number
  y: number
  w: number
  h: number
}

/** What is read as one piece: a button, whole; anything else with words of its own, outside a button. */
const piecesIn = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>('*')].filter((el) => {
    if (el instanceof SVGElement) return false
    const button = el.parentElement?.closest('button')
    if (button && root.contains(button)) return false
    if (el.tagName === 'BUTTON') return true
    for (const node of el.childNodes) if (node.nodeType === Node.TEXT_NODE && node.textContent!.trim() !== '') return true
    return false
  })

/** `still`: the story held (`?t=`), when nothing should move. */
export class Crossfade extends Component<{ children: ReactNode; still?: boolean; className?: string }> {
  root = createRef<HTMLDivElement>()
  layer = createRef<HTMLDivElement>()

  override getSnapshotBeforeUpdate(): Piece[] | null {
    const root = this.root.current
    if (!root || this.props.still || root.offsetWidth === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null
    const box = root.getBoundingClientRect()
    const k = box.width / root.offsetWidth
    return piecesIn(root).map((el) => {
      const r = el.getBoundingClientRect()
      return {
        el,
        text: el.textContent ?? '',
        html: el.outerHTML,
        x: (r.left - box.left) / k,
        y: (r.top - box.top) / k,
        w: r.width / k,
        h: r.height / k,
      }
    })
  }

  override componentDidUpdate(_: unknown, __: unknown, before: Piece[] | null) {
    const root = this.root.current
    const layer = this.layer.current
    if (!before || !root || !layer || typeof root.animate !== 'function') return
    const was = new Set(before.map((one) => one.el))
    const changed = before.filter((one) => !one.el.isConnected || one.el.textContent !== one.text)
    // Within a piece that changed, its own pieces go with it.
    const outer = changed.filter((one) => !changed.some((other) => other !== one && other.el.contains(one.el)))
    for (const one of outer) {
      const holder = document.createElement('template')
      holder.innerHTML = one.html
      const copy = holder.content.firstElementChild as HTMLElement | null
      if (!copy) continue
      // Still there, the copy takes its face from it, as what it was set in may not be where the copy is.
      if (one.el.isConnected) {
        const css = getComputedStyle(one.el)
        Object.assign(copy.style, {
          font: css.font,
          color: css.color,
          letterSpacing: css.letterSpacing,
          textTransform: css.textTransform,
          whiteSpace: css.whiteSpace,
        })
      }
      Object.assign(copy.style, {
        position: 'absolute',
        left: `${one.x}px`,
        top: `${one.y}px`,
        width: `${one.w}px`,
        height: `${one.h}px`,
        margin: '0',
        boxSizing: 'border-box',
        transform: 'none',
        translate: 'none',
      })
      copy.removeAttribute('id')
      layer.append(copy)
      const going = copy.animate([{ opacity: 1 }, { opacity: 0 }], { duration: OUT, easing: 'ease-out', fill: 'forwards' })
      going.onfinish = () => copy.remove()
      if (one.el.isConnected)
        one.el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: IN, delay: AFTER, easing: 'ease-out', fill: 'backwards' })
    }
    // What is new comes in.
    for (const el of piecesIn(root)) {
      if (was.has(el) || layer.contains(el)) continue
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: IN, delay: AFTER, easing: 'ease-out', fill: 'backwards' })
    }
  }

  override render() {
    return (
      <div ref={this.root} className={`${s.root} ${this.props.className ?? ''}`}>
        {this.props.children}
        <div ref={this.layer} className={s.layer} aria-hidden="true" />
      </div>
    )
  }
}
