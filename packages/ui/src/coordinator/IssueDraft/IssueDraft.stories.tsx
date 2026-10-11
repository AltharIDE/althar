import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { DRAFT_GITHUB, DRAFT_JIRA, DRAFT_LINEAR, DRAFT_LONG, FILED_LINEAR } from '../../fixtures/coordinator'
import { IssueDraftState } from '../../foundations/vocabulary'
import { States, statesOn } from '../../storybook/States'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { Turn } from '../../thread/Turn/Turn'
import { IssueDraft, type IssueDraftEdit, type IssueDraftProps } from './IssueDraft'

const meta = {
  title: 'Coordinator/IssueDraft',
  component: IssueDraft,
  decorators: [threadDecorator],
  args: { ...DRAFT_LINEAR, state: IssueDraftState.Pending, onFile: fn(), onChange: fn(), onDiscard: fn() },
} satisfies Meta<typeof IssueDraft>
export default meta
type Story = StoryObj<typeof meta>

/** A draft on Linear, waiting on you: nothing reaches the tracker until you file it. */
export const Pending: Story = {
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('article', { name: /Issue draft · Linear · Meridian/ })).toBeInTheDocument()
    await expect(c.getByRole('heading', { level: 3, name: DRAFT_LINEAR.title })).toBeInTheDocument()
    await expect(c.getByText('Labels: refunds, webhooks, bug')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'File issue' }))
    await expect(args.onFile).toHaveBeenCalled()
  },
}

/** Any other tracker, with no labels. */
export const PendingOnJira: Story = { args: DRAFT_JIRA }

/** A repository's issues, with no body: only its title and its label. */
export const PendingOnGitHub: Story = { args: DRAFT_GITHUB }

/** A long body shows its first lines until asked for. */
export const LongBody: Story = {
  args: DRAFT_LONG,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const more = c.getByRole('button', { name: 'Show all' })
    await expect(more).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(more)
    await expect(c.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true')
  },
}

/** Being filed: File shows it, and there is nothing to change or throw away meanwhile. */
export const Filing: Story = {
  args: { state: IssueDraftState.Filing },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('button', { name: 'File issue' })).toHaveAttribute('aria-busy', 'true')
    await expect(c.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    await expect(c.queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument()
  },
}

/** The tracker turned it down: the card says why, and it can be filed again. */
export const Failed: Story = {
  args: { state: IssueDraftState.Failed, error: 'Linear says the team Meridian no longer takes issues from this account.' },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText(/Couldn’t file it on Linear\. Linear says the team/)).toBeInTheDocument()
    await expect(c.getByRole('button', { name: 'File again' })).toBeInTheDocument()
    await expect(c.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  },
}

/** Filed: one line with the issue's key, linked. */
export const Filed: Story = {
  args: { state: IssueDraftState.Filed, issue: FILED_LINEAR },
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole('link', { name: /MER-244/ })
    await expect(link).toHaveAttribute('href', FILED_LINEAR.href)
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(within(canvasElement).queryByRole('button')).not.toBeInTheDocument()
  },
}

/** Filed where the tracker gave no address to open: the key, as text. */
export const FiledWithoutALink: Story = {
  args: { state: IssueDraftState.Filed, issue: { key: 'MER-244', href: 'linear://issue/MER-244' } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('link')).not.toBeInTheDocument()
    await expect(within(canvasElement).getByText('MER-244')).toBeInTheDocument()
  },
}

/** Thrown away: a quiet line, its title struck through. */
export const Discarded: Story = { args: { state: IssueDraftState.Discarded } }

/** Where the consumer gives no callbacks, there are no buttons. */
export const WithoutActions: Story = {
  args: { onFile: undefined, onChange: undefined, onDiscard: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button')).not.toBeInTheDocument()
  },
}

/** Edit turns the card into a form, with focus in its title. */
export const Editing: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Edit' }))
    await expect(c.getByRole('form', { name: 'Edit the issue draft' })).toBeInTheDocument()
    await expect(c.getByRole('textbox', { name: 'Title' })).toHaveFocus()
    await expect(c.getByRole('textbox', { name: 'Description' })).toHaveValue(DRAFT_LINEAR.body)
    await expect(c.getByRole('textbox', { name: 'Labels' })).toHaveValue('refunds, webhooks, bug')
  },
}

/** Saved without a title, it says so beside the title and puts focus there. */
export const SavedWithoutATitle: Story = {
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Edit' }))
    const title = c.getByRole('textbox', { name: 'Title' })
    await userEvent.clear(title)
    await userEvent.click(c.getByRole('button', { name: 'Save' }))
    await expect(title).toHaveAccessibleDescription('Give it a title first')
    await expect(title).toHaveFocus()
    await expect(args.onChange).not.toHaveBeenCalled()
    await userEvent.type(title, 'Retry-After')
    await expect(c.queryByText('Give it a title first')).not.toBeInTheDocument()
  },
}

/** The consumer that keeps the draft, and how long its save takes. */
function Kept({ onSaved, ...props }: Omit<IssueDraftProps, 'onChange'> & { onSaved?: (edit: IssueDraftEdit) => void }) {
  const [draft, setDraft] = useState({ title: props.title, body: props.body, labels: props.labels })
  const [saving, setSaving] = useState(false)
  return (
    <IssueDraft
      {...props}
      {...draft}
      saving={saving}
      onChange={(edit) => {
        onSaved?.(edit)
        setSaving(true)
        window.setTimeout(() => {
          setDraft(edit)
          setSaving(false)
        }, 200)
      }}
    />
  )
}

const saved = fn()

/** Saved: the labels are read as a list, the form stays while the save is under way, and focus goes back to Edit. */
export const Saving: Story = {
  render: (args) => <Kept {...args} onSaved={saved} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Edit' }))
    const labels = c.getByRole('textbox', { name: 'Labels' })
    await userEvent.clear(labels)
    await userEvent.type(labels, ' refunds , ,partner webhooks, ')
    await userEvent.click(c.getByRole('button', { name: 'Save' }))
    await expect(saved).toHaveBeenCalledWith({
      title: DRAFT_LINEAR.title,
      body: DRAFT_LINEAR.body,
      labels: ['refunds', 'partner webhooks'],
    })
    await expect(c.getByRole('button', { name: 'Save' })).toHaveAttribute('aria-busy', 'true')
    await waitFor(() => expect(c.getByRole('button', { name: 'Edit' })).toHaveFocus())
    await expect(c.getByText('Labels: refunds, partner webhooks')).toBeInTheDocument()
  },
}

/** Escape, from anywhere in the form, puts it away; so does Cancel. Focus goes back to Edit. */
export const EscapeCancels: Story = {
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Edit' }))
    await userEvent.type(c.getByRole('textbox', { name: 'Title' }), ' now')
    await userEvent.keyboard('{Escape}')
    await expect(c.queryByRole('form')).not.toBeInTheDocument()
    await expect(c.getByRole('button', { name: 'Edit' })).toHaveFocus()
    await expect(c.getByRole('heading', { name: DRAFT_LINEAR.title })).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Edit' }))
    await userEvent.click(c.getByRole('button', { name: 'Cancel' }))
    await expect(c.getByRole('button', { name: 'Edit' })).toHaveFocus()
    await expect(args.onChange).not.toHaveBeenCalled()
  },
}

/** The consumer that files it: a moment on its way, then the issue. */
function Filer(props: IssueDraftProps) {
  const [state, setState] = useState(IssueDraftState.Pending)
  return (
    <IssueDraft
      {...props}
      state={state}
      issue={FILED_LINEAR}
      onFile={() => {
        setState(IssueDraftState.Filing)
        window.setTimeout(() => setState(IssueDraftState.Filed), 200)
      }}
      onDiscard={() => setState(IssueDraftState.Discarded)}
    />
  )
}

/** Filed from the card: it shows it on its way, then folds to its line, and focus goes to the line. */
export const FiledFromTheCard: Story = {
  render: (args) => <Filer {...args} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'File issue' }))
    await expect(c.getByText('Filing on Linear…')).toBeInTheDocument()
    await waitFor(() => expect(c.getByRole('link', { name: /MER-244/ })).toBeInTheDocument())
    await waitFor(() => expect(c.getByRole('article')).toHaveFocus())
  },
}

/** Discarded from the card: it folds to its line, and focus goes there. */
export const DiscardedFromTheCard: Story = {
  render: (args) => <Filer {...args} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Discard' }))
    await expect(c.getByText('Issue draft discarded')).toBeInTheDocument()
    await waitFor(() => expect(c.getByRole('article')).toHaveFocus())
  },
}

/** Where a draft comes from: the coordinator offering it, under what it found. */
export const InTheConversation: Story = {
  render: (args) => (
    <>
      <Turn voice="Coordinator" at="11:40">
        The webhook retries ignore Retry-After, which is why refunds show undelivered. That is outside this task, so I drafted an issue for
        it on Linear.
      </Turn>
      <IssueDraft {...args} />
    </>
  ),
}

export const AllStates: Story = {
  parameters: statesOn({ hover: 'button:last-of-type', focus: 'button:last-of-type', pressed: 'button:last-of-type' }),
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'pending', node: <IssueDraft {...args} /> },
        { state: 'pending, plain', node: <IssueDraft {...args} {...DRAFT_JIRA} /> },
        { state: 'no body', node: <IssueDraft {...args} {...DRAFT_GITHUB} /> },
        { state: 'long body', node: <IssueDraft {...args} {...DRAFT_LONG} /> },
        { state: 'hover', node: <IssueDraft {...args} {...DRAFT_JIRA} /> },
        { state: 'focus', node: <IssueDraft {...args} {...DRAFT_JIRA} /> },
        { state: 'pressed', node: <IssueDraft {...args} {...DRAFT_JIRA} /> },
        { state: 'filing', node: <IssueDraft {...args} state={IssueDraftState.Filing} /> },
        {
          state: 'failed',
          node: <IssueDraft {...args} state={IssueDraftState.Failed} error="Linear took too long to answer. Nothing was filed." />,
        },
        { state: 'filed', node: <IssueDraft {...args} state={IssueDraftState.Filed} issue={FILED_LINEAR} /> },
        { state: 'discarded', node: <IssueDraft {...args} state={IssueDraftState.Discarded} /> },
        { state: 'no actions', node: <IssueDraft {...args} onFile={undefined} onChange={undefined} onDiscard={undefined} /> },
      ]}
    />
  ),
}
