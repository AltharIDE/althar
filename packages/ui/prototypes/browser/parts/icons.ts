// Scrappy: the glyphs a browser needs that the kit doesn't have yet, added to its own map, as building it would add them to icons.ts.
import { ChatPlusIn, ColorFilter, CursorPointer, Laptop, Refresh, ShieldCheck, SmartphoneDevice, ViewColumns2 } from 'iconoir-react'

import type { IconName } from '../../../src/foundations/Icon/Icon'
import { ICONS } from '../../../src/foundations/Icon/icons'

Object.assign(ICONS, {
  reload: Refresh,
  comment: ChatPlusIn,
  session: ShieldCheck,
  wide: Laptop,
  phone: SmartphoneDevice,
  columns: ViewColumns2,
  onion: ColorFilter,
  cursor: CursorPointer,
})

/** A glyph of the prototype's, by name, where the kit takes an IconName. */
export const glyph = (name: 'reload' | 'comment' | 'session' | 'wide' | 'phone' | 'columns' | 'onion' | 'cursor') =>
  name as unknown as IconName
