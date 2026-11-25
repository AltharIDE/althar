import { Brand, ProjectInk, RuntimeState, type ProjectTab, type RuntimeEntry } from '@althar/ui'

/*
 * One person's PC, as the lab has it: Windows 11 with WSL 2, where Ubuntu holds
 * their code, their agents and their sign-ins; Debian, stopped, that they tried
 * once; an old Ubuntu-20.04 still on WSL 1; one repository on Windows' own
 * disk; and a server they connected before, vps. Docker Desktop's own distros
 * are there too, and never shown.
 */

export interface Distro {
  readonly name: string
  readonly wsl: 1 | 2
  readonly running: boolean
  readonly default?: boolean
  readonly system: string
  /** The agents signed in there, by name. */
  readonly agents: readonly string[]
  readonly repositories: number
}

export const DISTROS: readonly Distro[] = [
  { name: 'Ubuntu', wsl: 2, running: true, default: true, system: 'Ubuntu 24.04.1 LTS', agents: ['Claude Code', 'Codex'], repositories: 6 },
  { name: 'Debian', wsl: 2, running: false, system: 'Debian 12', agents: [], repositories: 1 },
  { name: 'Ubuntu-20.04', wsl: 1, running: false, system: 'Ubuntu 20.04.6 LTS', agents: ['Claude Code'], repositories: 2 },
]

/** What a distro has, in a line, for choosing one. */
export const distroLine = (distro: Distro) => {
  if (distro.wsl === 1) return 'WSL 1. A home needs WSL 2'
  const agents = distro.agents.length === 0 ? 'No agents' : `${distro.agents.join(' and ')} signed in`
  const repos = distro.repositories === 1 ? '1 repository' : `${distro.repositories} repositories`
  return `${agents} · ${repos}${distro.running ? '' : ' · Stopped'}`
}

export const P = {
  meridian: { id: 'prj_meridian', seed: 'prj_meridian', name: 'Meridian', ink: ProjectInk.Clay },
  atlas: { id: 'prj_atlas', seed: 'prj_atlas', name: 'Atlas', ink: ProjectInk.Indigo },
  ledger: { id: 'prj_ledger', seed: 'prj_ledger', name: 'Ledger', ink: ProjectInk.Moss },
  tessera: { id: 'prj_tessera', seed: 'prj_tessera', name: 'Tessera', ink: ProjectInk.Teal },
} as const

export const tab = (project: (typeof P)[keyof typeof P], running = false, yours = 0): ProjectTab => ({
  id: project.id,
  seed: project.seed,
  name: project.name,
  ink: project.ink,
  running,
  yours,
})

const CLAUDE_CODE = { id: 'claude-code', name: 'Claude Code', brand: Brand.ClaudeCode }
const CODEX = { id: 'codex', name: 'Codex', brand: Brand.Codex }
const GEMINI = { id: 'gemini-cli', name: 'Gemini CLI', brand: Brand.GeminiCli }

/** What Windows itself has: nothing; its agents are in Ubuntu. */
export const ON_WINDOWS: RuntimeEntry[] = [
  { ...CLAUDE_CODE, state: RuntimeState.Missing, download: '70 MB' },
  { ...CODEX, state: RuntimeState.Missing, download: '45 MB' },
  { ...GEMINI, state: RuntimeState.Missing },
]

/** What Ubuntu has, as Althar found it there. */
export const IN_UBUNTU: RuntimeEntry[] = [
  { ...CLAUDE_CODE, state: RuntimeState.Ready, account: 'ana@meridian.dev · Max', version: '2.4.1' },
  { ...CODEX, state: RuntimeState.Ready, account: 'ana@meridian.dev · Pro', version: '0.52.0' },
  { ...GEMINI, state: RuntimeState.Missing, download: '38 MB' },
]

/** Ubuntu's, still being asked. */
export const IN_UBUNTU_ASKING: RuntimeEntry[] = [
  { ...CLAUDE_CODE, state: RuntimeState.Checking },
  { ...CODEX, state: RuntimeState.Checking },
]

/** Ubuntu's, where its agents aren't ready yet: one signed out, one not installed there. */
export const IN_UBUNTU_UNREADY: RuntimeEntry[] = [
  { ...CLAUDE_CODE, state: RuntimeState.SignedOut },
  { ...CODEX, state: RuntimeState.Missing, download: '45 MB' },
]
