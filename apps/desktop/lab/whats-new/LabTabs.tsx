import { useRouterState } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { ProjectTabs as KitTabs, type ProjectTabsProps } from '@althar/ui'

// The kit draws Iconoir; this one it hasn't named yet ("news" would be Sparks, in foundations/Icon/icons.ts).
import { Sparks } from '../../../../packages/ui/node_modules/iconoir-react'
import { go, WHATS_NEW } from './go'
import { useLab } from './state'

/*
 * The window's bar in the lab: the kit's own tabs, with Althar's tab, the one
 * more pinned tab vite.config.ts gives them. Kept like a project's, beside
 * the home's, with a quiet dot after an update until it's opened.
 */

/** The pinned tab the transform adds to the kit's tabs. */
interface AltharTab {
  current: boolean
  name: string
  mark: (className: string) => ReactNode
  dot?: boolean
  onSelect: () => void
}

const Tabs = KitTabs as (props: ProjectTabsProps & { whatsNew?: AltharTab }) => ReactNode

// Not the logo: the home's tab has it.
const sparks = (className: string) => <Sparks width={15} height={15} strokeWidth={2} className={className} aria-hidden="true" />

export function ProjectTabs(props: ProjectTabsProps) {
  const { unseen, view } = useLab()
  const onPage = useRouterState({ select: (state) => state.location.pathname }) === WHATS_NEW
  return (
    <Tabs
      {...props}
      whatsNew={{ current: onPage, name: 'Althar', mark: sparks, dot: unseen, onSelect: () => go.althar(onPage ? view : 'new') }}
    />
  )
}
