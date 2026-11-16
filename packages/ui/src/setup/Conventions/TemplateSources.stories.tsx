import type { Meta, StoryObj } from '@storybook/react-vite'

import { States } from '../../storybook/States'
import { TemplateSources } from './Conventions'

const meta = {
  title: 'Setup/TemplateSources',
  component: TemplateSources,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ maxWidth: 440 }}>{Story()}</div>],
  args: { repositories: [{ id: 'api', name: 'api', path: '.github/pull_request_template.md' }] },
} satisfies Meta<typeof TemplateSources>
export default meta
type Story = StoryObj<typeof meta>

/* Each state over the default, a repository with a template the lead fills in. */
// No template: Althar writes its own description.
const NO_TEMPLATE = [{ id: 'api', name: 'api', path: null }]
// Several repositories, each with its own.
const SEVERAL = [
  { id: 'api', name: 'api', path: '.github/pull_request_template.md' },
  { id: 'web', name: 'web', path: '.gitlab/merge_request_templates/Default.md' },
  { id: 'docs', name: 'docs', path: null },
]

/** Every state: a repository with a template, one without, and several, each with its own. */
export const AllStates: Story = {
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'has a template', node: <TemplateSources {...args} /> },
        { state: 'no template', node: <TemplateSources {...args} repositories={NO_TEMPLATE} /> },
        { state: 'several repositories', node: <TemplateSources {...args} repositories={SEVERAL} /> },
      ]}
    />
  ),
}
