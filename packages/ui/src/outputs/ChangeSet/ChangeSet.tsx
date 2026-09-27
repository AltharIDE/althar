import { useId, useState } from 'react'

import { Brand } from '../../foundations/brands/brands'
import { Icon } from '../../foundations/Icon/Icon'
import { BrandMark } from '../../foundations/Marks/Marks'
import { Model, type ModelInfo } from '../../foundations/Model/Model'
import { ChangeState, unreachable } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import { Button } from '../../primitives/Button/Button'
import { NoteForm } from '../../primitives/NoteForm/NoteForm'
import { Checks, passedOf, type ChangeCheck } from '../../primitives/Checks/Checks'
import { Delta, DiffStat, FileChanges, type ChangedFile } from '../../primitives/FileChanges/FileChanges'
import s from './ChangeSet.module.css'

/*
 * What a task changed, as GitHub would show it and as Charrette knows it:
 * one piece of work, with as many pull requests as it has repositories,
 * merged in an order and never as one. Who led it and who reviewed it, the
 * files by how much they changed, and every check. When all of them pass it
 * is ready, and accepting it is yours: nothing merges before. Or send it
 * back with a note, and the lead picks the note up.
 */

export interface PullRequest {
  /** owner/name. */
  repo: string
  number: number
  /** Where it lives on GitHub. */
  url?: string
  files: readonly ChangedFile[]
  /** It merges after another of this change's pull requests. */
  after?: { number: number; why: string }
}

export interface ChangeSetText {
  state: Record<ChangeState, string>
  commits: (n: number) => string
  repos: (n: number) => string
  led: string
  reviewed: string
  /** The same model led and reviewed it. */
  same: string
  prs: (n: number) => string
  number: (n: number) => string
  github: string
  githubLabel: (repo: string, n: number) => string
  after: (n: number, why: string) => string
  openFile: (path: string) => string
  checks: string
  passed: (passed: number, total: number) => string
  accept: (repos: number) => string
  order: (numbers: readonly number[]) => string
  sendBack: string
  sendBackPlaceholder: string
  cancel: string
  diff: string
}

export const changeSetText: ChangeSetText = {
  state: { [ChangeState.Draft]: 'Draft', [ChangeState.Ready]: 'Ready to accept', [ChangeState.Merged]: 'Merged' },
  commits: (n) => (n === 1 ? '1 commit' : `${n} commits`),
  repos: (n) => `${n} repositories`,
  led: 'Led by',
  reviewed: 'Reviewed by',
  same: 'The same model led and reviewed this',
  prs: (n) => (n === 1 ? 'Pull request' : 'Pull requests'),
  number: (n) => `#${n}`,
  github: 'GitHub',
  githubLabel: (repo, n) => `Open ${repo} #${n} on GitHub`,
  after: (n, why) => `Merges after #${n} · ${why}`,
  openFile: (path) => `Open the diff of ${path}`,
  checks: 'Checks',
  passed: (passed, total) => `${passed} of ${total} passed`,
  accept: (repos) => (repos > 2 ? `Accept and merge all ${repos}` : repos === 2 ? 'Accept and merge both' : 'Accept and merge'),
  order: (numbers) => (numbers.length > 1 ? `In order: ${numbers.map((n) => `#${n}`).join(', then ')}` : 'Squashes into the base branch'),
  sendBack: 'Send back',
  sendBackPlaceholder: 'What should change? The lead picks it up with this note',
  cancel: 'Cancel',
  diff: 'Review the diff',
}

function Status({ state, t }: { state: ChangeState; t: ChangeSetText }) {
  const icon = (() => {
    switch (state) {
      case ChangeState.Draft:
        return <Icon name="pr" size={12} />
      case ChangeState.Ready:
        return <span className={s.you} aria-hidden="true" />
      case ChangeState.Merged:
        return <Icon name="check" size={12} />
      default:
        return unreachable(state)
    }
  })()
  return (
    <span className={s.status}>
      {icon}
      {t.state[state]}
    </span>
  )
}

export interface ChangeSetProps {
  state: ChangeState
  /** A line beside the state: Opens for review when verify passes. */
  note?: string
  title: string
  branch: string
  base: string
  commits: number
  lead: ModelInfo
  reviewers?: readonly ModelInfo[]
  prs: readonly PullRequest[]
  checks: readonly ChangeCheck[]
  /** Accept it. Shown only when it is ready. */
  onAccept?: () => void
  /** Send it back with a note. Shown only when it is ready. */
  onSendBack?: (note: string) => void
  /** Open the whole diff. */
  onReviewDiff?: () => void
  /** The key that opens the diff, shown beside it; the consumer binds it. */
  diffKey?: string
  /** Open one file's diff. Without it, files are not links. */
  onOpenFile?: (path: string) => void
  className?: string
  text?: Partial<ChangeSetText>
}

export function ChangeSet({
  state,
  note,
  title,
  branch,
  base,
  commits,
  lead,
  reviewers = [],
  prs,
  checks,
  onAccept,
  onSendBack,
  onReviewDiff,
  diffKey,
  onOpenFile,
  className,
  text,
}: ChangeSetProps) {
  const t = { ...changeSetText, ...text }
  const titleId = useId()
  const [sending, setSending] = useState(false)

  const files = prs.flatMap((p) => p.files)
  const add = files.reduce((n, f) => n + f.add, 0)
  const del = files.reduce((n, f) => n + f.del, 0)
  const most = Math.max(1, ...files.map((f) => f.add + f.del))
  const same = reviewers.some((r) => r.id === lead.id)
  const deciding = state === ChangeState.Ready && (onAccept || onSendBack)

  return (
    <article className={cx(s.change, s[state], className)} aria-labelledby={titleId}>
      <div className={s.body}>
        <div className={s.statusLine}>
          <Status state={state} t={t} />
          {note && <span className={s.note}>{note}</span>}
        </div>
        <h2 id={titleId} className={s.title}>
          {title}
        </h2>
        <div className={s.branch}>
          <span className={s.ref}>{branch}</span>
          <Icon name="arrow" size={11} />
          <span className={s.ref}>{base}</span>
          <span className={s.commits}>
            {prs.length > 1 && `${t.repos(prs.length)} · `}
            {t.commits(commits)}
          </span>
        </div>
        <div className={s.by}>
          <span className={s.who}>
            <span className={s.k}>{t.led}</span>
            <Model model={lead} className={s.model} />
          </span>
          {reviewers.length > 0 && (
            <span className={s.who}>
              <span className={s.k}>{t.reviewed}</span>
              {reviewers.map((m) => (
                <Model key={m.id} model={m} className={s.model} />
              ))}
            </span>
          )}
          {same && <span className={s.same}>{t.same}</span>}
        </div>
      </div>

      <div className={s.grid}>
        <section className={s.section} aria-label={t.prs(prs.length)}>
          <header className={s.sub}>
            <span>{t.prs(prs.length)}</span>
            <span className={s.count}>{prs.length}</span>
            <span className={s.sum}>
              <Delta add={add} del={del} />
              <DiffStat add={add} del={del} />
            </span>
          </header>
          {prs.map((p, i) => {
            const [owner, name] = p.repo.includes('/') ? p.repo.split('/') : ['', p.repo]
            return (
              <div key={`${p.repo}${p.number}`} className={s.pr}>
                <div className={s.prHead}>
                  {prs.length > 1 && <span className={s.order}>{i + 1}</span>}
                  <BrandMark brand={Brand.GitHub} size={14} />
                  <span className={s.repo}>
                    {owner && <span className={s.owner}>{owner} /</span>} {name}
                  </span>
                  <span className={s.number}>{t.number(p.number)}</span>
                  {p.url && (
                    <a className={s.github} href={p.url} target="_blank" rel="noreferrer" aria-label={t.githubLabel(p.repo, p.number)}>
                      {t.github}
                      <Icon name="external" size={10} />
                    </a>
                  )}
                </div>
                {p.after && (
                  <p className={s.after}>
                    <Icon name="after" size={11} />
                    {t.after(p.after.number, p.after.why)}
                  </p>
                )}
                <FileChanges files={p.files} most={most} onOpen={onOpenFile} text={{ open: t.openFile }} />
              </div>
            )
          })}
        </section>

        <section className={s.section} aria-label={t.checks}>
          <header className={s.sub}>
            <span>{t.checks}</span>
            <span className={s.sum}>{t.passed(passedOf(checks), checks.length)}</span>
          </header>
          <Checks checks={checks} />
        </section>
      </div>

      {(deciding || onReviewDiff) && (
        <footer className={cx(s.foot, deciding && s.deciding)}>
          {deciding && sending ? (
            <NoteForm
              placeholder={t.sendBackPlaceholder}
              submit={t.sendBack}
              cancel={t.cancel}
              onSubmit={(note) => {
                onSendBack?.(note)
                setSending(false)
              }}
              onCancel={() => setSending(false)}
            />
          ) : (
            <>
              {deciding && onAccept && (
                <Button variant="signal" onClick={onAccept}>
                  {t.accept(prs.length)}
                </Button>
              )}
              {deciding && onSendBack && <Button onClick={() => setSending(true)}>{t.sendBack}</Button>}
              {deciding && <span className={s.meta}>{t.order(prs.map((p) => p.number))}</span>}
              {onReviewDiff && (
                <Button variant={deciding ? 'quiet' : 'default'} kbd={diffKey} onClick={onReviewDiff} className={cx(deciding && s.push)}>
                  {t.diff}
                </Button>
              )}
            </>
          )}
        </footer>
      )}
    </article>
  )
}
