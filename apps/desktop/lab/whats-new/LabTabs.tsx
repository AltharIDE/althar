import { useRouterState } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { ProjectTabs as KitTabs, type ProjectTabsProps } from '@althar/ui'

// The kit draws Iconoir; this one it hasn't named yet ("news" would be Sparks, in foundations/Icon/icons.ts).
import { Sparks } from '../../../../packages/ui/node_modules/iconoir-react'
import { go, WHATS_NEW } from './go'
import { lab, useLab } from './state'
import { UpdatedLine } from './WhatsNew'

/*
 * The window's bar in the lab: the kit's own tabs (with the one more pinned
 * tab vite.config.ts gives them), and in each direction what it says of the
 * update. A and B: a What's new tab of Althar's own after the settings', as
 * theirs is, which closes for good with its ×; B's line at the bar's end
 * until it's opened. D: Althar's tab, kept like a project's, with a quiet dot
 * until it's opened. C: nothing in the bar.
 */

/** The pinned tab the transform adds to the kit's tabs. */
interface WhatsNewTab {
  current: boolean
  name: string
  mark: (className: string) => ReactNode
  dot?: boolean
  onSelect: () => void
  onClose?: () => void
  closeLabel?: string
}

const Tabs = KitTabs as (props: ProjectTabsProps & { whatsNew?: WhatsNewTab }) => ReactNode

const sparks = (className: string) => <Sparks width={15} height={15} strokeWidth={2} className={className} aria-hidden="true" />

export function ProjectTabs(props: ProjectTabsProps) {
  const { d, tab, unseen } = useLab()
  const onPage = useRouterState({ select: (state) => state.location.pathname }) === WHATS_NEW
  // Closed, the window goes to the tab after it, as the settings' does: the first project's, else the home's.
  const close = () => {
    lab.set({ tab: false })
    if (onPage) props.onSelect(props.tabs[0]?.id ?? null)
  }
  const whatsNew: WhatsNewTab | undefined =
    d === 'd'
      ? {
          current: onPage,
          name: 'Althar',
          // Not the logo: the home's tab has it.
          mark: sparks,
          dot: unseen,
          onSelect: go.whatsNew,
        }
      : (d === 'a' || d === 'b') && tab
        ? { current: onPage, name: 'What’s new', mark: sparks, onSelect: go.whatsNew, onClose: close, closeLabel: 'Close What’s new' }
        : undefined
  return (
    <Tabs
      {...props}
      {...(whatsNew === undefined ? {} : { whatsNew })}
      end={
        d === 'b' && unseen ? (
          <>
            <UpdatedLine />
            {props.end}
          </>
        ) : (
          props.end
        )
      }
    />
  )
}
