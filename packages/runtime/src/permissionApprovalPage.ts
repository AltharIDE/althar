export const permissionApprovalPage = (nonce: string, enrollment: boolean) => `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${enrollment ? 'Set up a security key' : 'Confirm a permission'} · Althar</title>
<style nonce="${nonce}">
  :root { color-scheme: light dark; font: 100% system-ui, sans-serif; }
  body { margin: 0; }
  main { max-width: 32rem; margin: 12vh auto 0; padding: 0 1.5rem 2rem; }
  h1 { font-size: 1.5rem; line-height: 1.2; }
  p { line-height: 1.5; }
  #request, pre { overflow-wrap: anywhere; white-space: pre-wrap; unicode-bidi: plaintext; }
  button { font: inherit; padding: .5rem .75rem; }
</style>
<main>
  <h1>${enrollment ? 'Set up a security key' : 'Confirm a permission'}</h1>
  <p id="request" hidden></p>
  <pre id="command" hidden></pre>
  <p id="scope" hidden></p>
  <pre id="remembered" hidden></pre>
  <p id="reason" hidden></p>
  <pre id="fingerprint" hidden></pre>
  <button id="confirm" type="button" hidden></button>
  <p role="status" id="status">Opening the request…</p>
</main>
<script nonce="${nonce}">
  const enrollment = ${enrollment}
  const code = location.hash.slice(1)
  history.replaceState(null, '', location.pathname)
  const status = document.getElementById('status')
  const button = document.getElementById('confirm')
  const show = (id, value) => {
    if (!value) return
    const element = document.getElementById(id)
    element.textContent = value
    element.hidden = false
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
    status.textContent = enrollment ? 'The security key could not be saved. Start again from Althar.' : 'This request could not be confirmed. Reopen it from Althar.'
    button.hidden = true
  }
  post('/view').then((approval) => {
    show('request', approval.title)
    show('command', approval.command)
    show('reason', approval.reason)
    if (approval.scope === 'exact') show('scope', 'Remember for this exact command')
    if (approval.scope === 'prefix') show('scope', 'Remember for commands with this prefix')
    if (approval.scope === 'kind') show('scope', 'Remember for this kind of request')
    show('remembered', approval.remembered)
    button.textContent = enrollment ? 'Register security key' : approval.decision === 'allow' ? 'Confirm allow' : 'Confirm reject'
    button.hidden = false
    status.textContent = ''
    button.addEventListener('click', async () => {
      button.disabled = true
      status.textContent = 'Use your security key to confirm.'
      try {
        if (enrollment) {
          const publicKey = PublicKeyCredential.parseCreationOptionsFromJSON(approval.publicKey)
          const proof = await navigator.credentials.create({ publicKey })
          const manifest = await post('/export', { proof: proof.toJSON() })
          const contents = JSON.stringify(manifest, null, 2)
          const sha256 = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(contents))
          const download = document.createElement('a')
          download.href = URL.createObjectURL(new Blob([contents], { type: 'application/json' }))
          download.download = 'althar-approval-key.json'
          download.textContent = 'Download public key'
          button.after(download)
          show('fingerprint', Array.from(new Uint8Array(sha256), (byte) => byte.toString(16).padStart(2, '0')).join(''))
          status.textContent = 'Compare the SHA-256 value when you install this file on your home.'
        } else {
          const publicKey = PublicKeyCredential.parseRequestOptionsFromJSON(approval.publicKey)
          const proof = await navigator.credentials.get({ publicKey })
          await post('/answer', { proof: proof.toJSON() })
          status.textContent = 'Decision sent. You can return to Althar.'
        }
        button.hidden = true
      } catch {
        failed()
      }
    }, { once: true })
  }).catch(failed)
</script>
</html>`
