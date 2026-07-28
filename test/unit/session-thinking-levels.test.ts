import test from 'node:test'
import assert from 'node:assert/strict'
import { PiAcpAgent } from '../../src/acp/agent.js'
import { FakeAgentSideConnection, asAgentConn } from '../helpers/fakes.js'

class FakeSessions {
  constructor(private readonly session: any) {}

  async create() {
    return this.session
  }

  get(sessionId: string) {
    if (sessionId !== this.session.sessionId) throw new Error(`Unknown sessionId: ${sessionId}`)
    return this.session
  }

  maybeGet(sessionId: string) {
    return sessionId === this.session.sessionId ? this.session : undefined
  }
}

function makeSession(proc: Record<string, unknown>) {
  return {
    sessionId: 's1',
    cwd: process.cwd(),
    proc,
    setStartupInfo() {},
    sendStartupInfoIfPending() {}
  }
}

async function newSession(proc: Record<string, unknown>) {
  const conn = new FakeAgentSideConnection()
  const agent = new PiAcpAgent(asAgentConn(conn), {} as any)
  ;(agent as any).sessions = new FakeSessions(makeSession(proc)) as any
  return agent.newSession({ cwd: process.cwd(), mcpServers: [] } as any)
}

test('PiAcpAgent: preserves max when an older Pi lacks thinking-level discovery', async () => {
  const result = await newSession({
    async getAvailableModels() {
      return { models: [{ provider: 'test', id: 'alpha', name: 'Alpha' }] }
    },
    async getState() {
      return { thinkingLevel: 'max', model: { provider: 'test', id: 'alpha' } }
    },
    async getAvailableThinkingLevels() {
      throw new Error('pi get_available_thinking_levels failed: Unknown command: get_available_thinking_levels')
    }
  })

  const thinking = result.configOptions.find((option: any) => option.id === 'thought_level') as any
  assert.equal(thinking.currentValue, 'max')
  assert.deepEqual(
    thinking.options.map((option: any) => option.value),
    ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  )
})

test('PiAcpAgent: rejects malformed or transient thinking-level discovery responses', async () => {
  for (const getAvailableThinkingLevels of [
    async () => ({ levels: ['off', 'bogus'] }),
    async () => {
      throw new Error('pi get_available_thinking_levels failed: connection lost')
    },
    async () => {
      throw new Error(
        'pi get_available_thinking_levels failed: request failed after Unknown command: get_available_thinking_levels'
      )
    }
  ]) {
    await assert.rejects(() =>
      newSession({
        async getAvailableModels() {
          return { models: [{ provider: 'test', id: 'alpha', name: 'Alpha' }] }
        },
        async getState() {
          return { thinkingLevel: 'off', model: { provider: 'test', id: 'alpha' } }
        },
        getAvailableThinkingLevels
      })
    )
  }
})

test('PiAcpAgent: serializes concurrent session configuration mutations', async () => {
  const conn = new FakeAgentSideConnection()
  const calls: string[] = []
  let releaseFirst: (() => void) | undefined
  const firstMutation = new Promise<void>(resolve => {
    releaseFirst = resolve
  })
  const state = { thinkingLevel: 'low', model: { provider: 'test', id: 'alpha' } }
  const session = makeSession({
    async getAvailableModels() {
      return { models: [{ provider: 'test', id: 'alpha', name: 'Alpha' }] }
    },
    async getState() {
      return state
    },
    async getAvailableThinkingLevels() {
      return { levels: ['off', 'low', 'high'] }
    },
    async setThinkingLevel(level: 'low' | 'high') {
      calls.push(`start:${level}`)
      if (level === 'low') await firstMutation
      state.thinkingLevel = level
      calls.push(`end:${level}`)
    }
  })
  const agent = new PiAcpAgent(asAgentConn(conn), {} as any)
  ;(agent as any).sessions = new FakeSessions(session) as any

  const first = agent.setSessionConfigOption({ sessionId: 's1', configId: 'thought_level', value: 'low' } as any)
  const second = agent.setSessionConfigOption({ sessionId: 's1', configId: 'thought_level', value: 'high' } as any)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, ['start:low'])
  releaseFirst?.()
  await Promise.all([first, second])
  assert.deepEqual(calls, ['start:low', 'end:low', 'start:high', 'end:high'])
})
