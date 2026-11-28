import { Rpc, RpcGroup } from 'effect/rpc'
import { HeardAttention } from '../attention'
import { ClientAuthority, SocketAllowed } from './rpc'
import { ApiError } from './shared'

/** A native host can subscribe without constructing the desktop's complete client. Uses the same authenticated API. */
export const AttentionApi = RpcGroup.make(
  Rpc.make('WatchAttention', { payload: {}, success: HeardAttention, error: ApiError, stream: true }).annotate(SocketAllowed, true),
).middleware(ClientAuthority)
