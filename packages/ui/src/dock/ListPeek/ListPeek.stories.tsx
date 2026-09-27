import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { ARTIFACTS, NOTES_KEPT, NOTES_SEEN } from '../../fixtures/chrome'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { States, statesOn } from '../../storybook/States'
import { ListPeek } from './ListPeek'

const meta = {
  title: 'Dock/ListPeek',
  component: ListPeek,
  decorators: [(Story, { parameters }) => (parameters.pseudo ? Story() : <div style={{ width: 380 }}>{Story()}</div>)],
  args: {
    about: 'Held by the project. Every task starts with its notes, and adds what it saw.',
    sections: [
      { label: 'Notes', entries: NOTES_KEPT },
      { label: 'Seen in tasks', entries: NOTES_SEEN },
    ],
    onOpen: fn(),
  },
} satisfies Meta<typeof ListPeek>
export default meta
type Story = StoryObj<typeof meta>

/** The project's knowledge: two that disagree are flagged. */
export const Knowledge: Story = { args: { action: <ActionButton kbd="⇧K">Open knowledge full size</ActionButton> } }
/** Artifacts: one list, no sections. */
export const Artifacts: Story = {
  args: { about: 'What tasks wrote that is worth keeping, and isn’t in the repository.', sections: [{ entries: ARTIFACTS }] },
}
/** Entries that don't open. */
export const Plain: Story = { args: { onOpen: undefined } }

export const Opening: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Session tokens rotate/ }))
    await expect(args.onOpen).toHaveBeenCalledWith('k3')
  },
}

export const AllStates: Story = {
  parameters: statesOn({ hover: 'li:first-child button', focus: 'li:first-child button', pressed: 'li:first-child button' }),
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'knowledge', node: <ListPeek {...args} {...Knowledge.args} /> },
        { state: 'artifacts', node: <ListPeek {...args} {...Artifacts.args} /> },
        { state: 'plain', node: <ListPeek {...args} onOpen={undefined} /> },
        { state: 'hover', node: <ListPeek {...args} /> },
        { state: 'focus', node: <ListPeek {...args} /> },
      ]}
    />
  ),
}
