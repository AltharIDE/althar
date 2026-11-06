// Scrappy: E's viewport: the page at the panel's own size, or at a device's, drawn smaller where the panel is smaller. The button
// says the size while it isn't the panel's.
import type { ReactNode } from 'react'

import { ChromeButton } from '../../../src/chrome/ChromeButton/ChromeButton'
import { cx } from '../../../src/lib/cx'
import { Menu, MenuRadioGroup, MenuRadioItem } from '../../../src/primitives/Menu/Menu'
import { proto, sizeOf, useProto, type Viewport, VIEWPORTS } from '../state'
import { glyph } from './icons'
import s from './Viewport.module.css'

const glyphOf = (viewport: Viewport) =>
  glyph(viewport === 'fit' ? 'fit' : viewport === 'desktop' ? 'desktop' : viewport === 'laptop' ? 'wide' : 'phone')

export function ViewportMenu({ scope }: { scope: string }) {
  const p = useProto()
  const now = p.viewports[scope] ?? 'fit'
  const size = sizeOf(now)
  return (
    <Menu
      label="Viewport"
      align="end"
      width={232}
      trigger={<ChromeButton icon={glyphOf(now)} label={size === null ? 'Viewport' : `${size.w} × ${size.h}`} compact={size === null} />}
    >
      <MenuRadioGroup label="Viewport" value={now} onChange={(next) => proto.viewport(scope, next as Viewport)}>
        <MenuRadioItem value="fit">Fit the panel</MenuRadioItem>
        {VIEWPORTS.map((one) => (
          <MenuRadioItem key={one.value} value={one.value} hint={`${one.w} × ${one.h}`}>
            {one.name}
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
    </Menu>
  )
}

/** The page's size for its frame: none for the panel's own. */
export const pageSizeOf = (viewport: Viewport | undefined) => {
  const size = sizeOf(viewport)
  return size === null ? { pageWidth: null, pageHeight: null } : { pageWidth: size.w, pageHeight: size.h }
}

/** Where the page is drawn: the panel, or a well with room round a device's size. */
export function Well({ scope, children }: { scope: string; children: ReactNode }) {
  const sized = useProto().viewports[scope] !== undefined
  return <div className={cx(s.page, sized && s.device)}>{children}</div>
}
