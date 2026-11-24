import type { Socket } from 'node:net'

import { streamPort, type StreamPort } from './streamPort'

export type SocketPort = StreamPort
export const socketPort = (socket: Socket, maximum?: number): SocketPort =>
  streamPort({ readable: socket, writable: socket, close: () => socket.destroy(), ...(maximum === undefined ? {} : { maximum }) })
