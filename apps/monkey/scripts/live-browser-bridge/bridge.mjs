import { createHash, randomBytes } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_PORT = 11531
const DEFAULT_TIMEOUT_MS = 90_000
const LIVE_CLIENT_TTL_MS = 120_000
const UPDATE_DIR = resolve(SCRIPT_DIR, '../../output/live-bridge/updates')
const BRIDGE_SCRIPT_FILE = resolve(
  SCRIPT_DIR,
  '115master-live-bridge.user.js',
)
const FUSION_UPDATE_FILE = resolve(UPDATE_DIR, '115master-fusion.user.js')
const SESSION_FILE = resolve(
  SCRIPT_DIR,
  '../../output/live-bridge/session.json',
)
const logger = {
  info: (...messages) =>
    console.info('[115Master Bridge Controller]', ...messages),
  error: (...messages) =>
    console.error('[115Master Bridge Controller]', ...messages),
}

/**
 * ================================================================================
 * 步骤1：启动本机测试控制端
 * ================================================================================
 * 目标：维护正常浏览器测试桥的客户端、命令队列和结果等待器。
 * 数据源：127.0.0.1 HTTP 请求与内存态客户端表。
 * 操作：
 * 1) 仅监听回环地址并校验随机令牌
 * 2) 为指定标签页排队命令并等待回传结果
 */
export async function startBridgeServer(options = {}) {
  logger.info('开始启动本机测试控制端')

  const port = Number(options.port ?? DEFAULT_PORT)
  const token = options.token ?? randomBytes(32).toString('hex')
  const clients = new Map()
  const commandQueues = new Map()
  const resultWaiters = new Map()
  let commandSequence = 0
  let resolveClosed
  const closed = new Promise((resolvePromise) => {
    resolveClosed = resolvePromise
  })

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')

      // 1.1 更新端点只映射固定脚本，不读取 URL 提供的文件路径。
      if (request.method === 'GET' && url.pathname.startsWith('/updates/')) {
        serveUpdateArtifact(response, url.pathname)
        return
      }

      // 1.1 所有业务端点都要求同一随机令牌。
      if (request.headers['x-115master-bridge-token'] !== token) {
        sendJson(response, 401, { error: 'unauthorized' })
        return
      }

      if (request.method === 'POST' && url.pathname === '/v1/poll') {
        const body = await readJsonBody(request)
        const clientId = requireString(body.clientId, 'clientId')
        clients.set(clientId, {
          id: clientId,
          lastSeenAt: Date.now(),
          page: body.page ?? null,
        })
        const queue = commandQueues.get(clientId) ?? []
        const command = queue.shift()
        commandQueues.set(clientId, queue)
        sendJson(
          response,
          command ? 200 : 204,
          command ? { command } : undefined,
        )
        return
      }

      if (request.method === 'POST' && url.pathname === '/v1/result') {
        const body = await readJsonBody(request)
        const commandId = requireString(body.commandId, 'commandId')
        const waiter = resultWaiters.get(commandId)
        if (!waiter) {
          sendJson(response, 404, { error: 'unknown_command' })
          return
        }
        resultWaiters.delete(commandId)
        clearTimeout(waiter.timer)
        waiter.resolve({
          clientId: body.clientId,
          commandId,
          ok: Boolean(body.ok),
          value: body.value,
          error: body.error,
        })
        sendJson(response, 200, { accepted: true })
        return
      }

      if (request.method === 'GET' && url.pathname === '/v1/admin/clients') {
        sendJson(response, 200, { clients: getLiveClients(clients) })
        return
      }

      if (request.method === 'POST' && url.pathname === '/v1/admin/command') {
        const body = await readJsonBody(request)
        const client = selectClient(getLiveClients(clients), body.target)
        if (!client) {
          sendJson(response, 409, { error: 'no_matching_client' })
          return
        }

        // 1.2 命令只发给明确选中的一个标签页。
        commandSequence += 1
        const command = {
          id: `${Date.now()}-${commandSequence}`,
          type: requireString(body.type, 'type'),
          payload: body.payload ?? {},
        }
        logger.info(
          '开始等待浏览器命令结果',
          command.id,
          command.type,
          client.page?.url,
        )
        const resultPromise = waitForCommandResult(
          resultWaiters,
          command,
          options.timeoutMs,
        )
        const queue = commandQueues.get(client.id) ?? []
        queue.push(command)
        commandQueues.set(client.id, queue)

        const result = await resultPromise
        logger.info('浏览器命令结果等待完成', command.id, result.ok)
        sendJson(response, 200, result)
        return
      }

      if (request.method === 'POST' && url.pathname === '/v1/admin/stop') {
        sendJson(response, 200, { stopping: true })
        setTimeout(() => server.close(), 25)
        return
      }

      sendJson(response, 404, { error: 'not_found' })
    }
    catch (error) {
      logger.error('本机测试控制端请求失败', error)
      sendJson(response, 500, { error: error?.message ?? String(error) })
    }
  })

  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(port, '127.0.0.1', resolvePromise)
  })

  const address = server.address()
  const activePort
    = typeof address === 'object' && address ? address.port : port
  server.once('close', () => resolveClosed())
  logger.info('本机测试控制端启动完成', activePort)

  return {
    port: activePort,
    token,
    connectionCode: `http://127.0.0.1:${activePort}/?token=${token}`,
    closed,
    close: () =>
      new Promise((resolvePromise, rejectPromise) => {
        if (!server.listening) {
          resolvePromise()
          return
        }
        server.close(error =>
          error ? rejectPromise(error) : resolvePromise(),
        )
      }),
  }
}

/**
 * ================================================================================
 * 步骤2：提供固定的本地用户脚本更新端点
 * ================================================================================
 * 目标：首次手动安装后，让 Tampermonkey 从回环地址取得后续测试版。
 * 数据源：测试桥源码和经过本地更新地址改写的 Fusion 构建产物。
 * 操作：
 * 1) user.js 返回完整脚本，meta.js 只返回元数据块
 * 2) manifest 返回版本、哈希和可用状态
 */
function serveUpdateArtifact(response, pathname) {
  logger.info('开始读取本地用户脚本更新', pathname)

  const routes = {
    '/updates/bridge.user.js': { file: BRIDGE_SCRIPT_FILE, metadataOnly: false },
    '/updates/bridge.meta.js': { file: BRIDGE_SCRIPT_FILE, metadataOnly: true },
    '/updates/fusion.user.js': { file: FUSION_UPDATE_FILE, metadataOnly: false },
    '/updates/fusion.meta.js': { file: FUSION_UPDATE_FILE, metadataOnly: true },
  }

  if (pathname === '/updates/manifest.json') {
    const manifest = {
      bridge: describeUserscript(BRIDGE_SCRIPT_FILE),
      fusion: describeUserscript(FUSION_UPDATE_FILE),
    }
    sendJson(response, 200, manifest)
    logger.info('本地用户脚本更新读取完成', pathname)
    return
  }

  const route = routes[pathname]
  if (!route || !existsSync(route.file)) {
    sendJson(response, 404, { error: 'update_not_found' })
    logger.info('本地用户脚本更新读取完成，产物不存在', pathname)
    return
  }

  const script = readFileSync(route.file, 'utf8')
  const content = route.metadataOnly ? extractUserscriptMetadata(script) : script
  response.statusCode = 200
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Type', 'text/javascript; charset=utf-8')
  response.end(content)
  logger.info('本地用户脚本更新读取完成', pathname)
}

/** 提取 Tampermonkey 更新检查需要的完整元数据块。 */
function extractUserscriptMetadata(script) {
  const match = script.match(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/)
  if (!match)
    throw new Error('userscript_metadata_not_found')
  return `${match[0]}\n`
}

/** 按元数据键读取单行值。 */
function getUserscriptMetadataValue(script, name) {
  const marker = `// @${name}`
  const line = extractUserscriptMetadata(script)
    .split(/\r?\n/)
    .find(candidate => candidate.startsWith(marker))
  return line?.slice(marker.length).trim() || null
}

/** 按元数据键替换单行值，不扫描或改写脚本正文。 */
function setUserscriptMetadataValue(script, name, value) {
  const marker = `// @${name}`
  let replaced = false
  const lines = script.split('\n').map((line) => {
    if (!replaced && line.startsWith(marker)) {
      replaced = true
      return `${marker}  ${value}`
    }
    return line
  })
  if (!replaced)
    throw new Error(`userscript_metadata_value_not_found:${name}`)
  return lines.join('\n')
}

/** 读取用户脚本版本和 SHA-256，不返回脚本正文。 */
function describeUserscript(file) {
  if (!existsSync(file))
    return { available: false }
  const script = readFileSync(file, 'utf8')
  const metadata = extractUserscriptMetadata(script)
  return {
    available: true,
    version: getUserscriptMetadataValue(metadata, 'version'),
    sha256: createHash('sha256').update(script).digest('hex').toUpperCase(),
  }
}

/**
 * ================================================================================
 * 步骤3：发布 Fusion 本地自动更新产物
 * ================================================================================
 * 目标：保留正式构建内容，只把测试副本的更新地址改为回环控制端。
 * 数据源：dist/115master-fusion.user.js 或显式指定的构建文件。
 * 操作：
 * 1) 校验用户脚本元数据和版本
 * 2) 改写 updateURL/downloadURL 后写入固定更新目录
 */
export function publishFusionUpdate(sourceFile, options = {}) {
  logger.info('开始发布 Fusion 本地自动更新产物', sourceFile)

  const source = readFileSync(sourceFile, 'utf8')
  const version = getUserscriptMetadataValue(source, 'version')
  if (!version)
    throw new Error('fusion_version_not_found')
  if (!getUserscriptMetadataValue(source, 'downloadURL') || !getUserscriptMetadataValue(source, 'updateURL'))
    throw new Error('fusion_update_metadata_not_found')

  /** 3.1 只改测试副本的两个更新地址，正式 dist 文件保持不变。 */
  const withDownloadUrl = setUserscriptMetadataValue(
    source,
    'downloadURL',
    'http://127.0.0.1:11531/updates/fusion.user.js',
  )
  const published = setUserscriptMetadataValue(
    withDownloadUrl,
    'updateURL',
    'http://127.0.0.1:11531/updates/fusion.meta.js',
  )
  const destinationFile = options.destinationFile ?? FUSION_UPDATE_FILE
  mkdirSync(dirname(destinationFile), { recursive: true })
  writeFileSync(destinationFile, published)

  const result = {
    file: destinationFile,
    version,
    sha256: createHash('sha256').update(published).digest('hex').toUpperCase(),
  }
  logger.info('Fusion 本地自动更新产物发布完成', result)
  return result
}

/** 保留两分钟内轮询过的标签页，兼容浏览器对后台定时器的一分钟节流。 */
function getLiveClients(clients) {
  const cutoff = Date.now() - LIVE_CLIENT_TTL_MS
  return Array.from(clients.values())
    .filter(client => client.lastSeenAt >= cutoff)
    .sort((left, right) => right.lastSeenAt - left.lastSeenAt)
}

/** 按客户端 ID、URL 片段或最近活动顺序选择目标。 */
function selectClient(clients, target = {}) {
  if (target?.clientId)
    return clients.find(client => client.id === target.clientId)
  if (target?.urlContains) {
    return clients.find(client =>
      String(client.page?.url ?? '').includes(target.urlContains),
    )
  }
  return clients[0]
}

/** 等待浏览器回传单条命令结果。 */
function waitForCommandResult(
  waiters,
  command,
  timeoutMs = DEFAULT_TIMEOUT_MS,
) {
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      waiters.delete(command.id)
      rejectPromise(new Error(`命令等待超时: ${command.type}`))
    }, timeoutMs)
    waiters.set(command.id, {
      resolve: resolvePromise,
      timer,
    })
  })
}

/** 读取有限大小的 JSON 请求体。 */
async function readJsonBody(request) {
  let data = ''
  for await (const chunk of request) {
    data += chunk
    if (data.length > 1_000_000)
      throw new Error('request_body_too_large')
  }
  return data ? JSON.parse(data) : {}
}

/** 发送 JSON 响应。 */
function sendJson(response, status, value) {
  response.statusCode = status
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(value === undefined ? '' : JSON.stringify(value))
}

/** 校验必填字符串。 */
function requireString(value, name) {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${name} is required`)
  return value.trim()
}

/** 向已启动控制端发送管理请求。 */
async function callController(session, pathname, options = {}) {
  const response = await fetch(`http://127.0.0.1:${session.port}${pathname}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-115Master-Bridge-Token': session.token,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS + 5_000,
    ),
  })
  const text = await response.text()
  const value = text ? JSON.parse(text) : null
  if (!response.ok)
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(value)}`)
  return value
}

/** 读取控制端会话文件。 */
function readSession() {
  if (!existsSync(SESSION_FILE))
    throw new Error(`控制端尚未启动: ${SESSION_FILE}`)
  return JSON.parse(readFileSync(SESSION_FILE, 'utf8'))
}

/** 解析 --name value 形式的命令行参数。 */
function parseArguments(values) {
  const result = { _: [] }
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (!value.startsWith('--')) {
      result._.push(value)
      continue
    }
    const name = value.slice(2)
    const next = values[index + 1]
    if (!next || next.startsWith('--')) {
      result[name] = true
      continue
    }
    result[name] = next
    index += 1
  }
  return result
}

/** 把 CLI 参数转换成标签页筛选条件。 */
function getTarget(args) {
  return {
    clientId: args.client,
    urlContains: args.url,
  }
}

/** 把 CLI 子命令转换成桥命令。 */
function createCommand(args) {
  const type = args._[0]
  switch (type) {
    case 'status':
    case 'reload':
    case 'back':
      return { type, payload: {} }
    case 'query':
      return { type, payload: { selector: args.selector } }
    case 'click':
      return {
        type,
        payload: { selector: args.selector, index: Number(args.index ?? 0) },
      }
    case 'click-text':
      return {
        type: 'clickText',
        payload: {
          text: args.text,
          exact: args.exact !== 'false',
          index: Number(args.index ?? 0),
        },
      }
    case 'input':
      return {
        type,
        payload: {
          selector: args.selector,
          value: args.value,
          index: Number(args.index ?? 0),
        },
      }
    case 'scroll':
      return {
        type,
        payload: {
          selector: args.selector,
          index: Number(args.index ?? 0),
          top: Number(args.top ?? args.y ?? 0),
          left: Number(args.left ?? args.x ?? 0),
        },
      }
    case 'hover':
      return {
        type,
        payload: { selector: args.selector, index: Number(args.index ?? 0) },
      }
    case 'media-status':
      return {
        type: 'mediaStatus',
        payload: { selector: args.selector ?? 'video' },
      }
    case 'navigate':
      return { type, payload: { url: args.to } }
    case 'probe-javlibrary':
      return {
        type: 'probeJavLibrary',
        payload: { avNumber: args['av-number'] },
      }
    case 'request-source':
      return {
        type: 'requestSource',
        payload: args.json ? JSON.parse(args.json) : { url: args.to },
      }
    case 'probe-image':
      return {
        type: 'probeImage',
        payload: { url: args.to, referer: args.referer },
      }
    case 'fetch-same-origin':
      return {
        type: 'fetchSameOrigin',
        payload: { url: args.to },
      }
    case 'clear-fusion-detail-cache':
      return { type: 'clearFusionDetailCache', payload: {} }
    default:
      throw new Error(`未知命令: ${String(type)}`)
  }
}

/**
 * ================================================================================
 * 步骤4：分发控制端命令行
 * ================================================================================
 * 目标：让自动化调用者无需直接处理 HTTP 协议和会话令牌。
 * 数据源：bridge.mjs 子命令和 output/live-bridge/session.json。
 * 操作：
 * 1) serve 创建控制端并输出连接码
 * 2) 其余命令选择标签页并输出 JSON 结果
 */
async function main() {
  logger.info('开始处理本机测试桥命令行')

  const args = parseArguments(process.argv.slice(2))
  const commandName = args._[0]

  if (commandName === 'serve') {
    /** 4.1 启动新会话并保存本机调用凭据。 */
    const bridge = await startBridgeServer({
      port: Number(args.port ?? DEFAULT_PORT),
      token: args.token,
    })
    mkdirSync(dirname(SESSION_FILE), { recursive: true })
    writeFileSync(
      SESSION_FILE,
      JSON.stringify(
        {
          pid: process.pid,
          port: bridge.port,
          token: bridge.token,
          connectionCode: bridge.connectionCode,
          startedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    )
    console.log(
      JSON.stringify(
        {
          sessionFile: SESSION_FILE,
          connectionCode: bridge.connectionCode,
          bridgeScript: resolve(SCRIPT_DIR, '115master-live-bridge.user.js'),
        },
        null,
        2,
      ),
    )

    const cleanup = async () => {
      try {
        await bridge.close()
      }
      finally {
        rmSync(SESSION_FILE, { force: true })
      }
    }
    process.once('SIGINT', () => void cleanup().finally(() => process.exit(0)))
    process.once(
      'SIGTERM',
      () => void cleanup().finally(() => process.exit(0)),
    )
    await bridge.closed
    rmSync(SESSION_FILE, { force: true })
    return
  }

  if (commandName === 'publish-fusion') {
    /** 4.2 发布使用本地更新地址的 Fusion 测试副本。 */
    const source = resolve(args.source ?? resolve(SCRIPT_DIR, '../../dist/115master-fusion.user.js'))
    const value = publishFusionUpdate(source)
    console.log(JSON.stringify(value, null, 2))
    logger.info('本机测试桥命令行处理完成', commandName)
    return
  }

  const session = readSession()
  if (commandName === 'clients') {
    /** 4.3 列出当前两分钟内仍在轮询的标签页。 */
    const value = await callController(session, '/v1/admin/clients')
    console.log(JSON.stringify(value, null, 2))
    logger.info('本机测试桥命令行处理完成', commandName)
    return
  }

  if (commandName === 'stop') {
    await callController(session, '/v1/admin/stop', {
      method: 'POST',
      body: {},
    })
    console.log(JSON.stringify({ stopped: true }, null, 2))
    logger.info('本机测试桥命令行处理完成', commandName)
    return
  }

  const command = createCommand(args)
  const value = await callController(session, '/v1/admin/command', {
    method: 'POST',
    body: {
      target: getTarget(args),
      ...command,
    },
  })
  console.log(JSON.stringify(value, null, 2))
  logger.info('本机测试桥命令行处理完成', commandName)
}

if (
  process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url
) {
  main().catch((error) => {
    logger.error(error)
    process.exitCode = 1
  })
}
