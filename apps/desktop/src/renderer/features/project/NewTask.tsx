import { useEffect, useId, useRef, useState } from 'react'

import type { AgentStatus, IssueSummary, TaskEnd } from '@charrette/contracts'
import { Button, Field, FieldError, Select, SidePanel, SidePanelBody, SidePanelTitle, taskEndText, TaskEnd as End } from '@charrette/ui'

import { productName } from '../../shared/products'

import type { NewTask as Planned } from './useProject'
import s from './Project.module.css'

/*
 * A task the person plans themselves, beside the Talk room: the issue it
 * comes from, if any, what should change, who leads it, who reviews it, and,
 * where the repository's host is connected, what happens when the work is
 * done. It starts at once, and its card shows in the coordinator's thread
 * like any other.
 */

export const text = {
  panel: 'New task',
  title: 'What should change',
  titlePlaceholder: 'Add a retry to the checkout call',
  description: 'Anything the lead should know',
  lead: 'Lead',
  review: 'Review',
  noReview: 'No review',
  start: 'Start the task',
  starting: 'Starting…',
  needsTitle: 'Say what the task is.',
  issue: 'From an issue',
  noIssue: 'No issue',
  loadingIssues: 'Your issues…',
  issueOption: (issue: IssueSummary) => `${productName(issue.product)} ${issue.key} · ${issue.title}`,
  end: 'When the work is done',
}

/** The endings, in the menu's order, with the kit's words. */
const ENDS: ReadonlyArray<{ readonly value: TaskEnd; readonly kit: End }> = [
  { value: 'draft', kit: End.DraftPr },
  { value: 'ready', kit: End.ReadyPr },
  { value: 'none', kit: End.PushOnly },
]

/** What `review` holds for no review: the list's values can't be empty. */
const NONE = 'none'

export function NewTask({
  agents,
  starting,
  connected,
  listIssues,
  onStart,
  onClose,
}: {
  agents: ReadonlyArray<AgentStatus>
  starting: boolean
  /** The repository's host is connected: the task can end with a pull request. */
  connected: boolean
  listIssues: () => Promise<ReadonlyArray<IssueSummary>>
  onStart: (task: Planned) => void
  onClose: () => void
}) {
  const [issues, setIssues] = useState<ReadonlyArray<IssueSummary> | null>(null)
  const [issue, setIssue] = useState<string>(NONE)
  const [end, setEnd] = useState<TaskEnd>('draft')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [lead, setLead] = useState<string | null>(null)
  const [reviewer, setReviewer] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const ids = { title: useId(), description: useId(), missing: useId() }
  const chosenLead = lead ?? agents[0]?.id ?? null
  // By default, another agent reviews what the lead did.
  const chosenReviewer = reviewer ?? agents.find((agent) => agent.id !== chosenLead)?.id ?? NONE
  const options = agents.map((agent) => ({ value: agent.id, label: agent.name }))

  // The person's issues, for a task to come from: read once, when the panel opens.
  useEffect(() => {
    let current = true
    void listIssues().then((found) => {
      if (current) setIssues(found)
    })
    return () => {
      current = false
    }
  }, [listIssues])
  const pickIssue = (ref: string) => {
    const chosen = issues?.find((candidate) => candidate.ref === ref)
    // A title the person hasn't written yet comes from the issue.
    const previous = issues?.find((candidate) => candidate.ref === issue)
    if (chosen !== undefined && (title.trim() === '' || title === previous?.title)) setTitle(chosen.title)
    setIssue(ref)
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    // Say what is missing rather than disable: the button stays pressable.
    if (title.trim() === '') {
      setMissing(true)
      titleRef.current?.focus()
      return
    }
    if (chosenLead === null) return
    onStart({
      title,
      description,
      lead: chosenLead,
      reviewer: chosenReviewer === NONE ? null : chosenReviewer,
      issue: issue === NONE ? null : issue,
      end: connected ? end : null,
    })
  }

  return (
    <SidePanel label={text.panel} head={<SidePanelTitle>{text.panel}</SidePanelTitle>} onClose={onClose}>
      <SidePanelBody>
        <form onSubmit={submit} className={s.form} noValidate>
          {(issues === null || issues.length > 0) && (
            <>
              <span>{text.issue}</span>
              <Select
                label={text.issue}
                variant="filled"
                value={issue}
                placeholder={issues === null ? text.loadingIssues : text.noIssue}
                options={[
                  { value: NONE, label: text.noIssue },
                  ...(issues ?? []).map((candidate) => ({ value: candidate.ref, label: text.issueOption(candidate) })),
                ]}
                onChange={pickIssue}
              />
            </>
          )}
          <label htmlFor={ids.title}>{text.title}</label>
          <Field
            id={ids.title}
            ref={titleRef}
            value={title}
            placeholder={text.titlePlaceholder}
            invalid={missing && title.trim() === ''}
            aria-describedby={missing ? ids.missing : undefined}
            onChange={(event) => {
              setTitle(event.target.value)
              setMissing(false)
            }}
          />
          {missing && title.trim() === '' && <FieldError id={ids.missing}>{text.needsTitle}</FieldError>}
          <label htmlFor={ids.description}>{text.description}</label>
          <textarea
            id={ids.description}
            className={s.description}
            rows={4}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <span>{text.lead}</span>
          <Select label={text.lead} variant="filled" value={chosenLead} options={options} onChange={setLead} />
          <span>{text.review}</span>
          <Select
            label={text.review}
            variant="filled"
            value={chosenReviewer}
            options={[...options, { value: NONE, label: text.noReview }]}
            onChange={setReviewer}
          />
          {connected && (
            <>
              <span>{text.end}</span>
              <Select
                label={text.end}
                variant="filled"
                value={end}
                options={ENDS.map((option) => ({ value: option.value, label: taskEndText[option.kit].title }))}
                onChange={(value) => setEnd(ENDS.find((option) => option.value === value)?.value ?? 'draft')}
              />
            </>
          )}
          <Button type="submit" variant="signal" busy={starting}>
            {starting ? text.starting : text.start}
          </Button>
        </form>
      </SidePanelBody>
    </SidePanel>
  )
}
