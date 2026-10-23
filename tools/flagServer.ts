// Dev-server endpoints that save flags into flags/ and serve them back, so a
// flag raised in the browser lands where `bun run flag` can read it.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import type { Plugin } from 'vite'

const FLAGS_DIR = resolve(import.meta.dirname, '../flags')

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'flag'
  )
}

export function flagServer(): Plugin {
  return {
    name: 'flag-server',
    configureServer(server) {
      server.middlewares.use('/__flags', (req, res) => {
        if (req.method === 'POST') {
          let body = ''
          req.on('data', (chunk) => (body += chunk))
          req.on('end', () => {
            const flag = JSON.parse(body)
            mkdirSync(FLAGS_DIR, { recursive: true })
            const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
            const name = `${stamp}-${slug(flag.note ?? '')}.json`
            writeFileSync(join(FLAGS_DIR, name), JSON.stringify(flag))
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ name, path: `flags/${name}` }))
          })
          return
        }
        const name = basename(decodeURIComponent((req.url ?? '/').slice(1)))
        res.setHeader('content-type', 'application/json')
        if (!name) {
          let files: string[] = []
          try {
            files = readdirSync(FLAGS_DIR).filter((f) => f.endsWith('.json'))
          } catch {}
          res.end(JSON.stringify(files.sort()))
          return
        }
        try {
          res.end(readFileSync(join(FLAGS_DIR, name)))
        } catch {
          res.statusCode = 404
          res.end('{}')
        }
      })
    },
  }
}
