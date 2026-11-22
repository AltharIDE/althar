import { createHash, generateKeyPairSync, randomBytes, sign, X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { request } from 'node:https'
import { MessageChannel } from 'node:worker_threads'

import { Api, type ClientIdentity, type PermissionApproval, clientProtocol, emitterPort } from '@althar/contracts'
import { until } from '@althar/testing/effect'
import {
  apiClient,
  createDeviceKey,
  homeHttpsAgent,
  openHttpsConnection,
  preparePermissionApproval,
  prepareApprovalKeyEnrollment,
  signDeviceMessage,
  tlsPublicKeyPin,
} from '@althar/transport-node'
import { Effect, Layer } from 'effect'
import { RpcClient } from 'effect/rpc'
import { SqlClient } from 'effect/sql'
import { describe, expect, it } from 'vitest'

import { connection, services } from '../src/Api'
import { ClientIdentities } from '../src/ClientIdentities'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { Secrets } from '../src/Secrets'
import { envelope } from '../src/envelope'
import { listenNetworkApi } from '../src/networkApi'
import { approvalKeyEnrollment } from '../src/approvalKeyEnrollment'
import { approvalClientData, makePermissionApprovals } from '../src/permissionApprovals'
import { fakeAgents, fakeConnectors, repository, ROOMY } from './support'
import { workerTestDirectory } from './workerTestFiles'

const origin = new URL('https://my-home.example:6771')
const identity: ClientIdentity = {
  homeId: `home_${'1'.repeat(32)}`,
  actorId: `act_${'2'.repeat(32)}`,
  deviceId: `dev_${'3'.repeat(32)}`,
  role: 'socket',
}
const action: PermissionApproval = { commandId: `cmd_${'4'.repeat(32)}`, attentionId: 'ask_a', decision: 'allow' }

/** A local WebAuthn fixture with an ES256 credential. Its private key never enters the approval broker. */
const fixture = () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const { x, y } = publicKey.export({ format: 'jwk' })
  if (x === undefined || y === undefined) throw new Error('EC public key needs both coordinates')
  // COSE_Key {1: EC2, 3: ES256, -1: P-256, -2: x, -3: y}.
  const cose = Buffer.concat([
    Buffer.from('a5010203262001215820', 'hex'),
    Buffer.from(x, 'base64url'),
    Buffer.from('225820', 'hex'),
    Buffer.from(y, 'base64url'),
  ])
  const id = randomBytes(32).toString('base64url')
  const registration = { deviceId: identity.deviceId, credentialId: id, publicKey: cose.toString('base64url') }
  const response = (
    challenge: string,
    { from = origin.origin, rp = origin.hostname, flags = 5, counter = 1, credential = id, crossOrigin = false } = {},
  ) => {
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', origin: from, challenge, crossOrigin }))
    const authenticatorData = Buffer.alloc(37)
    createHash('sha256').update(rp).digest().copy(authenticatorData)
    authenticatorData[32] = flags
    authenticatorData.writeUInt32BE(counter, 33)
    const signature = sign('sha256', Buffer.concat([authenticatorData, createHash('sha256').update(clientDataJSON).digest()]), privateKey)
    return {
      id: credential,
      rawId: credential,
      type: 'public-key',
      response: {
        clientDataJSON: clientDataJSON.toString('base64url'),
        authenticatorData: authenticatorData.toString('base64url'),
        signature: signature.toString('base64url'),
      },
    }
  }
  const enroll = (challenge: string, from: URL) => {
    const credential = Buffer.from(id, 'base64url')
    const header = Buffer.alloc(55)
    createHash('sha256').update(from.hostname).digest().copy(header)
    header[32] = 0x45 // User present, verified, with attested credential data.
    header.writeUInt16BE(credential.length, 53)
    const data = Buffer.concat([header, credential, cose])
    // A test-only WebAuthn "none" attestation. The home only exports it for an administrator to inspect and install.
    const attestationObject = Buffer.concat([
      Buffer.from('a363666d74646e6f6e656761747453746d74a068617574684461746158', 'hex'),
      Buffer.from([data.length]),
      data,
    ])
    const clientData = { type: 'webauthn.create', origin: from.origin, challenge, crossOrigin: false }
    return {
      id,
      rawId: id,
      type: 'public-key',
      response: {
        clientDataJSON: Buffer.from(JSON.stringify(clientData)).toString('base64url'),
        attestationObject: attestationObject.toString('base64url'),
      },
    }
  }
  return { id, registration, response, enroll, approvals: makePermissionApprovals(origin, identity.homeId, [registration]) }
}

describe('protected permission approvals', () => {
  it('returns only the original identity and action after a fresh assertion and consumes the challenge', async () => {
    const { id, response, approvals } = fixture()
    const requested = { ...action, always: 'exact' as const }
    const code = approvals.begin(identity, requested, 'Publish this branch', 'git push', 100)
    const view = approvals.view(code, 200)
    expect(view).toMatchObject({
      title: 'Publish this branch',
      command: 'git push',
      decision: 'allow',
      scope: 'exact',
      publicKey: { rpId: origin.hostname, userVerification: 'required', allowCredentials: [{ id, type: 'public-key' }] },
    })
    const proof = response(view.publicKey.challenge)
    expect(await approvals.verify(code, proof, 200)).toMatchObject({ identity, action: requested })
    await expect(approvals.verify(code, proof, 200)).rejects.toMatchObject({ reason: 'ApprovalRefused' })
  })

  it.each([
    { from: 'https://lookalike.example' },
    { rp: 'lookalike.example' },
    { flags: 1 },
    { flags: 4 },
    { flags: 13 },
    { credential: 'b'.repeat(43) },
    { crossOrigin: true },
  ])('refuses an invalid assertion even though a transport device asked for it', async (alteration) => {
    const { response, approvals } = fixture()
    const code = approvals.begin(identity, action, 'Run it', null, 100)
    const {
      publicKey: { challenge },
    } = approvals.view(code, 200)
    await expect(approvals.verify(code, response(challenge, alteration), 200)).rejects.toMatchObject({ reason: 'ApprovalRefused' })
    await expect(approvals.verify(code, response(challenge), 200)).rejects.toMatchObject({ reason: 'ApprovalRefused' })
  })

  it('binds the signature to one action, expires it, and disallows an unregistered device', async () => {
    const { response, approvals } = fixture()
    const first = approvals.begin(identity, action, 'Run it', null, 100)
    const second = approvals.begin(identity, { ...action, decision: 'reject' }, 'Run it', null, 100)
    const {
      publicKey: { challenge },
    } = approvals.view(first, 200)
    const proof = response(challenge)
    await expect(approvals.verify(second, proof, 200)).rejects.toMatchObject({ reason: 'ApprovalRefused' })
    await expect(approvals.verify(first, proof, 90_100)).rejects.toMatchObject({ reason: 'ApprovalRefused' })
    expect(() => approvals.begin({ ...identity, deviceId: `dev_${'5'.repeat(32)}` }, action, 'Run it', null, 100)).toThrow()
  })

  it('bounds pending challenges and rejects incompatible origins and duplicated key identities', () => {
    const { registration } = fixture()
    for (const address of ['http://my-home.example', 'https://127.0.0.1', 'https://[::1]'])
      expect(() => makePermissionApprovals(new URL(address), identity.homeId, [registration])).toThrow()
    expect(() => makePermissionApprovals(origin, identity.homeId, [registration, registration])).toThrow()
    const devices = Array.from({ length: 17 }, (_, number) => ({
      ...registration,
      deviceId: `dev_${number.toString(16).padStart(32, '0')}`,
      credentialId: randomBytes(32).toString('base64url'),
    }))
    expect(() =>
      makePermissionApprovals(origin, identity.homeId, [registration, { ...devices[0]!, credentialId: registration.credentialId }]),
    ).toThrow()
    expect(() => makePermissionApprovals(origin, identity.homeId, [{ ...registration, publicKey: 'AB' }])).toThrow()
    const approvals = makePermissionApprovals(origin, identity.homeId, devices)
    const [first, ...rest] = devices
    if (first === undefined) throw new Error('Expected a test device')
    const same = { ...identity, deviceId: first.deviceId }
    expect(() => approvals.begin({ ...same, homeId: `home_${'6'.repeat(32)}` }, action, 'Run', null, 0)).toThrow()
    expect(() => approvals.begin({ ...same, role: 'window' }, action, 'Run', null, 0)).toThrow()
    const one = approvals.begin(same, action, 'Run\u202e now', null, 0)
    expect(approvals.view(one, 1).title).toBe('Run\\u{202e} now')
    for (const _ of [1, 2, 3]) approvals.begin(same, action, 'Run', null, 0)
    expect(() => approvals.begin(same, action, 'Run', null, 0)).toThrow()
    for (const item of rest.slice(0, 15)) {
      for (const _ of [1, 2, 3, 4]) approvals.begin({ ...identity, deviceId: item.deviceId }, action, 'Run', null, 0)
    }
    expect(() => approvals.begin({ ...identity, deviceId: rest[15]!.deviceId }, action, 'Run', null, 0)).toThrow()
    expect(() => approvals.view(one, 90_000)).toThrow()
    expect(approvals.begin(same, action, 'Run', null, 90_000)).toMatch(/^[a-zA-Z0-9_-]{43}$/)
  })

  it('rejects embedded ceremonies and allows only the current enrollment for a transport device', async () => {
    for (const data of [null, 7, { topOrigin: origin.origin }, { crossOrigin: true }])
      expect(() => approvalClientData(Buffer.from(JSON.stringify(data)).toString('base64url'))).toThrow()
    expect(() => approvalClientData(Buffer.from('{}').toString('base64url'))).not.toThrow()
    const { id, enroll, registration } = fixture()
    const proposals = approvalKeyEnrollment(origin, [{ ...registration, deviceId: `dev_${'7'.repeat(32)}` }])
    await expect(proposals.begin({ ...identity, role: 'window' }, 'This window', 0)).rejects.toThrow()
    const replaced = await proposals.begin(identity, 'Desktop', 0)
    const current = await proposals.begin(identity, 'Desktop', 1)
    expect(() => proposals.view(replaced, 1)).toThrow()
    const { publicKey } = proposals.view(current, 1)
    expect(publicKey.excludeCredentials).not.toContainEqual({ id, type: 'public-key' })
    await expect(proposals.finish(current, enroll(publicKey.challenge, origin), 1)).rejects.toThrow()
    expect(() => proposals.view(current, 1)).toThrow()
    const expired = await proposals.begin(identity, 'Desktop', 1)
    expect(() => proposals.view(expired, 300_001)).toThrow()
    expect(await proposals.begin(identity, 'Desktop', 300_001)).toMatch(/^[a-zA-Z0-9_-]{43}$/)
  })

  it('answers a real permission over verified HTTPS without promoting the connection device', async () => {
    const authenticator = fixture()
    const run = Effect.gen(function* () {
      const instance = yield* Instance
      const identities = yield* ClientIdentities
      const sql = yield* SqlClient.SqlClient
      const key = yield* createDeviceKey
      const paired = yield* identities.register({ role: 'socket', publicKey: key.publicKey, name: 'Desktop' })
      const certificate = readFileSync(new URL('../../transport-node/tests/fixtures/tls/certificate.pem', import.meta.url))
      const tlsKey = readFileSync(new URL('../../transport-node/tests/fixtures/tls/key.pem', import.meta.url))
      const { port } = yield* listenNetworkApi({
        origin: 'https://localhost:0',
        address: '127.0.0.1',
        port: 0,
        version: 'test',
        certificate,
        key: tlsKey,
        approvalCredentials: [{ ...authenticator.registration, deviceId: paired.deviceId }],
      })
      const target = {
        origin: `https://localhost:${port}`,
        homeId: instance.homeId,
        deviceId: paired.deviceId,
        tlsKeyPin: tlsPublicKeyPin(certificate),
        tlsCertificate: new X509Certificate(certificate).raw.toString('base64url'),
      }
      const agent = yield* homeHttpsAgent(target.origin, target)
      const sign = (message: string) => signDeviceMessage(key.privateKey, message)
      const { api, info } = yield* apiClient(yield* openHttpsConnection(target, sign))
      expect(info.identity.role).toBe('socket')
      const { port1, port2 } = new MessageChannel()
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          port1.close()
          port2.close()
        }),
      )
      yield* Effect.forkScoped(
        Layer.launch(
          connection(
            emitterPort(port1, (data) => data),
            { kind: 'window' },
          ),
        ),
      )
      const protocol = yield* Layer.build(clientProtocol(emitterPort(port2, (data) => data)))
      const local = yield* RpcClient.make(Api).pipe(Effect.provideContext(protocol))
      const project = yield* (yield* Projects).open({ envelope: yield* envelope('project.open', {}), path: repository() })
      const id = () => `cmd_${randomBytes(16).toString('hex')}`
      yield* local.SetProjectRules({ commandId: id(), projectId: project.projectId, permissions: 'ask', allowEverything: false })
      const task = yield* local.StartTask({
        commandId: id(),
        projectId: project.projectId,
        title: 'Worker-like permission',
        description: '[lead:permission] [lead:finish]',
        end: 'ready',
        steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
      })
      const thread = api.GetThread({ threadId: task.threadId, fresh: true })
      const before = yield* until(thread, (entry) => entry.attention.some((ask) => ask.command === 'make deploy'))
      const decision = {
        commandId: id(),
        attentionId: before.attention.find((ask) => ask.command === 'make deploy')!.id,
        decision: 'allow' as const,
      }
      expect((yield* Effect.flip(api.Answer(decision))).reason).toBe('PersonRequired')
      const approval = yield* preparePermissionApproval(target, sign, decision)
      const code = new URL(approval.url).hash.slice(1)
      const opposite = yield* preparePermissionApproval(target, sign, { ...decision, decision: 'reject' })
      const oppositeCode = new URL(opposite.url).hash.slice(1)
      const browser = (path: string, value: unknown, from = target.origin) =>
        Effect.promise(
          () =>
            new Promise<{ status: number; body: string }>((resolve, reject) => {
              const req = request(
                new URL(path, target.origin),
                {
                  agent,
                  method: 'POST',
                  headers: { 'content-type': 'application/json', origin: from },
                },
                (res) => {
                  res.setEncoding('utf8')
                  let body = ''
                  res.on('data', (chunk: string) => {
                    body += chunk
                  })
                  res.once('end', () => resolve({ status: res.statusCode ?? 0, body }))
                  res.once('error', reject)
                },
              )
              req.once('error', reject)
              req.end(JSON.stringify(value))
            }),
        )
      const route = '/v1/permission-approvals'
      expect((yield* browser(route + '/view', { code: 'invalid' })).status).toBe(403)
      expect((yield* browser(route + '/result', { code: 'a'.repeat(43) })).status).toBe(403)
      // The broker displays only a scope that this particular request offered.
      const [stored] = yield* sql<{ payload: string }>`SELECT payload FROM attention_requests WHERE id = ${decision.attentionId}`
      if (stored === undefined) throw new Error('The test permission was not recorded')
      const policy = {
        ...(JSON.parse(stored.payload) as Record<string, unknown>),
        always: { command: 'make deploy', prefix: 'make', kind: 'Run shell', allow: ['exact', 'prefix'], deny: [] },
      }
      yield* sql`UPDATE attention_requests SET payload = ${JSON.stringify(policy)} WHERE id = ${decision.attentionId}`
      yield* Effect.flip(preparePermissionApproval(target, sign, { ...decision, commandId: id(), always: 'kind' }))
      yield* Effect.flip(preparePermissionApproval(target, sign, { ...decision, commandId: id(), always: 'exact', decision: 'reject' }))
      const remember = yield* preparePermissionApproval(target, sign, {
        ...decision,
        commandId: id(),
        always: 'prefix',
        reason: 'For this project only',
      })
      const rememberCode = new URL(remember.url).hash.slice(1)
      const scope = yield* browser(route + '/view', { code: rememberCode })
      expect(scope.status).toBe(200)
      expect(JSON.parse(scope.body)).toMatchObject({ scope: 'prefix', remembered: 'make', reason: 'For this project only' })
      const rejected = yield* preparePermissionApproval(target, sign, { ...decision, commandId: id(), decision: 'reject' })
      const rejectedCode = new URL(rejected.url).hash.slice(1)
      expect((yield* browser(route + '/answer', { code: rejectedCode, proof: {} })).status).toBe(403)
      expect(JSON.parse((yield* browser(route + '/result', { code: rejectedCode })).body)).toEqual({ state: 'refused' })
      expect((yield* browser(route + '/view', { code: rejectedCode })).status).toBe(403)
      const setup = new URL(yield* prepareApprovalKeyEnrollment(target, sign))
      const setupCode = setup.hash.slice(1)
      const proposed = fixture()
      const options = yield* browser('/v1/approval-keys/view', { code: setupCode })
      expect(options.status).toBe(200)
      const setupOptions = JSON.parse(options.body) as { publicKey: { challenge: string } }
      const attestation = proposed.enroll(setupOptions.publicKey.challenge, new URL(target.origin))
      const finished = yield* browser('/v1/approval-keys/export', { code: setupCode, proof: attestation })
      expect(finished.status).toBe(200)
      expect(JSON.parse(finished.body)).toEqual({
        version: 1,
        homeId: target.homeId,
        origin: target.origin,
        credentials: [{ ...proposed.registration, deviceId: target.deviceId }],
      })
      expect((yield* browser('/v1/approval-keys/export', { code: setupCode, proof: attestation })).status).toBe(403)
      expect((yield* browser(route + '/view', { code }, 'https://foreign.test')).status).toBe(403)
      expect(JSON.parse((yield* browser(route + '/result', { code })).body)).toEqual({ state: 'pending' })
      const view = yield* browser(route + '/view', { code })
      expect(view.status).toBe(200)
      const { publicKey } = JSON.parse(view.body) as {
        publicKey: { challenge: string; rpId: string; allowCredentials: Array<{ id: string }> }
      }
      expect(publicKey.allowCredentials.map(({ id }) => id)).toEqual([authenticator.id])
      const proof = authenticator.response(publicKey.challenge, { from: target.origin, rp: publicKey.rpId })
      expect((yield* browser(route + '/answer', { code, proof })).status).toBe(200)
      yield* approval.wait
      // A second real signature cannot replay the same command ID with a different answer.
      const oppositeView = yield* browser(route + '/view', { code: oppositeCode })
      expect(oppositeView.status).toBe(200)
      const otherChallenge = (JSON.parse(oppositeView.body) as { publicKey: { challenge: string } }).publicKey.challenge
      const otherProof = authenticator.response(otherChallenge, { from: target.origin, rp: publicKey.rpId, counter: 2 })
      expect((yield* browser(route + '/answer', { code: oppositeCode, proof: otherProof })).status).toBe(403)
      expect(JSON.parse((yield* browser(route + '/result', { code: oppositeCode })).body)).toEqual({ state: 'refused' })
      expect((yield* browser(route + '/answer', { code, proof })).status).toBe(403)
      expect((yield* Effect.flip(api.Answer({ ...decision, commandId: id() }))).reason).toBe('PersonRequired')
      yield* until(thread, (entry) => entry.attention.every(({ id }) => id !== decision.attentionId))
      yield* Effect.flip(preparePermissionApproval(target, sign, { ...decision, commandId: id() }))
      // The status remains fenced even if the durable receipt is later marked uncertain or is no longer available.
      yield* sql`UPDATE api_commands SET state = 'uncertain', result = NULL, error = '{}' WHERE command_id = ${decision.commandId}`
      expect(JSON.parse((yield* browser(route + '/result', { code })).body)).toEqual({ state: 'refused' })
      yield* sql`DELETE FROM api_commands WHERE command_id = ${decision.commandId}`
      expect(JSON.parse((yield* browser(route + '/result', { code })).body)).toEqual({ state: 'pending' })
      yield* identities.revoke(paired.deviceId)
      expect((yield* browser(route + '/result', { code })).status).toBe(403)
    })
    await Effect.runPromise(
      Effect.scoped(
        run.pipe(
          Effect.provide(
            services({
              database: ':memory:',
              worktreeRoot: workerTestDirectory(),
              appVersion: 'test',
              deviceName: 'Test host',
              agents: fakeAgents(),
              secrets: Secrets.memory(),
              connectors: fakeConnectors({}),
              busy: { machine: ROOMY },
            }),
          ),
        ),
      ),
    )
  })
})
