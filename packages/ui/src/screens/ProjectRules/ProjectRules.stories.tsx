import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { ALWAYS_ASK, ALWAYS_ON, NEVER, NEVER_ON } from '../../fixtures/coordinator'
import { FindingsReach, LimitPolicy, PermissionPolicy, TaskEnd } from '../../foundations/vocabulary'
import { States, statesOn } from '../../storybook/States'
import { ProjectRules } from './ProjectRules'

const meta = {
  title: 'Screens/ProjectRules',
  component: ProjectRules,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ maxWidth: 760 }}>{Story()}</div>],
  args: {
    project: 'Meridian',
    always: ALWAYS_ASK,
    defaultAlwaysOn: ALWAYS_ON,
    never: NEVER,
    defaultNeverOn: NEVER_ON,
    learned: '6 of 10 so far',
    onAddRule: fn(),
    onPermissionsChange: fn(),
    onAlwaysOnChange: fn(),
    onNeverOnChange: fn(),
    onAddNever: fn(),
  },
} satisfies Meta<typeof ProjectRules>
export default meta
type Story = StoryObj<typeof meta>

/** The defaults: the lead answers, the risky few always wait for you. */
export const Default: Story = {}

/** Turning a rule on, then allowing everything, which sets the always-ask list aside. */
export const ChangingRules: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('checkbox', { name: /Messages to people/ }))
    await expect(args.onAlwaysOnChange).toHaveBeenCalledWith([...ALWAYS_ON, 'people'])
    await userEvent.click(c.getByRole('radio', { name: /Allow everything/ }))
    await expect(args.onPermissionsChange).toHaveBeenCalledWith(PermissionPolicy.AllowAll)
    await waitFor(() => expect(c.getByRole('checkbox', { name: /Pushing to main/ })).toBeDisabled())
  },
}

/** With everything allowed, the "always ask me" list is kept but does nothing. The "never" list still holds. */
export const AllowEverything: Story = {
  args: { defaultPermissions: PermissionPolicy.AllowAll },
}

/** With everything allowed, the "never" list can still be changed. */
export const NeverStillHolds: Story = {
  args: { defaultPermissions: PermissionPolicy.AllowAll },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    const secrets = c.getByRole('checkbox', { name: /Reading .env files/ })
    await expect(secrets).toBeEnabled()
    await userEvent.click(c.getByRole('checkbox', { name: /Installing packages/ }))
    await expect(args.onNeverOnChange).toHaveBeenCalledWith([...NEVER_ON, 'install'])
  },
}

/** Without a "never" list, the row is not there. */
export const WithoutNever: Story = { args: { never: undefined } }

/** A careful project: everything asks, every finding waits, it pushes only and waits out limits. */
export const Careful: Story = {
  args: {
    defaultPermissions: PermissionPolicy.Ask,
    defaultAlwaysOn: ALWAYS_ASK.map((a) => a.id),
    defaultReach: FindingsReach.All,
    defaultEnd: TaskEnd.PushOnly,
    defaultLimits: LimitPolicy.Wait,
  },
}

/** No way to add a rule here: the list is someone else's. */
export const FixedList: Story = { args: { onAddRule: undefined } }

export const AllStates: Story = {
  parameters: statesOn({ hover: '[role="radio"]', focus: '[role="radio"][aria-checked="true"]', pressed: '[role="radio"]' }),
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'default', node: <ProjectRules {...args} /> },
        { state: 'allow everything', node: <ProjectRules {...args} {...AllowEverything.args} /> },
        { state: 'careful', node: <ProjectRules {...args} {...Careful.args} /> },
        { state: 'hover', node: <ProjectRules {...args} /> },
        { state: 'focus', node: <ProjectRules {...args} /> },
        {
          state: 'narrow',
          node: (
            <div style={{ width: 420 }}>
              <ProjectRules {...args} />
            </div>
          ),
        },
      ]}
    />
  ),
}
