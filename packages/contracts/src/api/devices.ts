import { Schema } from 'effect'
import { RpcGroup } from 'effect/rpc'
import { ClientDeviceId, ClientListOptions, ClientName, ClientPage, ClientPublicKey, ConnectionInfo, RegisteredClient } from '../identities'
import { PairingCodeMade, PairingInvitation, PairingStatus, PairingTokenHash, PhoneAccess } from '../pairing'
import { call, ClientAuthority, command } from './rpc'

/**
 * Which clients may reach the home: pairing a device, the phone, and the devices and sockets registered.
 * Includes the connection info a client reads about itself.
 */
export const DevicesApi = RpcGroup.make(
  call('GetConnectionInfo', {}, ConnectionInfo),
  command('IssueDevicePairing', { tokenHash: PairingTokenHash }, PairingInvitation),
  // A call, not a command: a command's receipt would keep the code, a bearer, in the profile's database.
  call('CreatePairingCode', {}, PairingCodeMade),
  call('GetPairingStatus', { tokenHash: PairingTokenHash }, PairingStatus),
  call('GetPhoneAccess', {}, PhoneAccess),
  command('SetPhoneAccess', { on: Schema.Boolean }, PhoneAccess),
  command('RevokeConnectionDevice', { deviceId: ClientDeviceId }, Schema.Void),
  call('ListClientDevices', ClientListOptions.fields, ClientPage),
  command(
    'RegisterClientDevice',
    { name: ClientName, publicKey: ClientPublicKey, role: Schema.Literals(['paired_device', 'socket']) },
    RegisteredClient,
  ),
  command('RevokeClientDevice', { deviceId: ClientDeviceId }, Schema.Void),
).middleware(ClientAuthority)
