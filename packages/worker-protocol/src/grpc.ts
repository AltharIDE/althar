import { createHash, randomUUID } from 'node:crypto'
import { toBinary } from '@bufbuild/protobuf'
import { Server, ServerCredentials, status, type MethodDefinition, type ServerDuplexStream } from '@grpc/grpc-js'
import { HomeFrameSchema, MAX_HELLO_BYTES, WorkerControlService, WorkerHandshakeError, negotiateWorkerHello } from './index.ts'

const identity = (value: Buffer): Buffer => value
const connect: MethodDefinition<Buffer, Buffer> = {
  path: `/${WorkerControlService.typeName}/${WorkerControlService.method.connect.name}`,
  requestStream: true,
  responseStream: true,
  requestSerialize: identity,
  requestDeserialize: identity,
  responseSerialize: identity,
  responseDeserialize: identity,
}

interface HomeWorkerTransport {
  readonly homeId: string
  readonly certificateAuthorityPem: Buffer
  readonly certificatePem: Buffer
  readonly privateKeyPem: Buffer
  /** Look up a currently enrolled worker by SHA-256 of its verified certificate in DER format. */
  readonly workerForCertificate: (fingerprint: string) => string | undefined
}

const fail = (call: ServerDuplexStream<Buffer, Buffer>, code: status, message: string): void => {
  call.emit('error', Object.assign(new Error(message), { code }))
}

/** Start the worker handshake listener with mutual TLS and explicit enrollment. */
export const bindWorkerHandshake = async (address: string, home: HomeWorkerTransport): Promise<{ port: number; close: () => void }> => {
  if (home.certificateAuthorityPem.length === 0) throw new Error('The home needs a certificate authority for enrolled workers')
  const credentials = ServerCredentials.createSsl(
    home.certificateAuthorityPem,
    [{ cert_chain: home.certificatePem, private_key: home.privateKeyPem }],
    true,
  )
  const server = new Server({
    'grpc.max_receive_message_length': MAX_HELLO_BYTES,
    'grpc.max_send_message_length': MAX_HELLO_BYTES,
    'grpc.max_concurrent_streams': 8,
  })
  server.addService(
    { connect },
    {
      connect(call: ServerDuplexStream<Buffer, Buffer>) {
        const peer = call.getAuthContext().sslPeerCertificate
        if (!peer) {
          fail(call, status.UNAUTHENTICATED, 'A verified worker certificate is required')
          return
        }
        const fingerprint = createHash('sha256').update(peer.raw).digest('hex')
        const timer = setTimeout(() => fail(call, status.DEADLINE_EXCEEDED, 'The worker did not send a handshake'), 5_000)
        const clear = (): void => clearTimeout(timer)
        const missing = (): void => fail(call, status.INVALID_ARGUMENT, 'The worker handshake is missing')
        call.once('cancelled', clear)
        call.once('close', clear)
        call.once('error', clear)
        const receive = (bytes: Buffer): void => {
          clear()
          call.removeListener('end', missing)
          call.pause()
          try {
            const workerId = home.workerForCertificate(fingerprint)
            if (!workerId) {
              fail(call, status.UNAUTHENTICATED, 'The worker certificate is not enrolled')
              return
            }
            const reply = negotiateWorkerHello(bytes, {
              homeId: home.homeId,
              workerId,
              sessionId: `wsn_${randomUUID().replaceAll('-', '')}`,
            })
            call.write(Buffer.from(toBinary(HomeFrameSchema, reply)))
            call.end()
          } catch (error) {
            if (error instanceof WorkerHandshakeError) {
              const code = error.reason === 'WrongWorker' ? status.PERMISSION_DENIED : status.INVALID_ARGUMENT
              fail(call, code, error.message)
              return
            }
            fail(call, status.INTERNAL, 'Could not negotiate a worker session')
          }
        }
        call.once('data', receive)
        call.once('end', missing)
      },
    },
  )
  try {
    const port = await new Promise<number>((resolve, reject) => {
      server.bindAsync(address, credentials, (error, bound) => {
        if (error) reject(error)
        else resolve(bound)
      })
    })
    return { port, close: () => server.forceShutdown() }
  } catch (error) {
    server.forceShutdown()
    throw error
  }
}
