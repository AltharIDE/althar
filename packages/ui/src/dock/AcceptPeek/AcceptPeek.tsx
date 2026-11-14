import { useState, type ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import type { CodeHost } from '../../foundations/codeHost'
import { BrandMark } from '../../foundations/Marks/Marks'
import { Model, ModelList, type ModelInfo } from '../../primitives/Model/Model'
import { useRefocus } from '../../lib/refocus'
import { safeHref } from '../../lib/safeHref'
import { Button } from '../../primitives/Button/Button'
import { MergeButton } from '../../primitives/MergeButton/MergeButton'
import { Tooltip } from '../../primitives/HoverCard/HoverCard'
import { Checks, type ChangeCheck } from '../../primitives/Checks/Checks'
import { CheckState } from '../../foundations/vocabulary'
import { Delta, FileChanges, type ChangedFile } from '../../primitives/FileChanges/FileChanges'
import { NoteForm } from '../../primitives/NoteForm/NoteForm'
import { Problem } from '../../primitives/Problem/Problem'
import { PeekFoot, PeekHead, PeekSection } from '../Dock/Dock'
import s from './AcceptPeek.module.css'

/*
 * Accepting from the board: enough to decide on a small change without
 * opening its task. The pull request, who led it and who reviewed it, its
 * files and checks, and the two answers: accept and merge, or send it back
 * with a note. Commits the lead made since that aren't on the pull request
 * yet come first: pushed, as the person says, before anything is accepted. A
 * change that isn't small is one click away, in its task.
 */

export interface AcceptPeekText {
  number: (n: number) => string
  openOnHost: (repo: string, n: number, host: string) => string
  led: string
  reviewed: string
  files: string
  checks: string
  accept: string
  /** Opens a note to the lead about what should change. */
  sendBack: string
  sendBackPlaceholder: string
  /** Sends that note; the lead takes the work up again with it. */
  sendNote: string
  cancel: string
  /** Said in place of Accept while any check has not passed. */
  checksFirst: string
  /** Said where the checks would be, when none ran. */
  noChecks: string
  /** Said in place of Accept while the lead's later commits aren't on the pull request. */
  unpushed: (n: number) => string
  /** Said in place of Accept while the lead's later commits go up on their own. */
  going: (n: number) => string
  push: string
  /** Said in place of Accept while commits wait on the branch for Ship. */
  held: (n: number) => string
  ship: string
}

export const acceptPeekText: AcceptPeekText = {
  number: (n) => `#${n}`,
  openOnHost: (repo, n, host) => `Open ${repo} #${n} on ${host}`,
  led: 'Led by',
  reviewed: 'reviewed by',
  files: 'Files',
  checks: 'Checks',
  accept: 'Accept and merge',
  sendBack: 'Ask for changes',
  sendBackPlaceholder: 'What should change?',
  sendNote: 'Send to the lead',
  cancel: 'Cancel',
  checksFirst: 'Waiting for its checks',
  noChecks: 'No checks ran on it.',
  unpushed: (n) => (n === 1 ? 'One commit isn’t on the pull request yet' : `${n} commits aren’t on the pull request yet`),
  going: (n) => (n === 1 ? 'One commit is going up to the pull request' : `${n} commits are going up to the pull request`),
  push: 'Push',
  held: (n) => (n === 1 ? 'One commit isn’t shipped yet' : `${n} commits aren’t shipped yet`),
  ship: 'Ship',
}

export interface AcceptPeekProps {
  title: string
  because?: string
  /** owner/name. */
  repo: string
  number: number
  /** Where the pull request lives. */
  host: CodeHost
  /** The pull request on its host; a link only when it is http or https. */
  url?: string
  lead: ModelInfo
  reviewers?: readonly ModelInfo[]
  files: readonly ChangedFile[]
  checks: readonly ChangeCheck[]
  onAccept: () => void
  onBypassQueue?: () => void
  onSendBack: (note: string) => void
  /** Commits on the task's branch that aren't on the pull request yet: pushed first, with `onPush`. */
  unpushed?: number
  onPush?: () => void
  /** Commits on the task's branch going up to the pull request on their own: accepted once they're on it. */
  going?: number
  /** Pushing is under way: Push shows it and ignores presses. */
  pushing?: boolean
  /**
   * Commits that wait on the task's branch for Ship, which reviews them and
   * sends them up, with `onShip`: never accepted without them, nor pushed.
   */
  held?: number
  onShip?: () => void
  /** Shipping is under way: Ship shows it and ignores presses. */
  shipping?: boolean
  onOpenFile?: (path: string) => void
  /** Accepting is under way: Accept shows it and ignores presses. */
  accepting?: boolean
  /** The note is on its way to the lead: Ask for changes shows it and ignores presses. */
  sendingBack?: boolean
  /** Why the last answer did not go through, said in the foot. */
  error?: ReactNode
  text?: Partial<AcceptPeekText>
}

export function AcceptPeek({
  title,
  because,
  repo,
  number,
  host,
  url,
  lead,
  reviewers = [],
  files,
  checks,
  onAccept,
  onBypassQueue,
  onSendBack,
  unpushed = 0,
  onPush,
  going = 0,
  pushing = false,
  held = 0,
  onShip,
  shipping = false,
  onOpenFile,
  accepting = false,
  sendingBack = false,
  error,
  text,
}: AcceptPeekProps) {
  const t = { ...acceptPeekText, ...text }
  const [sending, setSending] = useState(false)
  const [draft, setDraft] = useState('')
  const back = useRefocus<HTMLButtonElement>(sending)
  const add = files.reduce((n, f) => n + f.add, 0)
  const del = files.reduce((n, f) => n + f.del, 0)
  const passed = checks.every((c) => c.state === CheckState.Passed || c.state === CheckState.Skipped)
  const link = safeHref(url)
  return (
    <>
      <PeekHead title={title} lead={because} />
      <div className={s.pr}>
        {host.brand && <BrandMark brand={host.brand} size={14} />}
        <span className={s.repo}>{repo}</span>
        <span className={s.number}>{t.number(number)}</span>
        {link && (
          <Tooltip label={t.openOnHost(repo, number, host.name)}>
            <a className={s.github} href={link} target="_blank" rel="noreferrer" aria-label={t.openOnHost(repo, number, host.name)}>
              <Icon name="external" size={11} />
            </a>
          </Tooltip>
        )}
      </div>
      <p className={s.by}>
        {t.led} <Model model={lead} className={s.model} />
        {reviewers.length > 0 && (
          <span>
            {' · '}
            {t.reviewed} <ModelList models={reviewers} className={s.model} />
          </span>
        )}
      </p>
      <PeekSection
        label={
          <>
            {t.files}
            <Delta add={add} del={del} />
          </>
        }
      >
        <FileChanges files={files} onOpen={onOpenFile} />
      </PeekSection>
      <PeekSection label={t.checks}>{checks.length > 0 ? <Checks checks={checks} /> : <p className={s.none}>{t.noChecks}</p>}</PeekSection>
      <PeekFoot>
        {sending ? (
          <NoteForm
            text={{ placeholder: t.sendBackPlaceholder, submit: t.sendNote, cancel: t.cancel }}
            defaultValue={draft}
            onSubmit={(note) => {
              /* kept, so a send that fails can be tried again without writing it twice */
              setDraft(note)
              onSendBack(note)
              setSending(false)
            }}
            onCancel={() => setSending(false)}
          />
        ) : (
          <>
            {held > 0 ? (
              <>
                {onShip && (
                  <Button variant="signal" busy={shipping} onClick={onShip}>
                    {t.ship}
                  </Button>
                )}
                <span className={s.wait}>{t.held(held)}</span>
              </>
            ) : unpushed > 0 && onPush ? (
              <>
                <Button variant="signal" busy={pushing} onClick={onPush}>
                  {t.push}
                </Button>
                <span className={s.wait}>{t.unpushed(unpushed)}</span>
              </>
            ) : going > 0 ? (
              <span className={s.wait}>{t.going(going)}</span>
            ) : passed ? (
              <MergeButton variant="signal" busy={accepting} onMerge={onAccept} onBypassQueue={onBypassQueue}>
                {t.accept}
              </MergeButton>
            ) : (
              <span className={s.wait}>{t.checksFirst}</span>
            )}
            <Button ref={back} busy={sendingBack} onClick={() => setSending(true)}>
              {t.sendBack}
            </Button>
          </>
        )}
        {error && (
          <Problem as="span" size="small" className={s.problem}>
            {error}
          </Problem>
        )}
      </PeekFoot>
    </>
  )
}
