// Dev-server endpoints that save flags into flags/ and serve them back, so a
// flag raised in the browser lands where `bun run flag` can read it.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import type { ServerResponse } from 'node:http'
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

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}

function saveFlag(body: string): { name: string; path: string } {
  const flag = JSON.parse(body)
  if (typeof flag !== 'object' || flag === null || typeof flag.note !== 'string' || !flag.keyframe || !flag.frames) {
    throw new Error('not a flag')
  }
  mkdirSync(FLAGS_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const name = `${stamp}-${slug(flag.note)}.json`
  writeFileSync(join(FLAGS_DIR, name), body)
  return { name, path: `flags/${name}` }
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
            try {
              send(res, 200, saveFlag(body))
            } catch (err) {
              send(res, 400, { error: (err as Error).message })
            }
          })
          return
        }
        const name = basename(decodeURIComponent((req.url ?? '/').slice(1)))
        if (!name) {
          let files: string[] = []
          try {
            files = readdirSync(FLAGS_DIR).filter((f) => f.endsWith('.json'))
          } catch {}
          send(res, 200, files.sort())
          return
        }
        try {
          send(res, 200, readFileSync(join(FLAGS_DIR, name), 'utf8'))
        } catch {
          send(res, 404, { error: 'no such flag' })
        }
      })
    },
  }
}
