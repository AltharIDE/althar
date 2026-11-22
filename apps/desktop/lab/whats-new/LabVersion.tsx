import type { MouseEvent } from 'react'

import { AboutHeader as KitAbout, type AboutHeaderProps, AppVersion as KitVersion, type AppVersionProps } from '@althar/ui'

import { CHANGELOG } from '../../src/renderer/shared/links'
import { go } from './go'
import s from './lab.module.css'

/*
 * The version line in the quick settings' foot and About Althar's head, as
 * the kit draws them, but What's new opens in the window (its tab, or C's
 * home) rather than the browser: the one way back to it once its tab is
 * closed. Its arrow out goes with it (lab.module.css).
 */

const inside = (event: MouseEvent) => {
  const link = (event.target as HTMLElement).closest('a')
  if (link?.getAttribute('href') !== CHANGELOG) return
  event.preventDefault()
  // The quick settings close, as they do for every way out of them.
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  go.whatsNew()
}

export function AppVersion(props: AppVersionProps) {
  return (
    <span className={s.inside} onClickCapture={inside}>
      <KitVersion {...props} />
    </span>
  )
}

export function AboutHeader(props: AboutHeaderProps) {
  return (
    <div className={s.inside} onClickCapture={inside}>
      <KitAbout {...props} />
    </div>
  )
}
