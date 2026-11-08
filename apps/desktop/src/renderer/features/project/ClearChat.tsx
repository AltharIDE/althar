import { ClearChatDialog, ClearedLine, type ClearKind } from '@althar/ui'
import { type ReactNode, useRef, useState } from 'react'

import type { MeterClear } from '../../shared/ContextMeter'
import type { ProjectModel } from './useProject'

/*
 * Clearing the coordinator's chat from the project's conversation. One
 * question, asked from two places: /clear in the composer, which opens it on
 * clearing the view; and the context ring's foot, which opens it on
 * forgetting the conversation, so it reads as the warning it is. Nothing is forgotten until the question's own button is
 * pressed: there is no shortcut to it.
 */

export const clearText = {
  /** What typed in the composer asks the same. */
  command: '/clear',
}

export interface ClearChat {
  /**
   * Where the cleared view begins, at the top of the thread; none while the view is whole, or has more before it to read. With
   * the earlier conversation open it stays, its way back with it, whatever more of that conversation there is to read.
   */
  readonly line: ReactNode
  /** The question, while it is asked. */
  readonly dialog: ReactNode
  /** The context ring's way to ask it. */
  readonly ring: MeterClear
  /** The composer's text, if it asks to clear: asked then, and it is not sent. */
  readonly command: (body: string) => boolean
}

export function useClearChat(model: ProjectModel): ClearChat {
  const [asking, setAsking] = useState<ClearKind | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const { coordinator } = model
  const view = coordinator?.view ?? null
  return {
    line:
      view?.cleared !== true || (coordinator?.earlier === true && !view.earlierOpen) ? null : (
        <ClearedLine
          earlierOpen={view.earlierOpen}
          onShowEarlier={() => void model.showEarlier(true)}
          onBackToNow={() => void model.showEarlier(false)}
          onUndo={() => void model.undoClearView()}
        />
      ),
    dialog:
      asking === null || view === null ? null : (
        <ClearChatDialog
          startOn={asking}
          clearable={view.clearable}
          onClear={(kind) => void (kind === 'view' ? model.clearView() : model.forgetConversation())}
          onClose={() => setAsking(null)}
          returnFocus={() => trigger.current}
        />
      ),
    ring: { onClear: () => setAsking('forget'), triggerRef: trigger },
    command: (body) => {
      if (body.trim() !== clearText.command) return false
      // With no conversation there is nothing to clear: the words are not sent to the coordinator either.
      if (view?.forgettable === true) setAsking('view')
      return true
    },
  }
}
