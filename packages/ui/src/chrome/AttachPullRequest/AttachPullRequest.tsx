import { useId, useState } from 'react'

import { Button } from '../../primitives/Button/Button'
import { Dialog } from '../../primitives/Dialog/Dialog'
import { Field, FieldError } from '../../primitives/Field/Field'
import s from './AttachPullRequest.module.css'

/*
 * Attaching a task to an open pull request it didn't open: one opened by
 * hand, or upstream from the fork its work goes to. The person gives its
 * link or number; from then on the task follows it, and its work goes to
 * that pull request's branch, with no new one. Where the task's branch isn't
 * based on that pull request's head, a second page says what starting from
 * the head keeps, and nothing changes until it is pressed.
 */

export interface AttachPullRequestText {
  title: string
  description: string
  label: string
  placeholder: string
  /** Sent empty. */
  empty: string
  attach: string
  cancel: string
  /** The second page: the task's branch isn't based on the pull request's head. */
  startTitle: (name: string) => string
  startDescription: (name: string) => string
  /** Where its branch starts, by the pull request's branch. */
  startFrom: (name: string, source: string) => string
  /** What it keeps: its own commits, by how many, on top; or none to lose. */
  keeps: (own: number) => string
  kept: string
  start: string
}

export const attachPullRequestText: AttachPullRequestText = {
  title: 'Attach a pull request',
  description:
    'The task follows an open pull request it didn’t open: what people say on it and its checks come here, and its work goes to that pull request’s branch, with no new one.',
  label: 'Its link or number',
  placeholder: 'https://github.com/owner/repo/pull/123, or #123',
  empty: 'Give the pull request’s link, or its number.',
  attach: 'Attach',
  cancel: 'Cancel',
  startTitle: (name) => `Start from ${name}’s head?`,
  startDescription: (name) => `The task’s branch isn’t based on ${name}’s head, so its work can’t go there as it is.`,
  startFrom: (name, source) => `Its branch starts again from ${name}’s head, on ${source}.`,
  keeps: (own) =>
    own === 0
      ? 'It has no commits of its own, so none is lost.'
      : `Its ${own === 1 ? 'own commit goes' : `${own} own commits go`} on top, one by one.`,
  kept: 'Where it was is kept. If its commits conflict with the head, it stays as it was.',
  start: 'Start from its head',
}

export interface AttachPullRequestProps {
  /** Where the task's branch isn't based on the pull request's head: its name, its branch, and how many commits of its own starting there keeps. */
  start?: { readonly name: string; readonly source: string; readonly own: number }
  /** What the person typed, kept while they look at starting from its head. */
  defaultValue?: string
  /** Attaches it; `start`, the person's word to start the task's branch from its head. */
  onAttach: (pullRequest: string, start: boolean) => void
  /** From starting over, back to the link. */
  onBack?: () => void
  onClose: () => void
  busy?: boolean
  error?: string
  text?: Partial<AttachPullRequestText>
}

export function AttachPullRequest({
  start,
  defaultValue = '',
  onAttach,
  onBack,
  onClose,
  busy = false,
  error,
  text,
}: AttachPullRequestProps) {
  const t = { ...attachPullRequestText, ...text }
  const [value, setValue] = useState(defaultValue)
  const [missing, setMissing] = useState(false)
  const errorId = useId()
  const failed =
    error === undefined ? null : (
      <p className={s.error} role="alert">
        {error}
      </p>
    )
  if (start !== undefined)
    return (
      <Dialog
        title={t.startTitle(start.name)}
        description={t.startDescription(start.name)}
        onClose={onClose}
        {...(onBack === undefined ? {} : { onBack })}
        holding={busy}
        width={460}
        actions={
          <>
            <Button variant="quiet" onClick={onClose}>
              {t.cancel}
            </Button>
            <Button busy={busy} onClick={() => onAttach(value.trim(), true)}>
              {t.start}
            </Button>
          </>
        }
      >
        <ul className={s.list}>
          <li>{t.startFrom(start.name, start.source)}</li>
          <li>{t.keeps(start.own)}</li>
          <li>{t.kept}</li>
        </ul>
        {failed}
      </Dialog>
    )
  return (
    <Dialog
      title={t.title}
      description={t.description}
      onClose={onClose}
      holding={busy}
      width={460}
      onSubmit={() => {
        const asked = value.trim()
        if (asked === '') return setMissing(true)
        onAttach(asked, false)
      }}
      actions={
        <>
          <Button variant="quiet" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button type="submit" busy={busy}>
            {t.attach}
          </Button>
        </>
      }
    >
      <Field
        className={s.field}
        aria-label={t.label}
        placeholder={t.placeholder}
        value={value}
        autoFocus
        invalid={missing}
        {...(missing ? { 'aria-describedby': errorId } : {})}
        onChange={(event) => {
          setValue(event.target.value)
          setMissing(false)
        }}
      />
      {missing && <FieldError id={errorId}>{t.empty}</FieldError>}
      {failed}
    </Dialog>
  )
}
