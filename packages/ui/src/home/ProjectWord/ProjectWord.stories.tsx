import type { Meta, StoryObj } from '@storybook/react-vite'

import { FERROUS, HALYARD, MERIDIAN, TESSERA } from '../../fixtures/home'
import { ProjectInk } from '../../foundations/ProjectMark/drawing'
import { States } from '../../storybook/States'
import { ProjectWord } from './ProjectWord'

const meta = {
  title: 'Home/ProjectWord',
  component: ProjectWord,
  args: { project: MERIDIAN },
} satisfies Meta<typeof ProjectWord>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** Each project on this Mac, and a long name, which stays on one line. */
export const AllStates: Story = {
  render: () => (
    <States
      cells={[
        ...[MERIDIAN, HALYARD, TESSERA, FERROUS].map((project) => ({ state: project.name, node: <ProjectWord project={project} /> })),
        {
          state: 'long name',
          node: <ProjectWord project={{ seed: 'billing', ink: ProjectInk.Rose, name: 'billing-reconciliation-service' }} />,
        },
      ]}
    />
  ),
}
