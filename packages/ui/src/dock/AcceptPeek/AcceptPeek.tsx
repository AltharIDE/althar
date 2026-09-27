import { useState } from 'react'

import { Brand } from '../../foundations/brands/brands'
import { Icon } from '../../foundations/Icon/Icon'
import { BrandMark } from '../../foundations/Marks/Marks'
import { Model, type ModelInfo } from '../../foundations/Model/Model'
import { Button } from '../../primitives/Button/Button'
import { Checks, type ChangeCheck } from '../../primitives/Checks/Checks'
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
  github: (repo: string, n: number) => string
  led: string
  reviewed: string
  files: string
  checks: string
  accept: string
  sendBack: string
  sendBackPlaceholder: string
  cancel: string
}

export const acceptPeekText: AcceptPeekText = {
  number: (n) => `#${n}`,
  github: (repo, n) => `Open ${repo} #${n} on GitHub`,
  led: 'Led by',
  reviewed: 'reviewed by',
  files: 'Files',
  checks: 'Checks',
  accept: 'Accept and merge',
  sendBack: 'Send back',
  sendBackPlaceholder: 'What should change?',
  cancel: 'Cancel',
}

export interface AcceptPeekProps {
  title: string
  because?: string
  /** owner/name. */
  repo: string
  number: number
  url?: string
  lead: ModelInfo
  reviewers?: readonly ModelInfo[]
  files: readonly ChangedFile[]
  checks: readonly ChangeCheck[]
  onAccept: () => void
  onSendBack: (note: string) => void
  onOpenFile?: (path: string) => void
  text?: Partial<AcceptPeekText>
}

export function AcceptPeek({
  title,
  because,
  repo,
  number,
  url,
  lead,
  reviewers = [],
  files,
  checks,
  onAccept,
  onSendBack,
  onOpenFile,
  text,
}: AcceptPeekProps) {
  const t = { ...acceptPeekText, ...text }
  const [sending, setSending] = useState(false)
  const add = files.reduce((n, f) => n + f.add, 0)
  const del = files.reduce((n, f) => n + f.del, 0)
  return (
    <>
      <PeekHead title={title} lead={because} />
      <div className={s.pr}>
        <BrandMark brand={Brand.GitHub} size={14} />
        <span className={s.repo}>{repo}</span>
        <span className={s.number}>{t.number(number)}</span>
        {url && (
          <a className={s.github} href={url} target="_blank" rel="noreferrer" aria-label={t.github(repo, number)}>
            <Icon name="external" size={11} />
          </a>
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
      <PeekSection label={t.checks}>
        <Checks checks={checks} />
      </PeekSection>
      <PeekFoot>
        {sending ? (
          <NoteForm
            placeholder={t.sendBackPlaceholder}
            submit={t.sendBack}
            cancel={t.cancel}
            onSubmit={(note) => {
              onSendBack(note)
              setSending(false)
            }}
            onCancel={() => setSending(false)}
          />
        ) : (
          <>
            <Button variant="signal" onClick={onAccept}>
              {t.accept}
            </Button>
            <Button onClick={() => setSending(true)}>{t.sendBack}</Button>
          </>
        )}
      </PeekFoot>
    </>
  )
}
