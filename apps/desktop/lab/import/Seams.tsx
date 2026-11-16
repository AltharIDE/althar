import type { ComponentProps } from 'react'

import { BoardCard as KitBoardCard, BoardColumn as KitBoardColumn, BoardLane, SettingsLayout as KitSettingsLayout } from '@althar/ui'

import { FoundGroup, OtherToolsSection, useFoundShown } from './Later'
import { TOOLS, WORKTREES } from './world'

/** A worktree brought in, stopped where it was left: its card says where it came from, rather than that you stopped it. */
export function BoardCard(props: ComponentProps<typeof KitBoardCard>) {
  const worktree = WORKTREES.find((one) => (props as { readonly taskId?: string }).taskId === `t_wt_${one.id}`)
  if (worktree === undefined || props.word !== 'Stopped') return <KitBoardCard {...props} />
  return <KitBoardCard {...props} word={`From ${TOOLS[worktree.tool].name}`} />
}

/** Up next, with the found group under Scratch, where the direction leaves what was found to the board. */
export function BoardColumn(props: ComponentProps<typeof KitBoardColumn>) {
  const found = useFoundShown()
  if (props.lane !== BoardLane.Next) return <KitBoardColumn {...props} />
  return (
    <KitBoardColumn {...props} filled={found || (props.filled ?? props.count > 0)}>
      <FoundGroup />
      {props.children}
    </KitBoardColumn>
  )
}

/** Either Settings page, drawing Other tools where it's the section open. */
export function SettingsLayout(props: ComponentProps<typeof KitSettingsLayout>) {
  if (props.section === 'import') return <KitSettingsLayout {...props}>{<OtherToolsSection where="project" />}</KitSettingsLayout>
  if (props.section === 'other-tools') return <KitSettingsLayout {...props}>{<OtherToolsSection where="app" />}</KitSettingsLayout>
  return <KitSettingsLayout {...props} />
}
