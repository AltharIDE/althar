import { useId, useState } from 'react'
import { Button, Caret, Disclosure, DisclosureTrigger, Field, Fold, Icon, Problem } from '@althar/ui'

import type { CheckedHome, HomesHost, RemoteHome, SshHomeTarget } from '../../../homes'
import { Identity, type Options, OptionFields, optionsOf, Refusal, targetOf, useConnect, Working } from './ConnectHome'
import { homeProblem, hostOf, nameFrom } from './useHomes'
import s from './Homes.module.css'

/*
 * A saved home's connection, changed: the host checked first, and kept only
 * where it still has the same home. A host with another home isn't this one
 * any more: it can be saved beside it instead, without opening it.
 */

const sameTarget = (a: SshHomeTarget, b: SshHomeTarget) =>
  a.target === b.target && a.profile === b.profile && a.launcher === b.launcher && a.configFile === b.configFile && a.port === b.port

export const useEdit = (homes: HomesHost, home: RemoteHome) => {
  // What is kept: the saved connection, or the one just kept, ahead of main saying so.
  const [kept, setKept] = useState<SshHomeTarget>(home.ssh)
  const [was, setWas] = useState(home.ssh)
  if (!sameTarget(home.ssh, was)) {
    setWas(home.ssh)
    setKept(home.ssh)
  }
  const form = useConnect(homes, undefined, { target: home.ssh.target, options: optionsOf(home.ssh) })
  const baseline = optionsOf(kept)
  const dirty =
    form.target.trim() !== kept.target ||
    (Object.keys(baseline) as Array<keyof Options>).some((key) => form.options[key].trim() !== baseline[key])
  const [same, setSame] = useState(false)
  const [savedNew, setSavedNew] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const other = form.phase === 'checked' && form.checked !== null && form.checked.homeId !== home.homeId ? form.checked : null
  /** A check that found the same home: its connection is kept at once, and main catches up behind. */
  const keep = (checked: CheckedHome, next: SshHomeTarget) => {
    if (checked.homeId !== home.homeId) return
    const previous = kept
    setKept(next)
    setSame(true)
    void homes.change(home.id, checked.checkId).catch((error: unknown) => {
      setKept(previous)
      setSame(false)
      setProblem(homeProblem(error))
    })
  }
  const touched = () => {
    setSame(false)
    setSavedNew(null)
    setProblem(null)
  }
  return {
    form: {
      ...form,
      setTarget: (value: string) => {
        touched()
        form.setTarget(value)
      },
      setOption: (key: keyof Options, value: string) => {
        touched()
        form.setOption(key, value)
      },
    },
    dirty,
    checking: form.phase === 'checking',
    same,
    other,
    savedNew,
    problem,
    save: () => {
      touched()
      const next = targetOf(form.target, form.options)
      form.check((checked) => keep(checked, next))
    },
    saveNew: () => {
      if (other === null) return
      const name = nameFrom(form.target)
      setSavedNew(name)
      form.reset(kept.target, optionsOf(kept))
      void homes.save(other.checkId, name).catch((error: unknown) => {
        setSavedNew(null)
        setProblem(homeProblem(error))
      })
    },
    reset: () => {
      touched()
      form.reset(kept.target, optionsOf(kept))
    },
  }
}
export type Editing = ReturnType<typeof useEdit>

/** The host and its options as the home has them, with what checking them found, and its identity beneath. */
export function ConnectionFields({ edit, home }: { edit: Editing; home: RemoteHome }) {
  const id = useId()
  const { form } = edit
  const host = form.target.trim()
  const anyOption = Object.values(optionsOf(home.ssh)).some((value) => value !== '')
  return (
    <div className={s.connection}>
      <label className={s.field} htmlFor={`${id}-host`}>
        <span>SSH host</span>
        <Field
          id={`${id}-host`}
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- Edit connection was pressed to change the host; its field takes the keys.
          autoFocus
          value={form.target}
          invalid={form.phase === 'refused'}
          spellCheck={false}
          autoComplete="off"
          maxLength={4096}
          data-own-escape
          onChange={(event) => edit.form.setTarget(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && edit.dirty) {
              event.preventDefault()
              edit.save()
            }
            if (event.key === 'Escape' && edit.dirty) {
              event.preventDefault()
              event.stopPropagation()
              edit.reset()
            }
          }}
        />
      </label>
      <Disclosure defaultOpen={anyOption}>
        <DisclosureTrigger>
          <button type="button" className={s.more}>
            Connection options <Caret />
          </button>
        </DisclosureTrigger>
        <Fold bleed={false}>
          <OptionFields form={edit.form} />
        </Fold>
      </Disclosure>
      {edit.checking && <Working>{`Checking ${hostOf(host)}…`}</Working>}
      {form.phase === 'refused' && form.problem !== null && <Refusal problem={form.problem} />}
      {edit.problem !== null && <Refusal problem={edit.problem} />}
      {edit.other !== null && (
        <Problem
          size="small"
          action={
            <Button size="small" onClick={edit.saveNew}>
              Save as a new home
            </Button>
          }
        >
          {`${host} has a different home. ${home.name} stays on ${home.ssh.target}.`}
        </Problem>
      )}
      {edit.savedNew !== null && (
        <output className={s.kept}>
          <Icon name="check" size={13} />
          {`Saved ${edit.savedNew} as a new home.`}
        </output>
      )}
      {edit.same && !edit.dirty && (
        <output className={s.kept}>
          <Icon name="check" size={13} />
          Same home as before
        </output>
      )}
      {edit.dirty && !edit.checking && (
        <span className={s.editActions}>
          <Button size="small" variant="quiet" onClick={edit.reset}>
            Cancel
          </Button>
          {edit.other === null && (
            <Button size="small" variant="signal" onClick={edit.save}>
              Check and save
            </Button>
          )}
        </span>
      )}
      <div className={s.identityRow}>
        <span className={s.label}>Identity</span>
        <Identity homeId={home.homeId} />
      </div>
    </div>
  )
}
