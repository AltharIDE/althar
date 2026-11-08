import { execFile } from 'node:child_process'

import { Effect } from 'effect'

import { HOST_SSH } from './git'

/*
 * An SSH remote's host can be a name the person's ~/.ssh/config gives a real
 * one: `git@github.com-work:owner/repo.git`, with `Host github.com-work` and
 * `HostName github.com`, the usual way to keep two accounts' keys apart. Git
 * doesn't know the real host; ssh does (`ssh -G`, which only reads the config
 * and connects to nothing).
 *
 * ssh's answer is taken only where Althar doesn't know the host as written
 * and does know the one ssh names: a config that sends a known host
 * elsewhere (`Host github.com` / `HostName ssh.github.com` for port 443, a
 * company's mirror) leaves it as written, where it is already found. The
 * remote itself is never rewritten where it is kept or used: what this gives
 * is only where Althar looks its host up, and pushes and fetches go by the
 * remote's name, through the alias and its key.
 */

/** How long `ssh -G` may take before its host is taken as written. */
const SSH_CONFIG_TIMEOUT = 3_000

/** The names code hosts take for SSH on another port, read as the host they are. */
const SSH_NAMES: Readonly<Record<string, string>> = { 'ssh.github.com': 'github.com', 'altssh.gitlab.com': 'gitlab.com' }

/** A host by its name, the hosts' own SSH names read as the host they are. */
export const canonicalHost = (host: string) => SSH_NAMES[host.toLowerCase()] ?? host.toLowerCase()

/** What ssh's config makes of a host's name: the name itself where it says nothing, or where ssh can't tell. */
const askSsh = (host: string): Promise<string> =>
  new Promise((resolveName) => {
    // Inside a Flatpak, the device's ssh, whose config is the person's (flatpak/host-ssh.sh).
    const command = process.env.FLATPAK_ID === undefined ? 'ssh' : HOST_SSH
    execFile(
      command,
      ['-G', host],
      { timeout: SSH_CONFIG_TIMEOUT, windowsHide: true, env: { ...process.env, LC_ALL: 'C' } },
      (error, stdout) => {
        if (error !== null) return resolveName(host)
        const named = /^hostname\s+(\S+)\s*$/im.exec(stdout)?.[1]?.toLowerCase()
        resolveName(named === undefined || named === '' ? host : named)
      },
    )
  })

/** Whether a host's name is one ssh can be asked about: never one it would read as an option. */
const askable = (host: string) => /^[a-z0-9_][a-z0-9._-]*$/i.test(host)

/** Each host's real name, as ssh's config gives it: asked once a launch. */
let sshNames = new Map<string, Promise<string>>()
let sshAsk = askSsh

/** For tests: what ssh's config says of each host, in place of the person's own; `undefined` asks ssh again. */
export const sshConfigSays = (names: Readonly<Record<string, string>> | undefined) => {
  sshNames = new Map()
  sshAsk = names === undefined ? askSsh : (host) => Promise.resolve(names[host] ?? host)
}

/** A host's real name, where ssh's config gives the one written another: `github.com` for `github.com-work`. */
export const sshHostName = (host: string): Effect.Effect<string> => {
  const name = host.toLowerCase()
  if (!askable(name)) return Effect.succeed(name)
  let asked = sshNames.get(name)
  if (asked === undefined) {
    asked = sshAsk(name).catch(() => name)
    sshNames.set(name, asked)
  }
  const answer = asked
  return Effect.promise(() => answer)
}

/**
 * A remote with its host as Althar knows it, for looking it up: as written
 * where `knows` that host; else its hosts' own SSH name read as the host
 * (`ssh.github.com`), or for an SSH remote the host ssh's config reaches
 * (`github.com` for `github.com-work`), where `knows` that one. Anything
 * else is as written.
 */
export const reachedRemote = (url: string, knows: (host: string) => boolean): Effect.Effect<string> => {
  const scheme = /^(ssh|git\+ssh|ssh\+git):\/\/([^/@]*@)?([^/:[\]]+)(.*)$/i.exec(url)
  const scp = scheme === null && !url.includes('://') ? /^([^/@:\s]+@)?([^/@:\s]{2,}):(?!\/\/)(.*)$/.exec(url) : null
  const host = scheme?.[3] ?? scp?.[2]
  if (host === undefined || knows(host.toLowerCase())) return Effect.succeed(url)
  const as = (name: string) =>
    scheme !== null ? `${scheme[1]}://${scheme[2] ?? ''}${name}${scheme[4]}` : `${scp?.[1] ?? ''}${name}:${scp?.[3] ?? ''}`
  const own = canonicalHost(host)
  if (own !== host.toLowerCase() && knows(own)) return Effect.succeed(as(own))
  return Effect.map(sshHostName(host), (named) => {
    const name = canonicalHost(named)
    return name !== host.toLowerCase() && knows(name) ? as(name) : url
  })
}
