import { isAbsolute } from 'node:path'

import { CommandId, HomeId } from '@althar/contracts'
import type { SshTarget } from '@althar/transport-node'
import { Schema } from 'effect'

export const ATTACH_USAGE = `althar inspect (--profile <absolute folder> | --ssh <host>) [--json]
althar attach (--profile <absolute folder> | --ssh <host> --home <home_id>) --thread <thr_id>
althar attach (--profile <absolute folder> | --ssh <host> --home <home_id>) --project <proj_id> --task <title> [--agent <id>] [--model <id>] [--command-id <cmd_id>]
SSH options: --ssh-config <absolute file>, --ssh-port <port>, --remote-launcher <absolute path>, --remote-profile <absolute path>
inspect prints the running home's identity and projects. Verify the home before using it in attach.
Attached mode: /quit, EOF and Ctrl-C disconnect; remote work continues. /stop stops the session.
Permission and question answers require a trusted person client.`

export type AttachmentTarget =
  | { readonly kind: 'local'; readonly profile: string; readonly homeId?: string }
  | { readonly kind: 'ssh'; readonly ssh: SshTarget; readonly homeId?: string }
export type AttachmentOptions = { readonly target: AttachmentTarget } & (
  | { readonly command: 'inspect'; readonly json: boolean }
  | {
      readonly command: 'attach'
      readonly selection:
        | { readonly threadId: string }
        | {
            readonly projectId: string
            readonly title: string
            readonly agentId: string
            readonly model?: string
            readonly commandId?: string
          }
    }
)
const values = new Set([
  'profile',
  'ssh',
  'home',
  'thread',
  'project',
  'task',
  'agent',
  'model',
  'command-id',
  'ssh-config',
  'ssh-port',
  'remote-launcher',
  'remote-profile',
])
const invalid = (message: string): never => {
  throw new Error(message)
}

export const attachmentTarget = (found: ReadonlyMap<string, string>): AttachmentTarget => {
  const profile = found.get('profile')
  const ssh = found.get('ssh')
  if ((profile === undefined) === (ssh === undefined)) return invalid('Choose exactly one of --profile or --ssh.')
  const homeId = found.get('home')
  if (homeId !== undefined && !Schema.is(HomeId)(homeId)) return invalid('--home must be a home identity.')
  if (profile !== undefined && !isAbsolute(profile)) return invalid('--profile must be absolute.')
  const sshOnly = ['ssh-config', 'ssh-port', 'remote-launcher', 'remote-profile']
  if (ssh === undefined && sshOnly.some((key) => found.has(key))) return invalid('SSH options require --ssh.')
  const target: AttachmentTarget =
    profile !== undefined
      ? { kind: 'local', profile, ...(homeId === undefined ? {} : { homeId }) }
      : {
          kind: 'ssh',
          ssh: {
            target: ssh!,
            ...(found.has('ssh-config') ? { configFile: found.get('ssh-config')! } : {}),
            ...(found.has('ssh-port') ? { port: Number(found.get('ssh-port')) } : {}),
            ...(found.has('remote-launcher') ? { launcher: found.get('remote-launcher')! } : {}),
            ...(found.has('remote-profile') ? { profile: found.get('remote-profile')! } : {}),
          },
          ...(homeId === undefined ? {} : { homeId }),
        }
  return target
}

export const requireVerifiedHome = (target: AttachmentTarget): void => {
  if (target.kind === 'ssh' && target.homeId === undefined)
    return invalid('SSH attachment requires --home. Use inspect to discover it first.')
}

export const parseAttachmentOptions = (args: ReadonlyArray<string>): AttachmentOptions => {
  const command = args[0]
  if (command !== 'inspect' && command !== 'attach') return invalid('Choose inspect or attach.')
  const found = new Map<string, string>()
  let json = false
  for (let i = 1; i < args.length; i++) {
    const option = args[i]?.slice(2) ?? ''
    if (!args[i]?.startsWith('--') || found.has(option) || (option === 'json' && json)) return invalid('Unknown or repeated option.')
    if (option === 'json') {
      json = true
      continue
    }
    if (!values.has(option)) return invalid('Unknown option. See attachment usage.')
    const value = args[++i]
    if (value === undefined || value.trim() === '' || value.startsWith('--') || value.includes('\0'))
      return invalid('Each option needs a value.')
    found.set(option, value)
  }
  const target = attachmentTarget(found)
  const selectionKeys = ['thread', 'project', 'task', 'agent', 'model', 'command-id']
  if (command === 'inspect') {
    if (selectionKeys.some((key) => found.has(key))) return invalid('inspect does not start or select a task.')
    return { command, target, json }
  }
  if (json) return invalid('--json is only available for inspect.')
  requireVerifiedHome(target)
  const threadId = found.get('thread')
  if (threadId !== undefined) {
    if (!/^thr_[0-9a-f]{32}$/.test(threadId) || selectionKeys.slice(1).some((key) => found.has(key)))
      return invalid('Use --thread alone to join an existing task.')
    return { command, target, selection: { threadId } }
  }
  const projectId = found.get('project')
  const title = found.get('task')?.trim()
  if (projectId === undefined || !/^proj_[0-9a-f]{32}$/.test(projectId) || title === undefined)
    return invalid('Choose --thread, or --project and --task.')
  const commandId = found.get('command-id')
  if (commandId !== undefined && !Schema.is(CommandId)(commandId)) return invalid('--command-id must be a command identity.')
  return {
    command,
    target,
    selection: {
      projectId,
      title,
      agentId: found.get('agent') ?? 'claude-code',
      ...(found.has('model') ? { model: found.get('model')! } : {}),
      ...(commandId === undefined ? {} : { commandId }),
    },
  }
}
