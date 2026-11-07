import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { ModelPick } from '../../composer/ModelPick/ModelPick'
import { TaskEnd } from '../../foundations/vocabulary'
import { CODEX, effortFor, model, OPUS, useModelPrefs } from '../../fixtures/models'
import type { ModelInfo } from '../../primitives/Model/Model'
import { TeamDialog } from './TeamDialog'

/** The consumer's picker for a step: the composer's own, bordered. */
function Pick({
  owner,
  value,
  onChange,
  onRemove,
}: {
  owner: string
  value: ModelInfo
  onChange: (m: ModelInfo) => void
  onRemove?: () => void
}) {
  const prefs = useModelPrefs()
  const [effort, setEffort] = useState(effortFor(value, prefs.efforts))
  return (
    <ModelPick
      variant="field"
      placement="below"
      owner={owner}
      model={value}
      pinned={prefs.pinned}
      effort={effort}
      defaultEffort={effortFor(value, prefs.efforts)}
      onChange={(id) => onChange(model(id))}
      onEffort={setEffort}
      {...(onRemove === undefined ? {} : { onRemove })}
    />
  )
}

/** What a task that has begun says under each step, and of a review that is done: how its team stands. */
interface AtWork {
  lead: string
  review?: string
  /** Its review is done: the reviewer is shown as it stays. */
  done?: string
  error?: string
}

function Team({
  held = true,
  ends = true,
  atWork,
  ...rest
}: {
  held?: boolean
  ends?: boolean
  atWork?: AtWork
  onSave: () => void
  onStart: () => void
}) {
  const [lead, setLead] = useState(OPUS)
  const [review, setReview] = useState<ModelInfo | null>(CODEX)
  const [end, setEnd] = useState(TaskEnd.DraftPr)
  return (
    <TeamDialog
      task="Bring a PR’s branch up to date with main"
      steps={[
        {
          id: 'implement',
          label: 'Implement',
          picker: <Pick owner="Lead" value={lead} onChange={setLead} />,
          why: atWork === undefined ? 'Knows the merge code from #419, and this is mostly reading what changed on main.' : atWork.lead,
        },
        {
          id: 'review',
          label: 'Review',
          picker: review === null ? null : <Pick owner="Review" value={review} onChange={setReview} onRemove={() => setReview(null)} />,
          skipped: review === null,
          onAdd: () => setReview(CODEX),
          ...(atWork?.review === undefined ? {} : { why: atWork.review }),
          ...(atWork?.done === undefined ? {} : { locked: 'GPT-6.1 Terra', why: atWork.done }),
        },
      ]}
      {...(ends && atWork === undefined ? { end: { value: end, onChange: setEnd } } : {})}
      {...(atWork?.error === undefined ? { onSave: rest.onSave } : { error: atWork.error })}
      {...(held && atWork === undefined ? { onStart: rest.onStart } : {})}
      onClose={() => {}}
    />
  )
}

const meta = {
  title: 'Coordinator/TeamDialog',
  component: Team,
  args: { onSave: fn(), onStart: fn() },
} satisfies Meta<typeof Team>
export default meta
type Story = StoryObj<typeof meta>

/** A plan held for you: change who does it, then save it or start it with them. */
export const Held: Story = {
  play: async ({ args }) => {
    const dialog = within(document.body)
    await userEvent.click(dialog.getByRole('button', { name: 'Start' }))
    await expect(args.onStart).toHaveBeenCalledOnce()
  },
}

/** Its review taken off: it says so, and puts it back. */
export const NoReview: Story = {
  play: async () => {
    const page = within(document.body)
    await userEvent.click(page.getByRole('button', { name: /^Review:/ }))
    await userEvent.click(await page.findByRole('button', { name: 'Remove from this step' }))
    await expect(page.getByText('No review')).toBeInTheDocument()
  },
}

const AT_WORK = { lead: 'From its next turn.' } satisfies AtWork

/** A task at work: its lead changes from its next turn, its reviewer until its review round starts. Save only; it keeps its ending. */
export const AtWorkBeforeReview: Story = { args: { held: false, atWork: AT_WORK } }

/** In a review round, the reviewer changes from the next round. */
export const AtWorkInAReviewRound: Story = { args: { held: false, atWork: { ...AT_WORK, review: 'From the next round.' } } }

/** The review is done: the reviewer stays, and the dialog says so. The lead still changes. */
export const ReviewDone: Story = {
  args: { held: false, atWork: { ...AT_WORK, done: 'The review is done, so the reviewer stays.' } },
}

export const ReviewDoneDark: Story = { ...ReviewDone, globals: { theme: 'dark' } }

/** Merged: nothing changes, and it says why. */
export const Merged: Story = {
  args: { held: false, atWork: { ...AT_WORK, error: 'It’s merged, so its team stays.' } },
}

/** Started, waiting for a free agent: it starts by itself, so only Save. */
export const Waiting: Story = { args: { held: false } }

/** Where the repository's host isn't connected, the task ends on its branch, with no ending to pick. */
export const OnItsBranch: Story = { args: { ends: false } }
