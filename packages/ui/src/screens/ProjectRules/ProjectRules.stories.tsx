import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { ALWAYS_ASK, ALWAYS_ON, NEVER, NEVER_ON } from '../../fixtures/coordinator'
import { FindingsReach, LimitPolicy, PermissionPolicy, TaskEnd } from '../../foundations/vocabulary'
import { ProjectRules, projectRulesText } from './ProjectRules'
import { States, statesOn } from '../../storybook/States'

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
    onReachChange: fn(),
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

/** A rule added by how its command starts; an empty one says what it needs. */
export const AddingARule: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    const [always] = c.getAllByRole('button', { name: 'Add a rule' })
    if (always === undefined) throw new Error('No way to add a rule')
    await userEvent.click(always)
    const field = c.getByRole('textbox', { name: 'A command, as it starts' })
    await expect(field).toHaveFocus()
    await userEvent.click(c.getByRole('button', { name: 'Add' }))
    await expect(c.getByRole('alert')).toHaveTextContent('Type how the command starts')
    await userEvent.type(field, '  terraform apply ')
    await userEvent.click(c.getByRole('button', { name: 'Add' }))
    await expect(args.onAddRule).toHaveBeenCalledWith('terraform apply')
    await expect(c.queryByRole('textbox', { name: 'A command, as it starts' })).toBeNull()
    // Escape steps back out of it.
    await userEvent.click(c.getAllByRole('button', { name: 'Add a rule' })[1] ?? always)
    await userEvent.keyboard('{Escape}')
    await expect(args.onAddNever).not.toHaveBeenCalled()
  },
}

/**
 * As Althar has it now: the rules allow, ask or allow everything; no
 * review findings row; usage limits move or wait; the accounts of agents
 * with more than one, rotating only where the person says.
 */
export const AsAltharHasIt: Story = {
  args: {
    permissionOptions: [PermissionPolicy.Rules, PermissionPolicy.Ask, PermissionPolicy.AllowAll],
    defaultPermissions: PermissionPolicy.Rules,
    limitOptions: [LimitPolicy.Move, LimitPolicy.Wait],
    onReachChange: undefined,
    agentAccounts: [
      {
        id: 'codex',
        name: 'Codex',
        accounts: [
          { id: 'acc_main', label: 'main' },
          { id: 'acc_client', label: 'Client' },
        ],
      },
    ],
    allowed: { codex: ['acc_client'] },
    onRotateChange: fn(),
    onAllowedChange: fn(),
    text: { foot: '' },
  },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.queryByRole('radiogroup', { name: projectRulesText.reach.label })).toBeNull()
    await expect(c.queryByRole('radio', { name: /Ask me.*A card/ })).toBeNull()
    await expect(c.getByRole('checkbox', { name: 'main' })).not.toBeChecked()
    // The only account ticked stays ticked: a project keeps at least one of an agent's accounts.
    await expect(c.getByRole('checkbox', { name: 'Client' })).toBeDisabled()
    await userEvent.click(c.getByRole('checkbox', { name: 'main' }))
    await expect(args.onAllowedChange).toHaveBeenCalledWith('codex', ['acc_main', 'acc_client'])
    await userEvent.click(c.getByRole('radio', { name: /The next account/ }))
    await expect(args.onRotateChange).toHaveBeenCalledWith(true)
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
