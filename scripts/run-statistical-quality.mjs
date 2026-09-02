import { spawn } from 'node:child_process'

const command = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const child = spawn(command, ['exec', '--', 'vitest', 'run', 'tests/quality'], {
  stdio: 'inherit',
  env: { ...process.env, RUN_STATISTICAL_QUALITY_BENCHMARK: '1' },
})
child.on('exit', (code) => process.exit(code ?? 1))
