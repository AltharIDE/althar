import { deepEqual, equal, ok } from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const product = fileURLToPath(new URL('.', import.meta.url))
const waitFor = async (read, description, signal) => {
  const expires = performance.now() + 15_000
  for (;;) {
    const value = await read()
    if (value) return value
    if (performance.now() >= expires) throw new Error(description)
    await delay(150, undefined, { signal })
  }
}
const stop = async (child) => {
  if (child.exitCode !== null || child.signalCode !== null) return
  const done = once(child, 'exit', { signal: AbortSignal.timeout(5_000) })
  child.kill('SIGTERM')
  try {
    await done
  } catch {
    const killed = once(child, 'exit', { signal: AbortSignal.timeout(5_000) })
    child.kill('SIGKILL')
    await killed
  }
}

const demo = async () => {
  if (process.platform !== 'linux' || process.getuid() === 0)
    throw new Error('Run the preview as an ordinary Linux user with a systemd user session.')
  if (process.argv.length !== 2) throw new Error('Usage: ./demo')
  await exec('/usr/bin/systemctl', ['--user', 'show-environment'], { timeout: 4000 })
  const root = mkdtempSync(join(tmpdir(), 'althar-preview-'))
  const path = (...parts) => join(root, ...parts)
  const checkout = path('checkout')
  const children = []
  const env = { HOME: root, PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }
  const interrupted = new AbortController()
  const interrupt = () => interrupted.abort(new Error('Althar preview interrupted.'))
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)
  const until = (read, description) => waitFor(read, description, interrupted.signal)
  const hostArgs = ['--profile', path('profile'), '--key-file', path('private', 'master'), '--json']
  const launcher = join(product, 'althar-host')
  const call = async (file, args, cwd = root) =>
    exec(file, args, { cwd, env, signal: interrupted.signal, timeout: 30_000, maxBuffer: 256 * 1024 })
  const host = async (command, ...args) => {
    const { stdout } = await call(launcher, [command, ...hostArgs, ...args])
    return JSON.parse(stdout)
  }
  let workerOutput = ''
  try {
    mkdirSync(path('private'), { mode: 0o700 })
    await call('/usr/bin/git', ['init', '--quiet', checkout])
    const tls = (name) => path('private', name)
    await call('/usr/bin/openssl', [
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
      '/CN=Althar preview CA',
      '-keyout',
      tls('ca.key'),
      '-out',
      tls('ca.pem'),
      '-addext',
      'basicConstraints=critical,CA:true',
      '-addext',
      'keyUsage=critical,keyCertSign',
    ])
    for (const [name, usage] of [
      ['home', 'serverAuth'],
      ['worker', 'clientAuth'],
    ]) {
      const extensions =
        'basicConstraints=critical,CA:false\nkeyUsage=critical,digitalSignature\n' +
        `extendedKeyUsage=${usage}\n` +
        (name === 'home' ? 'subjectAltName=DNS:localhost\n' : '')
      writeFileSync(tls(`${name}.ext`), extensions, { mode: 0o600 })
      await call('/usr/bin/openssl', [
        'req',
        '-new',
        '-newkey',
        'ec',
        '-pkeyopt',
        'ec_paramgen_curve:P-256',
        '-nodes',
        '-subj',
        `/CN=Althar preview ${name}`,
        '-keyout',
        tls(`${name}.key`),
        '-out',
        tls(`${name}.csr`),
      ])
      await call('/usr/bin/openssl', [
        'x509',
        '-req',
        '-in',
        tls(`${name}.csr`),
        '-CA',
        tls('ca.pem'),
        '-CAkey',
        tls('ca.key'),
        '-CAcreateserial',
        '-extfile',
        tls(`${name}.ext`),
        '-days',
        '1',
        '-out',
        tls(`${name}.pem`),
      ])
      chmodSync(tls(`${name}.pem`), 0o600)
    }
    chmodSync(tls('ca.pem'), 0o600)
    const home = await host('init', '--project', checkout)
    const [project] = home.projects
    ok(project)
    const configure = (port) =>
      host(
        'configure-workers',
        '--listen-port',
        String(port),
        '--worker-ca',
        tls('ca.pem'),
        '--tls-certificate',
        tls('home.pem'),
        '--tls-key',
        tls('home.key'),
      )
    await configure(0)
    const { workerId } = await host('enroll-worker', '--worker-certificate', tls('worker.pem'))
    const start = async () => {
      const child = spawn(launcher, ['serve', ...hostArgs], { cwd: root, env, stdio: ['ignore', 'pipe', 'inherit'] })
      children.push(child)
      const lines = createInterface({ input: child.stdout })
      const signal = AbortSignal.any([AbortSignal.timeout(30_000), interrupted.signal])
      try {
        const [line] = await Promise.race([
          once(lines, 'line', { signal }),
          once(child, 'exit', { signal }).then(([code]) => {
            throw new Error(`Home exited with code ${code}.`)
          }),
        ])
        return { child, ready: JSON.parse(line) }
      } finally {
        lines.close()
        child.stdout.resume()
      }
    }
    const { child: serving, ready } = await start()
    equal(ready.homeId, home.homeId)
    ok(ready.workerPort > 0)
    console.log(`Home ready ${ready.homeId}`)

    const command = path('check.sh')
    writeFileSync(
      command,
      [
        'set -eu',
        '/usr/bin/git rev-parse --is-inside-work-tree',
        '/usr/bin/git diff --check',
        'printf "Project check completed\\n"',
        'if test -e hold; then',
        `  /usr/bin/setsid /bin/sh -c 'trap "" TERM; echo $$ > detached.pid; exec /usr/bin/sleep 600' &`,
        '  wait',
        'fi',
      ].join('\n'),
    )
    const config = path('project-command')
    writeFileSync(config, [project, 'check', checkout, '/usr/bin/sh', command, ''].join('\n'), { mode: 0o600 })
    const worker = spawn(
      join(product, 'althar-worker'),
      [
        `https://localhost:${ready.workerPort}`,
        ready.homeId,
        workerId,
        tls('ca.pem'),
        tls('worker.pem'),
        tls('worker.key'),
        path('worker-journal'),
        '--project-config',
        config,
        '--watch',
      ],
      { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    children.push(worker)
    for (const pipe of [worker.stdout, worker.stderr]) {
      pipe.setEncoding('utf8')
      pipe.on('data', (chunk) => {
        workerOutput = (workerOutput + chunk).slice(-8192)
      })
    }
    const queue = async () =>
      (await host('worker-project-run', '--worker-id', workerId, '--project-id', project, '--command-name', 'check')).attemptId
    const result = async (attempt) => host('worker-result', '--attempt-id', attempt)
    const log = async (attempt) => Buffer.from((await host('worker-log', '--attempt-id', attempt)).bytesBase64, 'base64').toString()
    const first = await queue()
    await until(async () => (await result(first)).state === 'succeeded', 'The worker did not complete the registered command.')
    deepEqual((await log(first)).split('\n'), ['true', 'Project check completed', ''])
    console.log(`Run ${first} succeeded\n${(await log(first)).trimEnd()}`)

    await stop(serving)
    await until(() => workerOutput.includes('Worker connection failed:'), 'The worker did not observe the home restart.')
    await configure(ready.workerPort)
    const restarted = (await start()).ready
    equal(restarted.homeId, ready.homeId)
    equal(restarted.workerPort, ready.workerPort)
    equal((await result(first)).state, 'succeeded')
    console.log('The restarted home kept its identity and the completed run.')

    writeFileSync(join(checkout, 'hold'), '')
    const second = await queue()
    const pid = await until(() => {
      try {
        const value = Number(readFileSync(join(checkout, 'detached.pid'), 'utf8'))
        return Number.isSafeInteger(value) && value > 1 ? value : false
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        return false
      }
    }, 'The second run did not start its detached child.')
    await until(async () => (await log(second)).includes('Project check completed'), 'The live output did not reach the home.')
    await host('worker-cancel', '--attempt-id', second)
    await until(async () => (await result(second)).state === 'cancelled', 'The worker did not confirm cancellation.')
    try {
      const state = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]
      ok(state?.startsWith('Z '), 'The detached child survived a confirmed cancellation.')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    console.log(`Run ${second} cancelled and its detached child stopped`)
    console.log('Host and worker preview passed.')
  } catch (error) {
    if (workerOutput) console.error(workerOutput.trimEnd())
    if (error.stderr) console.error(error.stderr.trimEnd())
    throw error
  } finally {
    process.off('SIGINT', interrupt)
    process.off('SIGTERM', interrupt)
    try {
      for (const child of children.reverse()) await stop(child)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
}
await demo()
