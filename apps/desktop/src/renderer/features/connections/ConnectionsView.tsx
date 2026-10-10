import type { ConnectionList, Product } from '@althar/contracts'
import { Connections, Heading, type ServiceConnection, type ServiceOption } from '@althar/ui'

import { PartPending } from '../../shared/Pending'
import { productBrand } from '../../shared/products'
import s from './Connections.module.css'
import type { ConnectionsModel } from './useConnections'

/*
 * The code hosts and trackers Althar reaches for the person, drawn by the
 * kit: each service, who they are signed in as there, or how to connect it.
 */

export const text = {
  label: 'Code hosts and trackers',
  /** Side by side, as settings shows them: what each kind is for. */
  columns: {
    hosts: { title: 'Code hosts', note: 'Pull requests, their checks and review comments' },
    trackers: { title: 'Trackers', note: 'Issues become tasks, and tasks move their issues' },
  },
  what: { both: 'Pull requests and issues', host: 'Pull requests', tracker: 'Issues' },
  /** An example of the address of a service connected by one. */
  example: { jira_cloud: 'https://your-site.atlassian.net' } as Partial<Record<Product, string>>,
  reading: 'Reading the connections',
}

/** The products as the kit offers them; without `what` where their column says it. */
export const servicesOf = (list: ConnectionList, { what = true }: { readonly what?: boolean } = {}): ReadonlyArray<ServiceOption> =>
  list.products.map((product) => {
    const example = text.example[product.product]
    return {
      id: product.product,
      name: product.name,
      brand: productBrand(product.product),
      ...(what ? { what: product.host && product.tracker ? text.what.both : product.host ? text.what.host : text.what.tracker } : {}),
      hostedUrl: product.hostedUrl,
      selfHosted: product.selfHosted,
      browserSignIn: product.browserSignIn,
      ...(product.tokenNeeds === null ? {} : { tokenNeeds: product.tokenNeeds }),
      tokenHelp: product.tokenHelp,
      ...(product.tokenHelpForKey === null ? {} : { tokenHelpForKey: product.tokenHelpForKey }),
      ...(product.keyChecks.length === 0 ? {} : { keyChecks: product.keyChecks }),
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

/**
 * The services, in one list, or with `columns` the code hosts beside the
 * trackers, each saying what that kind is for, so its services needn't.
 */
export function ConnectionsView({ model, columns = false }: { model: ConnectionsModel; columns?: boolean }) {
  const list = model.list
  if (list === null) return model.error === null ? <PartPending label={text.reading} /> : <p role="alert">{model.error}</p>
  const services = servicesOf(list, { what: !columns })
  const isHost = (id: string) => list.products.some((product) => product.product === id && product.host)
  const listOf = (label: string, shown: ReadonlyArray<ServiceOption>) => (
    <Connections
      label={label}
      services={shown}
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
  )
  return (
    <div className={s.connections}>
      {columns ? (
        <div className={s.columns}>
          {(
            [
              ['hosts', services.filter((service) => isHost(service.id))],
              ['trackers', services.filter((service) => !isHost(service.id))],
            ] as const
          ).map(([kind, shown]) => (
            <section key={kind} className={s.column} aria-labelledby={`connections-${kind}`}>
              <Heading level={3} id={`connections-${kind}`} className={s.columnTitle}>
                {text.columns[kind].title}
              </Heading>
              <p className={s.columnNote}>{text.columns[kind].note}</p>
              {listOf(text.columns[kind].title, shown)}
            </section>
          ))}
        </div>
      ) : (
        listOf(text.label, services)
      )}
      {model.error !== null && (
        <p className={s.error} role="alert">
          {model.error}
        </p>
      )}
    </div>
  )
}
