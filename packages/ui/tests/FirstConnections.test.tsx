import { fireEvent, render, screen, within } from '@testing-library/react'
import { userEvent } from 'storybook/test'
import { describe, expect, it, vi } from 'vitest'

import { Brand } from '../src/foundations/brands/brands'
import { FirstConnections } from '../src/setup/FirstConnections/FirstConnections'

const GITHUB = { id: 'github', name: 'GitHub', brand: Brand.GitHub }
const HOSTS = [GITHUB, { id: 'gitlab', name: 'GitLab', brand: Brand.GitLab }, { id: 'bitbucket', name: 'Bitbucket' }]
const LINEAR = { id: 'linear', name: 'Linear', brand: Brand.Linear }
const TRACKERS = [LINEAR, { id: 'jira', name: 'Jira', brand: Brand.Jira }]

describe('a new project’s card for its code host and tracker', () => {
  it('names the host the code is on, connects it, and offers the trackers behind one menu', async () => {
    const onConnect = vi.fn()
    render(
      <FirstConnections
        host={{ service: GITHUB, where: 'northwind/meridian' }}
        trackers={TRACKERS}
        onConnect={onConnect}
        onHide={vi.fn()}
      />,
    )
    expect(screen.getByRole('region', { name: 'Before the first pull request' })).toBeInTheDocument()
    expect(screen.getByText('northwind/meridian')).toBeInTheDocument()
    expect(screen.getByText('Linear or Jira')).toBeInTheDocument()
    const [host, trackers] = screen.getAllByRole('button', { name: 'Connect' })
    if (host === undefined || trackers === undefined) throw new Error('Two ways to connect')
    fireEvent.click(host)
    expect(onConnect).toHaveBeenCalledWith('github')
    await userEvent.click(trackers)
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Jira' }))
    expect(onConnect).toHaveBeenCalledWith('jira')
  })

  it('offers every host behind one menu where the code names none', async () => {
    const onConnect = vi.fn()
    render(<FirstConnections hosts={HOSTS} onConnect={onConnect} onHide={vi.fn()} />)
    expect(screen.getByText('GitHub, GitLab or Bitbucket')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
    const menu = await screen.findByRole('menu', { name: 'Code hosts' })
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Bitbucket' }))
    expect(onConnect).toHaveBeenCalledWith('bitbucket')
  })

  it('asks only for a tracker once a host is connected, and is put away with ×', () => {
    const onHide = vi.fn()
    render(<FirstConnections trackers={[LINEAR]} onConnect={vi.fn()} onHide={onHide} />)
    expect(screen.getByRole('heading', { name: 'Bring in your issues' })).toBeInTheDocument()
    expect(screen.getByText('Linear')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(onHide).toHaveBeenCalled()
  })

  it('shows a walk in in place of its rows, and nothing once everything is connected', () => {
    const { rerender, container } = render(
      <FirstConnections host={{ service: GITHUB }} onConnect={vi.fn()} onHide={vi.fn()} walk={<p>The walk</p>} />,
    )
    expect(screen.getByText('The walk')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull()
    rerender(<FirstConnections onConnect={vi.fn()} onHide={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
})
