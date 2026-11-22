import { useMemo, useRef, useState } from 'react'

import { Brand, BrandMark, Button, Icon, Light, ProjectInk, ProjectMark } from '@althar/ui'

import { enter, type Intent } from '../entries'
import { FOUND, HOME, pastedOf, REPOS, slugOf } from '../world'
import a from './ask.module.css'
import { useArrive, usePasteAnywhere } from './Welcome'
import w from './welcome.module.css'

/*
 * 4 · Ask. The welcome is one big line under one big question. As you type,
 * the question becomes what pressing will do ("Clone althar", "Open
 * legacy-billing", "Start invoices empty"), the project's mark-to-be swells
 * up behind it, and what matches lines up under the field to pick by
 * pointer or arrows. Before anything's typed, what was pushed last and
 * what's already on the home. Return, or the button beside the line, opens
 * the New project page on it.
 */

interface Match {
  readonly key: string
  readonly kind: 'repo' | 'folder' | 'path' | 'new'
  readonly name: string
  /** Where it is, under its name. */
  readonly from: string
  readonly seed: string
  readonly ink: ProjectInk
  readonly intent: Intent
}

const ofRepo = (one: (typeof REPOS)[number], query = ''): Match => ({
  key: one.id,
  kind: 'repo',
  name: one.name,
  from: `${one.owner} on GitHub`,
  seed: one.id,
  ink: one.ink,
  intent: { way: 'clone', repo: one.id, ...(query === '' ? {} : { query }) },
})
const ofFolder = (one: (typeof FOUND)[number]): Match => ({
  key: one.id,
  kind: 'folder',
  name: one.name,
  from: one.where,
  seed: one.id,
  ink: one.ink,
  intent: { way: 'folder', folder: one.id },
})
const ofNew = (name: string): Match => ({
  key: `new:${name}`,
  kind: 'new',
  name,
  from: `A new repository on ${HOME.name}`,
  seed: `new:${slugOf(name)}`,
  ink: ProjectInk.Teal,
  intent: { way: 'new', fresh: name },
})

const matchesOf = (typed: string): readonly Match[] => {
  const query = typed.trim()
  if (query === '') return [...REPOS.slice(0, 3).map((one) => ofRepo(one)), ...FOUND.map(ofFolder)]
  const pasted = pastedOf(query)
  if (pasted !== null && query.includes('/')) return [ofRepo(pasted, query)]
  const q = query.toLowerCase()
  if (q.startsWith('/') || q.startsWith('~')) {
    const found = FOUND.filter((one) => one.where.toLowerCase().startsWith(q) || one.where.toLowerCase().includes(q))
    const typedPath: Match = {
      key: `path:${query}`,
      kind: 'path',
      name: query.replace(/\/+$/, '').split('/').at(-1) || query,
      from: query,
      seed: `path:${query}`,
      ink: ProjectInk.Sand,
      intent: { way: 'folder', path: query },
    }
    return found.length > 0 ? found.map(ofFolder) : [typedPath]
  }
  const repos = REPOS.filter((one) => `${one.owner}/${one.name}`.toLowerCase().includes(q)).slice(0, 4)
  const folders = FOUND.filter((one) => one.name.toLowerCase().includes(q)).slice(0, 2)
  return [...repos.map((one) => ofRepo(one)), ...folders.map(ofFolder), ofNew(query)]
}

const VERB: Record<Match['kind'], string> = { repo: 'Clone', folder: 'Open', path: 'Open', new: 'Start' }

export function AskWelcome() {
  const ref = useArrive<HTMLElement>()
  const [query, setQuery] = useState('')
  const [at, setAt] = useState(0)
  const field = useRef<HTMLInputElement>(null)
  const go = useRef<HTMLButtonElement>(null)
  const matches = useMemo(() => matchesOf(query), [query])
  const typed = query.trim() !== ''
  const top = typed ? (matches[Math.min(at, matches.length - 1)] ?? null) : null
  usePasteAnywhere((text) => {
    setQuery(text.trim())
    setAt(0)
    field.current?.focus()
  })
  const pick = (one: Match | null, door?: HTMLElement | null) => enter(one?.intent ?? {}, door ?? go.current)

  return (
    <main ref={ref} className={`${w.stage} ${a.stage}`}>
      <div className={w.light} aria-hidden="true">
        <Light height={typed ? 0.38 : 0.62} />
      </div>
      {top !== null && (
        <div key={top.seed} className={a.giant} aria-hidden="true">
          <ProjectMark seed={top.seed} ink={top.ink} size={620} quiet />
        </div>
      )}
      <div className={a.column}>
        <span className={w.eyebrow} data-arrive>
          <Icon name="home" size={13} />
          {HOME.name} · {HOME.what}
        </span>
        <div className={a.headline} aria-live="polite">
          {top === null ? (
            <h1 key="ask" className={`${w.display} ${a.title}`}>
              What should {HOME.name} work on?
            </h1>
          ) : (
            <h1 key={`${top.kind}:${top.name}`} className={`${w.display} ${a.title}`} data-says>
              <span className={a.verb}>{VERB[top.kind]}</span> <span className={a.object}>{top.name}</span>
              {top.kind === 'new' && <span className={a.verb}> empty</span>}
            </h1>
          )}
          <p key={`sub:${top?.key ?? ''}`} className={a.sub}>
            {top === null
              ? 'Paste a repository’s address, type its name, or a path on it.'
              : top.kind === 'repo'
                ? `From ${top.from}, onto ${HOME.name}`
                : top.kind === 'new'
                  ? top.from
                  : `Already on ${HOME.name}, at ${top.from}`}
          </p>
        </div>
        <form
          className={a.ask}
          data-arrive
          onSubmit={(event) => {
            event.preventDefault()
            pick(top)
          }}
        >
          <Icon name="search" size={20} className={a.askIcon} />
          <input
            ref={field}
            className={a.field}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setAt(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
                if (event.key === 'ArrowRight' && field.current?.selectionStart !== query.length) return
                event.preventDefault()
                setAt((was) => Math.min(was + 1, matches.length - 1))
              }
              if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
                if (event.key === 'ArrowLeft' && at === 0) return
                event.preventDefault()
                setAt((was) => Math.max(was - 1, 0))
              }
            }}
            placeholder="github.com/you/repository, a name, or ~/code/…"
            aria-label={`What ${HOME.name} should work on`}
            spellCheck={false}
            autoFocus
          />
          <Button ref={go} type="submit" variant="signal" className={a.go}>
            {top === null ? 'New project' : VERB[top.kind]}
          </Button>
        </form>
        <ul className={a.matches} aria-label={typed ? 'Matches' : 'Suggestions'}>
          {matches.map((one, i) => (
            <li key={one.key} style={{ ['--i' as string]: i }}>
              <button
                type="button"
                className={a.match}
                data-at={(typed && i === Math.min(at, matches.length - 1)) || undefined}
                onPointerEnter={() => typed && setAt(i)}
                onClick={(event) => pick(one, event.currentTarget)}
              >
                {one.kind === 'repo' ? (
                  <ProjectMark seed={one.seed} ink={one.ink} size={34} />
                ) : (
                  <span className={a.tile} data-kind={one.kind}>
                    <Icon name={one.kind === 'new' ? 'plus' : 'folder'} size={16} />
                  </span>
                )}
                <span className={a.matchText}>
                  <span className={a.matchName}>{one.name}</span>
                  <span className={a.matchFrom} data-mono={one.kind === 'folder' || one.kind === 'path' || undefined}>
                    {one.kind === 'repo' && <BrandMark brand={Brand.GitHub} size={11} />}
                    {one.kind === 'repo' ? one.from.replace(' on GitHub', '') : one.kind === 'new' ? 'New repository' : one.from}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </main>
  )
}
