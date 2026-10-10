import { useId, useState, type ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import type { CodeHost } from '../../foundations/codeHost'
import { BrandMark } from '../../foundations/Marks/Marks'
import { Model, type ModelInfo } from '../../primitives/Model/Model'
import { ChangeState, unreachable } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import { useRefocus } from '../../lib/refocus'
import { safeHref } from '../../lib/safeHref'
import { Button } from '../../primitives/Button/Button'
import { Checks, passedOf, type ChangeCheck } from '../../primitives/Checks/Checks'
import { Delta, DiffStat, FileChanges, type ChangedFile } from '../../primitives/FileChanges/FileChanges'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { NoteForm } from '../../primitives/NoteForm/NoteForm'
import s from './ChangeSet.module.css'

/*
 * What a task changed, as its code host would show it and as Althar knows it:
 * one piece of work, with as many pull requests as it has repositories,
 * merged in an order and never as one. Who led it and who reviewed it, the
 * files by how much they changed, and every check. When all of them pass it
 * is ready, and accepting it is yours: nothing merges before. Or send it
 * back with a note, and the lead picks the note up. Work that ended on its
 * branch, with no pull request, is the same change: its repositories in
 * place of pull requests, merged on this Mac when you accept it.
 */

export interface PullRequest {
  /** owner/name. */
  repo: string
  /** None for a repository whose work stays on its branch. */
  number?: number
  /** For work on its branch, pushed: the host's page for a new pull request from it, and the host's name where known. */
  newPullRequest?: { readonly url: string; readonly host?: string }
  /** Where it lives on the code host; a link only when it is http or https. */
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
  /** In place of pull requests, for work on its branch. */
  repositories: (n: number) => string
  number: (n: number) => string
  /** The link to a pull request on its host: its words, then its full name. */
  onHost: (host: string) => string
  onHostLabel: (repo: string, n: number, host: string) => string
  after: (n: number, why: string) => string
  openFile: (path: string) => string
  checks: string
  passed: (passed: number, total: number) => string
  /** Before any check has started, as on a pull request just opened. */
  noChecks: string
  accept: (repos: number) => string
  /** Accepting work on its branch: it merges into its base, on this Mac. */
  mergeHere: (base: string) => string
  /** Said beside that, where the order would be. */
  here: string
  /** Pushing what merged here: to the branch its base follows. */
  push: (remote: string) => string
  /** Work on its branch, as its remote has it: not there yet, behind by some commits, or there. */
  notOn: (remote: string) => string
  behindOn: (n: number, remote: string) => string
  on: (remote: string) => string
  /** Pushes the branch there. */
  pushBranch: string
  pushBranchLabel: (remote: string) => string
  /** The host's page for a new pull request from the branch, pushed without a connection. */
  newPullRequest: (host: string | undefined) => string
  /** Said beside that. */
  pushNote: string
  order: (numbers: readonly number[]) => string
  /** Opens a note to the lead about what should change. */
  sendBack: string
  sendBackPlaceholder: string
  /** Sends that note; the lead takes the work up again with it. */
  sendNote: string
  cancel: string
  diff: string
}

export const changeSetText: ChangeSetText = {
  state: {
    [ChangeState.Draft]: 'Draft',
    [ChangeState.Ready]: 'Ready to accept',
    [ChangeState.Merged]: 'Merged',
    [ChangeState.Branch]: 'On its branch',
  },
  commits: (n) => (n === 1 ? '1 commit' : `${n} commits`),
  repos: (n) => `${n} repositories`,
  led: 'Led by',
  reviewed: 'Reviewed by',
  same: 'The same model led and reviewed this',
  prs: (n) => (n === 1 ? 'Pull request' : 'Pull requests'),
  repositories: (n) => (n === 1 ? 'Repository' : 'Repositories'),
  number: (n) => `#${n}`,
  onHost: (host) => host,
  onHostLabel: (repo, n, host) => `Open ${repo} #${n} on ${host}`,
  after: (n, why) => `Merges after #${n} · ${why}`,
  openFile: (path) => `Open the diff of ${path}`,
  checks: 'Checks',
  passed: (passed, total) => `${passed} of ${total} passed`,
  noChecks: 'None have run yet',
  accept: (repos) => {
    if (repos > 2) return `Accept and merge all ${repos}`
    if (repos === 2) return 'Accept and merge both'
    return 'Accept and merge'
  },
  order: (numbers) => (numbers.length > 1 ? `In order: ${numbers.map((n) => `#${n}`).join(', then ')}` : 'Squashes into the base branch'),
  mergeHere: (base) => `Merge into ${base}`,
  here: 'Merges on this Mac',
  push: (remote) => `Push to ${remote}`,
  notOn: (remote) => `Not on ${remote} yet`,
  behindOn: (n, remote) => (n === 1 ? `1 commit not on ${remote} yet` : `${n} commits not on ${remote} yet`),
  on: (remote) => `On ${remote}`,
  pushBranch: 'Push',
  pushBranchLabel: (remote) => `Push the branch to ${remote}`,
  newPullRequest: (host) => (host === undefined ? 'Open a pull request' : `Open a pull request on ${host}`),
  pushNote: 'With your own git sign-in, as from a terminal',
  sendBack: 'Ask for changes',
  sendBackPlaceholder: 'What should change? The lead picks it up with this note',
  sendNote: 'Send to the lead',
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
      case ChangeState.Branch:
        return <Icon name="branch" size={12} />
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
  /** Where its pull requests live; none for work on its branch. */
  host?: CodeHost
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
  /** Merged on this Mac, it goes to the remote its branch follows: shown only when merged. */
  onPush?: () => void
  /** The push is under way: Push shows it and ignores presses. */
  pushing?: boolean
  /**
   * Work on its branch, as its remote has it, with no connection to the
   * host: the remote's name, whether it has the branch, how many commits it
   * doesn't have, and pushing it there. Shown only on its branch.
   */
  remote?: {
    readonly name: string
    readonly pushed: boolean
    readonly ahead: number
    readonly onPush?: () => void
    readonly pushing?: boolean
  }
  /** Accepting is under way: Accept shows it and ignores presses. */
  accepting?: boolean
  /** The note is on its way to the lead: Ask for changes shows it and ignores presses. */
  sendingBack?: boolean
  /** Why the last answer did not go through, said in the foot. */
  error?: ReactNode
  /** The title's rank in the page's outline. */
  headingLevel?: HeadingLevel
  className?: string
  text?: Partial<ChangeSetText>
}

export function ChangeSet({
  state,
  host,
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
  onPush,
  pushing = false,
  remote,
  accepting = false,
  sendingBack = false,
  error,
  headingLevel = 2,
  className,
  text,
}: ChangeSetProps) {
  const t = { ...changeSetText, ...text }
  const titleId = useId()
  const [sending, setSending] = useState(false)
  const [draft, setDraft] = useState('')
  const back = useRefocus<HTMLButtonElement>(sending)

  const files = prs.flatMap((p) => p.files)
  const add = files.reduce((n, f) => n + f.add, 0)
  const del = files.reduce((n, f) => n + f.del, 0)
  const most = Math.max(1, ...files.map((f) => f.add + f.del))
  const same = reviewers.some((r) => r.id === lead.id)
  const here = state === ChangeState.Branch
  const deciding = (state === ChangeState.Ready || here) && (onAccept !== undefined || onSendBack !== undefined)
  const numbers = prs.flatMap((p) => (p.number === undefined ? [] : [p.number]))
  const pushes = state === ChangeState.Merged && onPush !== undefined

  return (
    <article className={cx(s.change, s[state], (deciding || pushes) && s.asks, className)} aria-labelledby={titleId}>
      <div className={s.body}>
        <div className={s.statusLine}>
          <Status state={state} t={t} />
          {note && <span className={s.note}>{note}</span>}
        </div>
        <Heading level={headingLevel} id={titleId} className={s.title}>
          {title}
        </Heading>
        <div className={s.refs}>
          <span className={s.ref}>{branch}</span>
          <Icon name="arrow" size={11} />
          <span className={s.ref}>{base}</span>
          <span className={s.commits}>
            {prs.length > 1 && `${t.repos(prs.length)} · `}
            {t.commits(commits)}
          </span>
          {here && remote && (
            <span className={s.away}>
              <span className={cx(s.where, remote.pushed && remote.ahead === 0 && s.there)}>
                {!remote.pushed ? t.notOn(remote.name) : remote.ahead > 0 ? t.behindOn(remote.ahead, remote.name) : t.on(remote.name)}
              </span>
              {remote.onPush && (!remote.pushed || remote.ahead > 0) && (
                <Button size="small" busy={remote.pushing ?? false} onClick={remote.onPush} aria-label={t.pushBranchLabel(remote.name)}>
                  {t.pushBranch}
                </Button>
              )}
              {/* One repository: its pull request is a press from here; several say so each beside its own. */}
              {remote.pushed && prs.length === 1 && prs[0]?.newPullRequest && safeHref(prs[0].newPullRequest.url) && (
                <a className={s.newPr} href={safeHref(prs[0].newPullRequest.url)} target="_blank" rel="noreferrer">
                  {t.newPullRequest(prs[0].newPullRequest.host)}
                  <Icon name="external" size={10} />
                </a>
              )}
            </span>
          )}
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
        <section className={s.section} aria-label={here ? t.repositories(prs.length) : t.prs(prs.length)}>
          <header className={s.sub}>
            <span>{here ? t.repositories(prs.length) : t.prs(prs.length)}</span>
            <span className={s.count}>{prs.length}</span>
            <span className={s.sum}>
              <Delta add={add} del={del} />
              <DiffStat add={add} del={del} />
            </span>
          </header>
          {prs.map((p, i) => {
            const [owner, name] = p.repo.includes('/') ? p.repo.split('/') : ['', p.repo]
            const link = p.number === undefined || host === undefined ? undefined : safeHref(p.url)
            return (
              <div key={`${p.repo}${p.number ?? ''}`} className={s.pr}>
                <div className={s.prHead}>
                  {prs.length > 1 && !here && <span className={s.order}>{i + 1}</span>}
                  {host?.brand && p.number !== undefined && <BrandMark brand={host.brand} size={14} />}
                  <span className={s.repo}>
                    {owner && <span className={s.owner}>{owner} /</span>} {name}
                  </span>
                  {p.number !== undefined && <span className={s.number}>{t.number(p.number)}</span>}
                  {here && prs.length > 1 && remote?.pushed && p.newPullRequest && safeHref(p.newPullRequest.url) && (
                    <a className={s.github} href={safeHref(p.newPullRequest.url)} target="_blank" rel="noreferrer">
                      {t.newPullRequest(p.newPullRequest.host)}
                      <Icon name="external" size={10} />
                    </a>
                  )}
                  {link && host && p.number !== undefined && (
                    <a
                      className={s.github}
                      href={link}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={t.onHostLabel(p.repo, p.number, host.name)}
                    >
                      {t.onHost(host.name)}
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
            <span className={s.sum}>{checks.length === 0 ? t.noChecks : t.passed(passedOf(checks), checks.length)}</span>
          </header>
          {checks.length > 0 && <Checks checks={checks} />}
        </section>
      </div>

      {(deciding || pushes || onReviewDiff) && (
        <footer className={cx(s.foot, (deciding || pushes) && s.deciding)}>
          {deciding && sending ? (
            <NoteForm
              text={{ placeholder: t.sendBackPlaceholder, submit: t.sendNote, cancel: t.cancel }}
              defaultValue={draft}
              onSubmit={(note) => {
                /* kept, so a send that fails can be tried again without writing it twice */
                setDraft(note)
                onSendBack?.(note)
                setSending(false)
              }}
              onCancel={() => setSending(false)}
            />
          ) : (
            <>
              {deciding && onAccept && (
                <Button variant="signal" busy={accepting} onClick={onAccept}>
                  {here ? t.mergeHere(base) : t.accept(prs.length)}
                </Button>
              )}
              {deciding && onSendBack && (
                <Button ref={back} busy={sendingBack} onClick={() => setSending(true)}>
                  {t.sendBack}
                </Button>
              )}
              {deciding && <span className={s.meta}>{here ? t.here : t.order(numbers)}</span>}
              {pushes && (
                <>
                  <Button variant="signal" busy={pushing} onClick={onPush}>
                    {t.push(base)}
                  </Button>
                  <span className={s.meta}>{t.pushNote}</span>
                </>
              )}
              {onReviewDiff && (
                <Button
                  variant={deciding || pushes ? 'quiet' : 'default'}
                  kbd={diffKey}
                  onClick={onReviewDiff}
                  className={cx((deciding || pushes) && s.push)}
                >
                  {t.diff}
                </Button>
              )}
            </>
          )}
          {error && (
            <span className={s.error} role="alert">
              {error}
            </span>
          )}
        </footer>
      )}
    </article>
  )
}
