/* Copied from packages/runtime/src/presets.ts (its module reaches Node, so a page can't import it): the parts, the built-in presets, and `describe`. */

export interface PresetParts {
  readonly workspace: 'copy' | 'worktree' | 'local'
  readonly checked: 'before' | 'after' | 'none'
  readonly end: 'draft' | 'ready' | 'none'
  readonly shelf: 'scratch' | 'board'
  readonly lead: string | null
  readonly reviewer: string | null
  readonly brief: string
  readonly reviews?: boolean
}

export interface Preset {
  readonly id: string
  readonly name: string
  readonly parts: PresetParts
  readonly builtin: boolean
  readonly projectId: string | null
}

export const BUILT_IN: ReadonlyArray<Preset> = [
  {
    id: 'builtin:chat',
    name: 'Chat',
    builtin: true,
    projectId: null,
    parts: { workspace: 'copy', checked: 'none', end: 'none', shelf: 'scratch', lead: null, reviewer: null, brief: '' },
  },
  {
    id: 'builtin:change',
    name: 'Change',
    builtin: true,
    projectId: null,
    parts: { workspace: 'worktree', checked: 'before', end: 'draft', shelf: 'board', lead: null, reviewer: null, brief: '' },
  },
  {
    id: 'builtin:small-change',
    name: 'Small change',
    builtin: true,
    projectId: null,
    parts: { workspace: 'worktree', checked: 'after', end: 'ready', shelf: 'board', lead: null, reviewer: null, brief: '' },
  },
  {
    id: 'builtin:review',
    name: 'Review a PR',
    builtin: true,
    projectId: null,
    parts: { workspace: 'copy', checked: 'none', end: 'none', shelf: 'board', lead: null, reviewer: null, brief: '', reviews: true },
  },
  {
    id: 'builtin:prototype',
    name: 'Prototype',
    builtin: true,
    projectId: null,
    parts: {
      workspace: 'worktree',
      checked: 'after',
      end: 'none',
      shelf: 'board',
      lead: 'claude-code/claude-opus-5-5',
      reviewer: null,
      brief: 'A prototype: show the idea working, quickly. Its effort follows its size.',
    },
  },
]

export const describe = (parts: PresetParts) =>
  [
    parts.workspace === 'copy' ? 'a copy' : parts.workspace === 'local' ? 'Local' : 'a worktree',
    parts.checked === 'none' ? 'no review' : parts.checked === 'after' ? 'reviewed after it merges' : 'reviewed before it ships',
    parts.end === 'none' ? 'ends here' : parts.end === 'ready' ? 'a pull request ready for review' : 'a draft pull request',
    parts.lead === null ? 'the coordinator picks its lead' : `led by ${parts.lead.split('/').at(-1) ?? parts.lead}`,
  ].join(', ')
