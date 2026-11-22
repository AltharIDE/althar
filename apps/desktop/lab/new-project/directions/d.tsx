import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import type { ThreadItem } from '@althar/contracts'
import { Brand, BrandMark, Button, Composer, Icon, ProjectInk, Room } from '@althar/ui'

import { newProjectId } from '../../../src/renderer/data/client'
import { useServices } from '../../../src/renderer/data/services'
import { draftsOf } from '../../../src/renderer/features/newProject/draft'
import { items } from '../../../tests/fixtures'
import { ACCOUNT, FOUND, type Found, HOME, on, pastedOf, REPOS, slugOf, world } from '../world'
import dd from './d.module.css'

/*
 * D · An agent sets it up. Where a project is asked for, the page is a
 * composer: say where its code is and what it's for, as to the coordinator.
 * The project is made at once, named from what was said, and the window is
 * on its conversation, where an agent on the home does the setup in the
 * open: clones each repository, installs what they need there (a toolchain
 * the home lacks too), runs the tests once, and records the setup, so every
 * task after starts ready. What it can't do, such as a secret only the
 * person has, it asks for there.
 */

type Repo = (typeof REPOS)[number]

/** The repositories and folders named in what was said: owner/name, a URL, or a bare name that is one of yours. */
const namedIn = (said: string): { repos: Repo[]; folders: Found[] } => {
  const words = said.toLowerCase()
  const repos: Repo[] = []
  for (const one of REPOS) if (words.includes(`${one.owner}/${one.name}`.toLowerCase())) repos.push(one)
  const urls = said.match(/https?:\/\/github\.com\/[\w.-]+\/[\w.-]+/g) ?? []
  for (const url of urls) {
    const one = pastedOf(url)
    if (one !== null && !repos.some((kept) => kept.id === one.id)) repos.push(one)
  }
  // "its api": a bare name, of an owner already named, or one only one owner has.
  const owners = new Set(repos.map((one) => one.owner))
  for (const one of REPOS) {
    if (repos.includes(one) || !new RegExp(`\\b${one.name}\\b`, 'i').test(said.replace(/[\w.-]+\/[\w.-]+/g, ''))) continue
    if (owners.has(one.owner) || REPOS.filter((other) => other.name === one.name).length === 1) repos.push(one)
  }
  const folders = FOUND.filter((one) => new RegExp(`\\b${one.name}\\b`, 'i').test(said))
  return { repos, folders }
}

/** What a repository needs on the home before it builds, and how its check runs, by what reading it finds. */
const recipeOf = (reads: string, name: string) => {
  if (reads.includes('pnpm'))
    return { tool: null, install: 'corepack enable && pnpm install --frozen-lockfile', check: 'pnpm test', passed: '42 passed (6.1s)' }
  if (reads.includes('Go'))
    return {
      tool: 'curl -fsSL https://go.dev/dl/go1.23.4.linux-amd64.tar.gz | tar -xz -C ~/.local',
      install: 'go mod download',
      check: 'go test ./...',
      passed: `ok  github.com/northwind-co/${name}/...  4.1s`,
    }
  if (reads.includes('Bun'))
    return {
      tool: 'curl -fsSL https://bun.sh/install | bash',
      install: 'bun install --frozen-lockfile',
      check: 'bun run check',
      passed: 'Checked 11 packages in 18.4s',
    }
  if (reads.includes('Ruby'))
    return { tool: null, install: 'bundle install', check: 'bundle exec rspec', passed: '318 examples, 0 failures' }
  return { tool: null, install: 'npm ci', check: 'npm test', passed: 'Tests passed' }
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

/** The agent's setup, in the project's conversation, a line at a time. */
const setUp = async (projectId: string, said: string, repos: Repo[], folders: Found[]) => {
  const say = (item: ThreadItem) => world.say(projectId, item)
  const tool = async (title: string, command: string, output: string, ms: number) => {
    const item = items.tool({ title, toolKind: 'execute', status: 'in_progress', command, output: null, exit: null })
    say(item)
    await wait(ms)
    world.resay(
      projectId,
      item.id,
      (was) =>
        ({
          ...was,
          content: { ...(was.content as Record<string, unknown>), status: 'completed', output, exit: 0 },
        }) as unknown as ThreadItem,
    )
  }
  const tests = /test|pass|green|ci/i.test(said)
  const all = [...repos.map((one) => one.name), ...folders.map((one) => one.name)]
  const steps = [
    ...(repos.length > 0 ? [`Clone ${repos.map((one) => `${one.owner}/${one.name}`).join(' and ')}`] : []),
    ...(folders.length > 0 ? [`Open ${folders.map((one) => one.where).join(' and ')}`] : []),
    `Get ${all.length > 1 ? 'them' : 'it'} building ${on}`,
    tests ? 'Run the tests once' : 'Build once',
    'Record the setup for tasks',
  ]
  const plan = (done: number) =>
    items.plan(steps.map((content, at) => ({ content, status: at < done ? 'completed' : at === done ? 'in_progress' : 'pending' })))
  world.work(projectId, true)
  await wait(700)
  const planned = plan(0)
  say(planned)
  const progress = (done: number) => world.resay(projectId, planned.id, () => ({ ...plan(done), id: planned.id }))
  await wait(500)
  let at = 0
  if (repos.length > 0) {
    if (repos.some((one) => one.private) && !world.githubThere())
      say(
        items.notice(
          {
            title: `GitHub signed in ${on} as ${ACCOUNT}, approved in your browser on this Mac`,
            description: null,
            source: 'runtime',
            severity: 'info',
          },
          null,
        ),
      )
    for (const one of repos)
      await tool(
        `Clone ${one.owner}/${one.name}`,
        `git clone https://github.com/${one.owner}/${one.name} ${HOME.place}/${one.name}`,
        `Cloning into '${one.name}'…\nReceiving objects: 100% (${one.size * 211}/${one.size * 211}), ${one.size} MiB, done.`,
        1300 + one.size * 15,
      )
    progress((at += 1))
  }
  if (folders.length > 0) progress((at += 1))
  await wait(400)
  const reads = [
    ...repos.map((one) => ({ name: one.name, reads: one.reads })),
    ...folders.map((one) => ({ name: one.name, reads: one.reads })),
  ]
  say(
    items.says(
      `${reads.map((one) => `**${one.name}** is ${one.reads.charAt(0).toLowerCase()}${one.reads.slice(1)}`).join('; ')}. ${HOME.remote ? `${HOME.name} has git, and nothing else they need yet.` : ''}`,
    ),
  )
  await wait(700)
  for (const one of reads) {
    const recipe = recipeOf(one.reads, one.name)
    if (recipe.tool !== null && HOME.remote) await tool('Install the toolchain', recipe.tool, 'Installed.', 1400)
    await tool(`Install ${one.name}’s dependencies`, `cd ${HOME.place}/${one.name} && ${recipe.install}`, 'Done in 14.2s', 1600)
  }
  // What your own tools need there, as a toolchain is: your MCP servers are yours on every home, and each runs where the work is.
  if (world.need('docker').state === 'missing') {
    void world.fix('docker')
    await tool('Install Docker, for your postgres MCP server', 'curl -fsSL https://get.docker.com | sh', 'Docker 28.1.1 installed.', 2400)
  }
  progress((at += 1))
  for (const one of reads) {
    const recipe = recipeOf(one.reads, one.name)
    await tool(
      tests ? `Run ${one.name}’s tests` : `Build ${one.name}`,
      `cd ${HOME.place}/${one.name} && ${recipe.check}`,
      recipe.passed,
      1500,
    )
  }
  progress((at += 1))
  await wait(400)
  say(items.tool({ title: 'Recorded the setup for tasks', toolKind: 'other', status: 'completed', command: null }))
  progress(steps.length)
  await wait(500)
  say(
    items.says(
      `Ready ${on}. ${tests ? 'The tests pass in each. ' : ''}Every task here starts from the recorded setup, in a worktree of its own, with what it needs installed.${world.need('codex').state === 'missing' ? ` Codex isn’t signed in ${on}; a task that asks for it says so.` : ''}\n\nWhat should we start on?`,
    ),
  )
  world.work(projectId, false)
}

const SUGGESTED = REPOS.slice(0, 5).map((one) => `${one.owner}/${one.name}`)

export function DPage({ first = false, onCreated }: { first?: boolean; onCreated?: (projectId: string) => void; onClose?: () => void }) {
  const { client } = useServices()
  const navigate = useNavigate()
  const [said, setSaid] = useState('')
  const named = namedIn(said)
  const send = (text: string) => {
    if (text.trim() === '') return
    const { repos, folders } = namedIn(text)
    const drafts = draftsOf(client)
    const id = first ? newProjectId() : (drafts.get()?.id ?? newProjectId())
    const owners = [...new Set(repos.map((one) => one.owner))]
    const [one] = repos
    const name =
      repos.length > 1 && owners.length === 1
        ? (owners[0] ?? '').replace(/-co$/, '')
        : (one?.name ?? folders[0]?.name ?? slugOf(text.split(/\s+/).slice(0, 3).join(' ')))
    const ink = one?.ink ?? folders[0]?.ink ?? ProjectInk.Teal
    drafts.change(id, (now) => ({ ...now, name }))
    world.add(id, name, ink, one === undefined ? (folders[0]?.where ?? `${HOME.place}/${name}`) : `${HOME.place}/${one.name}`)
    world.say(id, items.you(text))
    void setUp(id, text, repos, folders)
    onCreated?.(id)
    void navigate({ to: '/projects/$projectId', params: { projectId: id }, search: { room: Room.Both } })
  }
  return (
    <main className={dd.page}>
      <div className={dd.column}>
        <h1 className={dd.title}>{first ? `No projects ${on} yet` : `New project ${on}`}</h1>
        <p className={dd.lede}>
          Say where its code is and what it’s for. An agent {on} clones it, gets it building and records how, so every task starts ready.
        </p>
        <Composer
          value={said}
          onChange={setSaid}
          onSubmit={send}
          placeholder="Where its code is, and what it’s for"
          suggestion="northwind-co/app and its api. Get the tests passing."
          picker={
            <span className={dd.who}>
              <BrandMark brand={Brand.ClaudeCode} size={13} />
              Claude Code {on}
            </span>
          }
          text={{}}
        />
        <div className={dd.found}>
          {named.repos.length + named.folders.length > 0 ? (
            <p className={dd.reads}>
              <Icon name="check" size={12} />
              {[...named.repos.map((one) => `${one.owner}/${one.name}`), ...named.folders.map((one) => one.where)].join(', ')}
            </p>
          ) : (
            <>
              <span className={dd.yours}>Yours on GitHub</span>
              {SUGGESTED.map((one) => (
                <Button
                  key={one}
                  size="small"
                  variant="quiet"
                  onClick={() => setSaid((was) => (was.trim() === '' ? one : `${was.trim()} and ${one}`))}
                >
                  {one}
                </Button>
              ))}
            </>
          )}
        </div>
      </div>
    </main>
  )
}
