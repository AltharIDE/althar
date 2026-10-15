import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { AddRunnable, EditRunnable, type ListedRunnable, type PickableScript, Runnables } from './Runnables'

/* This repository's own scripts, as its package.json files say them. */
const SCRIPTS: PickableScript[] = [
  { id: 'site', command: 'bun run site', body: 'bun --filter @althar/site dev' },
  { id: 'check', command: 'bun run check', body: "bun --filter '*' check" },
  { id: 'storybook', command: 'bun --filter @althar/ui storybook', body: 'storybook dev --port 6006 --no-open' },
  { id: 'desktop', command: 'bun --filter @althar/desktop dev', body: 'bun run build && electron .' },
  { id: 'preview', command: 'bun --filter @althar/pitch preview', body: 'vp preview' },
]

const LISTED: ListedRunnable[] = [
  { id: 'pitch', name: 'Pitch site', command: 'bun run dev', about: 'althar · Worked out from the repository' },
  { id: 'storybook', name: 'Storybook', command: 'bun --filter @althar/ui storybook', about: 'althar · Added by you' },
  { id: 'desktop', name: 'Desktop app', command: 'bun --filter @althar/desktop dev', about: 'althar · Added by the coordinator' },
  { id: 'probe', command: 'bun --filter @althar/runtime probe:tools', about: 'althar · Added by you' },
]

const meta = {
  title: 'Setup/Runnables',
  component: Runnables,
  parameters: { layout: 'fullscreen' },
  args: {
    project: 'althar',
    runnables: LISTED,
    onOrder: fn(),
    onDefault: fn(),
    onEdit: fn(),
    onRemove: fn(),
    onAdd: fn(),
    onClose: fn(),
  },
  decorators: [(Story) => <div style={{ minHeight: 560 }}>{Story()}</div>],
} satisfies Meta<typeof Runnables>
export default meta
type Story = StoryObj<typeof meta>

/** The whole list, the first its default: drag into order (or move with a grip's arrow keys), make another the default, edit, remove. */
export const List: Story = {
  play: async ({ args }) => {
    const page = within(document.body)
    const grip = await page.findByRole('button', { name: 'Drag to move Storybook' })
    grip.focus()
    await userEvent.keyboard('{ArrowUp}')
    await expect(args.onOrder).toHaveBeenCalledWith(['storybook', 'pitch', 'desktop', 'probe'])
    // It shows where it was put, the default now, and its grip keeps the focus.
    await expect(page.getAllByRole('listitem')[0]).toHaveTextContent(/^Storybook.*Default$/)
    await expect(grip).toHaveFocus()
    await userEvent.click(page.getAllByRole('button', { name: 'Make default' })[1]!)
    await expect(args.onDefault).toHaveBeenCalledWith('desktop')
    await userEvent.click(page.getByRole('button', { name: 'Remove bun --filter @althar/runtime probe:tools' }))
    await expect(args.onRemove).toHaveBeenCalledWith('probe')
    await userEvent.click(page.getByRole('button', { name: 'Edit Desktop app' }))
    await expect(args.onEdit).toHaveBeenCalledWith('desktop')
  },
}

/** Everything taken out. */
export const Empty: Story = { args: { runnables: [] } }

/** The runtime said no to removing or ordering one. */
export const ListFailed: Story = { args: { error: 'Storybook is running; stop it first.' } }

/** Adding one by typing its command and a name for it. */
export const AddTyped: StoryObj<typeof AddRunnable> = {
  render: (args) => <AddRunnable {...args} />,
  args: { way: 'type', repositories: ['althar'], scripts: SCRIPTS, onAdd: fn(), onAddScripts: fn(), onAsk: fn(), onClose: fn() },
  play: async ({ args }) => {
    const page = within(document.body)
    await expect(page.getByRole('button', { name: 'Add' })).toBeDisabled()
    await userEvent.type(await page.findByRole('textbox', { name: /Command/ }), 'bun --filter @althar/pitch preview')
    await userEvent.type(page.getByRole('textbox', { name: /Name/ }), 'Pitch site, as built')
    await userEvent.click(page.getByRole('button', { name: 'Add' }))
    await expect(args.onAdd).toHaveBeenCalledWith({
      name: 'Pitch site, as built',
      command: 'bun --filter @althar/pitch preview',
      repository: 'althar',
    })
  },
}

/** In a project of several repositories, which one it runs in. */
export const AddInOneOfSeveral: StoryObj<typeof AddRunnable> = {
  render: (args) => <AddRunnable {...args} />,
  args: { ...AddTyped.args, way: 'type', repositories: ['meridian-api', 'meridian-web'] } as StoryObj<typeof AddRunnable>['args'],
}

/** Picking from the repository's scripts, several at once. */
export const AddFromScripts: StoryObj<typeof AddRunnable> = {
  render: (args) => <AddRunnable {...args} />,
  args: { ...AddTyped.args, way: 'scripts' } as StoryObj<typeof AddRunnable>['args'],
  play: async ({ args }) => {
    const page = within(document.body)
    await userEvent.type(await page.findByRole('textbox', { name: /Find among 5 scripts/ }), 'filter @althar')
    await userEvent.click(page.getByRole('checkbox', { name: /storybook dev --port 6006/ }))
    await userEvent.click(page.getByRole('checkbox', { name: /bun run build && electron/ }))
    await userEvent.click(page.getByRole('button', { name: 'Add 2' }))
    await expect(args.onAddScripts).toHaveBeenCalledWith(['storybook', 'desktop'])
  },
}

/** In a project of several repositories, the same script in each, each saying which. */
export const ScriptsInSeveral: StoryObj<typeof AddRunnable> = {
  render: (args) => <AddRunnable {...args} />,
  args: {
    ...AddTyped.args,
    way: 'scripts',
    repositories: ['althar', 'althar-site'],
    scripts: [
      { id: 'althar:storybook', command: 'bun run storybook', body: 'storybook dev --port 6006', repository: 'althar' },
      { id: 'site:storybook', command: 'bun run storybook', body: 'storybook dev --port 6007', repository: 'althar-site' },
    ],
  } as StoryObj<typeof AddRunnable>['args'],
  play: async ({ args }) => {
    const page = within(document.body)
    await userEvent.type(await page.findByRole('textbox', { name: /Find among 2 scripts/ }), 'site')
    await userEvent.click(page.getByRole('checkbox', { name: /althar-site/ }))
    await userEvent.click(page.getByRole('button', { name: 'Add' }))
    await expect(args.onAddScripts).toHaveBeenCalledWith(['site:storybook'])
  },
}

/** While the scripts are read. */
export const ReadingScripts: StoryObj<typeof AddRunnable> = {
  render: (args) => <AddRunnable {...args} />,
  args: { ...AddTyped.args, way: 'scripts', scripts: null } as StoryObj<typeof AddRunnable>['args'],
}

/** None left that aren't kept. */
export const NoScripts: StoryObj<typeof AddRunnable> = {
  render: (args) => <AddRunnable {...args} />,
  args: { ...AddTyped.args, way: 'scripts', scripts: [] } as StoryObj<typeof AddRunnable>['args'],
}

/** Asking the coordinator to work it out: it answers in the project's conversation. */
export const AddByAsking: StoryObj<typeof AddRunnable> = {
  render: (args) => <AddRunnable {...args} />,
  args: { ...AddTyped.args, way: 'ask' } as StoryObj<typeof AddRunnable>['args'],
  play: async ({ args }) => {
    const page = within(document.body)
    await userEvent.click(await page.findByRole('button', { name: 'Ask the coordinator' }))
    await expect(args.onAsk).toHaveBeenCalledOnce()
  },
}

/** The runtime said no. */
export const AddFailed: StoryObj<typeof AddRunnable> = {
  render: (args) => <AddRunnable {...args} />,
  args: { ...AddTyped.args, error: 'The project has no repository on this Mac to run it in.' } as StoryObj<typeof AddRunnable>['args'],
}

/** Changing one the person added: its name and command; or removing it. */
export const Edit: StoryObj<typeof EditRunnable> = {
  render: (args) => <EditRunnable {...args} />,
  args: {
    name: 'Storybook',
    command: 'bun --filter @althar/ui storybook',
    own: false,
    from: 'person',
    repository: 'althar',
    repositories: ['althar'],
    onSave: fn(),
    onRemove: fn(),
    onClose: fn(),
  },
  play: async ({ args }) => {
    const page = within(document.body)
    const name = await page.findByRole('textbox', { name: /Name/ })
    await userEvent.clear(name)
    await userEvent.type(name, 'Storybook, the kit')
    await userEvent.click(page.getByRole('button', { name: 'Save' }))
    await expect(args.onSave).toHaveBeenCalledWith({
      name: 'Storybook, the kit',
      command: 'bun --filter @althar/ui storybook',
      repository: 'althar',
    })
  },
}

/** Its repository's own way stays its own, unless its command changes. */
export const EditOwn: StoryObj<typeof EditRunnable> = {
  render: (args) => <EditRunnable {...args} />,
  args: { ...Edit.args, name: null, command: 'bun run dev', own: true, from: 'repository' } as StoryObj<typeof EditRunnable>['args'],
  play: async ({ args }) => {
    const page = within(document.body)
    await userEvent.type(await page.findByRole('textbox', { name: /Name/ }), 'Pitch site')
    await userEvent.click(page.getByRole('button', { name: 'Save' }))
    await expect(args.onSave).toHaveBeenCalledWith({ name: 'Pitch site', command: null, repository: 'althar' })
    await userEvent.click(page.getByRole('button', { name: 'Remove' }))
    await expect(args.onRemove).toHaveBeenCalledOnce()
  },
}

/** In a project of several repositories, moved to another. */
export const EditInOneOfSeveral: StoryObj<typeof EditRunnable> = {
  render: (args) => <EditRunnable {...args} />,
  args: {
    ...Edit.args,
    repositories: ['meridian-api', 'meridian-web'],
    repository: 'meridian-web',
    error: 'Althar couldn’t keep it.',
  } as StoryObj<typeof EditRunnable>['args'],
}
