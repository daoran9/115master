/* eslint-disable jsdoc/convert-to-jsdoc-comments */
import type { Share } from '@115master/drive115'
import type { Ed2kProgress } from '@/utils/ed2k'
import { format } from '@115master/utils'
import { ref } from 'vue'
import { useAppDialog } from '@/app/dialog'
import { drive115 } from '@/utils/drive115Instance'
import { calculateEd2k } from '@/utils/ed2k'
import { appLogger } from '@/utils/logger'
import { GMRequest } from '@/utils/request/gmRequest'

const logger = appLogger.sub('ED2KAction')

function percent(progress: Ed2kProgress) {
  return progress.total === 0
    ? 100
    : Math.round(progress.loaded / progress.total * 100)
}

/**
 * ============================================================================
 * 步骤1：提供 ED2K 用户操作
 * ============================================================================
 * 目标：由用户主动为单个视频生成并复制标准 ED2K 链。
 * 数据源：当前单选视频、115 原文件下载地址和 Range 分块响应。
 * 操作：
 * 1) 打开可取消进度弹窗
 * 2) 获取原文件地址并分段计算
 * 3) 展示结果并在确认时复制
 */
export function useEd2kAction() {
  const dialog = useAppDialog()

  async function ed2k(item: Share.Entity.FileItem) {
    logger.info('开始生成视频 ED2K 链', item.pc, item.n)

    const controller = new AbortController()
    const progress = ref<Ed2kProgress>({ loaded: 0, parts: 0, speed: 0, total: Number(item.s) })
    let settled = false

    // 1.1 进度弹窗只允许显式取消，防止误触背景中断长任务
    const handle = dialog.create({
      title: '生成 ED2K 链',
      showConfirm: false,
      showCancel: true,
      cancelText: '取消',
      closeOnBackdrop: false,
      closeOnEscape: false,
      onCancel: () => controller.abort(),
      content: () => (
        <div class="space-y-4" data-ed2k-progress>
          <p class="text-base-content/80 text-sm break-all">{item.n}</p>
          <progress
            aria-label="ED2K 生成进度"
            class="progress progress-primary h-2 w-full"
            max={100}
            value={percent(progress.value)}
          />
          <div class="text-base-content/65 flex justify-between gap-4 text-xs">
            <span>{`${percent(progress.value)}%`}</span>
            <span>{`${format.fileSize(progress.value.speed)}/s`}</span>
          </div>
          <p class="text-base-content/55 text-xs">
            {`已读取 ${format.fileSize(progress.value.loaded)} / ${format.fileSize(progress.value.total)}`}
          </p>
        </div>
      ),
    })

    void handle.closed.then(() => {
      if (!settled)
        controller.abort()
    })

    try {
      // 1.2 获取临时原文件地址，并把认证 Cookie 交给 GM Range 请求
      const download = await drive115.video.getFileDownloadUrl(item.pc)
      const auth = download.url.auth_cookie
      const link = await calculateEd2k({
        cookie: auth ? `${auth.name}=${auth.value}` : undefined,
        name: item.n,
        size: Number(item.s),
        url: download.url.url,
      }, {
        request: new GMRequest(),
        signal: controller.signal,
        onProgress: value => progress.value = value,
      })

      settled = true
      handle.close()

      // 1.3 最终复制发生在确认按钮点击中，保留浏览器用户激活权限
      await dialog.alert({
        title: 'ED2K 链已生成',
        confirmText: '复制链接',
        content: () => (
          <textarea
            aria-label="ED2K 链"
            class="textarea textarea-bordered h-28 w-full resize-none font-mono text-xs"
            readonly
            value={link}
          />
        ),
        onConfirm: async () => navigator.clipboard.writeText(link),
      })
      logger.info('视频 ED2K 链生成完成', item.pc, item.n)
    }
    catch (cause) {
      settled = true
      handle.close()
      if (controller.signal.aborted) {
        logger.info('视频 ED2K 链生成结束，用户取消', item.pc, item.n)
        return
      }

      const message = cause instanceof Error ? cause.message : String(cause)
      await dialog.alert({ title: 'ED2K 生成失败', content: message })
      logger.info('视频 ED2K 链生成结束，发生错误', item.pc, message)
    }
  }

  return { ed2k }
}
