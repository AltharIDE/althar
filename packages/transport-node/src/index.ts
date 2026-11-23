export { streamPort, MAX_SOCKET_FRAME, type StreamPort, type ByteStreams } from './streamPort'
export { socketPort, type SocketPort } from './socketPort'
export { authenticateApiClient, AUTH_FRAME_LIMIT, Authenticated, readFrame, type ClientAuthentication } from './authentication'
export { openApiSocket } from './socket'
export { inspectSshHost, openSshConnection } from './ssh'
export type { SshRuntime, SshSpawn } from './sshProcess'
export { LocalApiEndpoint, readLocalEndpoint } from './endpoint'
export { openLocalConnection, apiClient, type ApiConnection } from './client'
export { BridgeRejected, receiveBridgeIdentity, socketReady } from './bridgeProtocol'
export { TransportError, TransportReason, transportError } from './errors'
export { sshArguments, sshEnvironment, type SshTarget, type SshConnectionOptions } from './sshArguments'

export { httpsOrigin, tlsPublicKeyPin, homeHttpsAgent, httpsJson } from './https'
export {
  openHttpsConnection,
  prepareApprovalKeyEnrollment,
  preparePermissionApproval,
  webSocketServer,
  webSocketPort,
  webSocketHeartbeat,
  type HomeWebSocket,
} from './webSocket'

export { createDeviceKey, signDeviceMessage, encodePairingCode, decodePairingCode, completeDevicePairing, type DeviceKey } from './pairing'
export { selfSignedCertificate, type SelfSigned } from './selfSigned'

export { untilPortCloses } from './lifetime'

export type { HttpsHomeTarget } from '@althar/contracts'

export { installWorkerSnapshot, workerCopyFolder } from './workerSnapshot'
