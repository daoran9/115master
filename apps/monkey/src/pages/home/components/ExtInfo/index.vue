<template>
  <div
    :class="[
      styles.container.main,
      props.variant === 'drive'
        ? styles.container.driveMain
        : props.variant === 'official'
          ? extInfo.state.value
            ? styles.container.officialMain
            : styles.container.officialPending
          : props.variant === 'official-panel'
            ? styles.container.officialPanelMain
            : styles.container.legacyMain,
    ]"
  >
    <div
      v-if="props.variant !== 'official' || extInfo.state.value"
      :class="[
        styles.container.content,
        props.variant === 'drive' && styles.container.driveContent,
      ]"
    >
      <!-- 错误状态 -->
      <div v-if="props.variant !== 'official' && extInfo.error.value" :class="styles.states.error">
        <LoadingError :message="extInfo.error.value" size="mini" />
      </div>

      <!-- 加载骨架 -->
      <template v-else-if="props.variant !== 'official' && extInfo.isLoading.value">
        <div class="skeleton h-full w-full" />
      </template>

      <!-- 空状态 -->
      <div v-else-if="props.variant !== 'official' && !extInfo.state.value" :class="styles.states.empty">
        <Empty :description="`未找到番号 [${props.avNumber}] 信息`" size="sm" />
      </div>

      <!-- 内容 -->
      <template v-else-if="extInfo.state.value">
        <div :class="[styles.cover.container, props.variant === 'drive' && styles.cover.drive]">
          <a href="javascript:void(0)" :alt="extInfo.state.value?.title" :class="styles.cover.link">
            <Image
              :src="coverCandidates[0]?.url ?? ''"
              :alt="extInfo.state.value?.title ?? ''"
              :loader="coverLoader"
              class="size-full"
            />
          </a>
        </div>

        <div :class="[styles.main.container, props.variant === 'drive' && styles.main.drive]">
          <div :class="styles.title.container">
            <a
              :href="extInfo.state.value?.detailUrl"
              target="_blank"
              :title="extInfo.state.value?.title"
              :alt="extInfo.state.value?.title"
              :class="styles.title.link"
            >
              {{ extInfo.state.value?.source }} {{ extInfo.state.value?.title }}
            </a>
          </div>

          <div :class="[styles.content.container, props.variant === 'drive' && styles.content.drive]">
            <div :class="styles.content.group">
              <div :class="styles.item.container">
                <span :class="styles.item.label">番号</span>
                <span v-if="extInfo.state.value?.avNumber" :class="styles.item.value">
                  <a
                    :href="extInfo.state.value?.detailUrl"
                    target="_blank"
                    :alt="extInfo.state.value?.title"
                    :class="styles.item.link"
                  >
                    {{ extInfo.state.value?.avNumber }}
                  </a>
                </span>
                <span v-else :class="styles.item.value">-</span>
              </div>

              <div :class="[styles.item.container, styles.secondary]">
                <span :class="styles.item.label">日期</span>
                <span v-if="extInfo.state.value?.date" :class="styles.item.value">
                  {{ format.date(extInfo.state.value?.date) }}
                </span>
                <span v-else :class="styles.item.value">-</span>
              </div>

              <div :class="[styles.item.container, styles.secondary]">
                <span :class="styles.item.label">时长</span>
                <span v-if="extInfo.state.value?.duration" :class="styles.item.value">
                  {{ format.duration(extInfo.state.value?.duration) }}
                </span>
                <span v-else :class="styles.item.value">-</span>
              </div>
            </div>

            <div :class="styles.content.group">
              <div :class="styles.item.container">
                <span :class="styles.item.label">演员</span>
                <span v-if="extInfo.state.value?.actors" :class="styles.item.value">
                  <a
                    v-for="actor in extInfo.state.value?.actors"
                    :key="actor.url"
                    :href="actor.url"
                    target="_blank"
                    :alt="actor.name"
                    :class="styles.item.link"
                  >
                    {{ actor.name }}
                  </a>
                </span>
                <span v-else :class="styles.item.value">-</span>
              </div>

              <div :class="[styles.item.container, styles.secondary]">
                <span :class="styles.item.label">导演</span>
                <span v-if="extInfo.state.value?.director" :class="styles.item.value">
                  <a
                    v-for="director in extInfo.state.value?.director"
                    :key="director.url"
                    :href="director.url"
                    target="_blank"
                    :alt="director.name"
                    :class="styles.item.link"
                  >
                    {{ director.name }}
                  </a>
                </span>
                <span v-else :class="styles.item.value">-</span>
              </div>

              <div v-if="extInfo.state.value?.category" :class="[styles.item.container, styles.secondary]">
                <span :class="styles.item.label">分类</span>
                <span v-if="extInfo.state.value?.category" :class="styles.item.value">
                  <a
                    v-for="category in extInfo.state.value?.category"
                    :key="category.url"
                    :href="category.url"
                    target="_blank"
                    :alt="category.name"
                    :class="styles.item.badge"
                  >
                    {{ category.name }}
                  </a>
                </span>
                <span v-else :class="styles.item.value">-</span>
              </div>
            </div>
          </div>
        </div>

        <div :class="[styles.meta.avNumber, props.variant === 'drive' && styles.meta.drive]">
          {{ props.avNumber }}
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { format } from '@115master/utils'
import { useAsyncState } from '@vueuse/core'
import { computed } from 'vue'
import {
  Empty,
  Image,
  LoadingError,
} from '@/components'
import { clsx } from '@/utils/clsx'
import { createGMImageFallbackLoader } from '@/utils/imageLoader'
import { createJavInfoSources } from '@/utils/jav'
import { loadJavInfo } from '@/utils/jav/loadInfo'
import { appLogger } from '@/utils/logger'

const props = withDefaults(defineProps<{
  avNumber: string
  variant?: 'drive' | 'legacy' | 'official' | 'official-panel'
}>(), {
  variant: 'legacy',
})
const logger = appLogger.sub('ExtInfo')

/** 样式常量定义 */
const styles = clsx({
  // 容器样式
  container: {
    main: 'w-full',
    legacyMain: 'h-24 px-20',
    driveMain: 'min-h-20 px-3 pt-2 pb-3',
    officialMain: 'min-h-24 px-4 py-2',
    officialPanelMain: 'min-h-24 px-4 py-2',
    officialPending: 'h-px overflow-hidden',
    content: 'group relative flex h-full items-center gap-1',
    driveContent: 'flex-col items-stretch gap-2',
  },
  // 状态样式
  states: {
    error: 'flex flex-1 items-center justify-center',
    empty: 'flex flex-1 items-center justify-center',
  },
  // 封面样式
  cover: {
    container: 'flex h-24 w-36 items-center justify-center',
    drive: 'hidden',
    link: 'block h-full w-full',
  },
  // 主要内容样式
  main: {
    container: 'flex flex-1 flex-col gap-2',
    drive: 'w-full min-w-0',
  },
  // 标题样式
  title: {
    container: 'text-md text-base-content/70 ml-2',
    link: 'hover:text-primary line-clamp-1 transition-colors hover:underline',
  },
  // 内容样式
  content: {
    container: 'ml-2 flex flex-1 items-start gap-5',
    drive: 'ml-0 grid grid-cols-1 gap-1 sm:grid-cols-2',
    group: 'flex min-w-32 flex-col gap-0.5',
  },
  // 项目样式
  item: {
    container: 'flex items-start gap-2 text-xs',
    label: 'text-base-content/70 h-5 w-8 shrink-0',
    value: 'text-base-content/70 line-clamp-1 flex flex-1 flex-wrap gap-2',
    link: 'hover:text-primary transition-colors hover:underline',
    badge: 'bg-base-200 hover:bg-base-200 rounded px-1 py-[1px] text-xs',
  },
  // 次要信息样式
  secondary: 'opacity-60',
  // 元信息样式
  meta: {
    avNumber: 'text-base-content/40 absolute right-4 bottom-2 text-xs',
    drive: 'hidden',
  },
})

const extInfo = useAsyncState(
  async () => {
    /**
     * ================================================================================
     * 步骤1：按缓存优先级加载番号资料
     * ================================================================================
     * 目标：复用旧版多来源能力，并避免可见列表重复请求。
     * 操作：
     * 1) 普通番号保留 JavLibrary、JavBus、JavDB、MissAV 顺序
     * 2) FC2 在普通来源前增加 FD2PPV
     */
    logger.info('开始加载番号资料', props.avNumber)

    try {
      // 1.1 缓存并行读取；联网请求重叠等待但仍按数组顺序选取结果。
      return await loadJavInfo(
        props.avNumber,
        createJavInfoSources(props.avNumber),
      )
    }
    finally {
      logger.info('番号资料加载完成', props.avNumber)
    }
  },
  null,
  {
    immediate: true,
  },
)

const coverCandidates = computed(() => {
  /*
   * ================================================================================
   * 步骤1：整理详情封面候选
   * ================================================================================
   * 目标：按资料源优先级向图片加载器提供全部可用封面。
   * 数据源：融合详情主封面、单页封面和后备来源封面。
   * 操作：
   * 1) 展开候选并过滤空值
   * 2) 按 URL 和 Referer 去重
   */
  logger.info('开始整理详情封面候选', props.avNumber)

  const info = extInfo.state.value
  const seen = new Set<string>()
  const candidates = [info?.cover, info?.coverSingle, ...(info?.coverFallbacks ?? [])]
    .filter((cover): cover is NonNullable<typeof cover> => Boolean(cover?.url))
    .filter((cover) => {
      /** 1.1 同 URL 的不同 Referer 仍可作为独立防盗链尝试。 */
      const key = `${cover.url}\u0000${cover.referer ?? ''}`
      if (seen.has(key))
        return false
      seen.add(key)
      return true
    })

  logger.info('详情封面候选整理完成', props.avNumber, candidates.length)
  return candidates
})

const coverLoader = computed(() => {
  if (!coverCandidates.value.length)
    return undefined
  return createGMImageFallbackLoader(coverCandidates.value)
})
</script>
