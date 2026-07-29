import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const minutesArgument = process.argv.find((argument) => argument.startsWith('--minutes='))
const minutes = minutesArgument ? Number(minutesArgument.slice('--minutes='.length)) : 30
if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('Stability duration must be a positive number of minutes.')

const playwrightCli = resolve(import.meta.dirname, '../node_modules/@playwright/test/cli.js')
const child = spawn(process.execPath, [playwrightCli, 'test', 'stability.spec.ts'], {
  stdio: 'inherit',
  env: { ...process.env, RUN_STABILITY: '1', STABILITY_MINUTES: String(minutes) },
})
child.on('exit', (code) => process.exit(code ?? 1))
