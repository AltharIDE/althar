import { useState } from 'react'

import { Button } from '../../primitives/Button/Button'
import s from './Diverged.module.css'

/*
 * A task's branch that a plain push to its pull request won't take, said in
 * a sentence rather than git's hint, with what puts it right. Rewritten
 * since it was pushed: its commits can replace the pull request's, a force
 * push the person confirms here, naming what goes; or the lead starts again
 * from what was pushed and merges, so a plain push works. Moved on, with
 * commits pushed from elsewhere: the lead brings them in by merging.
 */

export interface DivergedText {
  /** Rewritten: `local` new commits in place of `onPullRequest` on it. */
  rewritten: (local: number, onPullRequest: number, pullRequest: string) => string
  /** Moved on: commits on it that aren't here, counted where they are. */
  moved: (onPullRequest: number | null, pullRequest: string) => string
  replace: (pullRequest: string) => string
  /** Asked before replacing: what goes, and that nothing pushed since is lost. */
  confirm: (local: number, onPullRequest: number, named: string) => string
  replaceThem: string
  cancel: string
  /** Rewritten: the lead puts its work back on what was pushed, by merging. */
  askLead: string
  /** Moved on: the lead merges what was pushed there. */
  bringIn: (pullRequest: string) => string
}

const commits = (n: number) => (n === 1 ? '1 commit' : `${n} commits`)

export const divergedText: DivergedText = {
  rewritten: (local, onPullRequest, pullRequest) =>
    local === 0
      ? `This branch was rewritten since it was pushed: ${commits(onPullRequest)} on ${pullRequest} aren’t on it any more.`
      : `This branch was rewritten since it was pushed: ${local === 1 ? '1 new commit replaces' : `${local} new commits replace`} ${onPullRequest} on ${pullRequest}.`,
  moved: (onPullRequest, pullRequest) =>
    onPullRequest === null
      ? `${capitalised(pullRequest)} has commits pushed from elsewhere that aren’t on this branch, so it won’t take a plain push.`
      : `${capitalised(pullRequest)} has ${commits(onPullRequest)} pushed from elsewhere that ${onPullRequest === 1 ? 'isn’t' : 'aren’t'} on this branch, so it won’t take a plain push.`,
  replace: (pullRequest) => `Replace ${pullRequest}’s commits`,
  confirm: (local, onPullRequest, named) =>
    `Replace the ${commits(onPullRequest)} on ${named} with the ${local === 0 ? 'branch' : commits(local)} here? If anyone pushed to it since you looked, nothing is replaced.`,
  replaceThem: 'Replace them',
  cancel: 'Cancel',
  askLead: 'Ask the lead to merge instead',
  bringIn: (pullRequest) => `Bring in ${pullRequest}’s commits`,
}

const capitalised = (words: string) => words.charAt(0).toUpperCase() + words.slice(1)

export interface DivergedProps {
  /** `rewritten`: commits it pushed were rewritten here. `moved`: it has commits pushed from elsewhere. */
  kind: 'rewritten' | 'moved'
  /** Commits here in place of those on it. */
  local: number
  /** Its commits the branch doesn't have; none where they can't be counted here yet. */
  onPullRequest: number | null
  /** How it is said in a sentence: the pull request, web’s merge request. */
  pullRequest?: string
  /** How it is named when confirming: PR #124. */
  named: string
  /** Replaces its commits with the branch here, once confirmed. Offered only where rewritten. */
  onReplace?: () => void
  /** Has the lead merge: what was pushed, from what was pushed. */
  onMerge: () => void
  /** Replacing is under way. */
  replacing?: boolean
  /** Asking the lead is under way. */
  merging?: boolean
  /** Another action is under way: presses wait. */
  locked?: boolean
  text?: Partial<DivergedText>
}

export function Diverged({
  kind,
  local,
  onPullRequest,
  pullRequest = 'the pull request',
  named,
  onReplace,
  onMerge,
  replacing = false,
  merging = false,
  locked = false,
  text,
}: DivergedProps) {
  const t = { ...divergedText, ...text }
  const [confirming, setConfirming] = useState(false)
  // Asked once: replaced or refused, it is back to the sentence and both ways out.
  const [wasReplacing, setWasReplacing] = useState(replacing)
  if (wasReplacing !== replacing) {
    setWasReplacing(replacing)
    if (!replacing) setConfirming(false)
  }
  const rewritten = kind === 'rewritten'
  const replaced = onPullRequest ?? 0
  return (
    <div className={s.diverged}>
      <p className={s.said}>{rewritten ? t.rewritten(local, replaced, pullRequest) : t.moved(onPullRequest, pullRequest)}</p>
      {confirming && onReplace !== undefined ? (
        <div className={s.confirm}>
          <p className={s.ask}>{t.confirm(local, replaced, named)}</p>
          <div className={s.actions}>
            <Button size="small" variant="danger" busy={replacing} disabled={locked && !replacing} onClick={onReplace}>
              {t.replaceThem}
            </Button>
            <Button size="small" variant="quiet" disabled={replacing} onClick={() => setConfirming(false)}>
              {t.cancel}
            </Button>
          </div>
        </div>
      ) : (
        <div className={s.actions}>
          <Button size="small" busy={merging} disabled={locked && !merging} onClick={onMerge}>
            {rewritten ? t.askLead : t.bringIn(pullRequest)}
          </Button>
          {rewritten && onReplace !== undefined && (
            <Button size="small" variant="quiet" disabled={locked} onClick={() => setConfirming(true)}>
              {t.replace(pullRequest)}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
