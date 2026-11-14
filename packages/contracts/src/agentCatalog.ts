import { Schema } from 'effect'

/** A person's external ACP executable and the session options it must obey. No shell or credentials. */
export const AcpConnection = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^acp-[a-z0-9-]{1,100}$/)),
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(160)),
  command: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1000)),
  args: Schema.Array(Schema.String.check(Schema.isMaxLength(4096))).check(Schema.isMaxLength(100)),
  env: Schema.optional(
    Schema.Record(Schema.String.check(Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/)), Schema.String.check(Schema.isMaxLength(4096))),
  ),
  mode: Schema.NullOr(Schema.String),
  readerMode: Schema.NullOr(Schema.String),
  modeOption: Schema.String,
  modelOption: Schema.String,
  effortOption: Schema.NullOr(Schema.String),
  held: Schema.Record(Schema.String, Schema.String),
  registryId: Schema.NullOr(Schema.String),
  registryVersion: Schema.NullOr(Schema.String),
})
export type AcpConnection = typeof AcpConnection.Type

export const AcpCatalogItem = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  version: Schema.NullOr(Schema.String),
  guide: Schema.NullOr(Schema.String),
  command: Schema.NullOr(Schema.String),
  args: Schema.Array(Schema.String),
  env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  modeOption: Schema.optional(Schema.String),
  mode: Schema.NullOr(Schema.String),
  readerMode: Schema.NullOr(Schema.String),
  source: Schema.Literals(['registry', 'profile']),
})
export type AcpCatalogItem = typeof AcpCatalogItem.Type

export const AcpSavedConnection = Schema.Struct({
  connection: AcpConnection,
  state: Schema.Literals(['unchecked', 'checking', 'ready', 'failed']),
  reason: Schema.NullOr(Schema.String),
  version: Schema.NullOr(Schema.String),
})
export type AcpSavedConnection = typeof AcpSavedConnection.Type

export const AcpCatalog = Schema.Struct({
  revision: Schema.Number,
  items: Schema.Array(AcpCatalogItem),
  connections: Schema.Array(AcpSavedConnection),
  problem: Schema.NullOr(Schema.String),
  refreshing: Schema.Boolean,
})
export type AcpCatalog = typeof AcpCatalog.Type
