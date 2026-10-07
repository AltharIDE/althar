import type { ConnectionList, Product } from '@althar/contracts'
import { Connections, type ServiceConnection, type ServiceOption, Spinner } from '@althar/ui'

import { productBrand } from '../../shared/products'
import s from './Connections.module.css'
import type { ConnectionsModel } from './useConnections'

/*
 * The code hosts and trackers Althar reaches for the person, drawn by the
 * kit: each service, who they are signed in as there, or how to connect it.
 */

export const text = {
  label: 'Code hosts and trackers',
  what: { both: 'Pull requests and issues', host: 'Pull requests', tracker: 'Issues' },
  /** An example of the address of a service connected by one. */
  example: { jira_cloud: 'https://your-site.atlassian.net' } as Partial<Record<Product, string>>,
}

/** The products as the kit offers them. */
export const servicesOf = (list: ConnectionList): ReadonlyArray<ServiceOption> =>
  list.products.map((product) => {
    const example = text.example[product.product]
    return {
      id: product.product,
      name: product.name,
      brand: productBrand(product.product),
      what: product.host && product.tracker ? text.what.both : product.host ? text.what.host : text.what.tracker,
      hostedUrl: product.hostedUrl,
      selfHosted: product.selfHosted,
      browserSignIn: product.browserSignIn,
      ...(product.tokenNeeds === null ? {} : { tokenNeeds: product.tokenNeeds }),
      tokenHelp: product.tokenHelp,
      ...(example === undefined ? {} : { instanceExample: example }),
    }
  })

/** The connections as the kit lists them: who, and where, when it isn't the hosted service. */
export const connectionsOf = (list: ConnectionList): ReadonlyArray<ServiceConnection> =>
  list.connections.map((connection) => {
    const hosted = list.products.find((product) => product.product === connection.product)?.hostedUrl
    return {
      id: connection.id,
      service: connection.product,
      account: connection.account.login,
      ...(connection.webUrl === hosted ? {} : { instance: connection.webUrl }),
      ...(connection.state === 'reauth_required' ? { needsSignIn: true } : {}),
    }
  })

const isProduct = (list: ConnectionList, id: string): Product | undefined =>
  list.products.find((product) => product.product === id)?.product

export function ConnectionsView({ model }: { model: ConnectionsModel }) {
  const list = model.list
  if (list === null) return model.error === null ? <Spinner /> : <p role="alert">{model.error}</p>
  return (
    <div className={s.connections}>
      <Connections
        label={text.label}
        services={servicesOf(list)}
        connections={connectionsOf(list)}
        signingIn={model.signingIn}
        onSignIn={(id) => {
          const product = isProduct(list, id)
          if (product !== undefined) void model.signIn(product)
        }}
        onCancelSignIn={() => void model.cancelSignIn()}
        onToken={(id, token) => {
          const product = isProduct(list, id)
          if (product !== undefined) void model.connectToken(product, token)
        }}
        saving={model.saving}
        tokenError={model.tokenError}
        onDisconnect={(connectionId) => void model.disconnect(connectionId)}
      />
      {model.error !== null && (
        <p className={s.error} role="alert">
          {model.error}
        </p>
      )}
    </div>
  )
}
