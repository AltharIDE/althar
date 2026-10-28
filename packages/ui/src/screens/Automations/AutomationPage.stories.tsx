import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fireEvent, fn, userEvent, waitFor, within } from 'storybook/test'

import { AutomationCard } from '../../coordinator/AutomationCard/AutomationCard'
import { REVIEW_RUNS } from '../../fixtures/automations'
import { PROJECT } from '../../fixtures/meridian'
import { States } from '../../storybook/States'
import { type AutomationLimit, AutomationPage, type AutomationPageProps } from './AutomationPage'

const WHEN = [
  { value: 'weekdays', label: 'Every weekday at 9:00' },
  { value: 'daily', label: 'Every day at 9:00' },
]
const ENDS = [
  { value: 'none', label: 'Nothing leaves this Mac' },
  { value: 'review', label: 'Review each new pull request' },
]

const card = (
  <AutomationCard
    name="Morning review"
    project={PROJECT}
    prompt="Review the pull requests opened since yesterday by anyone but me."
    stage="kept"
    when={WHEN}
    whenValue="weekdays"
    onWhenChange={() => {}}
    next="tomorrow at 9:00"
    picker={() => 'Claude Opus 5'}
    ends={ENDS}
    endsValue="review"
    onEndsChange={() => {}}
    onPromptChange={() => {}}
  />
)

/** Its limits, as a consumer keeps them. */
function useLimits(review: boolean): readonly AutomationLimit[] {
  const [all, setAll] = useState(true)
  const [posts, setPosts] = useState(false)
  const [stops, setStops] = useState('45')
  return [
    {
      id: 'all',
      kind: 'switch',
      title: 'Allow everything',
      note: 'No ask stops a run. It never pushes to the default branch, and never merges.',
      on: all,
      onChange: setAll,
    },
    ...(review
      ? [
          {
            id: 'posts',
            kind: 'switch' as const,
            title: 'Post its reviews without asking',
            note: 'Off until you say so on its first review. A pull request from outside the team always waits.',
            on: posts,
            onChange: setPosts,
          },
        ]
      : []),
    {
      id: 'stops',
      kind: 'select',
      title: 'Stops after',
      value: stops,
      options: [
        { value: '15', label: '15 minutes' },
        { value: '45', label: '45 minutes' },
        { value: '90', label: '1½ hours' },
      ],
      onChange: setStops,
    },
    {
      id: 'places',
      kind: 'words',
      title: 'Agent places',
      words: 'One at most, after your own work. If its last run is still going, the next is skipped.',
    },
  ]
}

function Page(props: Partial<AutomationPageProps> & { review?: boolean }) {
  const { review = true, ...rest } = props
  const limits = useLimits(review)
  const [on, setOn] = useState(true)
  const [name, setName] = useState(rest.name ?? 'Morning review')
  return (
    <AutomationPage
      status={on ? 'Runs next tomorrow at 9:00' : 'Paused'}
      statusTone={on ? 'on' : 'off'}
      tone={on ? 'quiet' : 'paused'}
      paused={!on}
      proposed={false}
      on={on}
      onSwitch={setOn}
      onRunNow={fn()}
      onRename={setName}
      onDelete={fn()}
      onBack={fn()}
      card={card}
      limits={limits}
      runs={REVIEW_RUNS}
      onOpenRun={fn()}
      {...rest}
      name={name}
      onNameChange={setName}
    />
  )
}

/** A new one, as a consumer keeps it: its name and prompt typed in, and what it lacks said under its field. */
function NewPage(props: Partial<AutomationPageProps> & { prompt?: string }) {
  const { prompt: start = '', ...rest } = props
  const limits = useLimits(true)
  const [name, setName] = useState(rest.name ?? '')
  const [prompt, setPrompt] = useState(start)
  const [missing, setMissing] = useState(false)
  return (
    <AutomationPage
      making
      status="Off until you turn it on"
      statusTone="off"
      tone="quiet"
      paused={false}
      proposed
      on={false}
      onSave={fn()}
      onTurnOn={fn()}
      check={() => {
        setMissing(prompt.trim() === '')
        return prompt.trim() !== ''
      }}
      onBack={fn()}
      card={
        <AutomationCard
          name={name}
          project={PROJECT}
          prompt={prompt}
          stage="kept"
          writing
          promptMissing={missing}
          onPromptChange={(next) => {
            setPrompt(next)
            if (next.trim() !== '') setMissing(false)
          }}
          when={WHEN}
          whenValue="weekdays"
          onWhenChange={() => {}}
          next="tomorrow at 9:00"
          picker={() => 'Claude Opus 5'}
          ends={ENDS}
          endsValue="none"
          onEndsChange={() => {}}
        />
      }
      limits={limits}
      {...rest}
      name={name}
      onNameChange={setName}
    />
  )
}

const meta = {
  title: 'Screens/AutomationPage',
  component: AutomationPage,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div style={{ background: 'var(--n-2)', height: '100vh' }}>
        <Story />
      </div>
    ),
  ],
  args: {
    name: 'Morning review',
    status: 'Runs next tomorrow at 9:00',
    statusTone: 'on',
    tone: 'quiet',
    paused: false,
    proposed: false,
    on: true,
    onBack: fn(),
    card,
    limits: [],
  },
} satisfies Meta<typeof AutomationPage>
export default meta
type Story = StoryObj<typeof meta>

/** The morning review, on: as its page opens. */
export const MorningReview: Story = { render: () => <Page /> }

/** Where it stands and what can be done to it; what it does, its limits, and its runs, each with a task opening it. */
export const On: Story = {
  render: () => <Page />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('heading', { name: 'Morning review' })).toBeInTheDocument()
    await expect(c.getByText('Runs next tomorrow at 9:00')).toBeInTheDocument()
    await expect(c.getByRole('heading', { name: 'What it does' })).toBeInTheDocument()
    await expect(c.getByRole('switch', { name: 'Allow everything' })).toBeChecked()
    await userEvent.click(c.getByRole('switch', { name: 'Post its reviews without asking' }))
    await expect(c.getByRole('switch', { name: 'Post its reviews without asking' })).toBeChecked()
    await expect(c.getByText(/One at most, after your own work/)).toBeInTheDocument()
    // A run with a task opens it; one without is only its line.
    await expect(c.getByRole('button', { name: /Review #264/ })).toBeInTheDocument()
    await expect(c.queryByRole('button', { name: /No new pull requests/ })).toBeNull()
    await userEvent.click(c.getByRole('switch', { name: 'On' }))
    await expect(c.getByText('Paused')).toBeInTheDocument()
  },
}

/** Rename in place: Enter keeps it, Escape leaves it, and focus comes back to its name. */
export const Renaming: Story = {
  render: () => <Page />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'More' }))
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: 'Rename' }))
    const field = await c.findByRole('textbox', { name: 'Name' })
    await waitFor(() => expect(field).toHaveFocus())
    await userEvent.clear(field)
    await userEvent.type(field, 'Review of the morning{Enter}')
    await expect(c.getByRole('heading', { name: 'Review of the morning' })).toBeInTheDocument()
    await waitFor(() => expect(c.getByRole('heading', { name: 'Review of the morning' })).toHaveFocus())
    await userEvent.click(c.getByRole('button', { name: 'More' }))
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: 'Rename' }))
    await userEvent.type(await c.findByRole('textbox', { name: 'Name' }), ' again')
    await userEvent.keyboard('{Escape}')
    await expect(c.getByRole('heading', { name: 'Review of the morning' })).toBeInTheDocument()
  },
}

/** Delete asks first. */
export const Deleting: Story = {
  args: { onDelete: fn(), onRename: fn() },
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'More' }))
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: 'Delete…' }))
    const dialog = within(await within(document.body).findByRole('dialog', { name: 'Delete Morning review?' }))
    await expect(dialog.getByText('Nothing of it starts again. The tasks its runs made stay.')).toBeInTheDocument()
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
    await expect(args.onDelete).not.toHaveBeenCalled()
    await userEvent.click(c.getByRole('button', { name: 'More' }))
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: 'Delete…' }))
    await userEvent.click(within(await within(document.body).findByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await expect(args.onDelete).toHaveBeenCalled()
  },
}

/** Paused itself: a violet band says why, with Run it now and Turn it back on. */
export const PausedItself: Story = {
  args: {
    name: 'Sunday end-to-end',
    status: 'Paused itself',
    statusTone: 'yours',
    tone: 'yours',
    paused: true,
    on: false,
    pausedItself: 'Failed three Sundays running: its end-to-end run stops when the Mac sleeps.',
    onRunNow: fn(),
    onSwitch: fn(),
    runs: [],
  },
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await expect(c.getByText('It paused itself.')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Turn it back on' }))
    await expect(args.onSwitch).toHaveBeenCalledWith(true)
    await userEvent.click(c.getByRole('button', { name: 'Run it now' }))
    await expect(args.onRunNow).toHaveBeenCalled()
    await expect(c.getByText('No runs yet.')).toBeInTheDocument()
  },
}

/** Saved, not turned on yet: try it once, or turn it on. */
export const Proposed: Story = {
  args: { proposed: true, on: false, status: 'Off until you turn it on', statusTone: 'off', onTryOnce: fn(), onTurnOn: fn(), runs: [] },
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await expect(c.queryByRole('switch', { name: 'On' })).toBeNull()
    await userEvent.click(c.getByRole('button', { name: 'Try it once now' }))
    await expect(args.onTryOnce).toHaveBeenCalled()
    await userEvent.click(c.getByRole('button', { name: 'Turn on' }))
    await expect(args.onTurnOn).toHaveBeenCalled()
  },
}

/** A new one, not saved: Save keeps it off, Turn on saves it on. Nothing to try, rename or delete until it is saved; no runs yet to show. */
export const New: Story = {
  render: () => <NewPage name="Weekly polish" prompt="Tidy the changelog, and say what you changed." onSave={fn()} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.queryByRole('heading', { name: 'Runs' })).toBeNull()
    await expect(c.getByText('Say it as you would to the coordinator.')).toBeInTheDocument()
    await expect(c.queryByRole('button', { name: 'Try it once now' })).toBeNull()
    await expect(c.queryByRole('switch', { name: 'On' })).toBeNull()
    await expect(c.queryByRole('button', { name: 'More' })).toBeNull()
    await expect(c.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    await expect(c.getByRole('button', { name: 'Turn on' })).toBeInTheDocument()
  },
}

/** Save with nothing typed: each field says what it lacks under itself, pointed at by it, and the first of them takes focus; filled in, it goes. */
export const InvalidPrompt: Story = {
  render: () => <NewPage />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const name = c.getByRole('textbox', { name: 'Name' })
    const prompt = c.getByRole('textbox', { name: 'What each run is asked' })
    await userEvent.click(c.getByRole('button', { name: 'Save' }))
    await expect(name).toHaveAttribute('aria-invalid', 'true')
    await expect(name).toHaveAccessibleDescription('Give it a name first')
    await expect(prompt).toHaveAttribute('aria-invalid', 'true')
    await expect(prompt).toHaveAccessibleDescription('Say what each run should do first.')
    await waitFor(() => expect(name).toHaveFocus())
    await userEvent.type(name, 'Weekly polish')
    await expect(c.queryByText('Give it a name first')).toBeNull()
    await userEvent.click(c.getByRole('button', { name: 'Turn on' }))
    await waitFor(() => expect(prompt).toHaveFocus())
    await expect(c.getByText('Say what each run should do first.')).toBeInTheDocument()
  },
}

/** A long form, scrolled: the bar with the way back, Save and Turn on stays at the top, a line under it as the page passes beneath. */
export const LongFormScrolled: Story = {
  render: () => <NewPage id="automation-page" name="Weekly polish" prompt="Tidy the changelog, and say what you changed." />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const page = canvasElement.querySelector<HTMLElement>('#automation-page')
    const bar = page?.querySelector('[data-scrolled]') ?? null
    await expect(bar).toBeNull()
    if (page !== null) fireEvent.scroll(page, { target: { scrollTop: 10_000 } })
    await waitFor(() => expect(page?.querySelector('[data-scrolled]')).not.toBeNull())
    await expect(c.getByRole('button', { name: 'Turn on' })).toBeVisible()
    await expect(c.getByRole('button', { name: 'Save' })).toBeVisible()
  },
}

/** What went wrong with the last thing asked of it, under its head. */
export const Failed: Story = { args: { error: 'Althar couldn’t turn it on. Try again.' } }

export const AllStates: Story = {
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'on', node: <AutomationPage {...args} runs={REVIEW_RUNS} onOpenRun={() => {}} /> },
        {
          state: 'paused itself',
          node: (
            <AutomationPage
              {...args}
              status="Paused itself"
              statusTone="yours"
              tone="yours"
              paused
              pausedItself="Failed three times in a row."
              onSwitch={() => {}}
            />
          ),
        },
        {
          state: 'proposed',
          node: <AutomationPage {...args} proposed status="Off until you turn it on" statusTone="off" onTurnOn={() => {}} />,
        },
        {
          state: 'new',
          node: (
            <AutomationPage
              {...args}
              name=""
              making
              proposed
              status="Off until you turn it on"
              statusTone="off"
              onSave={() => {}}
              onTurnOn={() => {}}
            />
          ),
        },
        { state: 'busy', node: <AutomationPage {...args} proposed onTurnOn={() => {}} busy /> },
      ]}
    />
  ),
}
