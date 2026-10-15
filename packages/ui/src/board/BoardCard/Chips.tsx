import { Children, isValidElement, type ReactNode } from 'react'

import type { CodeHost } from '../../foundations/codeHost'
import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { BrandMark } from '../../foundations/Marks/Marks'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Code } from '../../primitives/Code/Code'
import { Delta } from '../../primitives/FileChanges/FileChanges'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import b from '../Board/Board.module.css'
import s from './Chips.module.css'

/*
 * What a board card holds under its title: at most one card in the card (a
 * pull request, a branch, the files or pictures a task handed back, the
 * command a permission asks to run) and one fact under it. Words and marks
 * only: they sit inside the card's one button, and nothing in them is
 * pressed. The accept card draws its pull requests with the same chips.
 */

export interface PullChipText {
  number: (n: number) => string
}

export const pullChipText: PullChipText = { number: (n) => `#${n}` }

export type PullChipProps = RootProps<
  'div',
  {
    /** Where it lives: its mark shows first. */
    host?: CodeHost
    /** The repository, without its owner: meridian-api. Someone else's pull request names whose it is instead. */
    repo?: string
    number: number
    /** Its lines added and deleted, where the host counts them. */
    add?: number
    del?: number
    /** Whose it is, for someone else's pull request: its number then shows whole, and the name gives way first. */
    by?: string
    text?: Partial<PullChipText>
  }
>

/** A pull request: its host's mark, its repository, its number and its size; someone else's says its number and whose it is. */
export function PullChip({ host, repo, number, add, del, by, text, className, ...rest }: PullChipProps) {
  const t = { ...pullChipText, ...text }
  return (
    <div className={cx(s.chip, className)} {...rest}>
      {host?.brand && <BrandMark brand={host.brand} size={12} />}
      {by === undefined ? (
        <>
          {repo !== undefined && <span className={s.name}>{repo}</span>}
          <span className={s.number}>{t.number(number)}</span>
        </>
      ) : (
        <>
          <span className={s.whole}>{t.number(number)}</span>
          <span className={s.by}>{by}</span>
        </>
      )}
      {(add !== undefined || del !== undefined) && <Delta {...sized(add, del)} className={s.delta} />}
    </div>
  )
}

/** Only the sides of a size that are known: a host that doesn't count shows none, rather than +0 −0. */
const sized = (add: number | undefined, del: number | undefined) => ({
  ...(add === undefined ? {} : { add }),
  ...(del === undefined ? {} : { del }),
})

export type BranchChipProps = RootProps<
  'div',
  {
    name: string
    /** How big its change is, where it is known. */
    add?: number
    del?: number
  }
>

/** A branch with no pull request yet: its name, cut at the end where the card is narrow, and how big its change is. */
export function BranchChip({ name, add, del, className, ...rest }: BranchChipProps) {
  return (
    <div className={cx(s.chip, className)} {...rest}>
      <Icon name="branch" size={12} />
      <span className={cx(s.name, s.branch)} title={name}>
        <bdi>{name}</bdi>
      </span>
      {(add !== undefined || del !== undefined) && <Delta {...sized(add, del)} className={s.delta} />}
    </div>
  )
}

/** A file a task handed back: where it is, and the lines it added where that is known. */
export interface HandedFile {
  path: string
  add?: number | null
}

export type FileChipsProps = RootProps<'ul', { files: readonly HandedFile[] }>

/** The files a task handed back, a row each: the file's name kept whole, its folder giving way first where the row is narrow. */
export function FileChips({ files, className, ...rest }: FileChipsProps) {
  return (
    <ul className={cx(s.list, className)} {...rest}>
      {files.map((file) => {
        const cut = file.path.lastIndexOf('/') + 1
        return (
          <li key={file.path} className={s.chip}>
            <Icon name="file" size={12} />
            <span className={s.path}>
              {cut > 0 && <span className={s.folder}>{file.path.slice(0, cut)}</span>}
              <span className={s.file}>{file.path.slice(cut)}</span>
            </span>
            {file.add != null && <Delta add={file.add} className={s.delta} />}
          </li>
        )
      })}
    </ul>
  )
}

export interface ThumbsText {
  /** The pictures, as a list, for assistive technology. */
  label: string
  /** One still being made, in its place. */
  making: string
}

export const thumbsText: ThumbsText = { label: 'Pictures', making: 'Being made' }

/** A picture a task handed back: where it is drawn from, small, and what it is called. */
export interface Thumb {
  id: string
  src: string
  name: string
}

export type ThumbsProps = RootProps<
  'ul',
  {
    pictures: readonly Thumb[]
    /** How many more are still being made: each shows as its place. */
    making?: number
    text?: Partial<ThumbsText>
  }
>

/** Pictures a task handed back, small, three to a row; one still being made shows as its place. */
export function Thumbs({ pictures, making = 0, text, className, ...rest }: ThumbsProps) {
  const t = { ...thumbsText, ...text }
  return (
    <ul className={cx(s.thumbs, className)} aria-label={t.label} {...rest}>
      {pictures.map((picture) => (
        <li key={picture.id} className={s.thumb}>
          <img src={picture.src} alt={picture.name} loading="lazy" decoding="async" />
        </li>
      ))}
      {Array.from({ length: making }, (_, i) => (
        <li key={`making-${i}`} className={cx(s.thumb, s.making)}>
          <VisuallyHidden>{t.making}</VisuallyHidden>
        </li>
      ))}
    </ul>
  )
}

export type CommandChipProps = RootProps<'code', { children: string }>

/** The command a permission asks to run, on one line, cut at its end where the card is narrow. */
export function CommandChip({ className, ...rest }: CommandChipProps) {
  return <Code className={cx(s.command, className)} {...rest} />
}

export type FactProps = RootProps<
  'span',
  {
    /** A glyph before it, where one helps: a check for checks that passed, a branch for a conflict. A live fact has its dot instead. */
    icon?: IconName
    /**
     * quiet: a plain fact. ok: something went well, its glyph green. warm: it
     * needs a hand, but nothing is lost, as with a merge conflict. danger:
     * something failed. live: someone else is at it, such as checks still
     * running, with a cobalt dot.
     */
    tone?: 'quiet' | 'ok' | 'warm' | 'danger' | 'live'
    children: ReactNode
  }
>

/** One fact at a card's foot, with a glyph where it helps: checks passed, a conflict, checks still running. */
export function Fact({ icon, tone = 'quiet', children, className, ...rest }: FactProps) {
  return (
    <span className={cx(s.fact, s[tone], className)} {...rest}>
      {tone === 'live' ? <LiveDot /> : icon !== undefined && <Icon name={icon} size={11} />}
      {children}
    </span>
  )
}

export type FactLineProps = RootProps<'span', { children: ReactNode }>

/**
 * Facts said as one line, a middot between them, the most pressing first:
 * “2 commits not on the PR · harness failed”. Where the card is narrow, it
 * wraps between them.
 */
export function FactLine({ children, className, ...rest }: FactLineProps) {
  const facts = Children.toArray(children)
  return (
    <span className={cx(s.factLine, className)} {...rest}>
      {facts.map((fact, i) => (
        <span key={isValidElement(fact) && fact.key !== null ? fact.key : i} className={s.factLinePart}>
          {i > 0 && (
            <span className={s.dot} aria-hidden="true">
              ·
            </span>
          )}
          {fact}
        </span>
      ))}
    </span>
  )
}

export type NextStepProps = RootProps<'span', { children: ReactNode }>

/**
 * The one next thing to do, at the end of a card's foot: Push 3 commits,
 * Accept and merge. Words, not a button: the card is the button, and opens
 * its task, where it is done.
 */
export function NextStep({ children, className, ...rest }: NextStepProps) {
  return (
    <span className={cx(b.go, className)} {...rest}>
      {children}
      <Icon name="arrow" size={11} />
    </span>
  )
}

export interface FindingsText {
  count: (n: number) => string
}

export const findingsText: FindingsText = { count: (n) => (n === 1 ? '1 finding' : `${n} findings`) }

export type FindingsProps = RootProps<
  'span',
  {
    count: number
    /** What they come to, quieter: 1 blocking · request changes. */
    detail?: string
    text?: Partial<FindingsText>
  }
>

/** How many findings a review has, in ink, a little louder than the facts beside it; then what they come to, quieter. */
export function Findings({ count, detail, text, className, ...rest }: FindingsProps) {
  const t = { ...findingsText, ...text }
  return (
    <span className={cx(s.findings, className)} {...rest}>
      <strong className={s.count}>{t.count(count)}</strong>
      {detail !== undefined && <span>{detail}</span>}
    </span>
  )
}
