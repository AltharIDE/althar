import type { Decorator } from '@storybook/react-vite'
import { useLayoutEffect, type ReactNode } from 'react'

import { cx } from '../../lib/cx'
import s from './Scheme.module.css'

/*
 * Light and dark for the exploration's stories. Light is the kit's paper;
 * dark is a stand-in kept in Scheme.module.css, since the kit has no dark
 * theme yet. A story takes a `scheme` arg, switched in its controls; while
 * it is dark, the page's body is too, so what a menu or popover opens over
 * the page (portalled to the body) is dark with it.
 */

export type Scheme = 'light' | 'dark'

export interface SchemeArgs {
  scheme: Scheme
}

export const schemeArgs: SchemeArgs = { scheme: 'light' }
export const schemeArgTypes = {
  scheme: { control: 'inline-radio', options: ['light', 'dark'], description: 'Paper, or the dark stand-in' },
} as const

/** Something drawn in one scheme, whatever the page around it is. */
export function InScheme({ scheme, className, children }: { scheme: Scheme; className?: string; children: ReactNode }) {
  return <div className={cx('ch-root', scheme === 'dark' && s.dark, className)}>{children}</div>
}

/* The body takes the dark too, for what is portalled onto it. */
function DarkBody() {
  useLayoutEffect(() => {
    const dark = s.dark
    if (dark === undefined) return
    document.body.classList.add(dark)
    return () => document.body.classList.remove(dark)
  }, [])
  return null
}

/** The story in the scheme its args name; fullscreen stories keep their own padding. */
export const schemeDecorator: Decorator = (Story, { args, parameters }) => {
  const scheme: Scheme = args['scheme'] === 'dark' ? 'dark' : 'light'
  return (
    <InScheme scheme={scheme} className={cx(s.page, parameters['layout'] === 'fullscreen' && s.fullscreen)}>
      {scheme === 'dark' && <DarkBody />}
      {Story()}
    </InScheme>
  )
}

export interface Pair {
  state: string
  /** Drawn twice, once in each scheme. */
  node: () => ReactNode
  /** One under the other, for what is too wide to sit side by side: a page, the window's bar. */
  stacked?: boolean
}

/** Each state of a path in light and in dark, labelled. */
export function Pairs({ pairs, light = 'Light', dark = 'Dark' }: { pairs: readonly Pair[]; light?: string; dark?: string }) {
  return (
    <div className={s.pairs}>
      {pairs.map((pair) => (
        <section key={pair.state} className={cx(s.pair, pair.stacked && s.stacked)} aria-label={pair.state}>
          <span className={s.pairLabel}>{pair.state}</span>
          <div className={s.pairCells}>
            <InScheme scheme="light" className={s.cell}>
              <span className={s.cellScheme}>{light}</span>
              {pair.node()}
            </InScheme>
            <InScheme scheme="dark" className={s.cell}>
              <span className={s.cellScheme}>{dark}</span>
              {pair.node()}
            </InScheme>
          </div>
        </section>
      ))}
    </div>
  )
}
