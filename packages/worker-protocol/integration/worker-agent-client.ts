import { readFileSync } from 'node:fs'
import { create, fromBinary, toBinary } from '@bufbuild/protobuf'
import { Client, credentials } from '@grpc/grpc-js'

import { runAgentMethod } from '../src/agentRuns.ts'
import { AgentHomeFrameSchema, AgentWorkerFrameSchema, type AgentWorkerFrame, type AgentWorkerHello } from '../src/index.ts'

export const testAgentWorker = (port: number, path: (file: string) => string, certificate = 'enrolled') => {
  const read = (file: string) => readFileSync(path(file))
  const tls = credentials.createSsl(read('home-ca.pem'), read(certificate + '.key'), read(certificate + '.pem'))
  const client = new Client('localhost:' + port, tls)
  const { path: method, requestSerialize, responseDeserialize } = runAgentMethod
  const call = client.makeBidiStreamRequest(method, requestSerialize, responseDeserialize, { deadline: Date.now() + 10_000 })
  const messages = call[Symbol.asyncIterator]()
  const send = (payload: AgentWorkerFrame['payload']) =>
    call.write(Buffer.from(toBinary(AgentWorkerFrameSchema, create(AgentWorkerFrameSchema, { payload }))))
  /** The home's next frame; undefined once it ends the stream. */
  const next = async () => {
    const message = await messages.next()
    return message.done === true ? undefined : fromBinary(AgentHomeFrameSchema, message.value).payload
  }
  return {
    hello: async (hello: AgentWorkerHello) => {
      send({ case: 'hello', value: hello })
      return next()
    },
    send,
    read: next,
    close: () => {
      call.cancel()
      client.close()
    },
  }
}
