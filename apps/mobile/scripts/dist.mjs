/*
 * Serves the web build (`dist`) on a port of its own, every unknown path
 * answered with the app, as a host for a single-page app does.
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'

const dist = path.resolve(import.meta.dirname, '..', 'dist')
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.css': 'text/css',
}

export const serve = (port) =>
  new Promise((resolve) => {
    const server = createServer((request, response) => {
      const asked = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
      let file = path.join(dist, asked)
      if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(dist, 'index.html')
      response.setHeader('content-type', types[path.extname(file)] ?? 'application/octet-stream')
      createReadStream(file).pipe(response)
    })
    server.listen(port, () => resolve(server))
  })
