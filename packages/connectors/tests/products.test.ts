import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { authorizationOf } from '../src/credential'
import { HOSTED } from '../src/links'
import { available, hostedOf, products } from '../src/products'

describe('the products', () => {
  it('available now are the ones with an adapter', () => {
    assert.deepStrictEqual(
      available().map((info) => info.product),
      ['github', 'bitbucket_cloud', 'bitbucket_dc', 'linear'],
    )
  })

  it('name their hosted services’ hosts, as links and remotes read them', () => {
    assert.deepStrictEqual(hostedOf(Object.values(products)), HOSTED)
    assert.deepStrictEqual(
      [...hostedOf([{ ...products.github, hosted: { webUrl: 'https://github.test', apiUrl: '' } }])],
      [['github.test', 'github']],
    )
  })

  it('know their instances’ API roots', () => {
    assert.strictEqual(products.github.apiFor('https://github.com/'), 'https://api.github.com')
    assert.strictEqual(products.github.apiFor('https://git.meridian.dev'), 'https://git.meridian.dev/api/v3')
    assert.strictEqual(products.gitlab.apiFor('https://gitlab.meridian.dev/'), 'https://gitlab.meridian.dev/api/v4')
    assert.strictEqual(products.bitbucket_cloud.apiFor('https://bitbucket.org'), 'https://api.bitbucket.org/2.0')
    assert.strictEqual(products.bitbucket_dc.apiFor('https://git.meridian.dev'), 'https://git.meridian.dev/rest/api/latest')
    assert.strictEqual(products.jira_cloud.apiFor('https://meridian.atlassian.net'), 'https://meridian.atlassian.net/rest/api/3')
    assert.strictEqual(products.jira_dc.apiFor('https://jira.meridian.dev'), 'https://jira.meridian.dev/rest/api/2')
    assert.strictEqual(products.linear.apiFor('https://linear.app'), 'https://api.linear.app')
    assert.strictEqual(products.trello.apiFor('https://trello.com'), 'https://api.trello.com/1')
  })

  it('know where a person signs in, and makes a token', () => {
    const github = products.github.browser
    assert.strictEqual(github?.kind, 'device')
    if (github?.kind === 'device') {
      assert.strictEqual(github.codeUrl('https://github.com'), 'https://github.com/login/device/code')
      assert.strictEqual(github.tokenUrl('https://git.meridian.dev/'), 'https://git.meridian.dev/login/oauth/access_token')
    }
    const gitlab = products.gitlab.browser
    if (gitlab?.kind === 'device') {
      assert.strictEqual(gitlab.codeUrl('https://gitlab.com'), 'https://gitlab.com/oauth/authorize_device')
      assert.strictEqual(gitlab.tokenUrl('https://gitlab.com'), 'https://gitlab.com/oauth/token')
    }
    assert.strictEqual(products.linear.browser?.kind, 'pkce')
    assert.isNull(products.jira_cloud.browser)
    for (const info of Object.values(products)) assert.match(info.token.help(info.hosted?.webUrl ?? 'https://example.com'), /^https:\/\//)
  })

  it('make their adapters', () => {
    const options = {
      fetch,
      apiUrl: 'https://api.github.com',
      webUrl: 'https://github.com',
      credential: Effect.succeed({ kind: 'bearer' as const, token: 't' }),
    }
    const github = products.github.make?.(options)
    assert.strictEqual(github?.host?.product, 'github')
    assert.strictEqual(github?.tracker?.product, 'github')
    for (const product of ['bitbucket_cloud', 'bitbucket_dc'] as const) {
      const bitbucket = products[product].make?.(options)
      assert.strictEqual(bitbucket?.host?.product, product)
      assert.isUndefined(bitbucket?.tracker)
    }
    const linear = products.linear.make?.(options)
    assert.isUndefined(linear?.host)
    assert.strictEqual(linear?.tracker?.product, 'linear')
  })
})

describe('a credential', () => {
  it('makes its header', () => {
    assert.strictEqual(authorizationOf({ kind: 'bearer', token: 't' }), 'Bearer t')
    assert.strictEqual(authorizationOf({ kind: 'key', token: 'k' }), 'k')
    assert.strictEqual(
      authorizationOf({ kind: 'basic', user: 'you@meridian.dev', token: 't' }),
      `Basic ${Buffer.from('you@meridian.dev:t').toString('base64')}`,
    )
  })
})
