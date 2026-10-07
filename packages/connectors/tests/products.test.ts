import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { authorizationOf } from '../src/credential'
import { HOSTED } from '../src/links'
import { addressOf, available, hostedOf, products } from '../src/products'

describe('the products', () => {
  it('available now are the ones with an adapter', () => {
    assert.deepStrictEqual(
      available().map((info) => info.product),
      ['github', 'gitlab', 'linear', 'jira_cloud', 'jira_dc', 'trello'],
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
    // A Jira Cloud site's API is at its origin, whatever page of it was pasted.
    assert.strictEqual(
      products.jira_cloud.apiFor('https://meridian.atlassian.net/jira/software/projects/PAY/boards/3'),
      'https://meridian.atlassian.net/rest/api/3',
    )
    assert.strictEqual(products.jira_dc.apiFor('https://jira.meridian.dev'), 'https://jira.meridian.dev/rest/api/2')
    assert.strictEqual(products.linear.apiFor('https://linear.app'), 'https://api.linear.app')
    assert.strictEqual(products.trello.apiFor('https://trello.com'), 'https://api.trello.com/1')
  })

  it('keep a connection’s address as typed, trimmed, or a Jira Cloud site by its origin', () => {
    assert.strictEqual(addressOf(products.github, 'https://git.meridian.dev/'), 'https://git.meridian.dev')
    assert.strictEqual(addressOf(products.jira_dc, 'https://issues.apache.org/jira/'), 'https://issues.apache.org/jira')
    assert.strictEqual(addressOf(products.jira_cloud, 'https://meridian.atlassian.net/jira/your-work'), 'https://meridian.atlassian.net')
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
    // A token goes with the account's email for Atlassian's, with the API key it was made for on Trello, and alone elsewhere.
    assert.deepStrictEqual(
      Object.values(products).map((info) => [info.product, info.token.needs]),
      [
        ['github', null],
        ['gitlab', null],
        ['bitbucket_cloud', 'email'],
        ['bitbucket_dc', null],
        ['linear', null],
        ['jira_cloud', 'email'],
        ['jira_dc', null],
        ['trello', 'key'],
      ],
    )
    for (const info of Object.values(products)) assert.match(info.token.help(info.hosted?.webUrl ?? 'https://example.com'), /^https:\/\//)
    // Trello makes a token for the key typed, and says when the key isn't one.
    assert.strictEqual(
      products.trello.token.helpForKey?.replace('{key}', 'k'),
      'https://trello.com/1/authorize?expiration=never&name=Althar&scope=read,write&response_type=token&key=k',
    )
    const wrong = (key: string) => products.trello.token.keyChecks?.find((check) => new RegExp(check.pattern).test(key))?.says
    const key = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
    assert.isUndefined(wrong(key))
    assert.strictEqual(wrong(`${key}${key}`), 'That’s the Power-Up’s secret; paste its API key')
    assert.strictEqual(wrong(key.slice(1)), 'An API key is 32 characters')
    assert.strictEqual(wrong(`${key.slice(1)}x`), 'An API key is 32 characters')
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
    const gitlab = products.gitlab.make?.(options)
    assert.strictEqual(gitlab?.host?.product, 'gitlab')
    assert.strictEqual(gitlab?.tracker?.product, 'gitlab')
    const linear = products.linear.make?.(options)
    assert.isUndefined(linear?.host)
    assert.strictEqual(linear?.tracker?.product, 'linear')
    const jira = products.jira_cloud.make?.(options)
    assert.isUndefined(jira?.host)
    assert.strictEqual(jira?.tracker?.product, 'jira_cloud')
    assert.strictEqual(products.jira_dc.make?.(options).tracker?.product, 'jira_dc')
    const trello = products.trello.make?.(options)
    assert.isUndefined(trello?.host)
    assert.strictEqual(trello?.tracker?.product, 'trello')
  })
})

describe('a credential', () => {
  it('makes its header', () => {
    assert.strictEqual(authorizationOf({ kind: 'bearer', token: 't' }), 'Bearer t')
    assert.strictEqual(authorizationOf({ kind: 'key', token: 'k' }), 'k')
    assert.strictEqual(authorizationOf({ kind: 'app', key: 'k', token: 't' }), 'OAuth oauth_consumer_key="k", oauth_token="t"')
    assert.strictEqual(
      authorizationOf({ kind: 'basic', user: 'you@meridian.dev', token: 't' }),
      `Basic ${Buffer.from('you@meridian.dev:t').toString('base64')}`,
    )
  })
})
