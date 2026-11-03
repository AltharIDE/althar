import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import {
  exampleName,
  MERIDIAN_ACCOUNTS,
  MERIDIAN_BRANCHES,
  MERIDIAN_BRANCHES_APART,
  MERIDIAN_COMMANDS,
  MERIDIAN_KINDS,
  MERIDIAN_TEMPLATES,
  MERIDIAN_TITLES,
} from '../../fixtures/rules'
import { CommandMatch, LimitPolicy, PermissionPolicy, RuleKind, RulePlace, TaskEnd } from '../../foundations/vocabulary'
import { type CommandPlace, type KindTally, ProjectRules, type ProjectRulesProps, type RuleCommand, type SandboxList } from './ProjectRules'

/** What Meridian's leads' sandboxes let through: what its packages, scripts and setup say, and its code host, registry and tracker. */
const MERIDIAN_SANDBOX = {
  commands: ['bunx playwright', 'bunx vp test run', 'node scripts/e2e.ts', 'ps', 'env -i'],
  hosts: ['github.com', 'api.github.com', 'registry.npmjs.org', 'linear.app', 'api.linear.app'],
}

/** How Meridian's asks and refusals went in the last two weeks: what was asked and allowed, and what agents worked around. */
const MERIDIAN_TALLY: readonly KindTally[] = [
  { kind: RuleKind.Outside, asked: 13, allowed: 13, refused: 0, workedAround: 0 },
  { kind: RuleKind.DefaultBranch, asked: 2, allowed: 1, refused: 0, workedAround: 1 },
  { kind: 'unclear', asked: 0, allowed: 0, refused: 5, workedAround: 4 },
  { kind: 'reader', asked: 0, allowed: 0, refused: 1, workedAround: 1 },
]

/** The screen with its values kept as they are changed, as the app keeps them; each change also goes to its spy. */
function Live(args: ProjectRulesProps) {
  const [mode, setMode] = useState(args.mode)
  const [allowAll, setAllowAll] = useState(args.allowAll)
  const [kinds, setKinds] = useState(args.kinds)
  const [commands, setCommands] = useState(args.commands)
  const [end, setEnd] = useState(args.end)
  const [limit, setLimit] = useState(args.limit)
  const [rotate, setRotate] = useState(args.rotate)
  const [allowed, setAllowed] = useState(args.allowed)
  const [branch, setBranch] = useState(args.branches.value)
  const [lists, setLists] = useState<Record<SandboxList, readonly string[]>>({
    commands: args.sandbox?.commands ?? [],
    hosts: args.sandbox?.hosts ?? [],
  })
  const sandbox = args.sandbox
  return (
    <ProjectRules
      {...args}
      mode={mode}
      allowAll={allowAll}
      onAllowAllChange={(on) => {
        setAllowAll(on)
        args.onAllowAllChange(on)
      }}
      onModeChange={(next) => {
        setMode(next)
        args.onModeChange(next)
      }}
      kinds={kinds}
      onKindChange={(kind, place) => {
        setKinds({ ...kinds, [kind]: place })
        args.onKindChange(kind, place)
      }}
      commands={commands}
      onRemoveCommand={(id) => {
        setCommands(commands.filter((each) => each.id !== id))
        args.onRemoveCommand(id)
      }}
      onAddCommand={(place: CommandPlace, pattern: string, match: CommandMatch) => {
        const problem = args.onAddCommand(place, pattern, match)
        if (problem === undefined) setCommands([...commands, { id: `${place}:${match}:${pattern}`, pattern, match, place }])
        return problem
      }}
      end={end}
      onEndChange={(next) => {
        setEnd(next)
        args.onEndChange(next)
      }}
      branches={{ ...args.branches, value: branch, onChange: setBranch }}
      limit={limit}
      onLimitChange={(next) => {
        setLimit(next)
        args.onLimitChange(next)
      }}
      rotate={rotate}
      onRotateChange={(next) => {
        setRotate(next)
        args.onRotateChange(next)
      }}
      allowed={allowed}
      onAllowedChange={(agent, ids) => {
        setAllowed({ ...allowed, [agent]: ids })
        args.onAllowedChange(agent, ids)
      }}
      {...(sandbox === undefined
        ? {}
        : {
            sandbox: {
              ...lists,
              onAdd: (list: SandboxList, typed: string) => {
                const problem = sandbox.onAdd(list, typed)
                if (problem === undefined) setLists({ ...lists, [list]: [...lists[list], typed.trim()] })
                return problem
              },
              onRemove: (list: SandboxList, value: string) => {
                setLists({ ...lists, [list]: lists[list].filter((each) => each !== value) })
                sandbox.onRemove(list, value)
              },
            },
          })}
    />
  )
}

const meta = {
  title: 'Screens/ProjectRules',
  component: ProjectRules,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ maxWidth: 984, minHeight: 760 }}>{Story()}</div>],
  render: (args) => <Live {...args} />,
  args: {
    project: 'Meridian',
    mode: PermissionPolicy.Coordinator,
    onModeChange: fn(),
    allowAll: false,
    onAllowAllChange: fn(),
    kinds: MERIDIAN_KINDS,
    onKindChange: fn(),
    commands: MERIDIAN_COMMANDS,
    onRemoveCommand: fn(),
    onAddCommand: fn((): string | undefined => undefined),
    end: TaskEnd.DraftPr,
    onEndChange: fn(),
    branches: { value: null, exampleOf: exampleName, fallback: 'althar/{key}-{slug}', repositories: MERIDIAN_BRANCHES },
    titles: { value: '{key}: {title}', onChange: fn(), exampleOf: exampleName, fallback: '{title}', repositories: MERIDIAN_TITLES },
    templates: MERIDIAN_TEMPLATES,
    limit: LimitPolicy.Move,
    onLimitChange: fn(),
    agentAccounts: MERIDIAN_ACCOUNTS,
    rotate: false,
    onRotateChange: fn(),
    allowed: {},
    onAllowedChange: fn(),
    sandbox: { ...MERIDIAN_SANDBOX, onAdd: fn((): string | undefined => undefined), onRemove: fn() },
    tally: MERIDIAN_TALLY,
  },
} satisfies Meta<typeof ProjectRules>
export default meta
type Story = StoryObj<typeof meta>

/** Meridian's rules: force pushes never, three kinds and three commands asked about, what goes ahead, and the coordinator for the rest. */
export const AtRest: Story = {}

/** The last two weeks: a line for each kind that asked or was refused, how often the person allowed it, and how often agents found another way. */
export const LastTwoWeeks: Story = {
  play: async ({ canvasElement }) => {
    const weeks = within(within(canvasElement).getByRole('listitem', { name: 'Last 14 days' }))
    await expect(weeks.getByText('Writing outside the task’s worktree: asked you 13 times, and you allowed all 13.')).toBeInTheDocument()
    await expect(weeks.getByText('Pushing to the default branch: asked you 2 times, and you allowed 1.')).toBeInTheDocument()
    await expect(
      weeks.getByText('Commands Althar couldn’t read: refused 5 times, and agents found another way 4 times.'),
    ).toBeInTheDocument()
    await expect(weeks.getByText('What a reader may not do: refused once, and agents found another way that time.')).toBeInTheDocument()
  },
}

/** Nothing asked or was refused lately: the sentence says so. */
export const NothingLately: Story = {
  args: { tally: [] },
  play: async ({ canvasElement }) => {
    const weeks = within(within(canvasElement).getByRole('listitem', { name: 'Last 14 days' }))
    await expect(weeks.getByText('Nothing asked you or was refused.')).toBeInTheDocument()
  },
}

/** Adding a command where it goes ahead: typed in the sentence, Enter adds it, and focus goes back to the +. */
export const AddingACommand: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Add a command to Go ahead' }))
    const field = c.getByRole('textbox', { name: 'A command, as it starts' })
    await waitFor(() => expect(field).toHaveFocus())
    await expect(field).toHaveAccessibleDescription(/How the command starts/)
    await userEvent.type(field, 'npx playwright test')
    await expect(field).toHaveAccessibleDescription('Holds for npx playwright test …')
    await userEvent.keyboard('{Enter}')
    await expect(args.onAddCommand).toHaveBeenCalledWith(RulePlace.Allow, 'npx playwright test', CommandMatch.Prefix)
    const goAhead = c.getByRole('listitem', { name: 'Go ahead' })
    await expect(within(goAhead).getByText('npx playwright test')).toBeInTheDocument()
    await waitFor(() => expect(c.getByRole('button', { name: 'Add a command to Go ahead' })).toHaveFocus())
  },
}

/** Opened and typed, before Enter: the field where the command will sit, and how it matches under the sentence. */
export const Adding: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Add a command to Go ahead' }))
    await userEvent.type(c.getByRole('textbox', { name: 'A command, as it starts' }), 'npx playwright test')
  },
}

/** Escape leaves a command half typed, adds nothing, and puts focus back on the +. */
export const LeavingIt: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Add a command to Never' }))
    await userEvent.type(c.getByRole('textbox', { name: 'A command, as it starts' }), 'rm -rf{Escape}')
    await expect(c.queryByRole('textbox', { name: 'A command, as it starts' })).toBeNull()
    await expect(args.onAddCommand).not.toHaveBeenCalled()
    await waitFor(() => expect(c.getByRole('button', { name: 'Add a command to Never' })).toHaveFocus())
  },
}

/** Enter with nothing typed says so; a command the rules refuse says why, and the field stays to change it. */
export const Refused: Story = {
  args: {
    onAddCommand: fn((): string | undefined => '“stripe” is under Ask me, which comes first, so nothing changed. Take it out there first.'),
  },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Add a command to Go ahead' }))
    const field = c.getByRole('textbox', { name: 'A command, as it starts' })
    await userEvent.keyboard('{Enter}')
    await expect(c.getByRole('alert')).toHaveTextContent('Type the command first.')
    await expect(args.onAddCommand).not.toHaveBeenCalled()
    await userEvent.type(field, 'stripe{Enter}')
    await expect(c.getByRole('alert')).toHaveTextContent('is under Ask me, which comes first')
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    await expect(field).toHaveFocus()
  },
}

/** A whole line, exactly: the match is chosen under the sentence. */
export const AddingExactly: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    const page = within(document.body)
    await userEvent.click(c.getByRole('button', { name: 'Add a command to Ask me' }))
    await userEvent.type(c.getByRole('textbox', { name: 'A command, as it starts' }), 'git push origin main')
    await userEvent.click(c.getByRole('combobox', { name: 'How it matches' }))
    await userEvent.click(await page.findByRole('option', { name: 'Exactly' }))
    await expect(c.getByText('Holds for this line alone')).toBeInTheDocument()
    await waitFor(() => expect(c.getByRole('textbox', { name: 'A command, as it starts' })).toHaveFocus())
    await userEvent.keyboard('{Enter}')
    await expect(args.onAddCommand).toHaveBeenCalledWith(RulePlace.Ask, 'git push origin main', CommandMatch.Exact)
  },
}

/** Taking a command out: it goes at once, and focus moves to the next one's ×. */
export const RemovingACommand: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Remove psql' }))
    await expect(args.onRemoveCommand).toHaveBeenCalledWith('ask:prefix:psql')
    await expect(c.queryByRole('button', { name: 'Remove psql' })).toBeNull()
    await waitFor(() => expect(c.getByRole('button', { name: 'Remove docker push' })).toHaveFocus())
  },
}

/** Editing a built-in: its word opens where it can sit, with what it catches, and choosing moves it to that sentence. */
export const EditingABuiltIn: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const page = within(document.body)
    await userEvent.click(c.getByRole('button', { name: 'deleting other branches' }))
    await expect(await page.findByRole('menu', { name: 'Deleting branches that aren’t the task’s' })).toHaveAccessibleDescription(
      /never the task’s own branch/,
    )
    await expect(page.getByRole('menuitemradio', { name: 'The rest' })).toHaveAccessibleDescription(
      'With the rest: the coordinator decides',
    )
  },
}

/** Moved to Never, it reads as what agents never do, and focus goes with it. */
export const MovingABuiltIn: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    const page = within(document.body)
    await userEvent.click(c.getByRole('button', { name: 'deleting other branches' }))
    await userEvent.click(await page.findByRole('menuitemradio', { name: 'Never' }))
    await expect(args.onKindChange).toHaveBeenCalledWith(RuleKind.DeleteBranch, RulePlace.Never)
    const never = c.getByRole('listitem', { name: 'Never' })
    await waitFor(() => expect(within(never).getByRole('button', { name: 'delete other branches' })).toHaveFocus())
  },
}

/** What happens to the rest, changed in place: three ways, as allowing everything is the switch over them. */
export const ChoosingTheRest: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    const page = within(document.body)
    await userEvent.click(c.getByRole('button', { name: 'the coordinator decides' }))
    await expect(await page.findAllByRole('menuitemradio')).toHaveLength(3)
    await userEvent.click(page.getByRole('menuitemradio', { name: 'Ask me' }))
    await expect(args.onModeChange).toHaveBeenCalledWith(PermissionPolicy.Ask)
  },
}

/** The switch over the sentences: on, what asks, goes ahead and the rest say they are off; Never doesn't, and still changes. */
export const AllowingEverything: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('switch', { name: 'Allow everything' }))
    await expect(args.onAllowAllChange).toHaveBeenCalledWith(true)
    await expect(c.getAllByText('Off while everything is allowed.')).toHaveLength(3)
    await expect(within(c.getByRole('listitem', { name: 'Never' })).queryByText('Off while everything is allowed.')).toBeNull()
  },
}

/** Everything allowed, as the page opens with it on. */
export const EverythingAllowed: Story = { args: { allowAll: true } }

/** A new project's rules: every kind asks, nothing is named, and what no rule keeps is allowed. */
export const NewProject: Story = {
  args: {
    mode: PermissionPolicy.Rules,
    kinds: Object.fromEntries(Object.values(RuleKind).map((kind) => [kind, RulePlace.Ask])) as Record<RuleKind, RulePlace>,
    commands: [],
  },
}

/** Nothing named anywhere: each sentence says so, and its + still adds. */
export const NothingNamed: Story = {
  args: {
    mode: PermissionPolicy.Ask,
    kinds: Object.fromEntries(Object.values(RuleKind).map((kind) => [kind, RulePlace.Rest])) as Record<RuleKind, RulePlace>,
    commands: [],
  },
}

/** Only commands are refused, and nothing asks: Agents is said where they are first named. */
export const OnlyCommands: Story = {
  args: {
    kinds: { ...MERIDIAN_KINDS, [RuleKind.ForcePush]: RulePlace.Rest },
    commands: MERIDIAN_COMMANDS.filter((command) => command.place !== RulePlace.Ask),
  },
}

/** Kinds always allowed go ahead beside the commands. */
export const KindsGoAhead: Story = {
  args: { kinds: { ...MERIDIAN_KINDS, [RuleKind.Deploy]: RulePlace.Allow, [RuleKind.Outside]: RulePlace.Allow } },
}

/** The repositories name branches each their own way: the sentence says so, and the name opens where each comes from. */
export const NamesApart: Story = {
  args: {
    branches: { value: null, exampleOf: exampleName, fallback: 'althar/{key}-{slug}', repositories: MERIDIAN_BRANCHES_APART },
    templates: MERIDIAN_TEMPLATES.map((each) => ({ ...each, path: null })),
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const page = within(document.body)
    await expect(c.getByRole('button', { name: 'Althar’s own words' })).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'as each repository says' }))
    await expect(await page.findByText('CONTRIBUTING.md says feat/{key}-{slug}')).toBeInTheDocument()
  },
}

/** A pattern of the person's own, typed in its popover: Enter gives it, and the sentence shows what it makes. */
export const NamingBranches: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const page = within(document.body)
    await userEvent.click(c.getByRole('button', { name: 'feat/MER-128-refund-banner' }))
    const field = await page.findByRole('textbox', { name: 'Branch names' })
    await userEvent.type(field, 'team/{{slug}{Enter}')
    await expect(c.getByRole('button', { name: 'team/refund-banner' })).toBeInTheDocument()
  },
}

/** Pushing the branch only: the sentence says so, and what a pull request opened from it would be titled. */
export const PushOnly: Story = { args: { end: TaskEnd.PushOnly, limit: LimitPolicy.Wait } }

/** When an account runs out, the step waits for the person: the sentence says what they'll choose between. */
export const LimitAsks: Story = {
  args: { limit: LimitPolicy.Ask },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('listitem', { name: 'Limits' })).toHaveTextContent(
      'When an account runs out, the work waits for you to move it to a model that’s free, or to wait for the reset.',
    )
  },
}

/** The three things a limit can do, from its word; asking is one. */
export const ChoosingALimit: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    const page = within(document.body)
    await userEvent.click(c.getByRole('button', { name: 'moves to the next agent free' }))
    await expect(await page.findAllByRole('menuitemradio')).toHaveLength(3)
    await userEvent.click(page.getByRole('menuitemradio', { name: 'Ask me' }))
    await expect(args.onLimitChange).toHaveBeenCalledWith(LimitPolicy.Ask)
    await expect(c.getByRole('button', { name: 'waits for you' })).toBeInTheDocument()
  },
}

/** Work goes on with an agent's next account: the limit sentence says that comes first, and the accounts read in order. */
export const NextAccount: Story = { args: { rotate: true } }

/** An agent's accounts: which this project may use, the last one kept, and whether work goes on with the next. */
export const ChoosingAccounts: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    const page = within(document.body)
    await userEvent.click(c.getByRole('button', { name: 'Personal' }))
    await userEvent.click(await page.findByRole('menuitemcheckbox', { name: 'Personal' }))
    await expect(args.onAllowedChange).toHaveBeenCalledWith('claude-code', ['work'])
    await expect(page.getByRole('menuitemcheckbox', { name: 'Work' })).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(page.getByRole('menuitemradio', { name: 'Go on with the next' }))
    await expect(args.onRotateChange).toHaveBeenCalledWith(true)
  },
}

/** The one account this project named is gone: work runs on every one again, and the sentence says so. */
export const AccountGone: Story = {
  args: { allowed: { 'claude-code': ['removed'] } },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const page = within(document.body)
    await userEvent.click(c.getByRole('button', { name: 'Personal' }))
    await expect(await page.findByRole('menuitemcheckbox', { name: 'Personal' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('menuitemcheckbox', { name: 'Work' })).toHaveAttribute('aria-checked', 'true')
  },
}

/** With no agent of several accounts, the limit sentence stands alone. */
export const OneAccountEach: Story = { args: { agentAccounts: [] } }

/** A command too long for its box is cut short, and reads whole on hover or focus. */
export const LongCommands: Story = {
  args: {
    commands: [
      ...MERIDIAN_COMMANDS,
      {
        id: 'long',
        pattern: 'terraform -chdir=environments/production apply -auto-approve',
        match: CommandMatch.Exact,
        place: RulePlace.Never,
      } satisfies RuleCommand,
    ],
  },
}

/** What leads' sandboxes let through while the rest is allowed: known commands outside it, known hosts without asking. */
export const Sandbox: Story = { args: { mode: PermissionPolicy.Rules } }

/** Adding a host: typed where it will sit, Enter adds it, and focus goes back to the +. */
export const AddingAHost: Story = {
  args: { mode: PermissionPolicy.Rules },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Add a host leads reach without asking' }))
    const field = c.getByRole('textbox', { name: 'A host' })
    await waitFor(() => expect(field).toHaveFocus())
    await expect(field).toHaveAccessibleDescription(/A host such as registry.npmjs.org/)
    await userEvent.type(field, 'pypi.org')
    await expect(field).toHaveAccessibleDescription('Reached without asking')
    await userEvent.keyboard('{Enter}')
    await expect(args.sandbox?.onAdd).toHaveBeenCalledWith('hosts', 'pypi.org')
    const sandbox = c.getByRole('listitem', { name: 'Sandbox' })
    await expect(within(sandbox).getByText('pypi.org')).toBeInTheDocument()
    await waitFor(() => expect(c.getByRole('button', { name: 'Add a host leads reach without asking' })).toHaveFocus())
  },
}

/** Taking a command out of what runs outside the sandbox: it goes, and focus moves to the next one's ×. */
export const RemovingAnOutsideCommand: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Remove env -i' }))
    await expect(args.sandbox?.onRemove).toHaveBeenCalledWith('commands', 'env -i')
    await expect(c.queryByRole('button', { name: 'Remove env -i' })).toBeNull()
  },
}

/** A project that has nothing outside the sandbox: every command in it first, every host asking. */
export const NothingOutside: Story = {
  args: { sandbox: { commands: [], hosts: [], onAdd: fn((): string | undefined => undefined), onRemove: fn() } },
}
