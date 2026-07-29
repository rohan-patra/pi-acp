import assert from 'node:assert/strict'
import { chmodSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import type { ImageContent } from '@earendil-works/pi-ai'
import { PiRpcProcess, type PiRpcEvent } from '../../src/pi-rpc/process.js'

const fixture = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'pi-rpc-fixture.mjs')
chmodSync(fixture, 0o755)

function fixtureCommand(event: PiRpcEvent): Record<string, unknown> | undefined {
  if (event.type !== 'fixture_command') return undefined
  return event.command && typeof event.command === 'object' ? (event.command as Record<string, unknown>) : undefined
}

test('PiRpcProcess uses canonical prompt/steer image frames and handles success/error responses', async t => {
  const proc = await PiRpcProcess.spawn({ cwd: process.cwd(), piCommand: fixture })
  t.after(() => proc.dispose())

  const commands: Record<string, unknown>[] = []
  proc.onEvent(event => {
    const command = fixtureCommand(event)
    if (command) commands.push(command)
  })

  const image: ImageContent = { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }
  await proc.prompt('hello', [image])
  await proc.steer('redirect', [image])
  await assert.rejects(proc.prompt('fail', [image]), /fixture rejection/)

  assert.equal(commands.length, 3)
  for (const [index, expected] of [
    ['prompt', 'hello'],
    ['steer', 'redirect'],
    ['prompt', 'fail']
  ].entries()) {
    const command = commands[index]
    assert.ok(command)
    assert.equal(command.type, expected[0])
    assert.equal(command.message, expected[1])
    assert.equal(typeof command.id, 'string')
    assert.deepEqual(command.images, [image])
  }
})
