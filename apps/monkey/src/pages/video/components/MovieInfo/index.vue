<template>
  <div :class="styles.container.main">
    <div :class="styles.container.content">
      <!-- 源切换 Tab -->
      <div :class="styles.tabs.container">
        <a
          v-for="tab in sourceTabs"
          :key="tab.key"
          :class="[
            styles.tabs.item,
            activeSource === tab.key ? styles.tabs.active : '',
          ]"
          @click="activeSource = tab.key"
        >
          {{ tab.label }}
        </a>
      </div>

      <template v-if="movieInfo.error.value">
        <StatusFeedback
          :class="styles.states.error"
          status="error"
          v-bind="errorFeedback(movieInfo.error.value)"
        />
      </template>

      <!-- 加载中 -->
      <template v-else-if="movieInfo.isLoading.value">
        <div :class="styles.header.container">
          <div :class="styles.header.title">
            <div :class="styles.skeleton.title" />
          </div>
        </div>
        <div :class="styles.actors.container">
          <div v-for="i in 1" :key="i" :class="styles.actors.item">
            <div :class="styles.actors.content">
              <div :class="styles.skeleton.avatar" />
              <div :class="styles.skeleton.name" />
            </div>
          </div>
        </div>
        <div :class="styles.content.container">
          <div v-for="i in 7" :key="i" :class="styles.content.item">
            <div :class="styles.skeleton.contentLine" />
          </div>
        </div>
      </template>

      <template v-else-if="!movieInfo.state.value">
        <Empty
          :class="styles.states.empty"
          description="暂无影片信息，可能番号无法识别"
          size="2xl"
        />
      </template>

      <template v-else>
        <!-- header -->
        <div :key="activeSource" :class="styles.header.container">
          <!-- 标题 -->
          <div :class="styles.header.title">
            <span :class="styles.header.titleText">
              {{ movieInfo.state.value?.title }}
            </span>
          </div>
        </div>

        <!-- 演员列表 -->
        <div :class="styles.actors.container">
          <div v-for="actor in movieInfo.state.value?.actors" :key="actor.name" :class="styles.actors.item">
            <a
              v-if="actor.url"
              :class="styles.actors.content"
              :href="actor.url"
              target="_blank"
            >
              <div :class="styles.actors.avatarWrapper">
                <div :class="styles.actors.avatarContainer">
                  <Image :src="getActorImageSource(actor, movieInfo.state.value?.detailUrl)" :alt="actor.name" :loader="getActorLoader(actor, movieInfo.state.value?.detailUrl)" :fallback="getActorFallback(actor, movieInfo.state.value?.detailUrl)" class="aspect-square w-full rounded-full" fit="cover" @error="movieInfos.loadActorFaces(actor.name)" />
                </div>
                <span
                  v-if="actor.sex !== undefined"
                  :class="[
                    styles.actors.sexBadge.base,
                    actor.sex === 1 ? styles.actors.sexBadge.female : styles.actors.sexBadge.male,
                  ]"
                >
                  {{ actor.sex === 1 ? '♀' : '♂' }}
                </span>
              </div>
              <span :class="styles.actors.name">
                {{ actor.name }}
              </span>
            </a>
            <div
              v-else
              :class="styles.actors.content"
            >
              <div :class="styles.actors.avatarWrapper">
                <div :class="styles.actors.avatarContainer">
                  <Image :src="getActorImageSource(actor, movieInfo.state.value?.detailUrl)" :alt="actor.name" :loader="getActorLoader(actor, movieInfo.state.value?.detailUrl)" :fallback="getActorFallback(actor, movieInfo.state.value?.detailUrl)" class="aspect-square w-full rounded-full" fit="cover" @error="movieInfos.loadActorFaces(actor.name)" />
                </div>
                <span
                  v-if="actor.sex !== undefined"
                  :class="[
                    styles.actors.sexBadge.base,
                    actor.sex === 1 ? styles.actors.sexBadge.female : styles.actors.sexBadge.male,
                  ]"
                >
                  {{ actor.sex === 1 ? '♀' : '♂' }}
                </span>
              </div>
              <span :class="styles.actors.name">
                {{ actor.name }}
              </span>
            </div>
          </div>
        </div>

        <!-- content -->
        <div :class="styles.content.container">
          <div :class="styles.content.item">
            <span :class="styles.content.label">
              番号
            </span>
            <span :class="styles.content.value">
              <a :href="movieInfo.state.value?.detailUrl" target="_blank" :class="styles.content.link">
                {{ movieInfo.state.value?.avNumber ?? '-' }}
              </a>
              <CopyButton
                v-if="movieInfo.state.value?.avNumber"
                :text="movieInfo.state.value?.avNumber"
              />
            </span>
          </div>

          <div :class="styles.content.item">
            <span :class="styles.content.label">
              日期
            </span>
            <span :class="styles.content.value">
              {{ format.date(movieInfo.state.value?.date) ?? '-' }}
            </span>
          </div>

          <div :class="styles.content.item">
            <span :class="styles.content.label">
              时长
            </span>
            <span :class="styles.content.value">
              {{ format.duration(movieInfo.state.value?.duration) ?? '-' }}
            </span>
          </div>

          <div :class="styles.content.item">
            <span :class="styles.content.label">
              导演
            </span>
            <span v-if="!movieInfo.state.value?.director" :class="styles.content.value">-</span>
            <span v-else :class="styles.content.value">
              <a v-for="director in movieInfo.state.value?.director" :key="director.name" :href="director.url" target="_blank" :class="styles.content.link">
                {{ director.name }}
              </a>
            </span>
          </div>

          <div :class="styles.content.item">
            <span :class="styles.content.label">
              片商
            </span>
            <span v-if="!movieInfo.state.value?.studio" :class="styles.content.value">-</span>
            <span v-else :class="styles.content.value">
              <a v-for="studio in movieInfo.state.value?.studio" :key="studio.name" :href="studio.url" target="_blank" :class="styles.content.link">
                {{ studio.name }}
              </a>
            </span>
          </div>

          <div :class="styles.content.item">
            <span :class="styles.content.label">
              系列
            </span>
            <span v-if="!movieInfo.state.value?.series" :class="styles.content.value">-</span>
            <span v-else :class="styles.content.value">
              <a v-for="serie in movieInfo.state.value?.series" :key="serie.name" :href="serie.url" target="_blank" :class="styles.content.badge">
                {{ serie.name }}
              </a>
            </span>
          </div>

          <div :class="styles.content.item">
            <span :class="styles.content.label">
              类别
            </span>
            <span v-if="!movieInfo.state.value?.category" :class="styles.content.value">-</span>
            <span v-else :class="styles.content.value">
              <a v-for="category in movieInfo.state.value?.category" :key="category.name" :href="category.url" target="_blank" :class="styles.content.badge">
                {{ category.name }}
              </a>
            </span>
          </div>
        </div>

        <!-- 缩略图 -->
        <div ref="movieInfoThumb" :class="styles.thumbnails.container">
          <template
            v-for="(item, index) in movieInfo.state.value?.preview"
            :key="getPreviewKey(item, index)"
          >
            <a
              v-if="!failedPreviews.has(getPreviewKey(item, index))"
              :class="styles.thumbnails.item"
              :href="item.raw || item.thumbnail"
            >
              <Image
                :src="item.raw || item.thumbnail || ''"
                alt="剧照"
                :loader="getPreviewLoader(
                  item,
                  index,
                  movieInfo.state.value?.avNumber,
                  movieInfo.state.value?.title,
                  movieInfo.state.value?.detailUrl,
                )"
                :fallback="getPreviewFallback(item, index, movieInfo.state.value?.detailUrl, getPreviewKey(item, index))"
                class="size-full"
                fit="cover"
                lazy
              />
            </a>
          </template>
        </div>
      </template>
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { useDataMovieInfo } from '@/pages/video/data/useDataMovieInfo'
import { Empty, Image, StatusFeedback } from '@115master/ui'
import { format } from '@115master/utils'
import PhotoSwipe from 'photoswipe'
import PhotoSwipeLightbox from 'photoswipe/lightbox'
import {
  computed,
  h,
  nextTick,
  ref,
  watch,
} from 'vue'
import { clsx } from '@/utils/clsx'
import { errorFeedback } from '@/utils/errorFeedback'
import { createFanzaPreviewLoader, createGMImageFallbackLoader } from '@/utils/imageLoader'
import { appLogger } from '@/utils/logger'
import { hasActorFace, normalizeActorName } from '../../data/actorFaces'
import CopyButton from './components/CopyButton.vue'
import 'photoswipe/style.css'

const props = defineProps<{
  movieInfos: ReturnType<typeof useDataMovieInfo>
}>()
const logger = appLogger.sub('MovieInfo')

const styles = clsx({
  // 容器样式
  container: {
    main: 'relative flex flex-col',
    content: 'flex flex-col gap-8',
  },
  // Tab 样式
  tabs: {
    container: 'tabs tabs-border absolute top-0 right-0',
    item: 'tab',
    active: 'tab-active',
  },
  // Skeleton
  skeleton: {
    title: 'skeleton h-14 w-4/5',
    avatar: 'skeleton h-15 w-15 shrink-0 rounded-full',
    name: 'skeleton h-4 w-20',
    contentLine: 'skeleton h-4 w-xs',
  },
  // 状态样式
  states: {
    error: 'mx-auto my-20',
    empty: 'mx-auto my-20',
  },
  // 头部样式
  header: {
    container: 'mb-6',
    title: 'text-base-content pr-64 text-xl font-bold break-words break-all',
    titleText: '',
  },
  // 演员
  actors: {
    container: 'flex flex-wrap gap-2',
    item: 'relative w-fit',
    content: 'flex w-full items-center gap-3 no-underline',
    avatarWrapper: 'avatar relative',
    avatarContainer: 'w-18 rounded-full',
    avatarImage: 'rounded-full',
    name: 'text-base-content pr-2 text-base',
    sexBadge: {
      base: 'text-secondary-content absolute -top-0.5 -right-0.5 flex h-4 w-4 rotate-45 items-center justify-center rounded-full text-xs',
      female: 'bg-secondary/80',
      male: 'bg-primary/80',
    },
  },
  // 内容样式
  content: {
    container: 'flex flex-col gap-3',
    item: 'flex gap-2 text-sm',
    label: 'text-base-content/50 min-w-10',
    value: 'flex flex-wrap items-center gap-2',
    link: 'link',
    badge: 'badge badge-neutral rounded-full',
  },
  // 缩略图样式
  thumbnails: {
    container:
      'grid grid-cols-3 gap-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-9',
    item: 'aspect-square overflow-hidden hover:opacity-80',
    image: 'size-full object-cover',
  },
})

const movieInfoThumb = ref<HTMLElement | null>(null)
const lightbox = ref<PhotoSwipeLightbox | null>(null)
const activeSource = ref('javDBState')

/** 默认头像（灰色的人形轮廓） */
const DEFAULT_AVATAR
  = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2NjYyI+PHBhdGggZD0iTTEyIDJDNi40OCAyIDIgNi40OCAyIDEyczQuNDggMTAgMTAgMTAgMTAtNC40OCAxMC0xMFMxNy41MiAyIDEyIDJ6bTAgM2MxLjY2IDAgMyAxLjM0IDMgM3MtMS4zNCAzLTMgMy0zLTEuMzQtMy0zIDEuMzQtMyAzLTN6bTAgMTQuMmMtMi41IDAtNC43MS0xLjI4LTYtMy4yMi4wMy0xLjk5IDQtMy4wOCA2LTMuMDggMS45OSAwIDUuOTcgMS4wOSA2IDMuMDgtMS4yOSAxLjk0LTMuNSAzLjIyLTYgMy4yMnoiLz48L3N2Zz4='

interface ActorImageData {
  name: string
  url?: string
  face?: string
  faceReferer?: string
}

const sourceTabs = computed(() => props.movieInfos.sourceTabs.value)

/** 把同名演员的各资料源头像合并为有序候选。 */
function getActorImageCandidates(actor: ActorImageData, detailUrl?: string) {
  /*
   * ================================================================================
   * 步骤1：合并播放器演员头像来源
   * ================================================================================
   * 目标：固定按 gfriends、影片资料源、MissAV 排序，不把通用占位图当头像。
   * 数据源：gfriends 主选头像、播放器资料源演员和 MissAV 后备头像。
   * 操作：
   * 1) 用标准化姓名筛选同一演员
   * 2) 按固定来源优先级去重头像并附带 Cookie 分区
   */
  logger.info('开始合并播放器演员头像来源', actor.name)

  /** 1.1 gfriends 优先；影片资料源居中；MissAV 只作最终后备。 */
  const actorName = normalizeActorName(actor.name)
  const gfriendsActors = props.movieInfos.gfriendsActorFaces.value.map(candidate => ({
    actor: candidate,
    detailUrl: candidate.faceReferer,
  }))
  const sourceActors = sourceTabs.value.flatMap(tab =>
    (tab.state.state.value?.actors ?? []).map(candidate => ({
      actor: candidate,
      detailUrl: tab.state.state.value?.detailUrl,
    })))
  const missAVActors = hasActorFace(actor.name, props.movieInfos.gfriendsActorFaces.value)
    ? []
    : props.movieInfos.missAVActorFaces.value.map(candidate => ({
        actor: candidate,
        detailUrl: candidate.faceReferer,
      }))
  const matchedActors = [
    ...gfriendsActors.filter(candidate => normalizeActorName(candidate.actor.name) === actorName),
    ...sourceActors.filter(candidate => normalizeActorName(candidate.actor.name) === actorName),
    { actor, detailUrl },
    ...missAVActors.filter(candidate =>
      normalizeActorName(candidate.actor.name) === actorName),
  ]

  /** 1.2 同一 URL 只请求一次，通用无图资源不进入候选链。 */
  const usedUrls = new Set<string>()
  const candidates = matchedActors.flatMap(({ actor: candidate, detailUrl: sourceDetailUrl }) => {
    const face = candidate.face?.trim()
    if (!face || isPlaceholderActorFace(face) || usedUrls.has(face))
      return []
    usedUrls.add(face)
    const referer = candidate.url || candidate.faceReferer || sourceDetailUrl
    return [{
      url: face,
      referer,
      cookiePartition: getCookiePartition(referer),
    }]
  })

  logger.info('播放器演员头像来源合并完成', actor.name, candidates.length)
  return candidates
}

/** 排除来源站点返回的通用无图资源。 */
function isPlaceholderActorFace(url: string) {
  return /nowprinting|no[-_]?image|no[-_]?photo|placeholder/i.test(url)
}

/** 从资料页生成 Tampermonkey 分区 Cookie 的顶级站点。 */
function getCookiePartition(referer?: string) {
  if (!referer)
    return undefined
  try {
    const url = new URL(referer)
    url.hostname = url.hostname.replace(/^www\./i, '')
    return { topLevelSite: url.origin }
  }
  catch {
    return undefined
  }
}

/** 返回当前演员首选头像地址。 */
function getActorImageSource(actor: ActorImageData, detailUrl?: string) {
  return getActorImageCandidates(actor, detailUrl)[0]?.url || DEFAULT_AVATAR
}

/** 为演员头像建立跨来源 GM 加载链。 */
function getActorLoader(actor: ActorImageData, detailUrl?: string) {
  const candidates = getActorImageCandidates(actor, detailUrl)
  return candidates.length
    ? createGMImageFallbackLoader(candidates, {
        transform: { maxHeight: 256, maxWidth: 256 },
      })
    : undefined
}

/** GM 链全部失败后用无 Referer 原生图片再试一次。 */
function getActorFallback(actor: ActorImageData, detailUrl?: string) {
  const urls = getActorImageCandidates(actor, detailUrl).map(candidate => candidate.url)
  let index = 0
  return () => h('img', {
    alt: actor.name,
    class: 'block size-full object-cover',
    referrerpolicy: 'no-referrer',
    src: urls[0] || DEFAULT_AVATAR,
    onError: (event: Event) => {
      const image = event.currentTarget as HTMLImageElement
      index += 1
      image.src = urls[index] || DEFAULT_AVATAR
    },
  })
}

interface PreviewImageData {
  raw?: string
  thumbnail?: string
}

/** 返回原图优先、缩略图后备的去重地址。 */
function getPreviewUrls(item: PreviewImageData) {
  return Array.from(new Set([item.raw, item.thumbnail].filter(Boolean))) as string[]
}

/** 合并当前来源和其他资料源中同序号的剧照候选。 */
function getPreviewCandidates(item: PreviewImageData, index: number, referer?: string) {
  const sources = [
    { item, referer },
    ...sourceTabs.value.flatMap((tab) => {
      const info = tab.state.state.value
      const preview = info?.preview?.[index]
      return preview ? [{ item: preview, referer: info?.detailUrl }] : []
    }),
  ]
  const usedUrls = new Set<string>()

  return sources.flatMap(source => getPreviewUrls(source.item).flatMap((url) => {
    if (!source.referer || usedUrls.has(url))
      return []
    usedUrls.add(url)
    return [{
      url,
      referer: source.referer,
      cookiePartition: getCookiePartition(source.referer),
    }]
  }))
}

/** 剧照优先尝试 FANZA/DMM 官方图片，再回退当前和其他资料源。 */
function getPreviewLoader(
  item: PreviewImageData,
  index: number,
  avNumber?: string,
  title?: string,
  referer?: string,
) {
  const candidates = getPreviewCandidates(item, index, referer)
  if (!candidates.length || !avNumber)
    return undefined
  return createFanzaPreviewLoader({
    avNumber,
    title,
    index,
    fallbacks: candidates,
  })
}

/** GM 图片链失败后用无 Referer 原生图片逐项回退。 */
function getPreviewFallback(
  item: PreviewImageData,
  index: number,
  referer: string | undefined,
  key: string,
) {
  const urls = getPreviewCandidates(item, index, referer).map(candidate => candidate.url)
  let fallbackIndex = 0
  return () => h('img', {
    alt: '剧照',
    class: 'block size-full object-cover',
    referrerpolicy: 'no-referrer',
    src: urls[0],
    onError: (event: Event) => {
      const image = event.currentTarget as HTMLImageElement
      fallbackIndex += 1
      if (urls[fallbackIndex]) {
        image.src = urls[fallbackIndex]
        return
      }
      hidePreview(key)
    },
  })
}

const failedPreviews = ref(new Set<string>())

/** 为无缩略图的旧数据提供稳定的剧照键。 */
function getPreviewKey(
  item: PreviewImageData,
  index: number,
) {
  return item.thumbnail || item.raw || String(index)
}

function hidePreview(key: string) {
  /*
   * ================================================================================
   * 步骤2：移除加载失败的剧照
   * ================================================================================
   * 目标：图片失败后网格自动收缩，不保留错误文字和空白方块。
   * 数据源：图片组件发送的失败事件。
   * 操作：
   * 1) 记录当前来源失败的剧照键
   * 2) 触发网格重排
   */
  logger.info('开始移除加载失败的剧照', key)
  failedPreviews.value = new Set([...failedPreviews.value, key])
  logger.info('加载失败的剧照移除完成', key)
}

const movieInfo = computed(() => {
  return sourceTabs.value.find(tab => tab.key === activeSource.value)?.state
    ?? sourceTabs.value[0]!.state
})

const previewSourceSignature = computed(() => JSON.stringify(sourceTabs.value.map((tab) => {
  const info = tab.state.state.value
  return [
    tab.key,
    info?.detailUrl,
    info?.preview?.map(item => [item.thumbnail, item.raw]),
  ]
})))

watch(
  [activeSource, () => movieInfo.value.state.value?.detailUrl, previewSourceSignature],
  () => {
    failedPreviews.value = new Set()
  },
)

watch(
  () => sourceTabs.value.map(tab => tab.key).join(','),
  () => {
    /*
     * ================================================================================
     * 步骤1：同步播放器资料活动来源
     * ================================================================================
     * 目标：文件类型切换后默认展示当前可用的最高优先级来源。
     * 数据源：普通来源和 FC2 专用来源标签。
     * 操作：
     * 1) 读取当前标签第一项
     * 2) 更新活动来源，避免保留已移除标签
     */
    logger.info('开始同步播放器资料活动来源')

    // 1.1 专用来源排在第一项；普通番号第一项仍是 JavDB。
    activeSource.value = sourceTabs.value[0]?.key ?? 'javDBState'

    logger.info('播放器资料活动来源同步完成', activeSource.value)
  },
  { immediate: true },
)

watch(movieInfoThumb, async () => {
  if (!movieInfoThumb.value)
    return
  lightbox.value?.destroy()
  await nextTick()
  lightbox.value = new PhotoSwipeLightbox({
    gallery: movieInfoThumb.value,
    children: 'a',
    pswpModule: PhotoSwipe,
    mouseMovePan: true,
    initialZoomLevel: 'fit',
    wheelToZoom: true,
  })
  lightbox.value.init()
  lightbox.value.addFilter('domItemData', (itemData, element) => {
    /*
     * ================================================================================
     * 步骤2：复用已加载的剧照打开大图
     * ================================================================================
     * 目标：PhotoSwipe 使用 GM 成功取得的 Blob，不再无 Referer 直连外站原图。
     * 数据源：当前剧照节点内已经完成加载的 img。
     * 操作：
     * 1) 用 currentSrc 覆盖远程 href
     * 2) 同步真实尺寸供 PhotoSwipe 计算缩放
     */
    logger.info('开始准备播放器剧照大图')

    /** 2.1 Blob 或原生回退地址均以实际显示结果为准。 */
    const image = element.querySelector('img')
    if (image?.currentSrc || image?.src)
      itemData.src = image.currentSrc || image.src
    itemData.width = image?.naturalWidth
    itemData.height = image?.naturalHeight

    logger.info('播放器剧照大图准备完成', itemData.src)
    return itemData
  })
})
</script>
