import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { PROJECT_LIST } from '../../fixtures/home'
import { States } from '../../storybook/States'
import { ProjectRow } from './ProjectRow'
import s from './ProjectRow.stories.module.css'

const [MERIDIAN_ROW, HALYARD_ROW, TESSERA_ROW, FERROUS_ROW] = PROJECT_LIST
if (!MERIDIAN_ROW || !HALYARD_ROW || !TESSERA_ROW || !FERROUS_ROW) throw new Error('The demo needs its projects')
/* An item as its component takes it: without the id that keys it in a list. */
const strip = <T extends { id: string }>(item: T) => {
  const { id: _id, ...rest } = item
  return rest
}

const meta = {
  title: 'Home/ProjectRow',
  component: ProjectRow,
  decorators: [(Story) => <div className={s.column}>{Story()}</div>],
  args: { ...strip(MERIDIAN_ROW), onOpen: fn() },
} satisfies Meta<typeof ProjectRow>
export default meta
type Story = StoryObj<typeof meta>

/** Work runs and something waits on you: the arc goes round the mark, the dot sits on it, and the words say both. */
export const Busy: Story = {}

/** Only running: no dot, and no violet. */
export const Running: Story = { args: strip(TESSERA_ROW) }

/** Something waits on you, and what runs is held: the dot, with no arc. */
export const HeldAndWaiting: Story = { args: { ...strip(HALYARD_ROW), moving: false } }

/** Nothing going on: the mark steps back, and the row says when it last did something. */
export const Quiet: Story = { args: strip(FERROUS_ROW) }

/** Quiet, with nothing to say about when. */
export const Idle: Story = { args: { ...strip(FERROUS_ROW), note: undefined } }

/** Nowhere to open it: the row is words. */
export const WithoutOpening: Story = { args: { onOpen: undefined } }

export const AllStates: Story = {
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'busy', node: <ProjectRow {...args} /> },
        { state: 'running', node: <ProjectRow {...args} {...strip(TESSERA_ROW)} /> },
        { state: 'held and waiting', node: <ProjectRow {...args} {...strip(HALYARD_ROW)} moving={false} /> },
        { state: 'quiet', node: <ProjectRow {...args} {...strip(FERROUS_ROW)} /> },
        { state: 'hover', node: <ProjectRow {...args} /> },
        { state: 'focus', node: <ProjectRow {...args} /> },
        { state: 'pressed', node: <ProjectRow {...args} /> },
      ]}
    />
  ),
}
