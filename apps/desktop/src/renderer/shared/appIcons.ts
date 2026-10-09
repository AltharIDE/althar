import type { AppIcon } from '../../main/appIcon'
import cobalt from '../../../resources/icons/cobalt.png'
import cobaltDark from '../../../resources/icons/cobalt-dark.png'
import ink from '../../../resources/icons/ink.png'
import paper from '../../../resources/icons/paper.png'
import solid from '../../../resources/icons/solid.png'
import solidDark from '../../../resources/icons/solid-dark.png'

/*
 * The icons the person can give the app, in the order Settings shows them:
 * the same pictures the main process puts on the Dock. Each has a name of its
 * own, a pigment or a stone, never another's name with "dark" after it; their
 * ids stay as they were, since the profile keeps them.
 */

export type { AppIcon }

export const appIcons: ReadonlyArray<{ readonly value: AppIcon; readonly title: string; readonly picture: string }> = [
  { value: 'cobalt', title: 'Cobalt', picture: cobalt },
  { value: 'cobalt-dark', title: 'Lapis', picture: cobaltDark },
  { value: 'paper', title: 'Paper', picture: paper },
  { value: 'ink', title: 'Ink', picture: ink },
  { value: 'solid', title: 'Keystone', picture: solid },
  { value: 'solid-dark', title: 'Monolith', picture: solidDark },
]

export const isAppIcon = (value: string): value is AppIcon => appIcons.some((icon) => icon.value === value)
