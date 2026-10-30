import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { ModelPick } from '../../composer/ModelPick/ModelPick'
import { PROJECT } from '../../fixtures/meridian'
import { CODEX, effortFor, model, OPUS, useModelPrefs } from '../../fixtures/models'
import type { ModelInfo } from '../../primitives/Model/Model'
import { States } from '../../storybook/States'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { Turn } from '../../thread/Turn/Turn'
import { You } from '../../thread/You/You'
import {
  AutomationAsk,
  AutomationCard,
  type AutomationCardProps,
  AutomationNote,
  type AutomationPick,
  type AutomationTime,
} from './AutomationCard'

const WHEN = [
  { value: 'weekdays', label: 'Every weekday at 9:00' },
  { value: 'daily', label: 'Every day at 9:00' },
  { value: 'monday', label: 'Every Monday at 9:00' },
  { value: 'friday', label: 'Every Friday at 16:00' },
  { value: 'nightly', label: 'Every night at 2:00' },
  { value: 'hourly', label: 'Every hour' },
]

const ENDS = [
  { value: 'none', label: 'Nothing leaves this Mac' },
  { value: 'draft', label: 'Open a draft pull request' },
  { value: 'ready', label: 'Open a pull request, ready for review' },
  { value: 'review', label: 'Review each new pull request' },
]

const LIMITS = [
  ['Allow everything', 'On. No ask stops a run; it never pushes to the default branch, and never merges.'],
  ['Stops after', '45 minutes'],
  ['If the Mac is asleep', 'Runs once when it’s back, if it’s not too late'],
  ['Agent places', 'One at most, after your own work.'],
  ['If it fails', 'After three failures in a row it pauses itself and says why.'],
] as const

const PROMPT = 'Bump the dependencies that have a patch or minor release, run the tests, and open a pull request if they pass.'

/** The consumer's picker: the composer's own, bordered, for the lead or the reviewer. */
function usePicker() {
  const prefs = useModelPrefs()
  const [picked, setPicked] = useState<Record<AutomationPick['role'], ModelInfo>>({ lead: OPUS, review: CODEX })
  const [efforts, setEfforts] = useState<Record<string, string>>({})
  return ({ role, owner }: AutomationPick) => {
    const agent = picked[role]
    return (
      <ModelPick
        variant="field"
        placement="below"
        owner={owner}
        model={agent}
        pinned={prefs.pinned}
        effort={efforts[role] ?? effortFor(agent, prefs.efforts)}
        defaultEffort={effortFor(agent, prefs.efforts)}
        onChange={(id) => setPicked({ ...picked, [role]: model(id) })}
        onEffort={(level) => setEfforts({ ...efforts, [role]: level })}
      />
    )
  }
}

/** A card wired as a consumer would: its choices kept here, as the runtime would keep them. */
function Card(props: Partial<AutomationCardProps>) {
  const picker = usePicker()
  const [when, setWhen] = useState(props.whenValue ?? 'nightly')
  const [ends, setEnds] = useState(props.endsValue ?? 'draft')
  const [reviewOn, setReviewOn] = useState(props.review?.on ?? false)
  const [prompt, setPrompt] = useState(props.prompt ?? PROMPT)
  const [time, setTime] = useState<AutomationTime>({ days: [1, 2, 3, 4, 5], at: '09:00' })
  const own = WHEN.some((option) => option.value === when)
    ? WHEN
    : [...WHEN, { value: when, label: `Every ${time.days.length} days at ${time.at}` }]
  return (
    <AutomationCard
      name="Nightly bump"
      project={PROJECT}
      stage="proposed"
      when={own}
      next="tonight at 2:00"
      time={time}
      onTimeChange={(chosen) => {
        setTime(chosen)
        setWhen('own')
      }}
      ends={ENDS}
      limits={LIMITS}
      picker={picker}
      onTryOnce={fn()}
      onTurnOn={fn()}
      {...props}
      prompt={prompt}
      whenValue={when}
      onWhenChange={props.onWhenChange === undefined ? setWhen : props.onWhenChange}
      endsValue={ends}
      onEndsChange={setEnds}
      {...(ends === 'review'
        ? { review: undefined }
        : {
            review: {
              on: reviewOn,
              onAdd: () => setReviewOn(true),
              onSkip: () => setReviewOn(false),
              ...(props.review?.was === undefined ? {} : { was: props.review.was }),
            },
          })}
      {...(props.onPromptChange === undefined ? {} : { onPromptChange: setPrompt })}
    />
  )
}

const meta = {
  title: 'Coordinator/AutomationCard',
  component: AutomationCard,
  decorators: [threadDecorator],
  args: {
    name: 'Nightly bump',
    project: PROJECT,
    prompt: PROMPT,
    stage: 'proposed',
    when: WHEN,
    whenValue: 'nightly',
    ends: ENDS,
    endsValue: 'draft',
    picker: () => 'Claude Opus 5',
  },
} satisfies Meta<typeof AutomationCard>
export default meta
type Story = StoryObj<typeof meta>

/** Proposed in the conversation: nothing runs until you turn it on. Change who leads it, when it runs, what it ends in; try it once first. */
export const Proposed: Story = {
  render: () => <Card />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Automation · Meridian')).toBeInTheDocument()
    await expect(c.getByText('Nightly bump')).toBeInTheDocument()
    await expect(c.getByText('next tonight at 2:00')).toBeInTheDocument()
    await expect(c.getByText('Off', { exact: true })).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: /Every night at 2:00/ }))
    await userEvent.click(await within(document.body).findByRole('menuitemradio', { name: 'Every weekday at 9:00' }))
    await waitFor(() => expect(c.getByRole('button', { name: /Every weekday at 9:00/ })).toBeInTheDocument())
    // A reviewer, added and skipped.
    await expect(c.getByText('None')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Add a reviewer' }))
    await expect(c.getByRole('button', { name: /Reviewer for each run/ })).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Skip' }))
    await expect(c.getByText('None')).toBeInTheDocument()
    await expect(c.getByRole('button', { name: 'Try it once now' })).toBeInTheDocument()
    await expect(c.getByRole('button', { name: 'Turn on' })).toBeInTheDocument()
  },
}

/** Its limits fold out of its foot, and fold away again. */
export const ItsLimits: Story = {
  render: () => <Card />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Its limits' }))
    await expect(c.getByText('45 minutes')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Hide its limits' }))
    await expect(c.queryByText('45 minutes')).toBeNull()
  },
}

/** A review of each new pull request is itself a review: no reviewer row. */
export const ReviewWork: Story = {
  render: () => <Card endsValue="review" name="Morning review" prompt="Review the pull requests opened since yesterday." />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.queryByText('Review', { selector: 'span' })).toBeNull()
    await expect(c.getByRole('button', { name: /Review each new pull request/ })).toBeInTheDocument()
  },
}

/** Another time…: days and a time of your own, in place under When; with no day picked it says so. Escape leaves it as it was. */
export const AnotherTime: Story = {
  render: () => <Card />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: /Every night at 2:00/ }))
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: 'Another time…' }))
    const days = await c.findByRole('group', { name: 'Days' })
    await waitFor(() => expect(within(days).getByRole('button', { name: 'Monday' })).toHaveFocus())
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'])
      await userEvent.click(within(days).getByRole('button', { name: day }))
    await userEvent.click(c.getByRole('button', { name: 'Done' }))
    await expect(c.getByText('Pick a day first')).toBeInTheDocument()
    await userEvent.click(within(days).getByRole('button', { name: 'Saturday' }))
    await expect(within(days).getByRole('button', { name: 'Saturday' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.clear(c.getByLabelText('Time'))
    await userEvent.type(c.getByLabelText('Time'), '07:30')
    await userEvent.click(c.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(c.getByRole('button', { name: /Every 1 days at 07:30/ })).toBeInTheDocument())
    // Opened again and left with Escape, nothing changes.
    await userEvent.click(c.getByRole('button', { name: /Every 1 days at 07:30/ }))
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: 'Another time…' }))
    await c.findByRole('group', { name: 'Days' })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(c.queryByRole('group', { name: 'Days' })).toBeNull())
    await userEvent.click(c.getByRole('button', { name: /Every 1 days at 07:30/ }))
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: 'Another time…' }))
    await userEvent.click(await c.findByRole('button', { name: 'Cancel' }))
    await expect(c.queryByRole('group', { name: 'Days' })).toBeNull()
  },
}

/** What the coordinator changed, while it is on: the old values struck through; it holds from its next run, or is undone. */
export const Changed: Story = {
  args: { onUndo: fn(), onOpen: fn() },
  render: (args) => (
    <AutomationCard
      {...args}
      stage="changed"
      holds
      next="Sunday at 3:00"
      when={[...WHEN, { value: 'sunday', label: 'Every Sunday at 3:00' }]}
      whenValue="sunday"
      whenWas="Every night at 2:00"
      endsValue="ready"
      endsWas="Open a draft pull request"
      picker={() => 'Claude Opus 5'}
      review={{ on: false }}
      limits={LIMITS}
    />
  ),
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Automation, changed · Meridian')).toBeInTheDocument()
    await expect(c.getByText('Every Sunday at 3:00')).toBeInTheDocument()
    await expect(c.getByText('Every night at 2:00').closest('s')).not.toBeNull()
    await expect(c.getByText('Holds from its next run, Sunday at 3:00.')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Undo' }))
    await expect(args.onUndo).toHaveBeenCalled()
    await userEvent.click(c.getByRole('button', { name: 'Open in Automations' }))
    await expect(args.onOpen).toHaveBeenCalled()
    await expect(c.queryByRole('button', { name: 'Turn on' })).toBeNull()
  },
}

/** A change it didn't make needs turning on again: Undo, or Turn on. */
export const ChangedNeedsTurningOn: Story = {
  args: { onUndo: fn(), onTurnOn: fn() },
  render: (args) => (
    <AutomationCard
      {...args}
      stage="changed"
      prompt="Bump every dependency, majors too, and open a pull request ready for review."
      leadWas="Claude Sonnet 5"
      picker={() => 'Claude Opus 5'}
      review={{ on: true, was: 'None' }}
    />
  ),
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Off', { exact: true })).toBeInTheDocument()
    await expect(c.getByText('Every night at 2:00', { selector: 'span' })).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Turn on' }))
    await expect(args.onTurnOn).toHaveBeenCalled()
    await expect(c.queryByRole('button', { name: 'Its limits' })).toBeNull()
  },
}

/** On its own page: no kicker and no name, its prompt its head, changed with Edit and Done. */
export const Kept: Story = {
  render: () => <Card stage="kept" onPromptChange={() => {}} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.queryByText('Automation · Meridian')).toBeNull()
    await expect(c.queryByRole('button', { name: 'Turn on' })).toBeNull()
    await userEvent.click(c.getByRole('button', { name: 'Edit' }))
    const field = c.getByRole('textbox', { name: 'What each run is asked' })
    await expect(field).toHaveFocus()
    await userEvent.clear(field)
    await userEvent.type(field, 'Bump the patch releases only.')
    await userEvent.click(c.getByRole('button', { name: 'Done' }))
    await expect(c.getByText(/Bump the patch releases only\./)).toBeInTheDocument()
    await waitFor(() => expect(c.getByRole('button', { name: 'Edit' })).toHaveFocus())
    // Escape leaves the words as they were.
    await userEvent.click(c.getByRole('button', { name: 'Edit' }))
    await userEvent.type(c.getByRole('textbox', { name: 'What each run is asked' }), ' And majors.')
    await userEvent.keyboard('{Escape}')
    await expect(c.queryByText(/And majors/)).toBeNull()
  },
}

/** Done on a prompt left blank keeps the field open, saying under it what it needs; typing clears it. */
export const KeptBlank: Story = {
  render: () => <Card stage="kept" onPromptChange={() => {}} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Edit' }))
    const field = c.getByRole('textbox', { name: 'What each run is asked' })
    await userEvent.clear(field)
    await userEvent.click(c.getByRole('button', { name: 'Done' }))
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    await expect(field).toHaveAccessibleDescription('Say what each run should do first.')
    await expect(field).toHaveFocus()
    await userEvent.type(field, 'Bump the patch releases only.')
    await expect(c.queryByText('Say what each run should do first.')).toBeNull()
  },
}

/** A new one, saved or turned on with nothing typed: what it needs is said under its field. */
export const WritingMissing: Story = {
  render: () => <Card stage="kept" prompt="" writing promptMissing onPromptChange={() => {}} />,
  play: async ({ canvasElement }) => {
    const field = within(canvasElement).getByRole('textbox', { name: 'What each run is asked' })
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    await expect(field).toHaveAccessibleDescription('Say what each run should do first.')
  },
}

/** A new one: the prompt is ready to type, each change kept at once. */
export const Writing: Story = {
  render: () => <Card stage="kept" prompt="" writing onPromptChange={() => {}} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const field = c.getByRole('textbox', { name: 'What each run is asked' })
    await waitFor(() => expect(field).toHaveFocus())
    await userEvent.type(field, 'Tidy the changelog')
    await expect(field).toHaveValue('Tidy the changelog')
  },
}

/** Where nothing can be changed, each row says its value. */
export const ReadOnly: Story = {
  args: { stage: 'changed', holds: true },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Every night at 2:00')).toBeInTheDocument()
    await expect(c.queryByRole('button', { name: /Every night/ })).toBeNull()
    await expect(c.getByText('Holds from its next run.')).toBeInTheDocument()
  },
}

/** Once it is on, the conversation folds it to a line; paused, it offers Turn on; deleted, it says so. */
export const Folded: Story = {
  render: () => (
    <>
      <AutomationNote name="Morning review" state="on" next="tomorrow at 9:00" onOpen={fn()} onTurnOff={fn()} />
      <AutomationNote name="Nightly bump" state="paused" onOpen={fn()} onTurnOn={fn()} />
      <AutomationNote name="Weekly polish" state="deleted" onOpen={fn()} />
      <AutomationNote name="Flaky sweep" state="on" />
    </>
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('is on. It runs next tomorrow at 9:00.')).toBeInTheDocument()
    await expect(c.getByText('is paused.')).toBeInTheDocument()
    await expect(c.getByText('was deleted.')).toBeInTheDocument()
    await expect(c.getByText('is on.')).toBeInTheDocument()
    await expect(c.getAllByRole('button', { name: 'Open in Automations' })).toHaveLength(2)
    await expect(c.getByRole('button', { name: 'Turn off' })).toBeInTheDocument()
    await expect(c.getByRole('button', { name: 'Turn on' })).toBeInTheDocument()
  },
}

/** The coordinator asks to resume one: one button, and once said, a line, focus on it. */
function Asking({ ask }: { ask: 'resume' | 'run' }) {
  const [done, setDone] = useState(false)
  return (
    <AutomationAsk
      name="Morning review"
      project={PROJECT}
      ask={ask}
      schedule="Every weekday at 9:00"
      done={done}
      onAnswer={() => setDone(true)}
    />
  )
}

export const AsksToResume: Story = {
  render: () => <Asking ask="resume" />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText(/Resume/, { selector: 'p' })).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Resume' }))
    await expect(c.getByText('Resumed.')).toBeInTheDocument()
    await waitFor(() => expect(c.getByText('Resumed.').parentElement).toHaveFocus())
  },
}

export const AsksToRunNow: Story = {
  render: () => <Asking ask="run" />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Run now' }))
    await expect(c.getByText('Started a run.')).toBeInTheDocument()
    await expect(c.getByText('Morning review · Every weekday at 9:00')).toBeInTheDocument()
  },
}

/** Where a proposal comes from: what you asked, the coordinator's words, then its card. */
export const InTheConversation: Story = {
  render: () => (
    <>
      <You at="9:02">every night, bump the dependencies and open a draft pull request if the tests pass</You>
      <Turn voice="Claude Code" at="9:02">
        Here it is. It runs at 2:00, while you sleep, and opens a draft only when the tests pass.
      </Turn>
      <Card />
    </>
  ),
}

export const AllStates: Story = {
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'proposed', node: <AutomationCard {...args} picker={() => 'Claude Opus 5'} onTurnOn={() => {}} onTryOnce={() => {}} /> },
        { state: 'turning on', node: <AutomationCard {...args} picker={() => 'Claude Opus 5'} onTurnOn={() => {}} busy /> },
        {
          state: 'changed, on',
          node: (
            <AutomationCard
              {...args}
              stage="changed"
              holds
              next="Sunday at 3:00"
              endsWas="Nothing leaves this Mac"
              picker={() => 'Claude Opus 5'}
              onUndo={() => {}}
              onOpen={() => {}}
            />
          ),
        },
        {
          state: 'changed, to turn on again',
          node: <AutomationCard {...args} stage="changed" leadWas="Claude Sonnet 5" picker={() => 'Claude Opus 5'} onUndo={() => {}} />,
        },
        {
          state: 'kept, on its page',
          node: <AutomationCard {...args} stage="kept" picker={() => 'Claude Opus 5'} onPromptChange={() => {}} />,
        },
        { state: 'no prompt yet', node: <AutomationCard {...args} stage="kept" prompt="" picker={() => 'Claude Opus 5'} /> },
        {
          state: 'on, folded',
          node: <AutomationNote name="Morning review" state="on" next="tomorrow at 9:00" onOpen={() => {}} onTurnOff={() => {}} />,
        },
        { state: 'paused, folded', node: <AutomationNote name="Morning review" state="paused" onTurnOn={() => {}} /> },
        { state: 'deleted', node: <AutomationNote name="Morning review" state="deleted" /> },
        {
          state: 'asks to resume',
          node: (
            <AutomationAsk
              name="Morning review"
              project={PROJECT}
              ask="resume"
              schedule="Every weekday at 9:00"
              done={false}
              onAnswer={() => {}}
            />
          ),
        },
        {
          state: 'asked to run, done',
          node: <AutomationAsk name="Morning review" project={PROJECT} ask="run" schedule="Every weekday at 9:00" done />,
        },
      ]}
    />
  ),
}
