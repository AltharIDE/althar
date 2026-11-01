import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { REVIEW_SEAL_SAMPLE } from '../../fixtures/setup'
import { Switch } from '../../primitives/Switch/Switch'
import type { SealStyle } from '../../seal/seal'
import { ReviewSeal, type ReviewSealProps } from './ReviewSeal'

const onStyle = fn()
const onChange = fn()

/* Kept as it is turned and picked, the way a consumer keeps it, with its switch beside it as a page's head would hold it. */
function Kept(args: Pick<ReviewSealProps, 'on' | 'style'>) {
  const [on, setOn] = useState(args.on)
  const [style, setStyle] = useState<SealStyle>(args.style)
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Switch
        checked={on}
        onChange={(next) => {
          setOn(next)
          onChange(next)
        }}
        label="Review seal on pull requests"
      />
      <ReviewSeal
        on={on}
        style={style}
        onStyle={(next) => {
          setStyle(next)
          onStyle(next)
        }}
        sample={REVIEW_SEAL_SAMPLE}
      />
    </div>
  )
}

const meta = {
  title: 'Setup/ReviewSeal',
  component: ReviewSeal,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ width: 564 }}>{Story()}</div>],
  args: { on: true, style: 'ring', onStyle, sample: REVIEW_SEAL_SAMPLE },
  render: (args) => <Kept on={args.on} style={args.style} />,
} satisfies Meta<typeof ReviewSeal>
export default meta
type Story = StoryObj<typeof meta>

/** On, as it starts: a pull request with the ring in its corner and its review folded, and the three looks to pick from. */
export const On: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const pr = c.getByRole('figure', { name: 'A pull request as GitHub shows it' })
    await expect(within(pr).getByRole('img', { name: 'Reviewed by GPT-6.1 Sol in 2 passes, at 4e1c07a' })).toBeInTheDocument()
    await expect(pr).toHaveTextContent('Reviewed by GPT-6.1 Sol in 2 passes, at 4e1c07a')
    await expect(c.getByRole('radio', { name: 'Ring' })).toHaveAttribute('aria-checked', 'true')
    await expect(c.queryByText(/findings/)).toBeNull()
  },
}

/** Picking another look puts it in the pull request's corner. */
export const PickingALook: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const seal = within(c.getByRole('figure', { name: 'A pull request as GitHub shows it' })).getByRole('img')
    const ring = seal.getAttribute('src')
    await userEvent.click(c.getByRole('radio', { name: 'Wax' }))
    await expect(onStyle).toHaveBeenCalledWith('wax')
    await expect(c.getByRole('radio', { name: 'Wax' })).toHaveAttribute('aria-checked', 'true')
    await expect(
      within(c.getByRole('figure', { name: 'A pull request as GitHub shows it' }))
        .getByRole('img')
        .getAttribute('src'),
    ).not.toBe(ring)
  },
}

/** Off: the seal's place is only its outline, the review's line struck through, no looks to pick, and what goes out instead. */
export const Off: Story = {
  args: { on: false },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const pr = c.getByRole('figure', { name: 'A pull request as GitHub shows it' })
    await expect(within(pr).queryByRole('img')).toBeNull()
    await expect(c.queryByRole('radiogroup')).toBeNull()
    await expect(c.getByText('Pull requests go out with only their description.')).toBeInTheDocument()
  },
}

/** Turned on from off, the seal and its looks come back. */
export const TurningItOn: Story = {
  args: { on: false },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('switch', { name: 'Review seal on pull requests' }))
    await expect(onChange).toHaveBeenCalledWith(true)
    await expect(c.getByRole('radio', { name: 'Ring' })).toHaveAttribute('aria-checked', 'true')
    await expect(within(c.getByRole('figure', { name: 'A pull request as GitHub shows it' })).getByRole('img')).toBeInTheDocument()
  },
}
