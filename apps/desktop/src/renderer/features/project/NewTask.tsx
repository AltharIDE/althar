import { useEffect, useId, useRef, useState } from 'react'

import type { AgentStatus, IssueSummary, TaskEnd } from '@althar/contracts'
import {
  Button,
  CheckList,
  Field,
  FieldError,
  LinkButton,
  Select,
  SidePanel,
  SidePanelBody,
  SidePanelTitle,
  taskEndText,
  TaskEnd as End,
} from '@althar/ui'

import { ModelChoice } from '../../shared/ModelChoice'
import type { Choice } from '../../shared/models'
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
  addReview: 'Add a review',
  start: 'Start the task',
  starting: 'Starting…',
  needsTitle: 'Say what the task is.',
  issue: 'From an issue',
  noIssue: 'No issue',
  loadingIssues: 'Your issues…',
  issueOption: (issue: IssueSummary) => `${productName(issue.product)} ${issue.key} · ${issue.title}`,
  end: 'When the work is done',
  repositories: 'Repositories it changes',
}

/** The endings, in the menu's order, with the kit's words. */
const ENDS: ReadonlyArray<{ readonly value: TaskEnd; readonly kit: End }> = [
  { value: 'draft', kit: End.DraftPr },
  { value: 'ready', kit: End.ReadyPr },
  { value: 'none', kit: End.PushOnly },
]

/** What `issue` holds for no issue: the list's values can't be empty. */
const NONE = 'none'

/** An agent on its own model and effort. */
const ownOf = (agentId: string): Choice => ({ agentId, model: null, effort: null })

export function NewTask({
  agents,
  starting,
  connected,
  defaultEnd = null,
  repositories = [],
  listIssues,
  onStart,
  onClose,
}: {
  agents: ReadonlyArray<AgentStatus>
  /** The project's repositories, the first first: with several, the person ticks the ones the task changes. */
  repositories?: ReadonlyArray<string>
  starting: boolean
  /** The repository's host is connected: the task can end with a pull request. */
  connected: boolean
  /** The project's ending, which the choice starts from; a draft pull request without one. */
  defaultEnd?: TaskEnd | null
  listIssues: () => Promise<ReadonlyArray<IssueSummary>>
  onStart: (task: Planned) => void
  onClose: () => void
}) {
  const [issues, setIssues] = useState<ReadonlyArray<IssueSummary> | null>(null)
  const [issue, setIssue] = useState<string>(NONE)
  const [end, setEnd] = useState<TaskEnd>(defaultEnd ?? 'draft')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [lead, setLead] = useState<Choice | null>(null)
  // Undefined until the person picks: another agent than the lead's. Null for no review.
  const [reviewer, setReviewer] = useState<Choice | null | undefined>(undefined)
  const [missing, setMissing] = useState(false)
  // The first repository, until the person ticks others: a task changes at least one.
  const [changes, setChanges] = useState<ReadonlyArray<string>>(repositories.slice(0, 1))
  const titleRef = useRef<HTMLInputElement>(null)
  const ids = { title: useId(), description: useId(), missing: useId() }
  const first = agents[0]
  const chosenLead = lead ?? (first === undefined ? null : ownOf(first.id))
  // By default, another agent reviews what the lead did.
  const other = agents.find((agent) => agent.id !== chosenLead?.agentId)
  const chosenReviewer = reviewer === undefined ? (other === undefined ? null : ownOf(other.id)) : reviewer

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
      reviewer: chosenReviewer,
      issue: issue === NONE ? null : issue,
      end: connected ? end : null,
      repositories: repositories.length > 1 ? changes : null,
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
          {repositories.length > 1 && (
            <>
              <span>{text.repositories}</span>
              <CheckList
                label={text.repositories}
                items={repositories.map((name) => ({ id: name, label: name }))}
                value={changes}
                onChange={setChanges}
                keepOne
              />
            </>
          )}
          {chosenLead !== null && (
            <>
              <span>{text.lead}</span>
              <ModelChoice owner={text.lead} agents={agents} value={chosenLead} onChange={setLead} variant="field" placement="below" />
              <span>{text.review}</span>
              {chosenReviewer === null ? (
                <span>
                  <LinkButton onClick={() => setReviewer(ownOf(other?.id ?? chosenLead.agentId))}>{text.addReview}</LinkButton>
                </span>
              ) : (
                <ModelChoice
                  owner={text.review}
                  agents={agents}
                  value={chosenReviewer}
                  onChange={setReviewer}
                  onRemove={() => setReviewer(null)}
                  variant="field"
                  placement="below"
                  text={{ remove: text.noReview }}
                />
              )}
            </>
          )}
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
