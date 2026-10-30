import { type ReactNode, type Ref, useId, useLayoutEffect, useRef, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { CommandMatch } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { FieldError } from '../../primitives/Field/Field'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { Tooltip } from '../../primitives/HoverCard/HoverCard'
import { IconButton, type IconButtonProps } from '../../primitives/IconButton/IconButton'
import { Kbd } from '../../primitives/Kbd/Kbd'
import { Menu, MenuRadioGroup, MenuRadioItem, type MenuProps } from '../../primitives/Menu/Menu'
import { Select } from '../../primitives/Select/Select'
import s from './Charter.module.css'

/*
 * A project's rules read as a few sentences, in the order a request meets
 * them, each with its word in the margin. What Althar knows the meaning of
 * is an underlined word, which opens what it can be; a command is code, in
 * its own small box, taken out with its × and added where its sentence
 * ends. The parts are always used together, by the rules screen.
 */

export type CharterProps = RootProps<'ol', { children: ReactNode }>

/** The sentences, one under the other, between hairlines. */
export function Charter({ className, ...rest }: CharterProps) {
  return <ol className={cx(s.charter, className)} {...rest} />
}

export type ClauseProps = RootProps<
  'li',
  {
    /** The word in the margin: Never, Ask me, Go ahead. It names the sentence. */
    label: string
    /** The margin word as a heading at this rank, so the sentences can be found by it. */
    headingLevel?: HeadingLevel
    /** What no project can change: smaller and quieter, behind a lock. */
    fixed?: boolean
    /** Why the sentence holds for nothing just now, said under it; the sentence stays, quieter, and can still be changed. */
    off?: string
    /** It starts a part of its own, after a gap: how a task ends, after what it may do. */
    apart?: boolean
    /** Under the sentence: how a command being added matches, and the keys. */
    below?: ReactNode
    /** The sentence. */
    children: ReactNode
  }
>

/** One sentence of the rules, with its word in the margin. */
export function Clause({ label, headingLevel, fixed = false, off, apart = false, below, children, className, ...rest }: ClauseProps) {
  const labelId = useId()
  return (
    <li
      aria-labelledby={labelId}
      className={cx(s.clause, fixed && s.fixed, off !== undefined && s.off, apart && s.apart, className)}
      {...rest}
    >
      {headingLevel === undefined ? (
        <span id={labelId} className={s.label}>
          {label}
        </span>
      ) : (
        <Heading level={headingLevel} id={labelId} className={s.label}>
          {label}
        </Heading>
      )}
      <p className={s.text}>
        {fixed && <Icon name="lock" size={13} className={s.lock} />}
        {children}
      </p>
      {off !== undefined && <p className={s.offNote}>{off}</p>}
      {below != null && <div className={s.below}>{below}</div>}
    </li>
  )
}

export interface CharterKeyText {
  /** What the key is, for a screen reader. */
  label: string
  /** An underlined word, shown underlined. */
  word: string
  wordMeans: string
  /** A command, shown as code. */
  code: string
  codeMeans: string
}

export const charterKeyText: CharterKeyText = {
  label: 'How to read it',
  word: 'underlined',
  wordMeans: 'Built in: Althar knows what it means',
  code: 'code',
  codeMeans: 'A command, matched by how it starts',
}

export type CharterKeyProps = RootProps<'dl', { text?: Partial<CharterKeyText> }>

/** How to read the sentences: an underlined word is built in, code is a command. */
export function CharterKey({ text, className, ...rest }: CharterKeyProps) {
  const t = { ...charterKeyText, ...text }
  return (
    <dl aria-label={t.label} className={cx(s.key, className)} {...rest}>
      <div className={s.keyRow}>
        <dt className={s.keyWord}>{t.word}</dt>
        <dd>{t.wordMeans}</dd>
      </div>
      <div className={s.keyRow}>
        <dt>
          <code className={s.keyCode}>{t.code}</code>
        </dt>
        <dd>{t.codeMeans}</dd>
      </div>
    </dl>
  )
}

export type RuleWordProps = RootProps<
  'button',
  {
    /** A name as it is spelt, in the code's type: a branch, a title. */
    mono?: boolean
    children: ReactNode
  }
>

/** A built-in setting as the sentence has it: an underlined word that opens what it can be. */
export function RuleWord({ mono = false, className, type = 'button', ...rest }: RuleWordProps) {
  return <button type={type} className={cx(s.word, mono && s.mono, className)} {...rest} />
}

/** One thing a word can be: its title in the menu, and what choosing it means. */
export interface ChoiceWordOption<V extends string> {
  value: V
  title: string
  note?: string
}

export interface ChoiceWordProps<V extends string> extends Pick<MenuProps, 'open' | 'defaultOpen' | 'onOpenChange' | 'width'> {
  /** The word, as the sentence has it. */
  word: ReactNode
  /** What is being chosen: the menu's name, and its heading. */
  label: string
  options: readonly ChoiceWordOption<V>[]
  value: V
  onChange: (value: V) => void
  /** A quiet line at the menu's foot: what the setting catches, or where it comes from. */
  note?: ReactNode
  mono?: boolean
  /** The word's button, for a consumer that moves focus to it: where a choice moves the word to another sentence. */
  wordRef?: Ref<HTMLButtonElement>
}

/** A built-in setting with a few values: its word, and the menu it opens, with the current one checked. */
export function ChoiceWord<V extends string>({
  word,
  label,
  options,
  value,
  onChange,
  note,
  mono,
  wordRef,
  width = 330,
  ...menu
}: ChoiceWordProps<V>) {
  return (
    <Menu
      label={label}
      width={width}
      note={note}
      trigger={
        <RuleWord ref={wordRef} mono={mono}>
          {word}
        </RuleWord>
      }
      {...menu}
    >
      <MenuRadioGroup
        label={label}
        value={value}
        onChange={(picked) => {
          const option = options.find((each) => each.value === picked)
          if (option !== undefined) onChange(option.value)
        }}
      >
        {options.map((option) => (
          <MenuRadioItem key={option.value} value={option.value} description={option.note}>
            {option.title}
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
    </Menu>
  )
}

export interface CommandTokenText {
  /** Before a rule for the whole line. */
  exactly: string
  /** The × that takes it out, by the command as the rule has it. */
  remove: (command: string) => string
}

export const commandTokenText: CommandTokenText = {
  exactly: 'exactly',
  remove: (command) => `Remove ${command}`,
}

export type CommandTokenProps = RootProps<
  'span',
  {
    /** The command as the rule keeps it: how it starts, or the whole line. */
    pattern: string
    match?: CommandMatch
    /** Takes the rule out. Without it, the command only reads. */
    onRemove?: () => void
    text?: Partial<CommandTokenText>
  }
>

/**
 * A command rule as the sentence has it: code in its own small box, with
 * "exactly" before a rule for the whole line. One too long for its box is
 * cut short, and shows whole on hover; from the keyboard, its × is named by
 * the whole command and says it on focus. Its × shows on hover or when it
 * has focus.
 */
export function CommandToken({ pattern, match = CommandMatch.Prefix, onRemove, text, className, ...rest }: CommandTokenProps) {
  const t = { ...commandTokenText, ...text }
  const exact = isExact(match)
  const code = useRef<HTMLElement>(null)
  const [cut, setCut] = useState(false)
  // Whether the box cuts it short, once it is laid out: then it can be read whole.
  useLayoutEffect(() => {
    const element = code.current
    if (element !== null) setCut(element.scrollWidth > element.clientWidth)
  }, [pattern])
  const command = exact ? `${t.exactly} ${pattern}` : pattern
  return (
    <span className={cx(s.token, className)} {...rest}>
      {exact && <span className={s.exact}>{t.exactly} </span>}
      {cut ? (
        <Tooltip label={pattern}>
          <code ref={code} className={s.code}>
            {pattern}
          </code>
        </Tooltip>
      ) : (
        <code ref={code} className={s.code}>
          {pattern}
        </code>
      )}
      {onRemove && (
        <IconButton icon="close" size="small" label={t.remove(command)} className={s.remove} onClick={onRemove} data-remove="" />
      )}
    </span>
  )
}

const isExact = (match: CommandMatch) => {
  switch (match) {
    case CommandMatch.Exact:
      return true
    case CommandMatch.Prefix:
      return false
  }
}

export type AddCommandProps = Omit<IconButtonProps, 'icon' | 'size'>

/** The small + at a sentence's end, which adds a command to it. */
export function AddCommand({ className, ...rest }: AddCommandProps) {
  return <IconButton icon="plus" size="small" className={cx(s.add, className)} data-add="" {...rest} />
}

export type NewCommandProps = RootProps<
  'input',
  {
    value: string
    /** What is typed won't do: the box says so, and its reason is given by `aria-describedby`. */
    invalid?: boolean
  }
>

/**
 * The command being added, typed where it will sit in its sentence: a box
 * like a command's that grows with what is typed. It needs a name, and
 * takes its own Escape, so a menu or page round it doesn't.
 */
export function NewCommand({ value, invalid = false, className, ...rest }: NewCommandProps) {
  return (
    <input
      type="text"
      spellCheck={false}
      autoComplete="off"
      autoCapitalize="off"
      size={Math.max(value.length + 1, 8)}
      value={value}
      aria-invalid={invalid || undefined}
      data-own-escape=""
      className={cx(s.newCommand, invalid && s.invalid, className)}
      {...rest}
    />
  )
}

export interface NewCommandHintText {
  /** The choice of how it matches, for a screen reader. */
  match: string
  matches: Record<CommandMatch, string>
  /** What a rule by how it starts holds for, before the command. */
  holds: string
  /** What a rule for the whole line holds for. */
  holdsLine: string
  /** Before anything is typed. */
  empty: Record<CommandMatch, string>
  enter: string
  adds: string
  esc: string
  leaves: string
}

export const newCommandHintText: NewCommandHintText = {
  match: 'How it matches',
  matches: { [CommandMatch.Prefix]: 'Starts with', [CommandMatch.Exact]: 'Exactly' },
  holds: 'Holds for',
  holdsLine: 'Holds for this line alone',
  empty: {
    [CommandMatch.Prefix]: 'How the command starts, * for anything',
    [CommandMatch.Exact]: 'The whole line, as an agent would run it',
  },
  enter: '↵',
  adds: 'adds it',
  esc: 'esc',
  leaves: 'leaves it',
}

export type NewCommandHintProps = RootProps<
  'div',
  {
    /** What is typed so far. */
    pattern: string
    match: CommandMatch
    /** A match chosen. Focus is the consumer's to put back, in the field being typed in. Without it, there is no choice. */
    onMatchChange?: (match: CommandMatch) => void
    /** Why it wasn't added, under the rest. */
    error?: string | null
    /** The id the field points `aria-describedby` at for the error. */
    errorId?: string
    /** The id the field points `aria-describedby` at for what it holds for. */
    noteId?: string
    text?: Partial<NewCommandHintText>
  }
>

const MATCHES = [CommandMatch.Prefix, CommandMatch.Exact] as const

/** Under a command being added: how it matches, where it can be chosen, what it holds for, the keys, and why it wasn't added. */
export function NewCommandHint({ pattern, match, onMatchChange, error, errorId, noteId, text, className, ...rest }: NewCommandHintProps) {
  const t = { ...newCommandHintText, ...text }
  const ownErrorId = useId()
  const typed = pattern.trim()
  // Once a match is chosen, focus goes back where the consumer puts it; closed without one, to the choice.
  const chosen = useRef(false)
  return (
    <div className={cx(s.hint, className)} {...rest}>
      {onMatchChange !== undefined && (
        <Select
          label={t.match}
          variant="quiet"
          options={MATCHES.map((value) => ({ value, label: t.matches[value] }))}
          value={match}
          onChange={(next) => {
            chosen.current = true
            onMatchChange(next)
          }}
          returnFocus={() => {
            const back = !chosen.current
            chosen.current = false
            return back
          }}
        />
      )}
      <span id={noteId} className={s.holds}>
        {typed === '' ? (
          t.empty[match]
        ) : isExact(match) ? (
          t.holdsLine
        ) : (
          <>
            {t.holds} <code>{typed} …</code>
          </>
        )}
      </span>
      <span className={s.keys}>
        <Kbd>{t.enter}</Kbd> {t.adds} <Kbd>{t.esc}</Kbd> {t.leaves}
      </span>
      {error && (
        <span className={s.error}>
          <FieldError id={errorId ?? ownErrorId}>{error}</FieldError>
        </span>
      )}
    </div>
  )
}
