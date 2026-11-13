import { Fragment } from 'react'

import c from './command.module.css'

/*
 * A command, read for a person: the folder it runs in (its leading `cd`), the
 * settings it sets first (NAME=value), the program by its own name (no
 * ../../node_modules/.bin/ in front), what it's asked to do (its words before
 * the first option), and each option with its value. Copy still copies the
 * whole command as it ran; this is only how it reads.
 */

export interface Option {
  flag: string
  value?: string
  /** Written --flag=value, not --flag value. */
  joined?: boolean
}

export interface ReadCommand {
  dir?: string
  env: ReadonlyArray<readonly [string, string]>
  program: string
  /** Its words before the first option: dev, run dev. */
  words: readonly string[]
  options: readonly Option[]
}

/** Splits on spaces outside quotes and $( ). */
const split = (text: string): string[] => {
  const out: string[] = []
  let word = ''
  let quote: string | null = null
  let depth = 0
  for (const ch of text) {
    if (quote !== null) {
      word += ch
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") {
      quote = ch
      word += ch
    } else if (ch === '(') {
      depth++
      word += ch
    } else if (ch === ')') {
      depth--
      word += ch
    } else if (ch === ' ' && depth === 0) {
      if (word !== '') out.push(word)
      word = ''
    } else word += ch
  }
  if (word !== '') out.push(word)
  return out
}

/** Its quotes off, where they only hold one word or a $( ). */
const unquoted = (value: string) => (/^"[^"]*"$/.test(value) ? value.slice(1, -1) : value)

export function readCommand(command: string): ReadCommand {
  let rest = command.trim()
  let dir: string | undefined
  const cd = /^cd\s+(\S+)\s*&&\s*/.exec(rest)
  if (cd !== null) {
    dir = cd[1]
    rest = rest.slice(cd[0].length)
  }
  const words = split(rest)
  const env: Array<readonly [string, string]> = []
  while (words[0] !== undefined && /^[A-Z_][A-Z0-9_]*=/.test(words[0])) {
    const [name, ...value] = words.shift()!.split('=')
    env.push([name!, unquoted(value.join('='))])
  }
  const program = (words.shift() ?? '').replace(/^(?:\.{1,2}\/)*(?:[\w.-]+\/)*node_modules\/\.bin\//, '')
  const lead: string[] = []
  while (words[0] !== undefined && !words[0].startsWith('-')) lead.push(words.shift()!)
  const options: Option[] = []
  while (words.length > 0) {
    const word = words.shift()!
    const [flag, inline] =
      word.startsWith('--') && word.includes('=') ? [word.slice(0, word.indexOf('=')), word.slice(word.indexOf('=') + 1)] : [word]
    if (inline !== undefined) options.push({ flag: flag!, value: inline, joined: true })
    else if (words[0] !== undefined && !words[0].startsWith('-')) options.push({ flag: flag!, value: words.shift()! })
    else options.push({ flag: flag! })
  }
  return { ...(dir === undefined ? {} : { dir }), env, program, words: lead, options }
}

/** What it runs, at a glance, for a run with no name: bun run dev. */
export const glanceOf = (command: string) => {
  const r = readCommand(command)
  return [r.program, ...r.words].join(' ')
}

/** The command, short, as a terminal would show it typed: what Terminal takes. */
export const shortCommand = (command: string) => {
  const r = readCommand(command)
  return [
    ...r.env.map(([k, v]) => `${k}=${v}`),
    r.program,
    ...r.words,
    ...r.options.map((o) => (o.value === undefined ? o.flag : `${o.flag}${o.joined === true ? '=' : ' '}${o.value}`)),
  ].join(' ')
}

function Opt({ o }: { o: Option }) {
  return (
    <>
      <span className={c.flag}>{o.flag}</span>
      {o.value !== undefined && (
        <>
          {o.joined === true ? <span className={c.eq}>=</span> : ' '}
          <span className={c.value}>{o.value}</span>
        </>
      )}
    </>
  )
}

/**
 * As a prompt: the folder, quiet, then what was typed, in the kit's syntax
 * inks; long, it wraps under its own start, never under the folder.
 */
export function PromptCommand({ command }: { command: string }) {
  const r = readCommand(command)
  return (
    <span className={c.prompt}>
      {r.dir !== undefined && <span className={c.dir}>{r.dir}</span>}
      <code className={c.typed}>
        {r.env.map(([k, v]) => (
          <Fragment key={k}>
            <span className={c.env}>{k}</span>
            <span className={c.eq}>=</span>
            <span className={c.value}>{v}</span>{' '}
          </Fragment>
        ))}
        <span className={c.program}>{r.program}</span>
        {r.words.map((w, i) => (
          <Fragment key={i}> {w}</Fragment>
        ))}
        {r.options.map((o, i) => (
          <Fragment key={i}>
            {' '}
            <Opt o={o} />
          </Fragment>
        ))}
      </code>
    </span>
  )
}

/**
 * As facts: what it runs, each option on a line of its own under it, the
 * folder, and what it sets first. Labels as the kit's key-value lists set
 * them.
 */
export function FactsCommand({ command }: { command: string }) {
  const r = readCommand(command)
  return (
    <dl className={c.facts}>
      <dt>Runs</dt>
      <dd>
        <code className={c.stack}>
          <span>
            <span className={c.program}>{r.program}</span>
            {r.words.map((w, i) => (
              <Fragment key={i}> {w}</Fragment>
            ))}
          </span>
          {r.options.map((o, i) => (
            <span key={i} className={c.indent}>
              <Opt o={o} />
            </span>
          ))}
        </code>
      </dd>
      {r.dir !== undefined && (
        <>
          <dt>In</dt>
          <dd>
            <code className={c.path}>{r.dir}</code>
          </dd>
        </>
      )}
      {r.env.length > 0 && (
        <>
          <dt>Sets</dt>
          <dd>
            <code className={c.stack}>
              {r.env.map(([k, v]) => (
                <span key={k}>
                  <span className={c.env}>{k}</span>
                  <span className={c.eq}> = </span>
                  <span className={c.value}>{v}</span>
                </span>
              ))}
            </code>
          </dd>
        </>
      )}
    </dl>
  )
}
