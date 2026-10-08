import { type KeyboardEvent, useId, useState } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Button } from '../../primitives/Button/Button'
import { Field, FieldError } from '../../primitives/Field/Field'
import s from './Conventions.module.css'

/*
 * How a team names its branches and pull requests, and the template its
 * descriptions are written in. Althar follows what each repository's own
 * docs say; the person can set a pattern of their own over them. Both say
 * where what Althar follows comes from, so a repository whose docs say
 * nothing reads as that, not as Althar guessing.
 */

/** One of the project's repositories, and the pattern its docs spell out, with the doc. */
export interface RepositoryNaming {
  id: string
  name: string
  found: { pattern: string; from: string } | null
}

export interface NamingRuleText {
  /** The field's name, for a screen reader: the row around it shows its own. */
  field: string
  /** What a pattern makes: `Makes feature/DEV-42-fix-login`. */
  example: (name: string) => string
  /** Where the repository's pattern comes from. */
  found: (from: string, pattern: string) => string
  /** A repository whose docs say nothing: Althar's own pattern. */
  none: (pattern: string) => string
  /** After either, with the person's own pattern set. */
  overridden: string
  /** Takes the person's pattern back. */
  clear: string
}

export const namingRuleText: NamingRuleText = {
  field: 'Pattern',
  example: (name) => `Makes ${name}`,
  found: (from, pattern) => `${from} says ${pattern}`,
  none: (pattern) => `Its docs don’t say, so Althar’s own, ${pattern}`,
  overridden: 'Yours is used instead.',
  clear: 'Follow the repository',
}

export type NamingRuleProps = RootProps<
  'div',
  {
    /** The person's own pattern; null to follow each repository. */
    value: string | null
    /** A pattern given, on Enter or leaving the field; null when it's emptied or taken back. */
    onChange?: (pattern: string | null) => void
    /** Why the pattern given won't do, beside the field. */
    error?: string | null
    /** What a pattern makes, for an example task. */
    exampleOf: (pattern: string) => string
    /** Althar's own pattern, where a repository says nothing. */
    fallback: string
    /** The project's repositories, in its order; their names are shown where there are several. */
    repositories: readonly RepositoryNaming[]
    text?: Partial<NamingRuleText>
  }
>

/** A pattern for names, the person's own over each repository's, with what it makes and where each repository's comes from. */
export function NamingRule({ value, onChange, error, exampleOf, fallback, repositories, text, className, ...rest }: NamingRuleProps) {
  const t = { ...namingRuleText, ...text }
  const [draft, setDraft] = useState(value ?? '')
  const noteId = useId()
  const errorId = useId()
  // What the person set from elsewhere, or took back, shows in the field.
  const [shownValue, setShownValue] = useState(value)
  if (value !== shownValue) {
    setShownValue(value)
    setDraft(value ?? '')
  }
  const followed = repositories[0]?.found?.pattern ?? fallback
  const shown = draft.trim() === '' ? followed : draft.trim()
  const several = repositories.length > 1
  const commit = () => {
    const pattern = draft.trim()
    if (pattern !== (value ?? '')) onChange?.(pattern === '' ? null : pattern)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') commit()
    if (event.key === 'Escape') setDraft(value ?? '')
  }
  return (
    <div className={cx(s.rule, className)} {...rest}>
      <span className={s.line}>
        <Field
          className={s.pattern}
          aria-label={t.field}
          aria-describedby={[noteId, error ? errorId : ''].filter(Boolean).join(' ')}
          value={draft}
          placeholder={followed}
          invalid={Boolean(error)}
          readOnly={onChange === undefined}
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
        />
        {value !== null && onChange && (
          <Button size="small" variant="quiet" type="button" onClick={() => onChange(null)}>
            {t.clear}
          </Button>
        )}
      </span>
      {error && <FieldError id={errorId}>{error}</FieldError>}
      <span id={noteId} className={s.notes}>
        <span className={s.example}>{t.example(exampleOf(shown))}</span>
        {repositories.map((repository) => (
          <span key={repository.id} className={s.note}>
            {several && <span className={s.name}>{repository.name}</span>}
            {repository.found === null ? t.none(fallback) : t.found(repository.found.from, repository.found.pattern)}
            {value !== null && ` ${t.overridden}`}
          </span>
        ))}
      </span>
    </div>
  )
}

/** One of the project's repositories, and its pull request template, by its path. */
export interface RepositoryTemplate {
  id: string
  name: string
  path: string | null
}

export interface TemplateSourcesText {
  found: (path: string) => string
  none: string
}

export const templateSourcesText: TemplateSourcesText = {
  found: (path) => `${path}, filled in by the lead`,
  none: 'No template, so Althar’s own description',
}

export type TemplateSourcesProps = RootProps<
  'ul',
  {
    /** The project's repositories, in its order; their names are shown where there are several. */
    repositories: readonly RepositoryTemplate[]
    text?: Partial<TemplateSourcesText>
  }
>

/** Which template each repository's pull requests are described in. */
export function TemplateSources({ repositories, text, className, ...rest }: TemplateSourcesProps) {
  const t = { ...templateSourcesText, ...text }
  const several = repositories.length > 1
  return (
    <ul className={cx(s.templates, className)} {...rest}>
      {repositories.map((repository) => (
        <li key={repository.id} className={s.note}>
          {several && <span className={s.name}>{repository.name}</span>}
          {repository.path === null ? t.none : t.found(repository.path)}
        </li>
      ))}
    </ul>
  )
}
