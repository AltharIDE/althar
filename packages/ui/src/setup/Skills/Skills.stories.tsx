import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { SkillInstall, SkillList, type SkillListProps, SkillReview, type SkillReviewModel, type SkillRowModel } from './Skills'

const SKILLS: SkillRowModel[] = [
  {
    id: 'brainstorming',
    description:
      'Use before building a new feature or change whose intent or design is not settled yet: draws out what the person wants and agrees a design before any code.',
    from: 'Althar',
    on: true,
    needsSubagents: false,
    canRollBack: false,
    removable: false,
  },
  {
    id: 'subagent-driven-development',
    description: 'Use when executing implementation plans with independent tasks in the current session.',
    from: 'Althar',
    on: true,
    needsSubagents: true,
    canRollBack: false,
    removable: false,
  },
  {
    id: 'systematic-debugging',
    description: 'Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes.',
    from: 'Althar',
    on: false,
    needsSubagents: false,
    canRollBack: false,
    removable: false,
  },
  {
    id: 'release-notes',
    description: 'Use when writing the notes for a release from the merged pull requests.',
    from: 'acme/agent-skills',
    on: true,
    needsSubagents: false,
    canRollBack: true,
    removable: true,
  },
]

const CARD: SkillReviewModel = {
  id: 'release-notes',
  repo: 'acme/agent-skills',
  ref: 'main',
  sha: '3f9c2b17a0d84e6c9b1f5a2e7d3c8b4a6f0e1d2c',
  subpath: 'skills/release-notes',
  license: 'MIT',
  description: 'Use when writing the notes for a release from the merged pull requests.',
  instructions:
    '---\nname: release-notes\ndescription: Use when writing the notes for a release from the merged pull requests.\nlicense: MIT\n---\n\n# Release notes\n\n1. List the pull requests merged since the last tag.\n2. Group them by what a reader cares about.\n3. Then run git push --tags.\n',
  files: [
    { path: 'SKILL.md', bytes: 1840, executable: false },
    { path: 'scripts/merged-since.sh', bytes: 612, executable: true },
  ],
  findings: [
    { level: 'flag', message: 'tells the agent to run git push', path: 'SKILL.md' },
    { level: 'flag', message: 'a script; Althar never runs it, the agent might', path: 'scripts/merged-since.sh' },
  ],
  installable: true,
  replaces: null,
  update: false,
  // A first install: every file is new.
  changes: [
    { path: 'SKILL.md', change: 'added', lines: [{ kind: 'added', text: '# Release notes' }] },
    {
      path: 'scripts/merged-since.sh',
      change: 'added',
      lines: [
        { kind: 'added', text: '#!/bin/sh' },
        { kind: 'added', text: 'git log --merges --oneline "$(git describe --tags --abbrev=0)"..HEAD' },
      ],
    },
  ],
}

const meta = {
  title: 'Setup/Skills',
  component: SkillList,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ maxWidth: 560 }}>{Story()}</div>],
  args: { skills: SKILLS, onToggle: fn(), onRollBack: fn(), onRemove: fn(), onToggleAll: fn() },
} satisfies Meta<typeof SkillList>
export default meta
type Story = StoryObj<typeof meta>

function Kept(args: SkillListProps) {
  const [skills, setSkills] = useState(args.skills)
  return (
    <SkillList
      {...args}
      skills={skills}
      onToggle={(id, on) => {
        args.onToggle(id, on)
        setSkills((now) => now.map((skill) => (skill.id === id ? { ...skill, on } : skill)))
      }}
      onToggleAll={(on) => {
        args.onToggleAll?.(on)
        setSkills((now) => now.map((skill) => (skill.problem === undefined ? { ...skill, on } : skill)))
      }}
    />
  )
}

/** Each skill on or off, where it is from, and what only some agents are given. */
export const List: Story = {
  render: (args) => <Kept {...args} />,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('3 of 4 on')).toBeVisible()
    await userEvent.click(canvas.getByRole('switch', { name: 'systematic-debugging' }))
    await expect(args.onToggle).toHaveBeenCalledWith('systematic-debugging', true)
    await expect(canvas.getByText('all 4 on')).toBeVisible()
    await expect(canvas.getByText('Only for agents that dispatch subagents')).toBeVisible()
    // Only the one the person installed can go back or be removed.
    await userEvent.click(canvas.getByRole('button', { name: 'Previous version' }))
    await expect(args.onRollBack).toHaveBeenCalledWith('release-notes')
    await expect(canvas.getAllByRole('button', { name: 'Remove' })).toHaveLength(1)
  },
}

/** Every skill at once: on while any is off, then off. */
export const AllAtOnce: Story = {
  render: (args) => <Kept {...args} />,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Turn all on' }))
    await expect(args.onToggleAll).toHaveBeenCalledWith(true)
    await expect(canvas.getByText('all 4 on')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Turn all off' }))
    await expect(args.onToggleAll).toHaveBeenCalledWith(false)
    await expect(canvas.getByText('0 of 4 on')).toBeVisible()
  },
}

/** One whose stored files Althar can't read: off, given to no run, and what to do about it. */
export const Broken: Story = {
  args: {
    skills: [
      {
        id: 'release-notes',
        description: 'Use when writing the notes for a release from the merged pull requests.',
        from: 'acme/agent-skills',
        on: false,
        needsSubagents: false,
        canRollBack: false,
        removable: true,
        problem: "Althar can't read this skill's stored files, so runs aren't given it. Install it again to put it right.",
      },
      ...SKILLS.slice(0, 1),
    ],
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/Install it again to put it right/)).toBeVisible()
  },
}

/** A repository looked in, its skill folders to choose from. */
export const Install: Story = {
  render: () => (
    <SkillInstall
      found={{ repo: 'acme/agent-skills', sha: CARD.sha, paths: ['skills/release-notes', 'skills/changelog'] }}
      busy={false}
      error={null}
      onFind={fn()}
      onReview={fn()}
    />
  ),
}

/** What GitHub wouldn't give, in words. */
export const InstallFailed: Story = {
  render: () => (
    <SkillInstall
      found={null}
      busy={false}
      error="GitHub /repos/acme/private-skills/commits/HEAD: not found (or private, which Althar does not install from yet)."
      onFind={fn()}
      onReview={fn()}
    />
  ),
}

/** A first install: where it is from, its licence, what to look at first, its files and what the agent is told. */
export const Review: Story = {
  render: () => <SkillReview card={CARD} busy={false} onInstall={fn()} onCancel={fn()} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Look at these first')).toBeVisible()
    // The script's own lines, not only its name, before it can be installed.
    await expect(canvas.getByText('Its other files')).toBeVisible()
    await expect(canvas.getByText('git log --merges', { exact: false })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Install' })).toBeEnabled()
  },
}

/** An update: only what changes. */
export const ReviewUpdate: Story = {
  render: () => (
    <SkillReview
      card={{
        ...CARD,
        findings: [],
        update: true,
        changes: [
          {
            path: 'SKILL.md',
            change: 'changed',
            lines: [
              { kind: 'same', text: '2. Group them by what a reader cares about.' },
              { kind: 'removed', text: '3. Then run git push --tags.' },
              { kind: 'added', text: '3. Stop and report the notes.' },
            ],
          },
          { path: 'scripts/merged-since.sh', change: 'removed', lines: [] },
        ],
      }}
      busy={false}
      onInstall={fn()}
      onCancel={fn()}
    />
  ),
}

/** One that can't be installed, and one that would take a default's place. */
export const ReviewRefusedAndReplacing: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 16 }}>
      <SkillReview
        card={{
          ...CARD,
          installable: false,
          findings: [
            { level: 'reject', message: '`allowed-tools` pre-approves tools for the turn that invokes the skill', path: 'SKILL.md' },
          ],
        }}
        busy={false}
        onInstall={fn()}
        onCancel={fn()}
      />
      <SkillReview
        card={{ ...CARD, id: 'brainstorming', findings: [], replaces: 'Althar' }}
        busy={false}
        onInstall={fn()}
        onCancel={fn()}
      />
    </div>
  ),
}
