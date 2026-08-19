import type { Ed2kProgress } from './calculate'
import type { Ed2kFile } from './generate'
import { GM_setClipboard } from '$'
import { format } from '@115master/utils'
import { appLogger } from '@/utils/logger'
import { generateEd2k } from './generate'

const logger = appLogger.sub('ED2KBrowserDialog')
let active: HTMLElement | null = null

function size(bytes: number) {
  return bytes === 0 ? '0 B' : format.fileSize(bytes)
}

const stages = {
  download: '正在读取文件',
  finish: '正在生成链接',
  hash: '正在计算分块摘要',
  link: '正在获取下载地址',
} satisfies Record<Ed2kProgress['stage'], string>

/**
 * ============================================================================
 * 步骤1：创建官方页面 ED2K 任务弹窗
 * ============================================================================
 * 目标：在不接管 115 原生菜单的前提下提供可取消的单文件任务。
 * 数据源：Fusion 文件行操作区传入的文件信息。
 * 操作：
 * 1) 创建 Shadow DOM 隔离弹窗
 * 2) 同步下载与计算进度
 * 3) 展示并复制最终链接
 */
export async function openEd2kDialog(file: Ed2kFile) {
  logger.info('开始创建官方页面 ED2K 任务弹窗', file.pickCode, file.name)

  // 1.1 同一页面只保留一个前台任务，避免多个大文件争抢带宽和内存
  if (active) {
    active.focus()
    logger.info('官方页面 ED2K 任务弹窗已存在')
    return
  }

  const host = document.createElement('section')
  host.tabIndex = -1
  host.setAttribute('data-115master-ed2k-dialog', '')
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `
    <style>
      :host { position: fixed; inset: 0; z-index: 2147483647; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: 0; }
      .backdrop { display: grid; width: 100%; height: 100%; place-items: center; padding: 20px; box-sizing: border-box; background: rgba(15, 23, 42, .62); }
      .dialog { width: min(520px, 100%); box-sizing: border-box; overflow: hidden; border: 1px solid #dce2ea; border-radius: 8px; background: #fff; color: #172033; box-shadow: 0 22px 60px rgba(0, 0, 0, .28); }
      .body { display: grid; gap: 14px; padding: 24px; }
      h2, p { margin: 0; }
      h2 { font-size: 20px; line-height: 1.3; }
      .name, .status, .detail { color: #667085; font-size: 13px; line-height: 1.5; }
      .name { color: #344054; word-break: break-all; }
      progress { width: 100%; height: 8px; accent-color: #1677ff; }
      .metrics { display: flex; justify-content: space-between; gap: 16px; color: #667085; font-size: 12px; }
      textarea { width: 100%; min-height: 112px; box-sizing: border-box; resize: vertical; border: 1px solid #cfd6df; border-radius: 6px; padding: 10px; color: #172033; background: #f8fafc; font: 12px/1.5 Consolas, monospace; }
      .error { color: #b42318; white-space: pre-wrap; }
      .actions { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 24px; border-top: 1px solid #e4e7ec; background: #f8fafc; }
      button { min-width: 74px; height: 36px; border: 1px solid #cfd6df; border-radius: 6px; padding: 0 14px; background: #fff; color: #344054; font-weight: 600; cursor: pointer; }
      button:hover { background: #f2f4f7; }
      .primary { border-color: #1677ff; background: #1677ff; color: #fff; }
      .primary:hover { background: #0958d9; }
      [hidden] { display: none !important; }
    </style>
    <div class="backdrop">
      <div aria-labelledby="ed2k-title" aria-modal="true" class="dialog" role="dialog">
        <div class="body">
          <h2 id="ed2k-title">生成 ED2K 链</h2>
          <p class="name"></p>
          <p class="status">正在获取下载地址</p>
          <progress aria-label="ED2K 生成进度" max="100" value="0"></progress>
          <div class="metrics"><span class="percent">0%</span><span class="speed">等待数据</span></div>
          <p class="detail"></p>
          <textarea aria-label="ED2K 链" hidden readonly></textarea>
          <p class="error" hidden></p>
        </div>
        <div class="actions">
          <button class="cancel" type="button">取消</button>
          <button class="copy primary" hidden type="button">复制链接</button>
        </div>
      </div>
    </div>
  `

  const controller = new AbortController()
  const title = root.querySelector<HTMLHeadingElement>('h2')!
  const name = root.querySelector<HTMLElement>('.name')!
  const status = root.querySelector<HTMLElement>('.status')!
  const progress = root.querySelector<HTMLProgressElement>('progress')!
  const percent = root.querySelector<HTMLElement>('.percent')!
  const speed = root.querySelector<HTMLElement>('.speed')!
  const detail = root.querySelector<HTMLElement>('.detail')!
  const result = root.querySelector<HTMLTextAreaElement>('textarea')!
  const error = root.querySelector<HTMLElement>('.error')!
  const cancel = root.querySelector<HTMLButtonElement>('.cancel')!
  const copy = root.querySelector<HTMLButtonElement>('.copy')!
  let settled = false

  const close = () => {
    if (!settled)
      controller.abort()
    host.remove()
    active = null
  }

  // 1.2 用户可随时中止当前请求；关闭后不保留文件字节
  name.textContent = file.name
  detail.textContent = `已读取 0 B / ${size(file.size)}`
  cancel.addEventListener('click', close)
  document.body.append(host)
  active = host
  host.focus()

  try {
    const link = await generateEd2k(file, {
      signal: controller.signal,
      onProgress: (value) => {
        const ratio = value.total === 0 ? 100 : Math.round(value.loaded / value.total * 100)
        status.textContent = stages[value.stage]
        progress.value = ratio
        percent.textContent = `${ratio}%`
        speed.textContent = value.speed > 0 ? `${size(value.speed)}/s` : '等待数据'
        detail.textContent = `已读取 ${size(value.loaded)} / ${size(value.total)}`
      },
    })

    // 1.3 成功后保留链接供核对，复制使用用户脚本原生剪贴板能力
    settled = true
    title.textContent = 'ED2K 链已生成'
    status.hidden = true
    progress.hidden = true
    root.querySelector<HTMLElement>('.metrics')!.hidden = true
    detail.hidden = true
    result.hidden = false
    result.value = link
    cancel.textContent = '关闭'
    copy.hidden = false
    copy.addEventListener('click', () => {
      GM_setClipboard(link, 'text')
      copy.textContent = '已复制'
    })
    logger.info('官方页面 ED2K 任务弹窗处理完成', file.pickCode, file.name)
  }
  catch (cause) {
    settled = true
    if (controller.signal.aborted) {
      close()
      logger.info('官方页面 ED2K 任务已取消', file.pickCode, file.name)
      return
    }

    title.textContent = 'ED2K 生成失败'
    status.hidden = true
    progress.hidden = true
    root.querySelector<HTMLElement>('.metrics')!.hidden = true
    detail.hidden = true
    error.hidden = false
    error.textContent = cause instanceof Error ? cause.message : String(cause)
    cancel.textContent = '关闭'
    logger.info('官方页面 ED2K 任务处理结束，发生错误', file.pickCode, error.textContent)
  }
}
