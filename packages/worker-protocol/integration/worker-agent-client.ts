import { readFileSync } from 'node:fs'
import { create, fromBinary, toBinary } from '@bufbuild/protobuf'
import { Client, credentials } from '@grpc/grpc-js'

import { runAgentMethod } from '../src/agentRuns.ts'
import { AgentHomeFrameSchema, AgentWorkerFrameSchema, type AgentWorkerHello } from '../src/index.ts'

export const testAgentWorker = (port: number, path: (file: string) => string, certificate = 'enrolled') => {
  const read = (file: string) => readFileSync(path(file))
  const tls = credentials.createSsl(read('home-ca.pem'), read(certificate + '.key'), read(certificate + '.pem'))
  const client = new Client('localhost:' + port, tls)
  const { path: method, requestSerialize, responseDeserialize } = runAgentMethod
  const call = client.makeBidiStreamRequest(method, requestSerialize, responseDeserialize, { deadline: Date.now() + 10_000 })
  const messages = call[Symbol.asyncIterator]()
  return {
    hello: async (hello: AgentWorkerHello) => {
      call.write(
        Buffer.from(toBinary(AgentWorkerFrameSchema, create(AgentWorkerFrameSchema, { payload: { case: 'hello', value: hello } }))),
      )
      const message = await messages.next()
      return message.done === true ? undefined : fromBinary(AgentHomeFrameSchema, message.value).payload
    },
    close: () => {
      call.cancel()
      client.close()
    },
  }
}
