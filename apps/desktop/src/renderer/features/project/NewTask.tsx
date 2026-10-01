import { useId, useRef, useState } from 'react'

import type { AgentStatus } from '@charrette/contracts'
import { Button, Field, FieldError, Select, SidePanel, SidePanelBody, SidePanelTitle } from '@charrette/ui'

import type { NewTask as Planned } from './useProject'
import s from './Project.module.css'

/*
 * A task the person plans themselves, beside the Talk room: what should
 * change, who leads it, and who reviews it. It starts at once, and its card
 * shows in the coordinator's thread like any other.
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
}

/** What `review` holds for no review: the list's values can't be empty. */
const NONE = 'none'

export function NewTask({
  agents,
  starting,
  onStart,
  onClose,
}: {
  agents: ReadonlyArray<AgentStatus>
  starting: boolean
  onStart: (task: Planned) => void
  onClose: () => void
}) {
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

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    // Say what is missing rather than disable: the button stays pressable.
    if (title.trim() === '') {
      setMissing(true)
      titleRef.current?.focus()
      return
    }
    if (chosenLead === null) return
    onStart({ title, description, lead: chosenLead, reviewer: chosenReviewer === NONE ? null : chosenReviewer })
  }

  return (
    <SidePanel label={text.panel} head={<SidePanelTitle>{text.panel}</SidePanelTitle>} onClose={onClose}>
      <SidePanelBody>
        <form onSubmit={submit} className={s.form} noValidate>
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
          <Button type="submit" variant="signal" busy={starting}>
            {starting ? text.starting : text.start}
          </Button>
        </form>
      </SidePanelBody>
    </SidePanel>
  )
}
