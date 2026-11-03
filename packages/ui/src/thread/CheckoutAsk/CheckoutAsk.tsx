import { useState } from 'react'

import { FileChips } from '../../board/BoardCard/Chips'
import { AskCard, AskFoot } from '../../primitives/Ask/Ask'
import { Button } from '../../primitives/Button/Button'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'

/*
 * What Althar asks before a Local task takes the person's checkout
 * (ADR-090): it has changes that aren't committed, which nothing switches
 * under, stashes or resets; or it is on a branch of the person's own, which
 * it goes back to once the task is settled. Each way on in a button: wait
 * until the changes are committed, check out the task's branch, start the
 * task from the person's branch, or start it in a worktree instead.
 */

export type CheckoutAnswer = 'wait' | 'worktree' | 'switch' | 'from_branch'

export interface CheckoutAskText {
  kicker: string
  who: string
  /** Its changes not committed, on what branch (null: detached). */
  changes: (repository: string, branch: string | null) => string
  /** On a branch of the person's own, which it goes back to. */
  branch: (repository: string, branch: string) => string
  wait: string
  worktree: string
  switch: string
  fromBranch: (branch: string) => string
}

export const checkoutAskText: CheckoutAskText = {
  kicker: 'Local',
  who: 'Before it starts',
  changes: (repository, branch) => `${repository} has uncommitted changes${branch === null ? '' : ` on ${branch}`}.`,
  branch: (repository, branch) => `${repository} is on ${branch}, and goes back to it when you settle this task.`,
  wait: 'Wait until they’re committed',
  worktree: 'Start in a worktree',
  switch: 'Check out its branch',
  fromBranch: (branch) => `Start from ${branch}`,
}

export interface CheckoutAskProps {
  repository: string
  holdup: 'changes' | 'branch'
  /** For changes not committed: which files. */
  files?: readonly string[]
  /** The branch the checkout is on; null where it is detached. */
  branch: string | null
  onAnswer: (answer: CheckoutAnswer) => void
  text?: Partial<CheckoutAskText>
  className?: string
}

export function CheckoutAsk({ repository, holdup, files = [], branch, onAnswer, text, className }: CheckoutAskProps) {
  const t = { ...checkoutAskText, ...text }
  // Answered once: the runtime moves on, and the card goes with the call.
  const [said, setSaid] = useState<CheckoutAnswer | null>(null)
  const answer = (choice: CheckoutAnswer) => {
    if (said !== null) return
    setSaid(choice)
    onAnswer(choice)
  }
  const busy = (choice: CheckoutAnswer) => ({ disabled: said !== null, busy: said === choice })
  const what = holdup === 'changes' ? t.changes(repository, branch) : t.branch(repository, branch ?? '')
  return (
    <AskCard icon="folder" kicker={t.kicker} who={t.who} what={what} {...(className === undefined ? {} : { className })}>
      {holdup === 'changes' && files.length > 0 && <FileChips files={files.map((path) => ({ path }))} />}
      <AskFoot>
        {holdup === 'changes' ? (
          <Button variant="signal" onClick={() => answer('wait')} {...busy('wait')}>
            {t.wait}
          </Button>
        ) : (
          <Button variant="signal" onClick={() => answer('switch')} {...busy('switch')}>
            {t.switch}
          </Button>
        )}
        <Button onClick={() => answer('worktree')} {...busy('worktree')}>
          {t.worktree}
        </Button>
        {holdup === 'branch' && branch !== null && (
          <LinkButton onClick={() => answer('from_branch')} disabled={said !== null}>
            {t.fromBranch(branch)}
          </LinkButton>
        )}
      </AskFoot>
    </AskCard>
  )
}
