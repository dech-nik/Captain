const { spawnSync } = require('node:child_process')
const { mkdirSync } = require('node:fs')
const { dirname, join } = require('node:path')

const root = join(__dirname, '..')
const output = join(
  root,
  'resources',
  'bin',
  process.platform === 'win32' ? 'k8s-proxy.exe' : 'k8s-proxy'
)

mkdirSync(dirname(output), { recursive: true })

const result = spawnSync(
  'go',
  [
    'build',
    '-C',
    join(root, 'proxy'),
    '-trimpath',
    '-ldflags=-s -w',
    '-o',
    output,
    './cmd/k8s-proxy'
  ],
  {
    stdio: 'inherit',
    env: { ...process.env, CGO_ENABLED: '0' }
  }
)

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}

process.exit(result.status ?? 1)
