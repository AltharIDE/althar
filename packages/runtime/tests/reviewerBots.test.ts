import { describe, expect, it } from 'vitest'

import { botName, reviewerBot, trusts } from '../src/reviewerBots'

/* Which bots Althar recognises as review or triage agents, to suggest a project trust them (code-hosts § Review and triage bots). */

describe('the review and triage bots Althar recognises', () => {
  it('knows the review agents by their accounts, whatever their case', () => {
    expect(reviewerBot('coderabbitai[bot]')).toEqual({ login: 'coderabbitai[bot]', name: 'CodeRabbit' })
    expect(reviewerBot('Copilot-Pull-Request-Reviewer[bot]')).toEqual({ login: 'copilot-pull-request-reviewer[bot]', name: 'Copilot' })
    expect(reviewerBot('claude[bot]')?.name).toBe('Claude')
    expect(reviewerBot('cursor[bot]')?.name).toBe('Cursor Bugbot')
  })

  it('recognises a bot named for an agent, such as a team’s own review action', () => {
    expect(reviewerBot('claude-review[bot]')).toEqual({ login: 'claude-review[bot]', name: 'Claude review' })
    expect(reviewerBot('acme-codex-triage[bot]')?.name).toBe('Acme codex triage')
  })

  it('suggests no bot that only reports, deploys or bumps, nor coding agents nor people', () => {
    for (const login of [
      'cloudflare-workers-and-pages[bot]',
      'codecov[bot]',
      'vercel[bot]',
      'netlify[bot]',
      'dependabot[bot]',
      'renovate[bot]',
      'github-actions[bot]',
      'changeset-bot[bot]',
      'sonarcloud[bot]',
      'claude-coverage[bot]',
      'copilot-swe-agent[bot]',
      'google-labs-jules[bot]',
      'campaign-roomba[bot]',
      'claude',
      'dana',
    ])
      expect(reviewerBot(login), login).toBeNull()
  })

  it('names a bot it doesn’t recognise from its account, and trusts by account whatever the case', () => {
    expect(botName('codecov[bot]')).toBe('Codecov')
    expect(trusts(['CodeRabbitAI[bot]'], 'coderabbitai[bot]')).toBe(true)
    expect(trusts([], 'coderabbitai[bot]')).toBe(false)
  })
})
