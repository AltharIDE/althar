import { isAbsolute } from 'node:path'

import { API_VERSION, HomeId } from '@althar/contracts'
import { Schema } from 'effect'

import { transportError } from './errors'

export interface SshTarget {
  readonly target: string
  readonly launcher?: string
  readonly profile?: string
  readonly configFile?: string
  readonly port?: number
}
export interface SshConnectionOptions extends SshTarget {
  readonly homeId: string
}
const invalid = () =>
  transportError('InvalidConnection', 'Use an SSH host name or alias, an absolute remote launcher/profile and a valid port.')
const clean = (value: string) =>
  value.length > 0 && value.length <= 4096 && !Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`

/** OpenSSH owns config, ProxyJump, host-key pinning and local authentication. No shell fragments are accepted. */
export const sshArguments = (options: SshTarget, homeId?: string): ReadonlyArray<string> => {
  if (
    !/^(?:[a-zA-Z0-9_][a-zA-Z0-9_.-]*@)?(?:[a-zA-Z0-9_][a-zA-Z0-9_.:-]*|\[[a-fA-F0-9:]+\])$/.test(options.target) ||
    options.target.length > 255
  )
    throw invalid()
  for (const path of [options.launcher, options.profile]) if (path !== undefined && (!path.startsWith('/') || !clean(path))) throw invalid()
  if (options.configFile !== undefined && (!isAbsolute(options.configFile) || !clean(options.configFile))) throw invalid()
  if (options.port !== undefined && (!Number.isSafeInteger(options.port) || options.port < 1 || options.port > 65535)) throw invalid()
  if (homeId !== undefined && !Schema.is(HomeId)(homeId)) throw invalid()
  const program =
    options.launcher === undefined ? '"${XDG_DATA_HOME:-$HOME/.local/share}/althar-host-program/launcher"' : quote(options.launcher)
  const command = homeId === undefined ? 'status --json' : `connect-stdio --home-id ${quote(homeId)} --client-api-version ${API_VERSION}`
  const remote = `exec /bin/sh ${program} ${command}${options.profile === undefined ? '' : ` --profile ${quote(options.profile)}`}`
  return [
    '-T',
    '-oBatchMode=yes',
    '-oStrictHostKeyChecking=yes',
    '-oForwardAgent=no',
    '-oClearAllForwardings=yes',
    '-oControlMaster=no',
    '-oControlPath=none',
    '-oControlPersist=no',
    '-oConnectTimeout=20',
    '-oServerAliveInterval=15',
    '-oServerAliveCountMax=3',
    '-oRequestTTY=no',
    ...(options.configFile === undefined ? [] : ['-F', options.configFile]),
    ...(options.port === undefined ? [] : ['-p', String(options.port)]),
    '--',
    options.target,
    remote,
  ]
}

/** Provider tokens and supervisor capabilities have no purpose in an SSH transport or its remote environment. */
export const sshEnvironment = (source: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const result: NodeJS.ProcessEnv = { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }
  for (const name of [
    'HOME',
    'USER',
    'LOGNAME',
    'PATH',
    'SSH_AUTH_SOCK',
    'SSH_ASKPASS',
    'DISPLAY',
    'WAYLAND_DISPLAY',
    'XDG_RUNTIME_DIR',
    'SystemRoot',
    'WINDIR',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'TEMP',
    'TMP',
  ]) {
    if (source[name] !== undefined) result[name] = source[name]
  }
  return result
}
