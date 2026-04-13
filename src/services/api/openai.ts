import type Anthropic from '@anthropic-ai/sdk'
import type {
  BetaMessage,
  BetaToolUnion,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type {
  ContentBlockParam,
  TextBlockParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import { randomUUID } from 'crypto'
import type { AssistantMessage } from 'src/types/message.js'
import type { AssistantMessage as InternalAssistantMessage } from 'src/types/message.js'
import { createAssistantMessage } from '../../utils/messages.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { safeParseJSON } from '../../utils/json.js'
import {
  getActiveProviderSelection,
  getConfiguredProviderApiKey,
} from '../../utils/xcoderConfig.js'

type OpenAIChatMessage =
  | {
      role: 'system' | 'user' | 'assistant'
      content: string | null
      tool_calls?: Array<{
        id: string
        type: 'function'
        function: { name: string; arguments: string }
      }>
    }
  | {
      role: 'tool'
      tool_call_id: string
      content: string
    }

type OpenAIChatRequest = {
  model: string
  messages: OpenAIChatMessage[]
  tools?: Array<{
    type: 'function'
    function: {
      name: string
      description?: string
      parameters: Record<string, unknown>
      strict?: boolean
    }
  }>
  tool_choice?:
    | 'auto'
    | {
        type: 'function'
        function: { name: string }
      }
  temperature?: number
  max_tokens?: number
  response_format?: {
    type: 'json_schema'
    json_schema: {
      name: string
      schema: Record<string, unknown>
      strict?: boolean
    }
  }
  thinking?: {
    type: 'enabled' | 'disabled'
  }
}

type OpenAIChatResponse = {
  id?: string
  model?: string
  choices?: Array<{
    message?: {
      role?: string
      content?: string | null
      tool_calls?: Array<{
        id: string
        type: 'function'
        function: { name: string; arguments: string }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
  }
}

function getOpenAISelectionOrThrow() {
  const selection = getActiveProviderSelection()
  if (!selection || selection.backend !== 'openai') {
    throw new Error('OpenAI provider is not active in xcoder.yaml')
  }

  const apiKey = getConfiguredProviderApiKey(selection)
  if (!apiKey) {
    throw new Error(
      `No API key resolved for provider '${selection.name}'. Configure api_key or api_key_env in xcoder.yaml.`,
    )
  }

  return {
    ...selection,
    apiKey,
    apiBase: selection.apiBase || 'https://api.openai.com/v1',
  }
}

function stringifyToolResultContent(content: string | ContentBlockParam[]): string {
  if (typeof content === 'string') {
    return content
  }

  return content
    .map(block => {
      if (typeof block === 'string') {
        return block
      }
      if (block.type === 'text' && 'text' in block) {
        return block.text
      }
      return JSON.stringify(block)
    })
    .filter(Boolean)
    .join('\n')
}

function convertAnthropicLikeMessagesToOpenAI(
  messages: Array<{
    role: 'user' | 'assistant'
    content: unknown
  }>,
): OpenAIChatMessage[] {
  const result: OpenAIChatMessage[] = []

  for (const message of messages) {
    if (typeof message.content === 'string') {
      result.push({
        role: message.role,
        content: message.content,
      })
      continue
    }

    if (!Array.isArray(message.content)) {
      result.push({
        role: message.role,
        content: JSON.stringify(message.content ?? ''),
      })
      continue
    }

    if (message.role === 'assistant') {
      const textParts: string[] = []
      const toolCalls: OpenAIChatMessage extends infer _T
        ? Array<{
            id: string
            type: 'function'
            function: { name: string; arguments: string }
          }>
        : never = []

      for (const block of message.content as Array<Record<string, unknown>>) {
        if (block.type === 'text' && typeof block.text === 'string') {
          textParts.push(block.text)
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id:
              (typeof block.id === 'string' && block.id) || randomUUID(),
            type: 'function',
            function: {
              name: String(block.name || 'tool'),
              arguments: JSON.stringify(block.input ?? {}),
            },
          })
        }
      }

      result.push({
        role: 'assistant',
        content: textParts.length > 0 ? textParts.join('\n') : null,
        ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
      })
      continue
    }

    const textParts: string[] = []
    for (const block of message.content as Array<Record<string, unknown>>) {
      if (block.type === 'text' && typeof block.text === 'string') {
        textParts.push(block.text)
      } else if (block.type === 'tool_result') {
        if (textParts.length > 0) {
          result.push({
            role: 'user',
            content: textParts.join('\n'),
          })
          textParts.length = 0
        }
        result.push({
          role: 'tool',
          tool_call_id: String(block.tool_use_id || ''),
          content: stringifyToolResultContent(
            (block.content as string | ContentBlockParam[]) ?? '',
          ),
        })
      }
    }
    if (textParts.length > 0) {
      result.push({
        role: 'user',
        content: textParts.join('\n'),
      })
    }
  }

  return result
}

function convertToolsToOpenAI(
  tools: BetaToolUnion[],
): OpenAIChatRequest['tools'] {
  if (tools.length === 0) {
    return undefined
  }

  return tools
    .filter(
      tool =>
        'name' in tool &&
        'description' in tool &&
        'input_schema' in tool &&
        typeof tool.name === 'string',
    )
    .map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description:
          typeof tool.description === 'string' ? tool.description : undefined,
        parameters:
          (tool.input_schema as Record<string, unknown>) || {
            type: 'object',
            properties: {},
          },
        ...('strict' in tool &&
          typeof tool.strict === 'boolean' && { strict: tool.strict }),
      },
    }))
}

function convertToolChoiceToOpenAI(
  toolChoice: Anthropic.ToolChoice | undefined,
): OpenAIChatRequest['tool_choice'] {
  if (!toolChoice) {
    return undefined
  }

  if (toolChoice.type === 'tool' && 'name' in toolChoice) {
    return {
      type: 'function',
      function: {
        name: toolChoice.name,
      },
    }
  }

  return 'auto'
}

function convertOutputFormatToOpenAI(
  outputFormat: unknown,
): OpenAIChatRequest['response_format'] {
  if (!outputFormat || typeof outputFormat !== 'object') {
    return undefined
  }

  const record = outputFormat as Record<string, unknown>
  const schema = (record.schema || record.json_schema) as
    | Record<string, unknown>
    | undefined
  if (!schema) {
    return undefined
  }

  return {
    type: 'json_schema',
    json_schema: {
      name: typeof record.name === 'string' ? record.name : 'output',
      schema,
      strict: true,
    },
  }
}

function buildUsage(
  usage: OpenAIChatResponse['usage'] | undefined,
): InternalAssistantMessage['message']['usage'] {
  return {
    input_tokens: usage?.prompt_tokens ?? 0,
    output_tokens: usage?.completion_tokens ?? 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
    service_tier: null,
    cache_creation: {
      ephemeral_1h_input_tokens: 0,
      ephemeral_5m_input_tokens: 0,
    },
    inference_geo: null,
    iterations: null,
    speed: null,
  }
}

function buildAssistantMessageFromOpenAI(
  response: OpenAIChatResponse,
  model: string,
  requestId?: string,
): AssistantMessage {
  const choice = response.choices?.[0]
  const contentBlocks: BetaMessage['content'] = []
  const message = choice?.message

  if (message?.content) {
    contentBlocks.push({
      type: 'text',
      text: message.content,
      citations: [],
    } as BetaMessage['content'][number])
  }

  for (const toolCall of message?.tool_calls || []) {
    const parsedInput = safeParseJSON(toolCall.function.arguments)
    contentBlocks.push({
      type: 'tool_use',
      id: toolCall.id,
      name: toolCall.function.name,
      input:
        parsedInput && typeof parsedInput === 'object' ? parsedInput : {},
    } as BetaMessage['content'][number])
  }

  const assistantMessage = createAssistantMessage({
    content:
      contentBlocks.length > 0
        ? contentBlocks
        : [
            {
              type: 'text',
              text: '',
              citations: [],
            } as BetaMessage['content'][number],
          ],
    usage: buildUsage(response.usage),
  })

  assistantMessage.message = {
    ...assistantMessage.message,
    id: response.id || assistantMessage.message.id,
    model: response.model || model,
    stop_reason:
      message?.tool_calls && message.tool_calls.length > 0
        ? 'tool_use'
        : 'end_turn',
    usage: buildUsage(response.usage),
  }
  assistantMessage.requestId = requestId
  return assistantMessage
}

export async function createOpenAIBetaMessage({
  model,
  system,
  messages,
  tools = [],
  toolChoice,
  outputFormat,
  maxTokens,
  temperature,
  signal,
}: {
  model: string
  system?: string | TextBlockParam[]
  messages: Array<{
    role: 'user' | 'assistant'
    content: unknown
  }>
  tools?: BetaToolUnion[]
  toolChoice?: Anthropic.ToolChoice
  outputFormat?: unknown
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
}): Promise<BetaMessage> {
  const selection = getOpenAISelectionOrThrow()
  const url = `${selection.apiBase!.replace(/\/$/, '')}/chat/completions`

  const systemText = Array.isArray(system)
    ? system
        .map(block => ('text' in block ? block.text : ''))
        .filter(Boolean)
        .join('\n\n')
    : system

  const openaiMessages: OpenAIChatMessage[] = []
  if (systemText && systemText.trim()) {
    openaiMessages.push({ role: 'system', content: systemText })
  }
  openaiMessages.push(...convertAnthropicLikeMessagesToOpenAI(messages))

  const payload: OpenAIChatRequest = {
    model,
    messages: openaiMessages,
    ...(tools.length > 0 && { tools: convertToolsToOpenAI(tools) }),
    ...(toolChoice && { tool_choice: convertToolChoiceToOpenAI(toolChoice) }),
    ...(temperature !== undefined && { temperature }),
    ...(maxTokens !== undefined && { max_tokens: maxTokens }),
    ...(outputFormat && {
      response_format: convertOutputFormatToOpenAI(outputFormat),
    }),
    // Disable reasoning/thinking mode for Kimi API compatibility
    thinking: { type: 'disabled' },
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${selection.apiKey}`,
    ...selection.extraHeaders,
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal,
  })

  if (!response.ok) {
    const errorText = await response.text()
    logForDebugging(
      `OpenAI provider request failed (${response.status}): ${errorText}`,
      { level: 'error' },
    )
    throw new Error(
      `OpenAI request failed (${response.status}): ${errorText || response.statusText}`,
    )
  }

  const requestId =
    response.headers.get('x-request-id') ||
    response.headers.get('request-id') ||
    undefined

  const json = (await response.json()) as OpenAIChatResponse
  const assistantMessage = buildAssistantMessageFromOpenAI(
    json,
    model,
    requestId,
  )

  return {
    ...assistantMessage.message,
    _request_id: requestId,
  } as unknown as BetaMessage
}

export async function queryOpenAIModelOnce({
  model,
  system,
  messages,
  tools = [],
  toolChoice,
  maxTokens,
  temperature,
  signal,
}: {
  model: string
  system?: string | TextBlockParam[]
  messages: Array<{
    role: 'user' | 'assistant'
    content: unknown
  }>
  tools?: BetaToolUnion[]
  toolChoice?: Anthropic.ToolChoice
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
}): Promise<AssistantMessage> {
  const betaMessage = await createOpenAIBetaMessage({
    model,
    system,
    messages,
    tools,
    toolChoice,
    maxTokens,
    temperature,
    signal,
  })

  return buildAssistantMessageFromOpenAI(
    {
      id: betaMessage.id,
      model: betaMessage.model,
      choices: [
        {
          message: {
            role: 'assistant',
            content: betaMessage.content
              .filter(block => block.type === 'text')
              .map(block => ('text' in block ? block.text : ''))
              .join('\n'),
            tool_calls: betaMessage.content
              .filter(block => block.type === 'tool_use')
              .map(block => ({
                id: 'id' in block ? block.id : randomUUID(),
                type: 'function' as const,
                function: {
                  name: 'name' in block ? block.name : 'tool',
                  arguments: JSON.stringify(
                    'input' in block ? (block.input ?? {}) : {},
                  ),
                },
              })),
          },
        },
      ],
      usage: {
        prompt_tokens: betaMessage.usage.input_tokens,
        completion_tokens: betaMessage.usage.output_tokens,
      },
    },
    model,
    (betaMessage as { _request_id?: string })._request_id,
  )
}

export function isOpenAIError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes('OpenAI request failed') ||
      error.message.includes('OpenAI provider'))
  )
}

export function getOpenAIErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : errorMessage(error)
}
