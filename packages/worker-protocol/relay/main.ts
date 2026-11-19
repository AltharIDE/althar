import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { isIP } from 'node:net'

import { bindWorkerRelay } from '../src/relayServer.ts'

const usage = 'Usage: bun run start:relay <listen-ip> <port> <certificate.pem> <key.pem> <routes.json>'

const privateFile = async (path: string, limit: number): Promise<Buffer> => {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0 || stat.size > limit)
      throw new Error('The relay needs private regular certificate, key, and route files')
    const bytes = Buffer.alloc(limit + 1)
    let length = 0
    while (length < bytes.length) {
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, null)
      if (bytesRead === 0) break
      length += bytesRead
    }
    if (length === 0 || length > limit) throw new Error('Invalid relay file size')
    return bytes.subarray(0, length)
  } finally {
    await file.close()
  }
}

const main = async (args: string[]): Promise<void> => {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(`${usage}\n`)
    return
  }
  const [host, portText, certPath, keyPath, routesPath] = args
  const port = Number(portText)
  if (
    args.length !== 5 ||
    !host ||
    !isIP(host) ||
    !Number.isInteger(port) ||
    port < 0 ||
    port > 65535 ||
    !certPath ||
    !keyPath ||
    !routesPath
  )
    throw new Error(usage)
  const [certificate, routeFile] = await Promise.all([privateFile(certPath, 65536), privateFile(routesPath, 65536)])
  const routes: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(routeFile))
  const key = await privateFile(keyPath, 65536)
  const relay = await bindWorkerRelay({
    host,
    port,
    certificate,
    key,
    routes,
  }).finally(() => key.fill(0))
  const stopped = new Promise<void>((resolve) => {
    process.once('SIGINT', resolve)
    process.once('SIGTERM', resolve)
  })
  process.stdout.write(`${JSON.stringify({ state: 'ready', port: relay.port })}\n`)
  await stopped
  await relay.close()
}
try {
  await main(process.argv.slice(2))
} catch {
  process.stderr.write(`Worker relay could not start or stop. Check its private TLS and route configuration.\n${usage}\n`)
  process.exitCode = 1
}
