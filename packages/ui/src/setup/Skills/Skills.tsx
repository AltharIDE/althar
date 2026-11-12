import { type FormEvent, useState } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Button } from '../../primitives/Button/Button'
import { Field } from '../../primitives/Field/Field'
import s from './Skills.module.css'

/*
 * Adding a skill from GitHub: a repository looked in for its skill folders,
 * then the one chosen read before it is added. A card shows where it is
 * from, the commit it is pinned to, its licence, what Althar noticed in it,
 * every file and what changes from the version added before, and only
 * Install puts it in. Nothing in a skill is run by Althar; an agent may run
 * its scripts, under the task's rules.
 */

/* ---- installing from GitHub ------------------------------------------------------- */

export interface SkillInstallText {
  label: string
  placeholder: string
  find: string
  finding: string
  choose: string
  review: string
  none: string
}

export const skillInstallText: SkillInstallText = {
  label: 'Install a skill from GitHub',
  placeholder: 'github.com/owner/repository, or a skill’s folder in it',
  find: 'Find skills',
  finding: 'Looking…',
  choose: 'Skills in it',
  review: 'Review',
  none: 'It has no folder with a SKILL.md.',
}

export type SkillInstallProps = RootProps<
  'div',
  {
    /** The skill folders found in the repository asked for, once it has been looked in. */
    found: { repo: string; sha: string; paths: readonly string[] } | null
    busy: boolean
    /** Why it couldn't be looked in or fetched, in the person's words. */
    error: string | null
    onFind: (source: string) => void
    onReview: (subpath: string) => void
    text?: Partial<SkillInstallText>
  }
>

/** A repository to look in for skills, then the folder to review. */
export function SkillInstall({ found, busy, error, onFind, onReview, text, className, ...rest }: SkillInstallProps) {
  const t = { ...skillInstallText, ...text }
  const [source, setSource] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (source.trim() !== '') onFind(source.trim())
  }
  return (
    <div className={cx(s.install, className)} {...rest}>
      <form className={s.ask} onSubmit={submit}>
        <Field aria-label={t.label} placeholder={t.placeholder} value={source} onChange={(event) => setSource(event.target.value)} />
        <Button type="submit" disabled={busy || source.trim() === ''}>
          {busy ? t.finding : t.find}
        </Button>
      </form>
      {error !== null && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      {found !== null && (
        <div className={s.found}>
          <span className={s.label}>
            {t.choose} · {found.repo} @ <code>{found.sha.slice(0, 8)}</code>
          </span>
          {found.paths.length === 0 && <p className={s.quiet}>{t.none}</p>}
          <ul className={s.paths}>
            {found.paths.map((path) => (
              <li key={path}>
                <code>{path || '/'}</code>
                <Button size="small" variant="quiet" disabled={busy} onClick={() => onReview(path)}>
                  {t.review}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/* ---- the review card --------------------------------------------------------------- */

export interface SkillReviewModel {
  id: string
  repo: string
  ref: string
  sha: string
  subpath: string
  license: string | null
  description: string | null
  instructions: string
  files: readonly { path: string; bytes: number; executable: boolean }[]
  findings: readonly { level: 'reject' | 'flag'; message: string; path?: string }[]
  installable: boolean
  /** Where the version installed under the same name is from, where it isn't this repository: installing replaces it. */
  replaces: string | null
  /** An update of the one installed, rather than a first install. */
  update: boolean
  changes: readonly {
    path: string
    change: 'added' | 'removed' | 'changed'
    lines: readonly { kind: 'same' | 'added' | 'removed'; text: string }[]
  }[]
}

export interface SkillReviewText {
  from: string
  license: string
  noLicense: string
  files: string
  script: string
  instructions: string
  changes: string
  /** A first install's files besides `SKILL.md`, each in full. */
  rest: string
  /** A file whose lines can't be shown: binary, or too long to compare. */
  unshown: string
  noted: string
  refused: string
  install: string
  update: string
  replace: (from: string) => string
  cancel: string
  change: Record<'added' | 'removed' | 'changed', string>
}

export const skillReviewText: SkillReviewText = {
  from: 'From',
  license: 'Licence',
  noLicense: 'None given',
  files: 'Files',
  script: 'script: an agent may run it, Althar never does',
  instructions: 'What the agent is told',
  changes: 'What changes',
  rest: 'Its other files',
  unshown: 'Can’t be shown here: binary, or too long to compare. Read it on GitHub before installing.',
  noted: 'Look at these first',
  refused: 'It can’t be installed',
  install: 'Install',
  update: 'Update',
  replace: (from) => `Install in place of the one from ${from}`,
  cancel: 'Cancel',
  change: { added: 'new', removed: 'gone', changed: 'changed' },
}

export type SkillReviewProps = RootProps<
  'section',
  {
    card: SkillReviewModel
    busy: boolean
    onInstall: (replace: boolean) => void
    onCancel: () => void
    text?: Partial<SkillReviewText>
  }
>

const sizeOf = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 102.4) / 10} KB`)

/** One version of a skill from GitHub, as it would be installed: read it, then install it or not. */
export function SkillReview({ card, busy, onInstall, onCancel, text, className, ...rest }: SkillReviewProps) {
  const t = { ...skillReviewText, ...text }
  const refused = card.findings.filter((finding) => finding.level === 'reject')
  const flagged = card.findings.filter((finding) => finding.level === 'flag')
  // Every file is shown before it is installed: a first install's SKILL.md as the instructions, the rest in full;
  // an update or a replacement as what changes from the version installed.
  const shown = card.update || card.replaces !== null ? card.changes : card.changes.filter((change) => change.path !== 'SKILL.md')
  return (
    <section className={cx(s.card, className)} aria-label={card.id} {...rest}>
      <header className={s.head}>
        <h3 className={s.title}>{card.id}</h3>
        {card.description !== null && <p className={s.description}>{card.description}</p>}
        <dl className={s.facts}>
          <dt>{t.from}</dt>
          <dd>
            {card.repo}/{card.subpath} @ <code>{card.sha.slice(0, 12)}</code> ({card.ref})
          </dd>
          <dt>{t.license}</dt>
          <dd>{card.license ?? t.noLicense}</dd>
        </dl>
      </header>
      {refused.length > 0 && <Findings title={t.refused} findings={refused} tone="refused" />}
      {flagged.length > 0 && <Findings title={t.noted} findings={flagged} tone="noted" />}
      <div className={s.part}>
        <span className={s.label}>{t.files}</span>
        <ul className={s.files}>
          {card.files.map((file) => (
            <li key={file.path}>
              <code>{file.path}</code>
              <span className={s.quiet}>
                {sizeOf(file.bytes)}
                {file.executable && ` · ${t.script}`}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {!card.update && (
        <div className={s.part}>
          <span className={s.label}>{t.instructions}</span>
          <pre className={s.instructions}>{card.instructions}</pre>
        </div>
      )}
      {shown.length > 0 && (
        <div className={s.part}>
          <span className={s.label}>{card.update || card.replaces !== null ? t.changes : t.rest}</span>
          {shown.map((change) => (
            <div key={change.path} className={s.change}>
              <span className={s.changePath}>
                <code>{change.path}</code> <span className={s.quiet}>{t.change[change.change]}</span>
              </span>
              {change.lines.length > 0 ? (
                <pre className={s.diff}>
                  {change.lines.map((line, at) => (
                    <span key={at} className={cx(s.line, line.kind === 'added' && s.plus, line.kind === 'removed' && s.minus)}>
                      {line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '− ' : '  '}
                      {line.text}
                      {'\n'}
                    </span>
                  ))}
                </pre>
              ) : (
                change.change !== 'removed' && <span className={s.quiet}>{t.unshown}</span>
              )}
            </div>
          ))}
        </div>
      )}
      <footer className={s.actions}>
        <Button variant="quiet" onClick={onCancel} disabled={busy}>
          {t.cancel}
        </Button>
        <Button variant="signal" disabled={busy || !card.installable} onClick={() => onInstall(card.replaces !== null)}>
          {card.replaces !== null ? t.replace(card.replaces) : card.update ? t.update : t.install}
        </Button>
      </footer>
    </section>
  )
}

function Findings({ title, findings, tone }: { title: string; findings: SkillReviewModel['findings']; tone: 'refused' | 'noted' }) {
  return (
    <div className={cx(s.part, s.findings, tone === 'refused' ? s.refused : s.noted)}>
      <span className={s.label}>{title}</span>
      <ul>
        {findings.map((finding, at) => (
          <li key={at}>
            {finding.message}
            {finding.path !== undefined && (
              <>
                {' '}
                <code>{finding.path}</code>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
