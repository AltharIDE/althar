import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { OPUS, SONNET } from '../src/fixtures/models'
import { GITHUB } from '../src/fixtures/outputs'
import { ChangeState, CheckState } from '../src/foundations/vocabulary'
import { ChangeSet, foldersOf, type PullRequest } from '../src/outputs/ChangeSet/ChangeSet'
import type { ChangedFile } from '../src/primitives/FileChanges/FileChanges'

/*
 * What a task changed, on the Outputs page: where it stands, its checks and
 * review in a line each, and its files by folder.
 */

const files = (...paths: string[]): ChangedFile[] => paths.map((path) => ({ path, add: 3, del: 1 }))
const one = (more: Partial<PullRequest> = {}): PullRequest[] => [
  { repo: 'stripe-internal/meridian-api', number: 1191, files: files('src/refunds/create.ts'), ...more },
]

describe('where a change stands', () => {
  it('names its pull request without a link where it has no host', () => {
    render(<ChangeSet state={ChangeState.Ready} prs={one({ url: 'https://github.com/stripe-internal/meridian-api/pull/1191' })} />)
    expect(screen.getByText('PR #1191')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('counts the commits its remote does not have yet', () => {
    render(<ChangeSet state={ChangeState.Branch} prs={one({ number: undefined })} remote={{ name: 'origin', pushed: true, ahead: 3 }} />)
    expect(screen.getByText('3 commits not on origin yet')).toBeInTheDocument()
  })

  it('says how big a change of one file is', () => {
    render(<ChangeSet state={ChangeState.Ready} host={GITHUB} prs={one()} />)
    expect(screen.getByText('1 file')).toBeInTheDocument()
  })
})

describe('its checks and review, a line each', () => {
  it('says one check passed', () => {
    render(<ChangeSet state={ChangeState.Ready} prs={one()} checks={[{ id: 'unit', name: 'Unit', state: CheckState.Passed }]} />)
    expect(screen.getByRole('button', { name: 'Its checks: 1 check passed' })).toBeInTheDocument()
  })

  it('names every check that failed', () => {
    render(
      <ChangeSet
        state={ChangeState.Ready}
        prs={one()}
        checks={[
          { id: 'unit', name: 'Unit', state: CheckState.Failed },
          { id: 'lint', name: 'Lint', state: CheckState.Passed },
          { id: 'e2e', name: 'Integration', state: CheckState.Failed },
        ]}
      />,
    )
    expect(screen.getByRole('button', { name: 'Its checks: 2 checks failed: Unit, Integration' })).toBeInTheDocument()
  })

  it('gives a review its own line without any checks, by who asked for changes', () => {
    render(<ChangeSet state={ChangeState.Ready} prs={one()} review={{ state: CheckState.Failed, by: [SONNET] }} />)
    expect(screen.queryByRole('button', { name: /Its checks/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Changes asked by/)).toBeInTheDocument()
  })

  it('says a review still going is being done, and by whom', () => {
    render(<ChangeSet state={ChangeState.Ready} prs={one()} review={{ state: CheckState.Running, by: [OPUS] }} />)
    expect(screen.getByText(/Being reviewed by/)).toBeInTheDocument()
  })
})

describe('its files by folder', () => {
  it('keeps a folder whole when only some of it is in subfolders and it holds no more than half the change', () => {
    const folders = foldersOf(
      files('apps/desktop/main.ts', 'apps/site/index.ts', 'apps/README.md', 'docs/retry.md', 'src/limit.ts', 'lib/x.ts'),
    )
    expect(folders.map((f) => [f.path, f.files.length])).toEqual([
      ['apps', 3],
      ['docs', 1],
      ['lib', 1],
      ['src', 1],
    ])
  })

  it('splits a folder holding most of the change into its own folders, keeping its own files under it', () => {
    const folders = foldersOf(files('packages/ui/a.ts', 'packages/ui/b.ts', 'packages/runtime/c.ts', 'packages/README.md', 'README.md'))
    expect(folders.map((f) => [f.path, f.files.length])).toEqual([
      ['packages/ui', 2],
      ['', 1],
      ['packages', 1],
      ['packages/runtime', 1],
    ])
  })

  it('opens a file at the top of the repository by its own path', () => {
    const onOpenFile = vi.fn()
    render(<ChangeSet state={ChangeState.Ready} prs={one({ files: files('README.md', 'src/limit.ts') })} onOpenFile={onOpenFile} />)
    expect(screen.getByRole('button', { name: /Top level/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open the diff of README.md' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open the diff of src/limit.ts' }))
    expect(onOpenFile.mock.calls).toEqual([['README.md'], ['src/limit.ts']])
  })
})
