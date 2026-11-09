import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { CROWDED_PROJECTS, SKILL_SYNC, SKILLS, TOOL_AGENTS, TOOL_PROJECTS } from '../../fixtures/tools'
import type { SkillReviewModel } from '../Skills/Skills'
import { AddSkillDialog } from './AddSkillDialog'
import { SkillSheet } from './SkillSheet'
import { SkillTiles, type SkillTilesProps } from './SkillTiles'
import type { SkillTileModel } from './tools'

const width = (px: number) => (Story: () => ReactNode) => <div style={{ maxWidth: px }}>{Story()}</div>

const CARD: SkillReviewModel = {
  id: 'release-notes',
  repo: 'charrette/agent-skills',
  ref: 'main',
  sha: '3f9c2b17a0d84e6c9b1f5a2e7d3c8b4a6f0e1d2c',
  subpath: 'skills/release-notes',
  license: 'MIT',
  description: 'Write the notes for a release from the pull requests merged since the last tag.',
  instructions: '---\nname: release-notes\ndescription: Write the notes for a release.\n---\n\n# Release notes\n',
  files: [{ path: 'SKILL.md', bytes: 1840, executable: false }],
  findings: [],
  installable: true,
  replaces: null,
  update: false,
  changes: [{ path: 'SKILL.md', change: 'added', lines: [{ kind: 'added', text: '# Release notes' }] }],
}

const meta = {
  title: 'Setup/ToolTiles/SkillTiles',
  component: SkillTiles,
  parameters: { layout: 'padded' },
  decorators: [width(880)],
  args: { skills: SKILLS, agents: TOOL_AGENTS, projects: TOOL_PROJECTS, sync: SKILL_SYNC, onRoles: fn(), onSync: fn(), onAdd: fn() },
  render: (args) => <Kept {...args} />,
} satisfies Meta<typeof SkillTiles>
export default meta
type Story = StoryObj<typeof meta>

/** The section with a model behind it; each opened skill is a SkillSheet, and Add from GitHub opens the AddSkillDialog. */
function Kept(args: SkillTilesProps) {
  const [skills, setSkills] = useState(args.skills)
  const [sync, setSync] = useState(args.sync)
  const [adding, setAdding] = useState<'find' | 'review' | null>(null)
  const change = (id: string, to: (one: SkillTileModel) => SkillTileModel) =>
    setSkills((now) => now.map((one) => (one.id === id ? to(one) : one)))
  return (
    <>
      <SkillTiles
        {...args}
        skills={skills}
        sync={sync}
        onRoles={(skill, roles) => {
          args.onRoles(skill, roles)
          change(skill.id, (one) => ({ ...one, roles }))
        }}
        onSync={(on, takeBack) => {
          args.onSync(on, takeBack)
          setSync((now) => ({ ...now, on }))
        }}
        onAdd={() => {
          args.onAdd?.()
          setAdding('find')
        }}
        sheet={(skill, back) => (
          <SkillSheet
            skill={skill}
            agents={args.agents}
            projects={args.projects}
            onBack={back}
            onRoles={(roles) => change(skill.id, (one) => ({ ...one, roles }))}
            onProject={(project, on) =>
              change(skill.id, (one) => ({ ...one, offIn: on ? one.offIn.filter((id) => id !== project) : [...one.offIn, project] }))
            }
            onUpdate={() => change(skill.id, (one) => ({ ...one, update: false }))}
            onRemove={() => setSkills((now) => now.filter((one) => one.id !== skill.id))}
          />
        )}
      />
      {adding !== null && (
        <AddSkillDialog
          found={{ repo: 'charrette/agent-skills', sha: CARD.sha, paths: ['skills/release-notes', 'skills/changelog'] }}
          busy={false}
          error={null}
          card={adding === 'review' ? CARD : null}
          onFind={() => {}}
          onReview={() => setAdding('review')}
          onInstall={() => {
            setSkills((now) => [
              ...now.filter((one) => one.id !== 'release-notes'),
              {
                id: 'release-notes',
                name: 'release-notes',
                about: CARD.description ?? '',
                roles: ['lead', 'reviewer', 'coordinator'],
                offIn: [],
                repository: null,
                here: { claude: 'added', codex: 'added', opencode: 'added' },
                home: '~/.agents/skills/release-notes',
                from: 'charrette/agent-skills',
                update: false,
              },
            ])
            setAdding(null)
          }}
          onBack={() => setAdding('find')}
          onClose={() => setAdding(null)}
        />
      )}
    </>
  )
}

/** Each skill a tile, the one with an update first; Add from GitHub and Same skills everywhere at the end. */
export const Usual: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByRole('switch')[0]).toHaveAccessibleName('release-checklist')
    await expect(canvas.getByText('Update ready')).toBeVisible()
    await expect(canvas.getByText('Leads and reviewers · not in fnt')).toBeVisible()
    await expect(canvas.getByRole('heading', { name: 'In althar’s repository' })).toBeVisible()
  },
}

/** Opened in place, and back to the tile it came from. */
export const OpensInPlace: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^release-checklist/ }))
    await expect(canvas.getByRole('heading', { name: 'release-checklist' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(canvas.getByRole('button', { name: /^release-checklist/ })).toHaveFocus())
    await userEvent.keyboard('{Enter}')
    await userEvent.click(canvas.getByRole('button', { name: 'Update' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(canvas.getByRole('button', { name: /^release-checklist/ })).toHaveFocus())
    await expect(canvas.queryByText('Update ready')).toBeNull()
  },
}

/** Same skills everywhere turns on at once, links only; off, it asks whether its links stay. */
export const SameSkills: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('switch', { name: 'Same skills everywhere' }))
    await expect(args.onSync).toHaveBeenCalledWith(true, false)
    await userEvent.click(canvas.getByRole('switch', { name: 'Same skills everywhere' }))
    const dialog = within(await within(document.body).findByRole('dialog', { name: 'Stop linking them everywhere?' }))
    await expect(dialog.getByText(/It linked 4 skills/)).toBeVisible()
    await userEvent.click(dialog.getByRole('button', { name: 'Leave them' }))
    await expect(args.onSync).toHaveBeenCalledWith(false, false)
  },
}

/** Add from GitHub: find, read, add; the new skill lands as a tile. */
export const AddFromGitHub: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Add from GitHub' }))
    const body = within(document.body)
    await userEvent.click((await body.findAllByRole('button', { name: 'Review' }))[0]!)
    await userEvent.click(await body.findByRole('button', { name: 'Install' }))
    await waitFor(() => expect(canvas.getByRole('switch', { name: 'release-notes' })).toBeVisible())
  },
}

/** None yet: where each agent keeps its skills, then Add from GitHub and Same skills everywhere. */
export const Empty: Story = {
  args: { skills: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: 'No skills yet' })).toBeVisible()
    await expect(canvas.getByText('~/.config/opencode/skills')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Add from GitHub' })).toBeVisible()
  },
}

export const Crowded: Story = {
  args: {
    projects: CROWDED_PROJECTS,
    skills: [
      ...SKILLS,
      ...Array.from({ length: 16 }, (_, at): SkillTileModel => ({
        ...SKILLS[at % 5]!,
        id: `more-${at}`,
        name: `${SKILLS[at % 5]!.name}-${['notes', 'review', 'plans', 'checks'][at % 4]}-${at}`,
        offIn: at % 3 === 0 ? ['p3', 'p4', 'p5'] : [],
      })),
    ],
  },
}

export const Loading: Story = { args: { loading: true } }

export const ReadFailed: Story = { args: { error: 'Claude Code’s skill folder can’t be read: permission denied.', onRetry: fn() } }

export const Narrow: Story = { decorators: [width(708)] }

export const Dark: Story = { globals: { theme: 'dark' } }

export const DarkEmpty: Story = { args: { skills: [] }, globals: { theme: 'dark' } }
