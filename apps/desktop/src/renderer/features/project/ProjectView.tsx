import { useId, useRef, useState } from 'react'

import type { TaskSummary } from '@charrette/contracts'
import { BackCrumb, Button, Field, FieldError, Heading, Select, Spinner, TitleBar } from '@charrette/ui'

import s from './Project.module.css'
import type { ProjectModel } from './useProject'

/*
 * A project: its tasks, and starting a new one. A task gets a worktree of its
 * own, and its lead starts on it from a brief.
 */

export const text = {
  back: 'Projects',
  tasks: 'Tasks',
  none: 'No tasks yet.',
  newTask: 'New task',
  title: 'What should change',
  titlePlaceholder: 'Add a retry to the checkout call',
  description: 'Anything the lead should know',
  lead: 'Lead',
  start: 'Start the task',
  starting: 'Starting…',
  needsTitle: 'Say what the task is.',
  needsAgent: 'No agent is signed in. Sign one in with its own tool, then come back.',
  working: (agent: string) => `${agent} is working`,
  waiting: (n: number) => (n === 1 ? '1 call waits on you' : `${n} calls wait on you`),
}

function TaskRow({ task, agentName, onOpen }: { task: TaskSummary; agentName: (id: string) => string; onOpen: () => void }) {
  const notes = [
    ...(task.agentId === null ? [] : [text.working(agentName(task.agentId))]),
    ...(task.waiting > 0 ? [text.waiting(task.waiting)] : []),
  ]
  return (
    <li>
      <button type="button" className={s.task} onClick={onOpen}>
        <span className={s.title}>{task.title}</span>
        <span className={s.branch}>{task.branch}</span>
        <span className={s.notes}>{notes.join(' · ')}</span>
      </button>
    </li>
  )
}

export function ProjectView({ model, onBack, onTask }: { model: ProjectModel; onBack: () => void; onTask: (threadId: string) => void }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [agentId, setAgentId] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const ids = { title: useId(), description: useId(), lead: useId(), missing: useId() }
  const lead = agentId ?? model.agents[0]?.id ?? null
  const agentName = (id: string) => model.agents.find((agent) => agent.id === id)?.name ?? id

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    // Say what is missing rather than disable: the button stays pressable.
    if (title.trim() === '') {
      setMissing(true)
      titleRef.current?.focus()
      return
    }
    if (lead === null) return
    void model.startTask({ title, description, agentId: lead }).then((task) => {
      if (task !== null) onTask(task.threadId)
    })
  }

  return (
    <div className={s.window}>
      <TitleBar>
        <BackCrumb to={text.back} onBack={onBack} {...(model.project === null ? {} : { title: model.project.name })} />
      </TitleBar>
      <main className={`${s.scroll} ${s.project}`}>
        <section aria-labelledby="tasks">
          <Heading level={1} id="tasks">
            {model.project?.name ?? text.tasks}
          </Heading>
          {model.project?.repository && <p className={s.repository}>{model.project.repository}</p>}
          {model.tasks === null ? (
            <Spinner />
          ) : model.tasks.length === 0 ? (
            <p className={s.quiet}>{text.none}</p>
          ) : (
            <ul className={s.tasks}>
              {model.tasks.map((task) => (
                <TaskRow key={task.id} task={task} agentName={agentName} onOpen={() => onTask(task.threadId)} />
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="new-task" className={s.new}>
          <Heading level={2} id="new-task">
            {text.newTask}
          </Heading>
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
            {model.agents.length === 0 ? (
              <p className={s.quiet}>{text.needsAgent}</p>
            ) : (
              <>
                <span id={ids.lead}>{text.lead}</span>
                <Select
                  label={text.lead}
                  variant="filled"
                  value={lead}
                  options={model.agents.map((agent) => ({ value: agent.id, label: agent.name }))}
                  onChange={setAgentId}
                />
                <Button type="submit" variant="signal" busy={model.starting}>
                  {model.starting ? text.starting : text.start}
                </Button>
              </>
            )}
            {model.error !== null && (
              <p className={s.error} role="alert">
                {model.error}
              </p>
            )}
          </form>
        </section>
      </main>
    </div>
  )
}
