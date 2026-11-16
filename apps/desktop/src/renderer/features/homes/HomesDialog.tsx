import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Button, Dialog, Field, Problem, Segmented } from '@althar/ui'

import type { CheckedHome, HomesHost, RemoteHome, SshHomeTarget } from '../../../homes'
import { homeProblem } from './useHomes'
import s from './Homes.module.css'

export function HomesDialog({ homes, onClose }: { homes: HomesHost; onClose: () => void }) {
  const [saved, setSaved] = useState<ReadonlyArray<RemoteHome> | null>(null)
  const [adding, setAdding] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const live = useRef(true)
  const reads = useRef(0)
  const refresh = useCallback(() => {
    const at = ++reads.current
    void homes
      .list()
      .then((value) => {
        if (live.current && reads.current === at) setSaved(value)
      })
      .catch((error: unknown) => {
        if (live.current && reads.current === at) setProblem(homeProblem(error))
      })
  }, [homes])
  useEffect(() => {
    live.current = true
    refresh()
    return () => {
      live.current = false
      void homes.cancelCheck().catch(() => undefined)
    }
  }, [homes, refresh])
  const open = (id: string) => {
    setPending(id)
    setProblem(null)
    void homes
      .open(id)
      .then(() => {
        if (live.current) onClose()
      })
      .catch((error: unknown) => {
        if (live.current) {
          setPending(null)
          setProblem(homeProblem(error))
        }
      })
  }
  return (
    <Dialog
      title={adding ? 'Connect a home' : 'Homes'}
      description={
        adding
          ? homes.pair === undefined
            ? 'Use a host already set up for SSH. Verify its home identity before connecting.'
            : 'Connect using a pairing code or SSH.'
          : 'Each home opens in its own window.'
      }
      width={520}
      onClose={onClose}
      {...(adding ? { onBack: () => setAdding(false) } : {})}
      actions={
        adding ? undefined : (
          <>
            <Button onClick={() => setAdding(true)}>Connect a host…</Button>
            <Button onClick={onClose}>Done</Button>
          </>
        )
      }
    >
      {adding ? (
        <ConnectHome homes={homes} onDone={onClose} />
      ) : (
        <div className={s.list}>
          {problem !== null && <Problem>{problem}</Problem>}
          <div className={s.row}>
            <span>This computer</span>
            <Button disabled={pending !== null} onClick={() => open('local')}>
              Open
            </Button>
          </div>
          {saved === null ? (
            <output className={s.note}>Reading saved homes…</output>
          ) : (
            saved.map((home) => (
              <div className={s.row} key={home.id}>
                <div className={s.identity}>
                  <strong>{home.name}</strong>
                  <span className={s.mono} title={home.ssh?.target ?? home.https?.origin}>
                    {home.ssh?.target ?? home.https?.origin}
                  </span>
                </div>
                <div className={s.actions}>
                  <Button disabled={pending !== null} onClick={() => open(home.id)}>
                    {pending === home.id ? 'Opening…' : 'Open'}
                  </Button>
                  <Button
                    variant="danger"
                    disabled={pending !== null}
                    onClick={() => {
                      setPending(home.id)
                      setProblem(null)
                      void homes
                        .forget(home.id)
                        .then(() => {
                          if (live.current) {
                            setPending(null)
                            refresh()
                          }
                        })
                        .catch((error: unknown) => {
                          if (live.current) {
                            setPending(null)
                            setProblem(homeProblem(error))
                          }
                        })
                    }}
                  >
                    Forget
                  </Button>
                </div>
              </div>
            ))
          )}
          <p className={s.note}>
            Remote access supports existing projects and task conversations. Approvals need a trusted device. Project setup, file transfers
            and local previews are not available through this connection.
          </p>
        </div>
      )}
    </Dialog>
  )
}

function SshConnectHome({ homes, onDone }: { homes: HomesHost; onDone: () => void }) {
  const id = useId()
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [profile, setProfile] = useState('')
  const [launcher, setLauncher] = useState('')
  const [config, setConfig] = useState('')
  const [port, setPort] = useState('')
  const [checked, setChecked] = useState<CheckedHome | null>(null)
  const [pending, setPending] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const generation = useRef(0)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
      void homes.cancelCheck().catch(() => undefined)
    }
  }, [homes])
  const edited = (set: (value: string) => void, value: string) => {
    generation.current++
    set(value)
    setChecked(null)
    setProblem(null)
    setPending(false)
    void homes.cancelCheck().catch(() => undefined)
  }
  const inspect = () => {
    const at = ++generation.current
    setPending(true)
    setProblem(null)
    setChecked(null)
    const input: SshHomeTarget = {
      target: target.trim(),
      ...(profile.trim() === '' ? {} : { profile: profile.trim() }),
      ...(launcher.trim() === '' ? {} : { launcher: launcher.trim() }),
      ...(config.trim() === '' ? {} : { configFile: config.trim() }),
      ...(port.trim() === '' ? {} : { port: Number(port) }),
    }
    void homes
      .inspect(input)
      .then((value) => {
        if (live.current && generation.current === at) {
          setChecked(value)
          setAdvanced(false)
          setPending(false)
        }
      })
      .catch((error: unknown) => {
        if (live.current && generation.current === at) {
          setProblem(homeProblem(error))
          setPending(false)
        }
      })
  }
  const connect = () => {
    if (checked === null) return
    setPending(true)
    setProblem(null)
    void homes
      .connect(checked.checkId, name)
      .then(() => {
        if (live.current) onDone()
      })
      .catch((error: unknown) => {
        if (live.current) {
          setProblem(homeProblem(error))
          setPending(false)
          setChecked(null)
        }
      })
  }
  const field = (key: string, label: string, value: string, set: (value: string) => void, hint?: string) => (
    <label className={s.field} htmlFor={`${id}-${key}`}>
      <span>{label}</span>
      <Field
        id={`${id}-${key}`}
        value={value}
        maxLength={key === 'name' ? 120 : 4096}
        onChange={(event) => (key === 'name' ? set(event.currentTarget.value) : edited(set, event.currentTarget.value))}
        {...(hint === undefined ? {} : { placeholder: hint })}
        autoComplete="off"
        spellCheck={false}
      />
    </label>
  )
  return (
    <div className={s.form}>
      {field('name', 'Name', name, setName, 'My server')}
      {field('host', 'SSH host', target, setTarget, 'user@host or an SSH alias')}
      <Button aria-expanded={advanced} onClick={() => setAdvanced((shown) => !shown)}>
        Connection options
      </Button>
      {advanced && (
        <div className={s.form}>
          {field('profile', 'Profile on the host', profile, setProfile)}
          {field('launcher', 'Launcher on the host', launcher, setLauncher)}
          {field('config', 'SSH configuration on this computer', config, setConfig)}
          {field('port', 'SSH port', port, setPort)}
        </div>
      )}
      {problem !== null && <Problem>{problem}</Problem>}
      {checked !== null && (
        <output className={s.check}>
          <strong>Home identity</strong>
          <code>{checked.homeId}</code>
          <span className={s.note}>Compare this with the home you intend to use. SSH must already trust the host’s key.</span>
          <span className={s.note}>
            Host {checked.version} · API {checked.apiVersion}
          </span>
        </output>
      )}
      <div className={s.actions}>
        <Button disabled={pending || target.trim() === ''} onClick={inspect}>
          {pending && checked === null ? 'Checking…' : 'Check host'}
        </Button>
        <Button variant="ink" disabled={pending || checked === null || name.trim() === ''} onClick={connect}>
          {pending && checked !== null ? 'Connecting…' : 'Connect to this home'}
        </Button>
      </div>
    </div>
  )
}

function ConnectHome({ homes, onDone }: { homes: HomesHost; onDone: () => void }) {
  const [method, setMethod] = useState<'pair' | 'ssh'>(homes.pair === undefined ? 'ssh' : 'pair')
  return (
    <div className={s.form}>
      {homes.pair !== undefined && (
        <Segmented
          label="Connection method"
          value={method}
          onChange={setMethod}
          options={[
            { value: 'pair', label: 'Pairing code' },
            { value: 'ssh', label: 'SSH' },
          ]}
        />
      )}
      {method === 'ssh' ? <SshConnectHome homes={homes} onDone={onDone} /> : <PairHome homes={homes} onDone={onDone} />}
    </div>
  )
}

function PairHome({ homes, onDone }: { homes: HomesHost; onDone: () => void }) {
  const id = useId()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [info, setInfo] = useState<{ origin: string; homeId: string; expiresAt: number } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
      void homes.cancelCheck().catch(() => undefined)
    }
  }, [homes])
  useEffect(() => {
    let current = true
    if (code.trim() !== '' && homes.pairingInfo !== undefined) {
      void homes
        .pairingInfo(code.trim())
        .then((info) => {
          if (current) setInfo(info)
        })
        .catch((error: unknown) => {
          if (current) setProblem(homeProblem(error))
        })
    }
    return () => {
      current = false
    }
  }, [code, homes])
  const pair = () => {
    if (homes.pair === undefined || info === null) return
    setPending(true)
    setProblem(null)
    void homes
      .pair(code.trim(), name.trim())
      .then(() => {
        if (live.current) {
          setCode('')
          onDone()
        }
      })
      .catch((error: unknown) => {
        if (live.current) {
          setPending(false)
          setProblem(homeProblem(error))
        }
      })
  }
  return (
    <div className={s.form}>
      <label className={s.field} htmlFor={`${id}-name`}>
        <span>Name</span>
        <Field
          id={`${id}-name`}
          value={name}
          maxLength={120}
          disabled={pending}
          autoComplete="off"
          placeholder="My server"
          onChange={(event) => setName(event.currentTarget.value)}
        />
      </label>
      <label className={s.field} htmlFor={`${id}-code`}>
        <span>Pairing code</span>
        <Field
          id={`${id}-code`}
          type="password"
          value={code}
          maxLength={8192}
          disabled={pending}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setCode(event.currentTarget.value)
            setInfo(null)
            setProblem(null)
          }}
        />
      </label>
      <p className={s.note}>
        On the host, run <code>althar-host pair</code> to create a code.
      </p>
      {problem !== null && <Problem>{problem}</Problem>}
      {info !== null && (
        <output className={s.check}>
          <strong>{info.origin}</strong>
          <span className={s.note}>This device can work with tasks. Approvals need a trusted device.</span>
        </output>
      )}
      <div className={s.actions}>
        <Button variant="ink" disabled={pending || info === null || name.trim() === ''} onClick={pair}>
          {pending ? 'Pairing…' : 'Pair and open'}
        </Button>
      </div>
    </div>
  )
}
