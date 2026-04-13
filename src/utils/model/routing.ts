import type { Message } from '../../types/message.js'
import { getConfiguredTurnRouting } from '../xcoderConfig.js'

export type TurnModelRoutingDecision = {
  selectedModel: string
  strategy: 'base' | 'cheap'
  reason: string
  signature: string
}

type TurnRoutingSignals = {
  latestUserTextChars: number
  messageCount: number
  hasAttachments: boolean
}

type TurnModelRoutingInput = {
  baseModel: string
  messages: Message[]
  permissionMode: string
  querySource: string
  toolCount: number
}

function matchesAllowedQuerySource(
  querySource: string,
  allowedQuerySources: string[],
): boolean {
  return allowedQuerySources.some(
    source => querySource === source || querySource.startsWith(`${source}:`),
  )
}

function deriveTurnRoutingSignals(messages: Message[]): TurnRoutingSignals {
  let latestUserTextChars = 0
  let hasAttachments = false

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as Message & {
      type?: string
      message?: { content?: unknown[] }
    }

    if (message.type === 'attachment') {
      hasAttachments = true
    }

    if (message.type !== 'user' || !message.message?.content) {
      continue
    }

    let totalChars = 0
    for (const block of message.message.content) {
      if (
        typeof block === 'object' &&
        block !== null &&
        'type' in block &&
        block.type === 'text' &&
        'text' in block &&
        typeof block.text === 'string'
      ) {
        totalChars += block.text.length
      } else if (
        typeof block === 'object' &&
        block !== null &&
        'type' in block &&
        block.type !== 'text'
      ) {
        hasAttachments = true
      }
    }

    latestUserTextChars = totalChars
    break
  }

  return {
    latestUserTextChars,
    messageCount: messages.length,
    hasAttachments,
  }
}

function buildRouteSignature(params: {
  strategy: 'base' | 'cheap'
  reason: string
  querySource: string
  messageCount: number
  latestUserTextChars: number
  toolCount: number
  hasAttachments: boolean
}): string {
  return [
    `strategy=${params.strategy}`,
    `reason=${params.reason}`,
    `query=${params.querySource}`,
    `messages=${params.messageCount}`,
    `chars=${params.latestUserTextChars}`,
    `tools=${params.toolCount}`,
    `attachments=${params.hasAttachments ? 1 : 0}`,
  ].join(';')
}

export function selectTurnModelRoute(
  input: TurnModelRoutingInput,
): TurnModelRoutingDecision {
  const config = getConfiguredTurnRouting()
  const signals = deriveTurnRoutingSignals(input.messages)

  const baseDecision = (reason: string): TurnModelRoutingDecision => ({
    selectedModel: input.baseModel,
    strategy: 'base',
    reason,
    signature: buildRouteSignature({
      strategy: 'base',
      reason,
      querySource: input.querySource,
      messageCount: signals.messageCount,
      latestUserTextChars: signals.latestUserTextChars,
      toolCount: input.toolCount,
      hasAttachments: signals.hasAttachments,
    }),
  })

  if (!config) {
    return baseDecision('routing_disabled')
  }

  if (input.permissionMode === 'plan') {
    return baseDecision('plan_mode')
  }

  if (
    input.querySource === 'compact' ||
    input.querySource === 'session_memory'
  ) {
    return baseDecision('maintenance_query')
  }

  if (!matchesAllowedQuerySource(input.querySource, config.allowedQuerySources)) {
    return baseDecision('query_source_blocked')
  }

  if (signals.hasAttachments) {
    return baseDecision('attachments_present')
  }

  if (signals.messageCount > config.maxMessages) {
    return baseDecision('message_budget_exceeded')
  }

  if (signals.latestUserTextChars > config.maxPromptChars) {
    return baseDecision('prompt_budget_exceeded')
  }

  if (input.toolCount > 24) {
    return baseDecision('tool_surface_too_large')
  }

  if (config.cheapModel === input.baseModel) {
    return baseDecision('same_model')
  }

  return {
    selectedModel: config.cheapModel,
    strategy: 'cheap',
    reason: 'cheap_route_selected',
    signature: buildRouteSignature({
      strategy: 'cheap',
      reason: 'cheap_route_selected',
      querySource: input.querySource,
      messageCount: signals.messageCount,
      latestUserTextChars: signals.latestUserTextChars,
      toolCount: input.toolCount,
      hasAttachments: signals.hasAttachments,
    }),
  }
}
