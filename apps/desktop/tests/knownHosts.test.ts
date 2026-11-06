import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/*
 * The host keys the Flatpak trusts by default (flatpak/known_hosts), checked
 * against the SHA256 fingerprints each vendor documents, copied here from
 * their pages by hand. A key in the file that isn't one of these, or a host
 * without its keys, fails: a key changes only when its vendor's page does.
 */

const GITHUB = 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints'
const GITLAB = 'https://docs.gitlab.com/user/gitlab_com/#ssh-host-keys-fingerprints'
const BITBUCKET = 'https://support.atlassian.com/bitbucket-cloud/docs/configure-ssh-and-two-step-verification/'
const CODEBERG = 'https://docs.codeberg.org/security/ssh-fingerprint/'
const AZURE = 'https://learn.microsoft.com/en-us/azure/devops/repos/git/use-ssh-keys-to-authenticate'

/** Each host's documented fingerprints, by key type, and the page that documents them. */
const DOCUMENTED: Readonly<Record<string, { readonly page: string; readonly keys: Readonly<Record<string, string>> }>> = {
  'github.com': {
    page: GITHUB,
    keys: {
      'ssh-ed25519': 'SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU',
      'ecdsa-sha2-nistp256': 'SHA256:p2QAMXNIC1TJYWeIOttrVc98/R1BUFWu3/LiyKgUfQM',
      'ssh-rsa': 'SHA256:uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s',
    },
  },
  'gitlab.com': {
    page: GITLAB,
    keys: {
      'ssh-ed25519': 'SHA256:eUXGGm1YGsMAS7vkcx6JOJdOGHPem5gQp4taiCfCLB8',
      'ecdsa-sha2-nistp256': 'SHA256:HbW3g8zUjNSksFbqTiUWPWg2Bq1x8xdGUrliXFzSnUw',
      'ssh-rsa': 'SHA256:ROQFvPThGrW4RuWLoL9tq9I9zJ42fK4XywyRtbOz/EQ',
    },
  },
  'bitbucket.org': {
    page: BITBUCKET,
    keys: {
      'ssh-ed25519': 'SHA256:ybgmFkzwOSotHTHLJgHO0QN8L0xErw6vd0VhFA9m3SM',
      'ecdsa-sha2-nistp256': 'SHA256:FC73VB6C4OQLSCrjEayhMp9UMxS97caD/Yyi2bhW/J0',
      'ssh-rsa': 'SHA256:46OSHA1Rmj8E8ERTC6xkNcmGOw9oFxYr0WF6zWW8l1E',
    },
  },
  'codeberg.org': {
    page: CODEBERG,
    keys: {
      'ssh-ed25519': 'SHA256:mIlxA9k46MmM6qdJOdMnAQpzGxF4WIVVL+fj+wZbw0g',
      'ecdsa-sha2-nistp256': 'SHA256:T9FYDEHELhVkulEKKwge5aVhVTbqCW0MIRwAfpARs/E',
      'ssh-rsa': 'SHA256:6QQmYi4ppFS4/+zSZ5S4IU+4sa6rwvQ4PbhCtPEBekQ',
    },
  },
  'ssh.dev.azure.com': { page: AZURE, keys: { 'ssh-rsa': 'SHA256:ohD8VZEXGWo6Ez8GSEJQ9WpafgLFsOfLOtGGQCQo6Og' } },
}

/** Other names a vendor serves the same keys under: SSH over port 443, and Azure DevOps's earlier host. */
const SAME_KEYS: Readonly<Record<string, string>> = {
  '[ssh.github.com]:443': 'github.com',
  '[altssh.gitlab.com]:443': 'gitlab.com',
  '[altssh.bitbucket.org]:443': 'bitbucket.org',
  'vs-ssh.visualstudio.com': 'ssh.dev.azure.com',
}

/** A key's SHA256 fingerprint as `ssh-keygen -l` prints it. */
const fingerprint = (blob: string) =>
  `SHA256:${createHash('sha256').update(Buffer.from(blob, 'base64')).digest('base64').replace(/=+$/, '')}`

const entries = readFileSync(join(import.meta.dirname, '..', 'flatpak', 'known_hosts'), 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '' && !line.startsWith('#'))
  .map((line) => {
    const [hosts = '', type = '', blob = ''] = line.split(/\s+/)
    return { hosts: hosts.split(','), type, blob }
  })

describe('the host keys the Flatpak trusts', () => {
  it('are each one its vendor documents, for every name it is pinned under', () => {
    for (const entry of entries)
      for (const host of entry.hosts) {
        const vendor = DOCUMENTED[SAME_KEYS[host] ?? host]
        expect(vendor, `${host} is a host whose fingerprints are documented here`).toBeDefined()
        expect(fingerprint(entry.blob), `${host} ${entry.type}, against ${vendor?.page}`).toBe(vendor?.keys[entry.type])
      }
  })

  it('cover every host Althar trusts by default, with a key of each type its sshd offers that OpenSSH prefers', () => {
    const pinned = (host: string) => entries.filter((entry) => entry.hosts.includes(host)).map((entry) => entry.type)
    for (const host of ['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org', ...Object.keys(SAME_KEYS)])
      expect(pinned(host), host).toContain('ssh-ed25519' in (DOCUMENTED[SAME_KEYS[host] ?? host]?.keys ?? {}) ? 'ssh-ed25519' : 'ssh-rsa')
    // Azure DevOps offers RSA alone.
    expect(pinned('ssh.dev.azure.com')).toEqual(['ssh-rsa'])
    expect(pinned('vs-ssh.visualstudio.com')).toEqual(['ssh-rsa'])
  })

  it('has every line in known_hosts form, a key OpenSSH can read', () => {
    for (const entry of entries) {
      expect(['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ssh-rsa']).toContain(entry.type)
      // The blob names its own type first, as every SSH public key does.
      const blob = Buffer.from(entry.blob, 'base64')
      expect(blob.subarray(4, 4 + blob.readUInt32BE(0)).toString()).toBe(entry.type)
    }
  })
})
