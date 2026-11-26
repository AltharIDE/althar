import { ruleKindWords } from '@althar/contracts'

/*
 * The page a home serves to confirm, with a security key, a permission
 * answered from a device away from it, or to register that key: in the
 * browser, beside Althar, so drawn in Althar's own palette and type
 * (packages/ui's tokens, light and dark), one sheet on the page. It carries
 * no style attribute or script of its own beyond its nonce'd two.
 */
export const permissionApprovalPage = (nonce: string, enrollment: boolean) => `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${enrollment ? 'Set up a security key' : 'Confirm a permission'} · Althar</title>
<style nonce="${nonce}">
  :root {
    color-scheme: light dark;
    --page: #f4f2ec; --sheet: #fcfbf8; --well: #f4f2ec; --line: rgba(20, 20, 28, 0.11);
    --t-1: #141417; --t-2: #45454c; --t-3: #63636b;
    --fill: #7a3ff0; --fill-hover: #6a2fd6; --on-fill: #ffffff; --focus: #7a3ff0;
    --danger: #c4402f; --ok: #237a3a;
    --lift: 0 1px 2px rgba(60, 50, 30, 0.06), 0 10px 24px -12px rgba(60, 50, 30, 0.14);
    --font: 'Inter Variable', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    --mono: 'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --page: #1c1a17; --sheet: #25231f; --well: rgba(0, 0, 0, 0.2); --line: rgba(255, 240, 215, 0.115);
      --t-1: #efeae1; --t-2: #bcb5a9; --t-3: #aca699;
      --fill: #7350ec; --fill-hover: #7c5cf0; --on-fill: #ffffff; --focus: #a68aff;
      --danger: #f2816f; --ok: #6fc283;
      --lift: 0 0 0 0.5px rgba(255, 240, 215, 0.1), 0 1px 2px rgba(0, 0, 0, 0.4), 0 10px 24px -12px rgba(0, 0, 0, 0.5);
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: var(--page); color: var(--t-1); font: 14px/1.5 var(--font); -webkit-font-smoothing: antialiased; }
  main { max-width: 30rem; margin: 14vh auto 2rem; padding: 28px 28px 24px; background: var(--sheet); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--lift); }
  .brand { margin: 0 0 18px; font: 500 11px/1 var(--mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--t-3); }
  h1 { margin: 0; font-size: 20px; line-height: 1.25; font-weight: 600; letter-spacing: -0.01em; }
  .about { margin: 6px 0 0; color: var(--t-2); }
  [hidden] { display: none !important; }
  #request { margin: 22px 0 0; font-weight: 600; }
  pre { margin: 8px 0 0; padding: 10px 12px; background: var(--well); border: 1px solid var(--line); border-radius: 8px; font: 12.5px/1.55 var(--mono); color: var(--t-1); overflow-wrap: anywhere; white-space: pre-wrap; unicode-bidi: plaintext; }
  dl { display: grid; grid-template-columns: 6.5rem minmax(0, 1fr); gap: 6px 12px; margin: 16px 0 0; font-size: 13px; }
  dt { color: var(--t-3); }
  dd { margin: 0; color: var(--t-1); overflow-wrap: anywhere; unicode-bidi: plaintext; }
  code { font: 12.5px var(--mono); }
  .actions { display: flex; align-items: center; gap: 12px; margin: 24px 0 0; }
  button, .download { display: inline-flex; align-items: center; height: 34px; padding: 0 14px; border: 0; border-radius: 8px; background: var(--fill); color: var(--on-fill); font: 500 13px var(--font); text-decoration: none; cursor: pointer; }
  button:hover:not(:disabled), .download:hover { background: var(--fill-hover); }
  button:disabled { opacity: 0.55; cursor: default; }
  button:focus-visible, .download:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  #status { margin: 0; font-size: 13px; color: var(--t-2); }
  #status:empty { display: none; }
  #status[data-tone='bad'] { color: var(--danger); }
  #status[data-tone='good'] { color: var(--ok); }
  .check { margin: 20px 0 0; font-size: 13px; color: var(--t-2); }
</style>
<main>
  <p class="brand">Althar</p>
  <h1>${enrollment ? 'Set up a security key' : 'Confirm with your security key'}</h1>
  ${enrollment ? '<p class="about">Register a key you keep with you. It confirms each permission this device answers on the home.</p>' : ''}
  <p id="request" hidden></p>
  <pre id="command" hidden></pre>
  <dl id="answer" hidden>
    <dt>Your answer</dt><dd id="decision"></dd>
    <dt id="scopeName" hidden>For</dt><dd id="scope" hidden></dd>
    <dt id="reasonName" hidden>Your note</dt><dd id="reason" hidden></dd>
  </dl>
  <div class="actions">
    <button id="confirm" type="button" hidden></button>
    <p role="status" id="status">Opening the request…</p>
  </div>
  <p class="check" id="check" hidden>Before you install it on the home, check that its SHA-256 matches:</p>
  <pre id="fingerprint" hidden></pre>
  <p class="check" id="then" hidden>It confirms permissions once it’s installed and the home’s service has restarted.</p>
</main>
<script nonce="${nonce}">
  const enrollment = ${enrollment}
  const code = location.hash.slice(1)
  history.replaceState(null, '', location.pathname)
  const status = document.getElementById('status')
  const button = document.getElementById('confirm')
  const say = (words, tone) => {
    status.textContent = words
    if (tone) status.dataset.tone = tone
    else delete status.dataset.tone
  }
  const show = (id, value) => {
    if (!value) return
    const element = document.getElementById(id)
    element.textContent = value
    element.hidden = false
  }
  const reveal = (id) => {
    document.getElementById(id).hidden = false
  }
  const post = async (path, input) => {
    const response = await fetch((enrollment ? '/v1/approval-keys' : '/v1/permission-approvals') + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, ...input }),
      credentials: 'omit',
      redirect: 'error',
    })
    if (!response.ok) throw new Error('Approval unavailable')
    return response.json()
  }
  const failed = () => {
    say(enrollment ? 'Althar couldn’t register this key. Start again from Homes in Althar.' : 'Althar couldn’t confirm this. Answer it again in Althar.', 'bad')
    button.hidden = true
  }
  // What an always (never, for a denial) keeps, as the home will keep it: this command or host exactly (a host and every
  // host under it, for a never), commands that start the same way, or a kind of request in words. The subject and its
  // reach are the broker's, never the page's own reading.
  const kinds = ${JSON.stringify(ruleKindWords)}
  const scopes = {
    exact: { lead: 'Exactly', none: 'Exactly this request' },
    prefix: { lead: 'Commands starting with', none: 'Commands that start like this one' },
  }
  const scopeOf = (scope, remembered, under) => {
    const into = document.getElementById('scope')
    if (scope === 'kind') {
      const words = (remembered && kinds[remembered]) || remembered || 'Requests of this kind'
      into.textContent = words.charAt(0).toUpperCase() + words.slice(1)
      return
    }
    if (!remembered) {
      into.textContent = scopes[scope].none
      return
    }
    const subject = document.createElement('code')
    subject.textContent = remembered
    if (under) into.append(subject, ' and every host under it')
    else into.append(scopes[scope].lead + ' ', subject)
  }
  post('/view').then((approval) => {
    if (!enrollment) {
      show('request', approval.title)
      show('command', approval.command)
      const allow = approval.decision === 'allow'
      const always = approval.scope === 'exact' || approval.scope === 'prefix' || approval.scope === 'kind'
      show('decision', allow ? (always ? 'Always allow' : 'Allow once') : always ? 'Never allow' : 'Deny')
      if (always) {
        scopeOf(approval.scope, approval.remembered, approval.under === true)
        reveal('scope')
        reveal('scopeName')
      }
      if (approval.reason) {
        show('reason', approval.reason)
        reveal('reasonName')
      }
      reveal('answer')
    }
    button.textContent = enrollment ? 'Register a security key' : 'Confirm'
    button.hidden = false
    say('')
    button.addEventListener('click', async () => {
      button.disabled = true
      say('Use your security key to confirm.')
      try {
        if (enrollment) {
          const publicKey = PublicKeyCredential.parseCreationOptionsFromJSON(approval.publicKey)
          const proof = await navigator.credentials.create({ publicKey })
          const manifest = await post('/export', { proof: proof.toJSON() })
          const contents = JSON.stringify(manifest, null, 2)
          const sha256 = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(contents))
          const download = document.createElement('a')
          download.className = 'download'
          download.href = URL.createObjectURL(new Blob([contents], { type: 'application/json' }))
          download.download = 'althar-approval-key.json'
          download.textContent = 'Download the public key'
          button.after(download)
          // The download first, then what to check before installing it: the home doesn't compare the digest itself.
          reveal('check')
          show('fingerprint', Array.from(new Uint8Array(sha256), (byte) => byte.toString(16).padStart(2, '0')).join(''))
          reveal('then')
          say('The public key is ready to download.', 'good')
        } else {
          const publicKey = PublicKeyCredential.parseRequestOptionsFromJSON(approval.publicKey)
          const proof = await navigator.credentials.get({ publicKey })
          await post('/answer', { proof: proof.toJSON() })
          say('Confirmed. You can close this page.', 'good')
        }
        button.hidden = true
      } catch {
        failed()
      }
    }, { once: true })
  }).catch(failed)
</script>
</html>`
