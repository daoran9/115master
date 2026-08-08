import type { Share } from '@115master/drive115'
import { useAsyncState } from '@vueuse/core'
import { computed, shallowRef, watch } from 'vue'
import { useAppDialog } from '@/app/dialog'
import { router } from '@/app/router'
import { useFolderImagePreview } from '@/hooks/useFolderImagePreview'
import { useSmartVideoCover } from '@/hooks/useVideoCover'
import { actressFaceDB } from '@/utils/actressFaceDB'
import { getAvNumber } from '@/utils/getNumber'
import { openFilesItem, resolveFileLink } from '@/utils/openFilesItem'
import { useUserSetting } from '@/utils/userSettings'

interface ActressFaceDBActress {
  url: string
  name: string
  folder: string
  filename: string
  timestamp: number
}

interface UseFileItemOptions {
  data: Share.Entity.FilesItem
  cid?: string
  order?: Share.Base.Sorter['o']
  asc?: Share.Base.Sorter['asc']
  onPreview?: (data: Share.Entity.FilesItem) => void
}

export function useFileItem(options: UseFileItemOptions) {
  const { data, onPreview } = options
  const dialog = useAppDialog()
  const itemRef = shallowRef<HTMLElement>()
  const showPreview = useUserSetting('enableFilelistPreview')
  const showAvInfo = useUserSetting('enableAvInfo')
  const showActressFaces = useUserSetting('enableActressFaces')

  /** 添加 folder image preview 支持 */
  const folderPreview = options.cid
    ? useFolderImagePreview({
        cid: options.cid,
        order: options.order ?? 'user_ptime',
        asc: options.asc ?? 0,
      })
    : null

  const isVideo = computed(() => data.iv === 1)
  const isFolder = computed(() => data.fc === 0)
  const avNumber = computed(() => getAvNumber(data.n))

  const actressAsyncState = useAsyncState(async () => {
    if (!showActressFaces.value || !isFolder.value) {
      return null
    }
    await actressFaceDB.init()
    const actress = await actressFaceDB.findActress(data.n.trim())
    return actress as ActressFaceDBActress | null
  }, null, {
    immediate: true,
  })

  watch(showActressFaces, (enabled) => {
    if (enabled)
      actressAsyncState.execute()
  })

  const coverOptions = computed(() => ({
    pickCode: data.pc,
    sha1: data.sha,
    coverNum: 1,
    duration: data.play_long,
  }))

  const videoCoverResult = isVideo.value
    ? useSmartVideoCover(coverOptions, { elementRef: itemRef })
    : null

  const link = computed(() => resolveFileLink(data))

  const hasActressCover = computed(() =>
    showActressFaces.value
    && actressAsyncState.isReady.value
    && !!actressAsyncState.state.value,
  )

  const hasVideoCover = computed<boolean>(() =>
    showPreview.value
    && isVideo.value
    && !!videoCoverResult?.videoCover.isReady
    && videoCoverResult.videoCover.state.length > 0,
  )

  const hasImagePreview = computed(() => !!data.u)

  function isIconUrl(icon: string): boolean {
    return icon.startsWith('https://')
  }

  function open(): Promise<void> {
    return openFilesItem(data, {
      router,
      alert: opts => dialog.alert(opts),
      folderPreview,
      onPreview,
    })
  }

  return {
    itemRef,
    isVideo,
    isFolder,
    avNumber,
    showAvInfo,
    link,
    hasActressCover,
    hasVideoCover,
    hasImagePreview,
    actressAsyncState,
    videoCoverResult,
    open,
    isIconUrl,
  }
}
