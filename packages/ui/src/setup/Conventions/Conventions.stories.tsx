import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { States, statesOn } from '../../storybook/States'
import { NamingRule, type NamingRuleProps, type RepositoryNaming } from './Conventions'

/** What a branch pattern makes for an example task, as the desktop app works it out. */
const exampleOf = (pattern: string) => pattern.replace('{key}', 'DEV-42').replace('{slug}', 'fix-login')

const SAYS_NOTHING: RepositoryNaming[] = [{ id: 'api', name: 'api', found: null }]
const CONTRIBUTING: RepositoryNaming[] = [{ id: 'api', name: 'api', found: { pattern: 'feature/{key}-{slug}', from: 'CONTRIBUTING.md' } }]
const SEVERAL: RepositoryNaming[] = [
  { id: 'api', name: 'api', found: { pattern: 'feature/{key}-{slug}', from: 'CONTRIBUTING.md' } },
  { id: 'web', name: 'web', found: null },
]

const meta = {
  title: 'Setup/NamingRule',
  component: NamingRule,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ maxWidth: 440 }}>{Story()}</div>],
  args: {
    value: null,
    exampleOf,
    fallback: 'althar/{key}-{slug}',
    repositories: SAYS_NOTHING,
    onChange: fn(),
    text: { field: 'Branch names' },
  },
} satisfies Meta<typeof NamingRule>
export default meta
type Story = StoryObj<typeof meta>

/* Each state over the defaults, where the docs say nothing: Althar names branches its own way, and says so. */
// Its CONTRIBUTING.md names them: Althar follows it, and says where from.
const FOLLOWING_THE_DOCS: Partial<NamingRuleProps> = { repositories: CONTRIBUTING }
// The person's own pattern, over what the docs say.
const YOUR_OWN: Partial<NamingRuleProps> = { value: 'team/{slug}', repositories: CONTRIBUTING }
// A pattern Althar can't follow, and why, beside the field.
const CANT_FOLLOW: Partial<NamingRuleProps> = {
  value: 'feature/{key}',
  error: 'It needs {slug}, so each task’s is its own.',
  repositories: CONTRIBUTING,
}
// Without a way to change it, the pattern only reads.
const READ_ONLY: Partial<NamingRuleProps> = { value: 'team/{slug}', onChange: undefined }

/** Typing shows what it makes; Enter sets it, Escape puts it back, and the button follows the repository again. */
export const Typing: Story = {
  render: function Render(args: NamingRuleProps) {
    const [value, setValue] = useState<string | null>(args.value)
    return (
      <NamingRule
        {...args}
        value={value}
        onChange={(pattern) => {
          args.onChange?.(pattern)
          setValue(pattern)
        }}
      />
    )
  },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    const field = c.getByRole('textbox', { name: 'Branch names' })
    await userEvent.type(field, 'feature/{{key}-{{slug}')
    await expect(c.getByText('Makes feature/DEV-42-fix-login')).toBeInTheDocument()
    await userEvent.keyboard('{Enter}')
    await expect(args.onChange).toHaveBeenCalledWith('feature/{key}-{slug}')
    await userEvent.type(field, 'x{Escape}')
    await expect(field).toHaveValue('feature/{key}-{slug}')
    await userEvent.click(c.getByRole('button', { name: 'Follow the repository' }))
    await expect(args.onChange).toHaveBeenLastCalledWith(null)
    await expect(field).toHaveValue('')
  },
}

/** Every state: the docs saying nothing, followed, overruled, a pattern it can't follow, several repositories, read only, hovered and focused. */
export const AllStates: Story = {
  parameters: statesOn({ hover: 'input', focus: 'input', pressed: 'button' }),
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'says nothing', node: <NamingRule {...args} /> },
        { state: 'following the docs', node: <NamingRule {...args} {...FOLLOWING_THE_DOCS} /> },
        { state: 'your own', node: <NamingRule {...args} {...YOUR_OWN} /> },
        { state: 'can’t follow', node: <NamingRule {...args} {...CANT_FOLLOW} /> },
        { state: 'several repositories', node: <NamingRule {...args} repositories={SEVERAL} /> },
        { state: 'read only', node: <NamingRule {...args} {...READ_ONLY} /> },
        { state: 'hover', node: <NamingRule {...args} /> },
        { state: 'focus', node: <NamingRule {...args} /> },
      ]}
    />
  ),
}
