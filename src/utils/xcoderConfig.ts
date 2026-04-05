import { existsSync, readFileSync, statSync } from 'fs'
import { dirname, isAbsolute, join, resolve } from 'path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod/v4'
import { getOriginalCwd } from '../bootstrap/state.js'
import type { ChannelEntry } from '../bootstrap/state.js'
import type { ScopedMcpServerConfig } from '../services/mcp/types.js'
import { logForDebugging } from './debug.js'
import { logError } from './log.js'

export const XCODER_CONFIG_FILENAME = 'xcoder.yaml'

export const XcoderProviderTypeSchema = z.enum([
  'anthropic',
  'anthropic-compatible',
  'openai',
  'openai-compatible',
])

export const XcoderAutoYesModeSchema = z.enum([
  'safe_except_delete_or_choice',
])

const ProviderConfigSchema = z
  .object({
    type: XcoderProviderTypeSchema.optional(),
    api_key: z.string().optional(),
    apiKey: z.string().optional(),
    api_key_env: z.string().optional(),
    apiKeyEnv: z.string().optional(),
    api_base: z.string().optional(),
    apiBase: z.string().optional(),
    extra_headers: z.record(z.string(), z.string()).optional(),
    extraHeaders: z.record(z.string(), z.string()).optional(),
    models: z.array(z.string()).optional(),
  })
  .passthrough()

const FeishuApprovalSchema = z
  .object({
    enabled: z.boolean().optional(),
  })
  .passthrough()

const FeishuAccountSchema = z
  .object({
    app_id: z.string().optional(),
    appId: z.string().optional(),
    app_id_env: z.string().optional(),
    appIdEnv: z.string().optional(),
    app_secret: z.string().optional(),
    appSecret: z.string().optional(),
    app_secret_env: z.string().optional(),
    appSecretEnv: z.string().optional(),
    encrypt_key: z.string().optional(),
    encryptKey: z.string().optional(),
    encrypt_key_env: z.string().optional(),
    encryptKeyEnv: z.string().optional(),
    verification_token: z.string().optional(),
    verificationToken: z.string().optional(),
    verification_token_env: z.string().optional(),
    verificationTokenEnv: z.string().optional(),
    botName: z.string().optional(),
    bot_name: z.string().optional(),
  })
  .passthrough()

const FeishuChannelConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    mode: z.enum(['mcp']).optional(),
    connectionMode: z.enum(['webhook', 'websocket']).optional(),
    connection_mode: z.enum(['webhook', 'websocket']).optional(),
    domain: z.enum(['feishu', 'lark']).optional(),
    dmPolicy: z.string().optional(),
    dm_policy: z.string().optional(),
    server_name: z.string().optional(),
    serverName: z.string().optional(),
    bind_host: z.string().optional(),
    bindHost: z.string().optional(),
    bind_port: z.number().int().positive().optional(),
    bindPort: z.number().int().positive().optional(),
    callback_path: z.string().optional(),
    callbackPath: z.string().optional(),
    public_base_url: z.string().optional(),
    publicBaseUrl: z.string().optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    app_id: z.string().optional(),
    appId: z.string().optional(),
    app_id_env: z.string().optional(),
    appIdEnv: z.string().optional(),
    app_secret: z.string().optional(),
    appSecret: z.string().optional(),
    app_secret_env: z.string().optional(),
    appSecretEnv: z.string().optional(),
    encrypt_key: z.string().optional(),
    encryptKey: z.string().optional(),
    encrypt_key_env: z.string().optional(),
    encryptKeyEnv: z.string().optional(),
    verification_token: z.string().optional(),
    verificationToken: z.string().optional(),
    verification_token_env: z.string().optional(),
    verificationTokenEnv: z.string().optional(),
    bot_name: z.string().optional(),
    botName: z.string().optional(),
    accounts: z.record(z.string(), FeishuAccountSchema).optional(),
    allow_from: z.array(z.string()).optional(),
    allowFrom: z.array(z.string()).optional(),
    approval: FeishuApprovalSchema.optional(),
  })
  .passthrough()

const XcoderChannelsSchema = z
  .object({
    feishu: FeishuChannelConfigSchema.optional(),
  })
  .passthrough()

const XcoderPermissionsSchema = z
  .object({
    auto_yes_mode: XcoderAutoYesModeSchema.optional(),
    autoYesMode: XcoderAutoYesModeSchema.optional(),
  })
  .passthrough()

const XcoderConfigSchema = z
  .object({
    xcoder: z
      .object({
        model: z.string().optional(),
      })
      .optional(),
    providers: z.record(z.string(), ProviderConfigSchema).optional(),
    channels: XcoderChannelsSchema.optional(),
    permissions: XcoderPermissionsSchema.optional(),
  })
  .passthrough()

export type XcoderProviderType = z.infer<typeof XcoderProviderTypeSchema>
export type XcoderAutoYesMode = z.infer<typeof XcoderAutoYesModeSchema>
export type XcoderConfig = z.infer<typeof XcoderConfigSchema>
export type XcoderProviderBackend = 'anthropic' | 'openai'
export type XcoderFeishuChannelConfig = z.infer<
  typeof FeishuChannelConfigSchema
>

export type NormalizedXcoderProviderConfig = {
  name: string
  type: XcoderProviderType
  backend: XcoderProviderBackend
  apiKey?: string
  apiKeyEnv?: string
  apiBase?: string
  extraHeaders: Record<string, string>
  models?: string[]
}

export type ActiveProviderSelection = NormalizedXcoderProviderConfig & {
  model: string
}

export type NormalizedFeishuChannelConfig = {
  enabled: boolean
  mode: 'mcp'
  serverName: string
  connectionMode: 'webhook' | 'websocket'
  domain: 'feishu' | 'lark'
  dmPolicy: string
  bindHost?: string
  bindPort?: number
  callbackPath?: string
  publicBaseUrl?: string
  botName?: string
  command?: string
  args: string[]
  env: Record<string, string>
  allowFrom: string[]
  approvalEnabled: boolean
}

let cachedConfigPath: string | null = null
let cachedConfigMtimeMs: number | null = null
let cachedConfig: XcoderConfig | null = null

export function getXcoderConfigSearchPaths(): string[] {
  const paths: string[] = []

  if (process.env.XCODER_CONFIG) {
    paths.push(process.env.XCODER_CONFIG)
  }

  paths.push(join(getOriginalCwd(), XCODER_CONFIG_FILENAME))

  const execDir = dirname(process.execPath)
  const execPath = join(execDir, XCODER_CONFIG_FILENAME)
  if (!paths.includes(execPath)) {
    paths.push(execPath)
  }

  return paths
}

export function getXcoderConfigPath(): string {
  for (const path of getXcoderConfigSearchPaths()) {
    if (existsSync(path)) {
      return path
    }
  }

  return getXcoderConfigSearchPaths()[0]!
}

function inferProviderType(
  providerName: string,
  explicitType?: XcoderProviderType,
): XcoderProviderType | null {
  if (explicitType) {
    return explicitType
  }

  const normalized = providerName.toLowerCase()
  if (normalized === 'anthropic') return 'anthropic'
  if (normalized === 'openai') return 'openai'
  if (normalized.includes('anthropic')) return 'anthropic-compatible'
  if (normalized.includes('openai')) return 'openai-compatible'
  if (normalized.includes('relay')) return 'anthropic-compatible'
  return null
}

function resolveConfiguredString(
  directValue?: string,
  envName?: string,
): string | undefined {
  if (directValue && directValue.trim()) {
    return directValue
  }
  if (envName && envName.trim()) {
    const envValue = process.env[envName]
    if (envValue && envValue.trim()) {
      return envValue
    }
  }
  return undefined
}

function resolveConfigRelativePath(
  value: string | undefined,
  configPath: string,
): string | undefined {
  if (!value || !value.trim()) {
    return undefined
  }
  if (isAbsolute(value)) {
    return value
  }
  if (value.startsWith('./') || value.startsWith('../')) {
    return resolve(dirname(configPath), value)
  }
  return value
}

function getPrimaryFeishuAccount(
  feishu: XcoderFeishuChannelConfig,
): z.infer<typeof FeishuAccountSchema> | undefined {
  if (!feishu.accounts) {
    return undefined
  }

  return feishu.accounts.main || Object.values(feishu.accounts)[0]
}

function getProviderBackend(type: XcoderProviderType): XcoderProviderBackend {
  return type.startsWith('openai') ? 'openai' : 'anthropic'
}

function getDefaultApiKeyEnv(type: XcoderProviderType): string {
  return type.startsWith('openai') ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'
}

function getDefaultApiBase(type: XcoderProviderType): string | undefined {
  switch (type) {
    case 'openai':
      return process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
    case 'openai-compatible':
      return process.env.OPENAI_BASE_URL
    case 'anthropic-compatible':
      return process.env.ANTHROPIC_BASE_URL
    case 'anthropic':
    default:
      return process.env.ANTHROPIC_BASE_URL
  }
}

function normalizeProviderConfig(
  name: string,
  providerConfig: XcoderConfig['providers'][string],
): NormalizedXcoderProviderConfig | null {
  const type = inferProviderType(
    name,
    providerConfig.type as XcoderProviderType | undefined,
  )
  if (!type) {
    return null
  }

  return {
    name,
    type,
    backend: getProviderBackend(type),
    apiKey: providerConfig.api_key || providerConfig.apiKey,
    apiKeyEnv:
      providerConfig.api_key_env ||
      providerConfig.apiKeyEnv ||
      getDefaultApiKeyEnv(type),
    apiBase:
      providerConfig.api_base ||
      providerConfig.apiBase ||
      getDefaultApiBase(type),
    extraHeaders:
      providerConfig.extra_headers || providerConfig.extraHeaders || {},
    models: providerConfig.models,
  }
}

function inferProviderNameFromModel(
  model: string,
  providers: Record<string, XcoderConfig['providers'][string]>,
): string | null {
  const entries = Object.entries(providers)
  if (entries.length === 1) {
    return entries[0]![0]
  }

  const normalizedModel = model.toLowerCase()
  const wantsOpenAI =
    normalizedModel.startsWith('gpt-') ||
    normalizedModel.startsWith('o') ||
    normalizedModel.includes('chatgpt')
  const wantsAnthropic = normalizedModel.includes('claude')

  for (const [name, cfg] of entries) {
    const type = inferProviderType(
      name,
      cfg.type as XcoderProviderType | undefined,
    )
    if (!type) continue
    if (wantsOpenAI && type.startsWith('openai')) return name
    if (wantsAnthropic && type.startsWith('anthropic')) return name
  }

  return null
}

export function getXcoderConfig(): XcoderConfig | null {
  const path = getXcoderConfigPath()

  if (!existsSync(path)) {
    cachedConfigPath = path
    cachedConfigMtimeMs = null
    cachedConfig = null
    return null
  }

  try {
    const stat = statSync(path)
    if (
      cachedConfigPath === path &&
      cachedConfigMtimeMs === stat.mtimeMs &&
      cachedConfig !== null
    ) {
      return cachedConfig
    }

    const content = readFileSync(path, 'utf8')
    const parsed = parseYaml(content)
    const result = XcoderConfigSchema.safeParse(parsed)

    if (!result.success) {
      logForDebugging(
        `Invalid ${XCODER_CONFIG_FILENAME}: ${result.error.message}`,
        { level: 'error' },
      )
      cachedConfigPath = path
      cachedConfigMtimeMs = stat.mtimeMs
      cachedConfig = null
      return null
    }

    cachedConfigPath = path
    cachedConfigMtimeMs = stat.mtimeMs
    cachedConfig = result.data
    return cachedConfig
  } catch (error) {
    logError(error)
    cachedConfigPath = path
    cachedConfigMtimeMs = null
    cachedConfig = null
    return null
  }
}

export function getActiveProviderSelection(): ActiveProviderSelection | null {
  const config = getXcoderConfig()
  const configuredModel = config?.xcoder?.model?.trim()
  const providers = config?.providers

  if (!configuredModel || !providers || Object.keys(providers).length === 0) {
    return null
  }

  let providerName: string | null = null
  let model = configuredModel

  const separatorIndex = configuredModel.indexOf(':')
  if (separatorIndex > 0) {
    providerName = configuredModel.slice(0, separatorIndex).trim()
    model = configuredModel.slice(separatorIndex + 1).trim()
  } else {
    providerName = inferProviderNameFromModel(configuredModel, providers)
  }

  if (!providerName || !model) {
    return null
  }

  const providerConfig = providers[providerName]
  if (!providerConfig) {
    return null
  }

  const normalized = normalizeProviderConfig(providerName, providerConfig)
  if (!normalized) {
    return null
  }

  return {
    ...normalized,
    model,
  }
}

export function isOpenAIProviderConfigured(): boolean {
  return getActiveProviderSelection()?.backend === 'openai'
}

export function isAnthropicConfiguredProvider(): boolean {
  return getActiveProviderSelection()?.backend === 'anthropic'
}

export function getConfiguredProviderApiKey(
  selection: ActiveProviderSelection | null,
): string | null {
  if (!selection) {
    return null
  }

  if (selection.apiKey && selection.apiKey.trim()) {
    return selection.apiKey
  }

  if (selection.apiKeyEnv) {
    const envValue = process.env[selection.apiKeyEnv]
    if (envValue && envValue.trim()) {
      return envValue
    }
  }

  return null
}

export function getConfiguredAutoYesMode(): XcoderAutoYesMode | null {
  const config = getXcoderConfig()
  return (
    config?.permissions?.auto_yes_mode ||
    config?.permissions?.autoYesMode ||
    null
  )
}

export function getConfiguredFeishuChannelConfig():
  | NormalizedFeishuChannelConfig
  | null {
  const configPath = getXcoderConfigPath()
  const config = getXcoderConfig()
  const feishu = config?.channels?.feishu
  if (!feishu || feishu.enabled !== true) {
    return null
  }

  const serverName = feishu.server_name || feishu.serverName || 'feishu'
  const mode = feishu.mode || 'mcp'
  const connectionMode =
    feishu.connectionMode || feishu.connection_mode || 'webhook'
  const domain = feishu.domain || 'feishu'
  const dmPolicy = feishu.dmPolicy || feishu.dm_policy || 'pairing'
  const primaryAccount = getPrimaryFeishuAccount(feishu)
  const env: Record<string, string> = {
    ...(feishu.env || {}),
    XCODER_CONFIG_PATH: getXcoderConfigPath(),
    XCODER_CHANNEL: 'feishu',
    XCODER_CHANNEL_SERVER_NAME: serverName,
    XCODER_FEISHU_CONNECTION_MODE: connectionMode,
    XCODER_FEISHU_DOMAIN: domain,
    XCODER_FEISHU_DM_POLICY: dmPolicy,
    XCODER_FEISHU_ALLOW_FROM: JSON.stringify(
      feishu.allow_from || feishu.allowFrom || [],
    ),
    XCODER_FEISHU_APPROVAL_ENABLED:
      feishu.approval?.enabled === false ? '0' : '1',
  }

  const appId = resolveConfiguredString(
    primaryAccount?.app_id ||
      primaryAccount?.appId ||
      feishu.app_id ||
      feishu.appId,
    primaryAccount?.app_id_env ||
      primaryAccount?.appIdEnv ||
      feishu.app_id_env ||
      feishu.appIdEnv,
  )
  const appSecret = resolveConfiguredString(
    primaryAccount?.app_secret ||
      primaryAccount?.appSecret ||
      feishu.app_secret ||
      feishu.appSecret,
    primaryAccount?.app_secret_env ||
      primaryAccount?.appSecretEnv ||
      feishu.app_secret_env ||
      feishu.appSecretEnv,
  )
  const encryptKey = resolveConfiguredString(
    primaryAccount?.encrypt_key ||
      primaryAccount?.encryptKey ||
      feishu.encrypt_key ||
      feishu.encryptKey,
    primaryAccount?.encrypt_key_env ||
      primaryAccount?.encryptKeyEnv ||
      feishu.encrypt_key_env ||
      feishu.encryptKeyEnv,
  )
  const verificationToken = resolveConfiguredString(
    primaryAccount?.verification_token ||
      primaryAccount?.verificationToken ||
      feishu.verification_token ||
      feishu.verificationToken,
    primaryAccount?.verification_token_env ||
      primaryAccount?.verificationTokenEnv ||
      feishu.verification_token_env ||
      feishu.verificationTokenEnv,
  )
  const botName =
    primaryAccount?.bot_name ||
    primaryAccount?.botName ||
    feishu.bot_name ||
    feishu.botName

  if (appId) env.FEISHU_APP_ID = appId
  if (appSecret) env.FEISHU_APP_SECRET = appSecret
  if (encryptKey) env.FEISHU_ENCRYPT_KEY = encryptKey
  if (verificationToken) env.FEISHU_VERIFICATION_TOKEN = verificationToken
  if (botName) env.XCODER_FEISHU_BOT_NAME = botName
  const bindHost = feishu.bind_host || feishu.bindHost
  const bindPort = feishu.bind_port || feishu.bindPort
  const callbackPath = feishu.callback_path || feishu.callbackPath
  const publicBaseUrl = feishu.public_base_url || feishu.publicBaseUrl

  if (bindHost) env.XCODER_FEISHU_BIND_HOST = bindHost
  if (bindPort) env.XCODER_FEISHU_BIND_PORT = String(bindPort)
  if (callbackPath) env.XCODER_FEISHU_CALLBACK_PATH = callbackPath
  if (publicBaseUrl) env.XCODER_FEISHU_PUBLIC_BASE_URL = publicBaseUrl

  return {
    enabled: true,
    mode,
    serverName,
    connectionMode,
    domain,
    dmPolicy,
    bindHost,
    bindPort,
    callbackPath,
    publicBaseUrl,
    botName,
    command: resolveConfigRelativePath(feishu.command, configPath),
    args: (feishu.args || []).map(arg =>
      resolveConfigRelativePath(arg, configPath) || arg,
    ),
    env,
    allowFrom: feishu.allow_from || feishu.allowFrom || [],
    approvalEnabled: feishu.approval?.enabled !== false,
  }
}

export function getConfiguredChannelEntriesFromXcoderConfig(): ChannelEntry[] {
  const feishu = getConfiguredFeishuChannelConfig()
  if (!feishu) {
    return []
  }

  return [
    {
      kind: 'server',
      name: feishu.serverName,
      managedByXcoder: true,
    } as ChannelEntry,
  ]
}

export function getConfiguredMcpServersFromXcoderConfig(): Record<
  string,
  ScopedMcpServerConfig
> {
  const feishu = getConfiguredFeishuChannelConfig()
  if (!feishu || feishu.mode !== 'mcp' || !feishu.command) {
    return {}
  }

  return {
    [feishu.serverName]: {
      type: 'stdio',
      command: feishu.command,
      args: feishu.args,
      env: feishu.env,
      scope: 'dynamic',
    },
  }
}

export function isConfiguredManagedChannelServer(serverName: string): boolean {
  return getConfiguredChannelEntriesFromXcoderConfig().some(
    entry =>
      entry.kind === 'server' &&
      entry.name === serverName &&
      'managedByXcoder' in entry &&
      entry.managedByXcoder === true,
  )
}


