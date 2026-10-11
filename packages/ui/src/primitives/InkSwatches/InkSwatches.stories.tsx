import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { ProjectInk } from '../../foundations/ProjectMark/drawing'
import { States, statesOn } from '../../storybook/States'
import { InkSwatches } from './InkSwatches'

/** The inks the other projects have, as a window with four of them would say. */
const TAKEN = { [ProjectInk.Teal]: 'Meridian', [ProjectInk.Clay]: 'Halyard', [ProjectInk.Moss]: 'Tessera', [ProjectInk.Ochre]: 'Ferrous' }

function Example({ initial = ProjectInk.Rose }: { initial?: ProjectInk }) {
  const [ink, setInk] = useState(initial)
  return <InkSwatches value={ink} onChange={setInk} taken={TAKEN} />
}

const meta = {
  title: 'Primitives/InkSwatches',
  component: InkSwatches,
  args: { value: ProjectInk.Rose, onChange: fn(), taken: TAKEN },
} satisfies Meta<typeof InkSwatches>
export default meta
type Story = StoryObj<typeof meta>

/** Rose chosen; the four others' inks say whose they are. */
export const Default: Story = {}

/** No other project yet: each ink by its name alone. */
export const NoneTaken: Story = { args: { taken: {} } }

/** A press chooses; another project's ink can still be chosen, and says whose it is. */
export const Choosing: Story = {
  render: () => <Example />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('radio', { name: 'Rose' })).toBeChecked()
    await userEvent.click(c.getByRole('radio', { name: 'Teal, Meridian’s' }))
    await expect(c.getByRole('radio', { name: 'Teal, Meridian’s' })).toBeChecked()
    await expect(c.getByRole('radiogroup', { name: 'Colour' })).toBeTruthy()
  },
}

/** Tab in, and the arrows choose the next, wrapping round. */
export const ChoosingByKeyboard: Story = {
  render: () => <Example initial={ProjectInk.Umber} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.tab()
    await expect(c.getByRole('radio', { name: 'Umber' })).toHaveFocus()
    await userEvent.keyboard('{ArrowRight>}')
    await new Promise((r) => setTimeout(r, 30))
    await userEvent.keyboard('{/ArrowRight}')
    await waitFor(() => expect(c.getByRole('radio', { name: 'Clay, Halyard’s' })).toBeChecked())
  },
}

/* The state lands on one swatch, not on the group. */
export const AllStates: Story = {
  parameters: statesOn({ hover: '[role="radio"]:first-child', focus: '[aria-checked="true"]', pressed: '[role="radio"]:first-child' }),
  render: () => (
    <States
      size="wide"
      cells={[
        ...['rest', 'hover', 'focus', 'pressed'].map((state) => ({
          state,
          node: <InkSwatches value={ProjectInk.Rose} onChange={() => {}} taken={TAKEN} text={{ label: `Colour, ${state}` }} />,
        })),
        { state: 'none taken', node: <InkSwatches value={ProjectInk.Slate} onChange={() => {}} text={{ label: 'Colour, none taken' }} /> },
        {
          state: 'fewer offered',
          node: (
            <InkSwatches
              value={ProjectInk.Olive}
              onChange={() => {}}
              inks={[ProjectInk.Olive, ProjectInk.Rose, ProjectInk.Umber]}
              text={{ label: 'Colour, fewer offered' }}
            />
          ),
        },
      ]}
    />
  ),
}
