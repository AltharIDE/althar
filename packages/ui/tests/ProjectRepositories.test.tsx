import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MAP_HOSTS, MAP_MERIDIAN } from '../src/fixtures/setup'
import { ProjectRepositories } from '../src/screens/ProjectRepositories/ProjectRepositories'

/* A project's repositories on its settings page: the map, with only what the page gives it. */

describe('a project’s repositories', () => {
  it('offers no way to connect, open or leave one out where the page gives none, and says its worktrees aren’t made yet', () => {
    render(
      <ProjectRepositories
        project="Meridian"
        repositories={MAP_MERIDIAN}
        hosts={MAP_HOSTS}
        onRoleChange={() => {}}
        onTargetChange={() => {}}
        text={{ note: 'Where its tasks work.' }}
      />,
    )
    expect(screen.getByText('Where its tasks work.')).toBeInTheDocument()
    expect(screen.getByText('Tasks work in their own worktrees, never in these folders')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Connect GitLab' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^More for/ })).not.toBeInTheDocument()
  })
})
