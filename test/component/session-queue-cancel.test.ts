import test from 'node:test'
import assert from 'node:assert/strict'
import { PiAcpSession } from '../../src/acp/session.js'
import { FakeAgentSideConnection, FakePiRpcProcess, asAgentConn } from '../helpers/fakes.js'

test('PiAcpSession: cancel hands a replacement prompt to Pi as native steering', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()

  const session = new PiAcpSession({
    sessionId: 's1',
    cwd: process.cwd(),
    mcpServers: [],
    proc: proc as any,
    conn: asAgentConn(conn),
    fileCommands: []
  })

  const first = session.prompt('one')
  assert.equal(proc.prompts.length, 1)
  proc.emit({ type: 'agent_start' })

  await session.cancel()
  assert.equal(await first, 'cancelled')
  assert.equal(proc.abortCount, 0)

  const replacement = session.prompt('two')
  assert.deepEqual(proc.steers, [{ message: 'two', attachments: [] }])
  assert.equal(proc.prompts.length, 1)

  proc.emit({ type: 'agent_end' })
  assert.equal(await replacement, 'end_turn')
})

test('PiAcpSession: quarantines cancelled-turn output until its replacement steer arrives', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()
  const session = new PiAcpSession({
    sessionId: 's1',
    cwd: process.cwd(),
    mcpServers: [],
    proc: proc as any,
    conn: asAgentConn(conn),
    fileCommands: []
  })

  const first = session.prompt('one')
  proc.emit({ type: 'agent_start' })
  await session.cancel()
  assert.equal(await first, 'cancelled')

  proc.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'stale' } })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(
    conn.updates.some(update => (update.update as any).content?.text === 'stale'),
    false
  )

  const replacement = session.prompt('two')
  proc.emit({ type: 'turn_start' })
  proc.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'fresh' } })
  proc.emit({ type: 'agent_end' })
  assert.equal(await replacement, 'end_turn')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(
    conn.updates.some(update => (update.update as any).content?.text === 'fresh'),
    true
  )
})

test('PiAcpSession: physically aborts a cancelled Pi run when no replacement arrives', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()
  const session = new PiAcpSession({
    sessionId: 's1',
    cwd: process.cwd(),
    mcpServers: [],
    proc: proc as any,
    conn: asAgentConn(conn),
    fileCommands: []
  })

  const first = session.prompt('one')
  await session.cancel()
  assert.equal(await first, 'cancelled')
  assert.equal(proc.abortCount, 0)

  await new Promise(resolve => setTimeout(resolve, 1_050))
  assert.equal(proc.abortCount, 1)
  proc.emit({ type: 'agent_end' })
})

test('PiAcpSession: defers a prompt received after the handoff timeout until Pi settles', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()
  const session = new PiAcpSession({
    sessionId: 's1',
    cwd: process.cwd(),
    mcpServers: [],
    proc: proc as any,
    conn: asAgentConn(conn),
    fileCommands: []
  })

  const first = session.prompt('one')
  await session.cancel()
  assert.equal(await first, 'cancelled')
  await new Promise(resolve => setTimeout(resolve, 1_050))
  assert.equal(proc.abortCount, 1)

  const next = session.prompt('two')
  assert.equal(proc.steers.length, 0)
  assert.equal(proc.prompts.length, 1)

  proc.emit({ type: 'agent_end' })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(proc.prompts, [
    { message: 'one', attachments: [] },
    { message: 'two', attachments: [] }
  ])
  proc.emit({ type: 'agent_end' })
  assert.equal(await next, 'end_turn')
})

test('PiAcpSession: responds to permissions while cancelled-turn output is quarantined', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()
  const session = new PiAcpSession({
    sessionId: 's1',
    cwd: process.cwd(),
    mcpServers: [],
    proc: proc as any,
    conn: asAgentConn(conn),
    fileCommands: []
  })

  const first = session.prompt('one')
  await session.cancel()
  assert.equal(await first, 'cancelled')

  proc.emit({
    type: 'extension_ui_request',
    id: 'confirm-1',
    method: 'confirm',
    title: 'Continue?',
    message: 'Continue?'
  })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(conn.permissionRequests.length, 0)
  assert.deepEqual(proc.extensionUiResponses[0], { id: 'confirm-1', cancelled: true })
  proc.emit({ type: 'agent_end' })
})
