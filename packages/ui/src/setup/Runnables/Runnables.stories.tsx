import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { AddRunnable, EditRunnable, type ListedRunnable, type PickableScript, RunnableList, Runnables } from './Runnables'
import { LONG } from './long'

/* This repository's own scripts, as its package.json files say them. */
const SCRIPTS: PickableScript[] = [
  { id: 'site', command: 'bun run site', body: 'bun --filter @althar/site dev' },
  { id: 'check', command: 'bun run check', body: "bun --filter '*' check" },
  { id: 'storybook', command: 'bun --filter @althar/ui storybook', body: 'storybook dev --port 6006 --no-open' },
  { id: 'desktop', command: 'bun --filter @althar/desktop dev', body: 'bun run build && electron .' },
  { id: 'preview', command: 'bun --filter @althar/site preview', body: 'vp preview' },
]

const LISTED: ListedRunnable[] = [
  { id: 'dev', name: 'Public site', command: 'bun run dev', about: 'althar · Worked out from the repository' },
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
    await expect(args.onOrder).toHaveBeenCalledWith(['storybook', 'dev', 'desktop', 'probe'])
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

/** Everything taken out: what will be here and how it gets here, over the way to add one in the dialog's foot. */
export const Empty: Story = {
  args: { runnables: [] },
  play: async () => {
    const page = within(document.body)
    await expect(await page.findByRole('heading', { level: 3, name: 'Nothing to run yet' })).toBeVisible()
    await expect(page.getByText(/Run starts it without an agent/)).toBeVisible()
    await expect(page.queryByRole('list')).toBeNull()
    await expect(page.getByRole('button', { name: 'Add something to run' })).toBeVisible()
  },
}

/** Nothing yet, on a page of the project's settings, at night. */
export const EmptyOnAPageDark: StoryObj<typeof RunnableList> = {
  render: (args) => (
    <div style={{ width: 760, padding: 24, background: 'var(--n-1)' }}>
      <RunnableList {...args} />
    </div>
  ),
  args: { runnables: [], onOrder: fn(), onDefault: fn(), onEdit: fn(), onRemove: fn() },
  globals: { theme: 'dark' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('region', { name: 'Nothing to run yet' })).toBeVisible()
  },
}

/** The runtime said no to removing or ordering one. */
export const ListFailed: Story = { args: { error: 'Storybook is running; stop it first.' } }

/** The same list on a page of its own, as the project's settings have it: no dialog, the same rows. */
export const ListOnAPage: StoryObj<typeof RunnableList> = {
  render: (args) => (
    <div style={{ width: 720, padding: 24 }}>
      <RunnableList {...args} />
    </div>
  ),
  args: { runnables: LISTED, onOrder: fn(), onDefault: fn(), onEdit: fn(), onRemove: fn() },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.queryByRole('dialog')).toBeNull()
    await expect(c.getAllByRole('listitem')[0]).toHaveTextContent(/^Public site.*Default$/)
    await userEvent.click(c.getByRole('button', { name: 'Edit Storybook' }))
    await expect(args.onEdit).toHaveBeenCalledWith('storybook')
  },
}

/**
 * Dozens of them, as a project of labs and prototypes has: searched, sorted by who added each, and only the first few
 * until all are asked for. The default stays first; searched or sorted, nothing drags.
 */
export const LongListOnAPage: StoryObj<typeof RunnableList> = {
  render: (args) => (
    <div style={{ width: 720, padding: 24 }}>
      <RunnableList {...args} />
    </div>
  ),
  args: { runnables: LONG, onOrder: fn(), onDefault: fn(), onEdit: fn(), onRemove: fn() },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    // The first few, the default first, and the rest behind Show all.
    await expect(c.getAllByRole('listitem')).toHaveLength(8)
    await expect(c.getAllByRole('listitem')[0]).toHaveTextContent(/^Desktop app.*Default$/)
    await userEvent.click(c.getByRole('button', { name: `Show all ${LONG.length}` }))
    await expect(c.getAllByRole('listitem')).toHaveLength(LONG.length)
    await userEvent.click(c.getByRole('button', { name: 'Show fewer' }))
    // The person's own, at once.
    await userEvent.click(c.getByRole('radio', { name: 'Yours' }))
    await expect(c.getAllByRole('listitem')).toHaveLength(LONG.filter((one) => one.from === 'person').length)
    await expect(c.queryByRole('button', { name: /^Drag to move/ })).toBeNull()
    await userEvent.click(c.getAllByRole('button', { name: 'Make default' })[0]!)
    await expect(args.onDefault).toHaveBeenCalledWith('storybook')
    await userEvent.click(c.getByRole('radio', { name: 'All' }))
    // Searched by name, command or where it runs.
    await userEvent.type(c.getByRole('searchbox', { name: `Find among ${LONG.length}` }), 'handoff')
    await expect(c.getAllByRole('listitem')).toHaveLength(1)
    await userEvent.type(c.getByRole('searchbox'), 'x')
    await expect(c.getByText('Nothing here matches.')).toBeVisible()
    await userEvent.click(c.getByRole('button', { name: 'Clear' }))
    await expect(c.getAllByRole('listitem')).toHaveLength(8)
    await expect(c.getByRole('button', { name: 'Drag to move Desktop app' })).toBeVisible()
  },
}

/** The same, at night. */
export const LongListOnAPageDark: StoryObj<typeof RunnableList> = {
  ...LongListOnAPage,
  render: (args) => (
    <div style={{ width: 720, padding: 24, background: 'var(--n-1)' }}>
      <RunnableList {...args} />
    </div>
  ),
  globals: { theme: 'dark' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByRole('listitem')).toHaveLength(8)
  },
}

/** Adding one by typing its command and a name for it. */
export const AddTyped: StoryObj<typeof AddRunnable> = {
  render: (args) => <AddRunnable {...args} />,
  args: { way: 'type', repositories: ['althar'], scripts: SCRIPTS, onAdd: fn(), onAddScripts: fn(), onAsk: fn(), onClose: fn() },
  play: async ({ args }) => {
    const page = within(document.body)
    await expect(page.getByRole('button', { name: 'Add' })).toBeDisabled()
    await userEvent.type(await page.findByRole('textbox', { name: /Command/ }), 'bun --filter @althar/site preview')
    await userEvent.type(page.getByRole('textbox', { name: /Name/ }), 'Public site, as built')
    await userEvent.click(page.getByRole('button', { name: 'Add' }))
    await expect(args.onAdd).toHaveBeenCalledWith({
      name: 'Public site, as built',
      command: 'bun --filter @althar/site preview',
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

/**
 * Asking the coordinator to work it out: the request goes in its composer, unsent, for the person to change or send.
 * Nothing waits on it, even while the scripts are read behind it.
 */
export const AddByAsking: StoryObj<typeof AddRunnable> = {
  render: (args) => <AddRunnable {...args} />,
  args: { ...AddTyped.args, way: 'ask', scripts: null, busy: true } as StoryObj<typeof AddRunnable>['args'],
  play: async ({ args }) => {
    const page = within(document.body)
    const ask = await page.findByRole('button', { name: 'Ask the coordinator' })
    await expect(ask).not.toHaveAttribute('aria-busy')
    await expect(page.getByText(/goes in the coordinator’s composer, unsent/)).toBeVisible()
    await userEvent.click(ask)
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
    await userEvent.type(await page.findByRole('textbox', { name: /Name/ }), 'Public site')
    await userEvent.click(page.getByRole('button', { name: 'Save' }))
    await expect(args.onSave).toHaveBeenCalledWith({ name: 'Public site', command: null, repository: 'althar' })
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
