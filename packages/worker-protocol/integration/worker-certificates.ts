import { execFileSync } from 'node:child_process'
import { chmodSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const workerCertificates = (root: string, extra = false) => {
  const path = (name: string): string => join(root, name)
  const openssl = (...args: string[]): void => {
    execFileSync('openssl', args, { cwd: root, timeout: 5000, stdio: 'pipe' })
  }
  const authority = (name: string): void => {
    openssl(
      'req',
      '-new',
      '-x509',
      '-newkey',
      'ec',
      '-pkeyopt',
      'ec_paramgen_curve:P-256',
      '-nodes',
      '-days',
      '1',
      '-subj',
      `/CN=${name}`,
      '-keyout',
      `${name}.key`,
      '-out',
      `${name}.pem`,
      '-addext',
      'basicConstraints=critical,CA:true',
      '-addext',
      'keyUsage=critical,keyCertSign',
    )
  }
  const issue = (name: string, use: 'serverAuth' | 'clientAuth', issuer = 'home-ca'): void => {
    const san = use === 'serverAuth' ? '\nsubjectAltName=DNS:localhost' : ''
    writeFileSync(
      path(`${name}.ext`),
      `basicConstraints=critical,CA:false\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=${use}${san}\n`,
    )
    openssl(
      'req',
      '-new',
      '-newkey',
      'ec',
      '-pkeyopt',
      'ec_paramgen_curve:P-256',
      '-nodes',
      '-subj',
      `/CN=${name}`,
      '-keyout',
      `${name}.key`,
      '-out',
      `${name}.csr`,
    )
    openssl(
      'x509',
      '-req',
      '-in',
      `${name}.csr`,
      '-CA',
      `${issuer}.pem`,
      '-CAkey',
      `${issuer}.key`,
      '-CAcreateserial',
      '-extfile',
      `${name}.ext`,
      '-days',
      '1',
      '-out',
      `${name}.pem`,
    )
  }
  authority('home-ca')
  if (extra) authority('other-ca')
  issue('home', 'serverAuth')
  issue('enrolled', 'clientAuth')
  if (extra) {
    issue('unenrolled', 'clientAuth')
    issue('relay', 'serverAuth', 'other-ca')
  }
  for (const name of ['home-ca', 'home', 'enrolled', ...(extra ? ['other-ca', 'unenrolled', 'relay'] : [])])
    chmodSync(path(`${name}.pem`), 0o600)
  return path
}
