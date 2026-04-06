import { createServer } from 'http'
import type { IncomingMessage, ServerResponse } from 'http'
import * as Lark from '@larksuiteoapi/node-sdk'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod/v4'
import {
  CHANNEL_PERMISSION_METHOD,
  CHANNEL_PERMISSION_REQUEST_METHOD,
  type ChannelPermissionRequestParams,
} from '../../src/services/mcp/channelNotification.js'
import {
  CHANNEL_MIRROR_STATUS_CAPABILITY,
  CHANNEL_MIRROR_STATUS_METHOD,
  ChannelMirrorStatusNotificationSchema,
  type ChannelMirrorStatusParams,
} from '../../src/services/mcp/channelMirror.js'
import { PERMISSION_REPLY_RE } from '../../src/services/mcp/channelPermissions.js'

type FeishuConnectionMode = 'webhook' | 'websocket'
type FeishuDomain = 'feishu' | 'lark'
type ReceiveIdType = 'chat_id' | 'open_id'

type FeishuTarget = {
  receiveIdType: ReceiveIdType
  receiveId: string
  openId?: string
  chatId?: string
  userName?: string
  messageId?: string
}

type FeishuMessageReceiveEvent = {
  sender: {
    sender_id?: {
      open_id?: string
      user_id?: string
      union_id?: string
    }
    sender_type?: string
    tenant_key?: string
  }
  message: {
    message_id: string
    chat_id: string
    thread_id?: string
    chat_type: string
    message_type: string
    content: string
  }
}

type FeishuServerConfig = {
  appId?: string
  appSecret?: string
  verificationToken?: string
  encryptKey?: string
  botName?: string
  allowFrom: string[]
  approvalEnabled: boolean
  bindHost: string
  bindPort: number
  callbackPath: string
  publicBaseUrl?: string
  serverName: string
  connectionMode: FeishuConnectionMode
  domain: FeishuDomain
  dmPolicy: string
  mirrorEnabled: boolean
  mirrorProgress: boolean
  mirrorToolEvents: boolean
  mirrorAssistantUpdates: boolean
  mirrorThrottleMs: number
  mirrorProgressThrottleMs: number
}

const TOOL_NAME = 'send_message'
const SERVER_VERSION = process.env.npm_package_version || '0.0.0'
const BARE_APPROVAL_RE = /^\s*(y|yes|n|no)\s*$/i

const SendMessageInputSchema = z.object({
  content: z.string().min(1),
  receive_id: z.string().optional(),
  receive_id_type: z.enum(['chat_id', 'open_id']).optional(),
})

const PermissionRequestNotificationSchema = z.object({
  method: z.literal(CHANNEL_PERMISSION_REQUEST_METHOD),
  params: z.object({
    request_id: z.string(),
    tool_name: z.string(),
    description: z.string(),
    input_preview: z.string(),
  }),
})

let latestTarget: FeishuTarget | null = null
const pendingApprovalTargetByRequestId = new Map<string, string>()
const pendingApprovalByTarget = new Map<
  string,
  {
    requestId: string
    target: FeishuTarget
  }
>()
let pendingMirrorMessages: ChannelMirrorStatusParams[] = []
let mirrorFlushTimer: ReturnType<typeof setTimeout> | null = null
const lastProgressMirrorAtByKey = new Map<string, number>()

function getConfig(): FeishuServerConfig {
  const bindPort = parseInt(process.env.XCODER_FEISHU_BIND_PORT || '39876', 10)
  const connectionMode =
    process.env.XCODER_FEISHU_CONNECTION_MODE === 'websocket'
      ? 'websocket'
      : 'webhook'
  const domain =
    process.env.XCODER_FEISHU_DOMAIN === 'lark' ? 'lark' : 'feishu'

  return {
    appId: process.env.FEISHU_APP_ID,
    appSecret: process.env.FEISHU_APP_SECRET,
    verificationToken: process.env.FEISHU_VERIFICATION_TOKEN,
    encryptKey: process.env.FEISHU_ENCRYPT_KEY,
    botName: process.env.XCODER_FEISHU_BOT_NAME,
    allowFrom: JSON.parse(process.env.XCODER_FEISHU_ALLOW_FROM || '[]'),
    approvalEnabled:
      (process.env.XCODER_FEISHU_APPROVAL_ENABLED || '1') !== '0',
    bindHost: process.env.XCODER_FEISHU_BIND_HOST || '127.0.0.1',
    bindPort: Number.isFinite(bindPort) ? bindPort : 39876,
    callbackPath: process.env.XCODER_FEISHU_CALLBACK_PATH || '/feishu/events',
    publicBaseUrl: process.env.XCODER_FEISHU_PUBLIC_BASE_URL,
    serverName: process.env.XCODER_CHANNEL_SERVER_NAME || 'feishu',
    connectionMode,
    domain,
    dmPolicy: process.env.XCODER_FEISHU_DM_POLICY || 'pairing',
    mirrorEnabled: (process.env.XCODER_FEISHU_MIRROR_ENABLED || '0') === '1',
    mirrorProgress: (process.env.XCODER_FEISHU_MIRROR_PROGRESS || '1') !== '0',
    mirrorToolEvents:
      (process.env.XCODER_FEISHU_MIRROR_TOOL_EVENTS || '1') !== '0',
    mirrorAssistantUpdates:
      (process.env.XCODER_FEISHU_MIRROR_ASSISTANT_UPDATES || '1') !== '0',
    mirrorProgressThrottleMs:
      parseInt(
        process.env.XCODER_FEISHU_MIRROR_PROGRESS_THROTTLE_MS || '30000',
        10,
      ) || 30000,
    mirrorThrottleMs:
      parseInt(process.env.XCODER_FEISHU_MIRROR_THROTTLE_MS || '3000', 10) ||
      3000,
  }
}

function logInfo(message: string): void {
  process.stderr.write(`[feishu-channel] ${message}\n`)
}

function assertAppCredentials(config: FeishuServerConfig): void {
  if (config.appId && config.appSecret) {
    return
  }

  throw new Error(
    'FEISHU_APP_ID and FEISHU_APP_SECRET must be configured for feishu-channel.',
  )
}

function getLarkDomain(domain: FeishuDomain): Lark.Domain {
  return domain === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu
}

function getDomainLabel(domain: FeishuDomain): string {
  return domain === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn'
}

function createLarkClient(config: FeishuServerConfig): Lark.Client {
  assertAppCredentials(config)
  return new Lark.Client({
    appId: config.appId!,
    appSecret: config.appSecret!,
    appType: Lark.AppType.SelfBuild,
    domain: getLarkDomain(config.domain),
    loggerLevel: Lark.LoggerLevel.error,
  })
}

function extractTextFromEvent(event: FeishuMessageReceiveEvent): string | null {
  const contentRaw = event.message.content
  if (typeof contentRaw !== 'string') {
    return null
  }

  const parsed = JSON.parse(contentRaw) as Record<string, unknown>
  if (
    event.message.message_type === 'text' &&
    typeof parsed.text === 'string'
  ) {
    return parsed.text
  }

  return `[feishu:${String(event.message.message_type || 'unknown')}]`
}

function extractTargetFromEvent(
  event: FeishuMessageReceiveEvent,
): FeishuTarget | null {
  const chatId = event.message.chat_id
  const openId = event.sender.sender_id?.open_id

  if (!chatId && !openId) {
    return null
  }

  return {
    receiveIdType: chatId ? 'chat_id' : 'open_id',
    receiveId: chatId || openId!,
    openId,
    chatId,
    userName: undefined,
    messageId: event.message.message_id,
  }
}

function isAllowedSender(
  config: FeishuServerConfig,
  target: FeishuTarget | null,
): boolean {
  if (!target) {
    return false
  }
  if (config.allowFrom.length === 0) {
    return true
  }
  return !!target.openId && config.allowFrom.includes(target.openId)
}

function getTargetKey(target: FeishuTarget): string {
  return `${target.receiveIdType}:${target.receiveId}`
}

function rememberPendingApproval(
  requestId: string,
  target: FeishuTarget,
): void {
  const key = getTargetKey(target)
  const previous = pendingApprovalByTarget.get(key)
  if (previous) {
    pendingApprovalTargetByRequestId.delete(previous.requestId)
  }
  pendingApprovalByTarget.set(key, { requestId, target })
  pendingApprovalTargetByRequestId.set(requestId, key)
}

function clearPendingApproval(requestId: string): void {
  const key = pendingApprovalTargetByRequestId.get(requestId)
  if (!key) {
    return
  }
  pendingApprovalTargetByRequestId.delete(requestId)
  const pending = pendingApprovalByTarget.get(key)
  if (pending?.requestId === requestId) {
    pendingApprovalByTarget.delete(key)
  }
}

function resolveApprovalFromText(
  target: FeishuTarget | null,
  text: string,
): { requestId: string; behavior: 'allow' | 'deny' } | null {
  const explicitMatch = text.match(PERMISSION_REPLY_RE)
  if (explicitMatch) {
    return {
      requestId: explicitMatch[2]!.toLowerCase(),
      behavior: /^y(es)?$/i.test(explicitMatch[1] || '') ? 'allow' : 'deny',
    }
  }

  if (!target) {
    return null
  }

  const bareMatch = text.match(BARE_APPROVAL_RE)
  if (!bareMatch) {
    return null
  }

  const pending = pendingApprovalByTarget.get(getTargetKey(target))
  if (!pending) {
    return null
  }

  return {
    requestId: pending.requestId,
    behavior: /^y(es)?$/i.test(bareMatch[1] || '') ? 'allow' : 'deny',
  }
}

function shouldMirrorMessage(
  config: FeishuServerConfig,
  params: ChannelMirrorStatusParams,
): boolean {
  if (!config.mirrorEnabled) {
    return false
  }

  if (params.category === 'progress' && !config.mirrorProgress) {
    return false
  }

  if (params.category === 'tool' && !config.mirrorToolEvents) {
    return false
  }

  if (params.category === 'assistant' && !config.mirrorAssistantUpdates) {
    return false
  }

  return true
}

async function flushMirrorMessages(
  client: Lark.Client,
  config: FeishuServerConfig,
): Promise<void> {
  mirrorFlushTimer = null
  if (pendingMirrorMessages.length === 0) {
    return
  }

  const target = getDefaultTarget(config)
  if (!target) {
    return
  }

  const batch = pendingMirrorMessages
  pendingMirrorMessages = []
  const text = batch.map(item => `• ${item.text}`).join('\n')
  await sendFeishuTextMessage(client, target, text)
}

function queueMirrorMessage(
  client: Lark.Client,
  config: FeishuServerConfig,
  params: ChannelMirrorStatusParams,
): void {
  if (!shouldMirrorMessage(config, params)) {
    return
  }

  const last = pendingMirrorMessages.at(-1)
  if (
    last &&
    last.dedupeKey &&
    params.dedupeKey &&
    last.dedupeKey === params.dedupeKey &&
    last.text === params.text
  ) {
    return
  }

  if (params.category === 'progress') {
    const key = params.dedupeKey || params.text
    const now = Date.now()
    const lastSentAt = lastProgressMirrorAtByKey.get(key) || 0
    if (now - lastSentAt < config.mirrorProgressThrottleMs) {
      return
    }
    lastProgressMirrorAtByKey.set(key, now)
  }

  pendingMirrorMessages.push(params)

  if (params.urgent) {
    if (mirrorFlushTimer) {
      clearTimeout(mirrorFlushTimer)
      mirrorFlushTimer = null
    }
    void flushMirrorMessages(client, config).catch(error => {
      logInfo(
        `Failed to flush urgent mirror message: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
    return
  }

  if (!mirrorFlushTimer) {
    mirrorFlushTimer = setTimeout(() => {
      void flushMirrorMessages(client, config).catch(error => {
        logInfo(
          `Failed to flush mirror messages: ${error instanceof Error ? error.message : String(error)}`,
        )
      })
    }, config.mirrorThrottleMs)
  }
}

async function sendFeishuTextMessage(
  client: Lark.Client,
  target: FeishuTarget,
  content: string,
): Promise<void> {
  await client.im.message.create({
    params: {
      receive_id_type: target.receiveIdType,
    },
    data: {
      receive_id: target.receiveId,
      msg_type: 'text',
      content: JSON.stringify({ text: content }),
    },
  })
}

function getDefaultTarget(config: FeishuServerConfig): FeishuTarget | null {
  if (latestTarget) {
    return latestTarget
  }
  if (config.allowFrom.length === 1) {
    return {
      receiveIdType: 'open_id',
      receiveId: config.allowFrom[0]!,
      openId: config.allowFrom[0]!,
    }
  }
  return null
}

async function handleMessageSend(
  client: Lark.Client,
  config: FeishuServerConfig,
  args: z.infer<typeof SendMessageInputSchema>,
): Promise<CallToolResult> {
  const parsed = SendMessageInputSchema.parse(args)
  const target =
    parsed.receive_id && parsed.receive_id_type
      ? {
          receiveIdType: parsed.receive_id_type,
          receiveId: parsed.receive_id,
          ...(parsed.receive_id_type === 'chat_id'
            ? { chatId: parsed.receive_id }
            : { openId: parsed.receive_id }),
        }
      : getDefaultTarget(config)

  if (!target) {
    throw new Error(
      'No Feishu target available. Provide receive_id + receive_id_type, or receive an inbound Feishu message first.',
    )
  }

  await sendFeishuTextMessage(client, target, parsed.content)
  return {
    content: [
      {
        type: 'text',
        text: `Sent message to ${target.receiveIdType}:${target.receiveId}`,
      },
    ],
  }
}

function buildPermissionPrompt(params: ChannelPermissionRequestParams): string {
  return [
    `Approval needed for tool: ${params.tool_name}`,
    `Request ID: ${params.request_id}`,
    `Why: ${params.description}`,
    `Input: ${params.input_preview}`,
    '',
    `Reply with: Yes`,
    `Or: No`,
    `You can also reply with: yes ${params.request_id}`,
    `Or: no ${params.request_id}`,
  ].join('\n')
}

async function handleInboundEvent(
  server: Server,
  config: FeishuServerConfig,
  event: FeishuMessageReceiveEvent,
): Promise<void> {
  if (event.sender.sender_type && event.sender.sender_type !== 'user') {
    return
  }

  const target = extractTargetFromEvent(event)
  if (!isAllowedSender(config, target)) {
    return
  }

  const text = extractTextFromEvent(event)
  if (!text) {
    return
  }

  latestTarget = target

  const approvalDecision = config.approvalEnabled
    ? resolveApprovalFromText(target, text)
    : null
  if (approvalDecision) {
    clearPendingApproval(approvalDecision.requestId)
    await server.notification({
      method: CHANNEL_PERMISSION_METHOD,
      params: {
        request_id: approvalDecision.requestId,
        behavior: approvalDecision.behavior,
      },
    })
    return
  }

  await server.notification({
    method: 'notifications/claude/channel',
    params: {
      content: text,
      meta: {
        ...(target?.chatId ? { chat_id: target.chatId } : {}),
        ...(target?.openId ? { open_id: target.openId } : {}),
        ...(target?.messageId ? { message_id: target.messageId } : {}),
        ...(event.message.thread_id ? { thread_id: event.message.thread_id } : {}),
        ...(event.message.chat_type ? { chat_type: event.message.chat_type } : {}),
      },
    },
  })
}

function createEventDispatcher(
  server: Server,
  config: FeishuServerConfig,
): Lark.EventDispatcher {
  return new Lark.EventDispatcher({
    encryptKey: config.encryptKey,
    verificationToken: config.verificationToken,
    loggerLevel: Lark.LoggerLevel.error,
  }).register({
    'im.message.receive_v1': async event => {
      await handleInboundEvent(server, config, event as FeishuMessageReceiveEvent)
    },
  })
}

function createWebhookHttpServer(
  dispatcher: Lark.EventDispatcher,
  config: FeishuServerConfig,
) {
  const adapter = Lark.adaptDefault(config.callbackPath, dispatcher, {
    autoChallenge: true,
  })

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url || '/'

    if (req.method === 'GET' && url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, mode: 'webhook' }))
      return
    }

    void adapter(req, res)
  })
}

async function startWebhookRuntime(
  dispatcher: Lark.EventDispatcher,
  config: FeishuServerConfig,
): Promise<() => Promise<void>> {
  const httpServer = createWebhookHttpServer(dispatcher, config)
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(config.bindPort, config.bindHost, () => resolve())
  })

  logInfo(
    `Feishu webhook server listening on http://${config.bindHost}:${config.bindPort}${config.callbackPath}`,
  )
  if (config.publicBaseUrl) {
    logInfo(
      `Feishu public callback URL: ${config.publicBaseUrl.replace(/\/$/, '')}${config.callbackPath}`,
    )
  } else {
    logInfo(
      'Feishu webhook mode is active without public_base_url; local testing works, but Feishu cannot reach this server from the public internet until you expose it yourself.',
    )
  }

  return async () =>
    await new Promise<void>(resolve => httpServer.close(() => resolve()))
}

async function startWebsocketRuntime(
  dispatcher: Lark.EventDispatcher,
  config: FeishuServerConfig,
): Promise<() => Promise<void>> {
  assertAppCredentials(config)

  const wsClient = new Lark.WSClient({
    appId: config.appId!,
    appSecret: config.appSecret!,
    domain: getLarkDomain(config.domain),
    loggerLevel: Lark.LoggerLevel.error,
    autoReconnect: true,
  })

  await wsClient.start({ eventDispatcher: dispatcher })
  logInfo(
    `Feishu websocket mode connected through ${getDomainLabel(config.domain)}; no public callback URL is required while this process stays online.`,
  )

  return async () => {
    wsClient.close({ force: true })
  }
}

async function start(): Promise<void> {
  const config = getConfig()
  const client = createLarkClient(config)
  const server = new Server(
    {
      name: `xcoder-channel-${config.serverName}`,
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
        experimental: {
          'claude/channel': {},
          'claude/channel/permission': {},
          [CHANNEL_MIRROR_STATUS_CAPABILITY]: {},
        },
      },
      instructions:
        'Feishu channel server for xcoder. When a message arrives from <channel source="feishu">, the human on Feishu cannot see plain terminal-only assistant text. Use this server\'s send_message tool to reply to that conversation. Supports inbound message relay, outbound send_message, and remote permission approvals.',
    },
  )

  server.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => ({
    tools: [
      {
        name: TOOL_NAME,
        description:
          'Send a message back to Feishu. Use this to reply to inbound Feishu channel messages; plain assistant text in the terminal is not visible in Feishu. If receive_id and receive_id_type are omitted, the most recent inbound Feishu conversation is used.',
        inputSchema: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'The message text to send.',
            },
            receive_id: {
              type: 'string',
              description:
                'Optional explicit Feishu receive_id (chat_id or open_id).',
            },
            receive_id_type: {
              type: 'string',
              enum: ['chat_id', 'open_id'],
              description:
                'Required when receive_id is provided. Omit both fields to reply to the latest inbound conversation.',
            },
          },
          required: ['content'],
        },
      },
    ],
  }))

  server.setRequestHandler(
    CallToolRequestSchema,
    async ({ params }): Promise<CallToolResult> => {
      try {
        if (params.name !== TOOL_NAME) {
          throw new Error(`Unknown tool: ${params.name}`)
        }
        const args = (params.arguments || {}) as z.infer<typeof SendMessageInputSchema>
        return await handleMessageSend(client, config, args)
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: error instanceof Error ? error.message : String(error),
            },
          ],
        }
      }
    },
  )

  server.setNotificationHandler(
    PermissionRequestNotificationSchema,
    async notification => {
      const target = getDefaultTarget(config)
      if (!target) {
        logInfo(
          `No Feishu target available for permission request ${notification.params.request_id}`,
        )
        return
      }

      const prompt = buildPermissionPrompt(notification.params)
      try {
        rememberPendingApproval(notification.params.request_id, target)
        await sendFeishuTextMessage(client, target, prompt)
      } catch (error) {
        clearPendingApproval(notification.params.request_id)
        logInfo(
          `Failed to forward permission request ${notification.params.request_id}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    },
  )

  server.setNotificationHandler(
    ChannelMirrorStatusNotificationSchema,
    async notification => {
      queueMirrorMessage(client, config, notification.params)
    },
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)

  const dispatcher = createEventDispatcher(server, config)
  const stopRuntime =
    config.connectionMode === 'websocket'
      ? await startWebsocketRuntime(dispatcher, config)
      : await startWebhookRuntime(dispatcher, config)

  logInfo(
    `Feishu channel ready in ${config.connectionMode} mode for ${config.domain}. dmPolicy=${config.dmPolicy}${config.botName ? ` bot=${config.botName}` : ''}`,
  )

  let exiting = false
  const shutdown = async () => {
    if (exiting) return
    exiting = true
    await stopRuntime().catch(() => {})
    process.exit(0)
  }

  process.stdin.on('end', () => void shutdown())
  process.stdin.on('error', () => void shutdown())
}

void start().catch(error => {
  process.stderr.write(`[feishu-channel] fatal: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
