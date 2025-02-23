import express from 'express'
import { AddressInfo } from 'net'
import * as http from 'node:http'
import multer from 'multer'
import crypto from 'crypto'

const upload = multer({ dest: 'uploads/' })

const deployments: Record<string, string> = {}

async function listen(): Promise<[http.Server, number]> {
  const app = express()
  app.use((req, res, next) => {
    console.info('Incoming request: %s %s', req.method, req.url)
    next()
  })
  app.post('/upload', upload.single('bundle'), (req, res) => {
    console.info('File: %o', req.file)
    const id = crypto.randomBytes(16).toString('hex')
    deployments[id] = req.file!.path
    res.end(id)
  })
  app.post('/status', (req, res) => {
    const id = req.query.id?.toString()
    if (!id) {
      res.status(400).end()
    } else if (!deployments[id]) {
      res.status(404).end()
    } else {
      res.end(JSON.stringify({ deploymentState: 'PUBLISHED' }))
    }
  })
  return new Promise((resolve, reject) => {
    const server = app.listen(error => {
      if (error) {
        reject(error)
      } else {
        resolve([server, (server.address() as AddressInfo).port])
      }
    })
  })
}

const [server, port] = await listen()

try {
  process.env['INPUT_LOCAL-REPOSITORY-PATH'] = 'build/repo'
  process.env['INPUT_UPLOAD-API-URL'] = `http://localhost:${port}/upload`
  process.env['INPUT_STATUS-API-URL'] = `http://localhost:${port}/status`
  process.env['INPUT_MANUAL-PUBLISHING'] = 'true'
  process.env['INPUT_USERNAME'] = 'test'
  process.env['INPUT_PASSWORD'] = 'test'

  // Execute the steps of our workflow
  const main = await import('./src/main.js')
  await main.main()
} finally {
  server.close()
}
