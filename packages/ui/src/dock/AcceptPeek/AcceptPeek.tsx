import { useState, type ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import type { CodeHost } from '../../foundations/codeHost'
import { BrandMark } from '../../foundations/Marks/Marks'
import { Model, type ModelInfo } from '../../foundations/Model/Model'
import { useRefocus } from '../../lib/refocus'
import { safeHref } from '../../lib/safeHref'
import { Button } from '../../primitives/Button/Button'
import { Tooltip } from '../../primitives/HoverCard/HoverCard'
import { Checks, type ChangeCheck } from '../../primitives/Checks/Checks'
import { CheckState } from '../../foundations/vocabulary'
import { Delta, FileChanges, type ChangedFile } from '../../primitives/FileChanges/FileChanges'
import { NoteForm } from '../../primitives/NoteForm/NoteForm'
import { PeekFoot, PeekHead, PeekSection } from '../Dock/Dock'
import s from './AcceptPeek.module.css'

/*
 * Accepting from the board: enough to decide on a small change without
 * opening its task. The pull request, who led it and who reviewed it, its
 * files and checks, and the two answers: accept and merge, or send it back
 * with a note. A change that isn't small is one click away, in its task.
 */

export interface AcceptPeekText {
  number: (n: number) => string
  openOnHost: (repo: string, n: number, host: string) => string
  led: string
  reviewed: string
  files: string
  checks: string
  accept: string
  sendBack: string
  sendBackPlaceholder: string
  cancel: string
  /** Said in place of Accept while any check has not passed. */
  checksFirst: string
  /** Said where the checks would be, when none ran. */
  noChecks: string
}

export const acceptPeekText: AcceptPeekText = {
  number: (n) => `#${n}`,
  openOnHost: (repo, n, host) => `Open ${repo} #${n} on ${host}`,
  led: 'Led by',
  reviewed: 'reviewed by',
  files: 'Files',
  checks: 'Checks',
  accept: 'Accept and merge',
  sendBack: 'Send back',
  sendBackPlaceholder: 'What should change?',
  cancel: 'Cancel',
  checksFirst: 'It can be accepted once its checks pass',
  noChecks: 'No checks ran on it.',
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
  onSendBack: (note: string) => void
  onOpenFile?: (path: string) => void
  /** Accepting is under way: Accept shows it and ignores presses. */
  accepting?: boolean
  /** The note is on its way back: Send back shows it and ignores presses. */
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
  onSendBack,
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
  const passed = checks.every((c) => c.state === CheckState.Passed)
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
          <>
            {' · '}
            {t.reviewed}{' '}
            {reviewers.map((m) => (
              <Model key={m.id} model={m} className={s.model} />
            ))}
          </>
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
            text={{ placeholder: t.sendBackPlaceholder, submit: t.sendBack, cancel: t.cancel }}
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
            {passed ? (
              <Button variant="signal" busy={accepting} onClick={onAccept}>
                {t.accept}
              </Button>
            ) : (
              <span className={s.wait}>{t.checksFirst}</span>
            )}
            <Button ref={back} busy={sendingBack} onClick={() => setSending(true)}>
              {t.sendBack}
            </Button>
          </>
        )}
        {error && (
          <span className={s.error} role="alert">
            {error}
          </span>
        )}
      </PeekFoot>
    </>
  )
}
