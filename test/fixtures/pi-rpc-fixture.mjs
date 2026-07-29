#!/usr/bin/env node

import { createInterface } from 'node:readline'

const lines = createInterface({ input: process.stdin })

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

lines.on('line', line => {
  const command = JSON.parse(line)
  send({ type: 'fixture_command', command })

  if (command.type === 'get_state') {
    send({
      type: 'response',
      id: command.id,
      command: 'get_state',
      success: true,
      data: {
        thinkingLevel: 'off',
        isStreaming: false,
        isCompacting: false,
        steeringMode: 'one-at-a-time',
        followUpMode: 'one-at-a-time',
        sessionId: 'fixture',
        autoCompactionEnabled: true,
        messageCount: 0,
        pendingMessageCount: 0
      }
    })
    return
  }

  if (command.message === 'fail') {
    send({
      type: 'response',
      id: command.id,
      command: command.type,
      success: false,
      error: 'fixture rejection'
    })
    return
  }

  send({ type: 'response', id: command.id, command: command.type, success: true })
})
