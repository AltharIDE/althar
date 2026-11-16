import type { ComponentType, ReactNode } from 'react'
import type { ProjectTabsProps } from '@althar/ui'
import type { HomeProps } from '@althar/ui/screens'

import type { Host } from '../../../src/renderer/data/services'

/*
 * What a direction draws, each in the place the app has for it: what sits at
 * the end of the window's bar, what opens over the window (the homes, the
 * form, a dropped connection), a home's window before it has connected, the
 * window's tabs where it changes them, the Home screen where it changes
 * that, and a home with no projects yet.
 */
export interface DirectionParts {
  /** At the end of the window's bar, on every screen with one. */
  readonly Button: ComponentType
  /** Over the window, always mounted: the homes, the form, a dropped connection. */
  readonly Overlays: ComponentType<{ readonly host: Host; readonly windowId: string }>
  /** A home's window before it first connects, or where its first connection failed. */
  readonly Opening: ComponentType<{ readonly windowId: string }>
  /** The window's tabs, where the direction changes them. */
  readonly Tabs?: ComponentType<ProjectTabsProps & { readonly Real: ComponentType<ProjectTabsProps> }>
  /** The Home screen, where the direction changes it. */
  readonly Home?: ComponentType<HomeProps & { readonly Real: ComponentType<HomeProps> }>
  /** A home's window with no projects yet, in StartView's place for it. */
  readonly Empty: ComponentType
  /** Anything else in the window: a banner, a line at its foot. */
  readonly Around?: (props: { readonly children: ReactNode }) => ReactNode
}
