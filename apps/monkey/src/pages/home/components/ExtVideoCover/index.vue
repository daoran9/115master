<template>
  <div
    ref="rootRef"
    :class="[
      props.variant === 'official'
        ? videoCover.isReady
          ? styles.container.officialMain
          : styles.container.officialPending
        : props.variant === 'official-panel'
          ? styles.container.officialPanelMain
          : styles.container.legacyMain,
    ]"
  >
    <div
      v-if="props.variant !== 'official' || videoCover.isReady"
      :class="[
        styles.container.content,
        props.variant === 'legacy' && styles.container.legacyContent,
      ]"
    >
      <!-- 错误状态 -->
      <div v-if="props.variant !== 'official' && videoCover.error" :class="styles.states.error">
        <LoadingError size="mini" :message="videoCover.error" />
      </div>

      <!-- 骨架屏 -->
      <template v-else-if="props.variant !== 'official' && videoCover.isLoading">
        <div :class="[styles.skeleton, props.variant === 'legacy' && styles.legacySkeleton]" />
      </template>

      <!-- 内容 -->
      <div
        v-else-if="videoCover.isReady"
        :id="`gallery-${props.pickCode}`"
        class="pswp-gallery"
        :class="[styles.cover.container, props.variant === 'legacy' && styles.cover.legacyContainer]"
      >
        <a
          v-for="(thumbnail, index) in videoCover.state"
          :key="index"
          :class="[styles.cover.thumbItem, props.variant === 'legacy' && styles.cover.legacyThumbItem]"
          @click.prevent.stop="openPhotoSwipe(index)"
        >
          <img
            :src="thumbnail.img"
            :alt="`视频封面 ${index + 1}`"
            :class="[styles.cover.thumbImage, props.variant === 'legacy' && styles.cover.legacyThumbImage]"
          >
        </a>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import PhotoSwipe from 'photoswipe'
import PhotoSwipeLightbox from 'photoswipe/lightbox'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { LoadingError } from '@/components'
import { useSmartVideoCover } from '@/hooks/useVideoCover'
import { clsx } from '@/utils/clsx'
import 'photoswipe/style.css'

const props = withDefaults(defineProps<{
  pickCode: string
  sha1: string
  duration: number | string
  listScrollBoxNode: HTMLElement
  variant?: 'legacy' | 'official' | 'official-panel'
}>(), {
  variant: 'legacy',
})

/** 文件列表视频封面数量 */
const FILELIST_VIDEO_COVER_NUM = 5

/** 样式常量定义 */
const styles = clsx({
  // 容器样式
  container: {
    legacyMain: 'h-[150px] w-full [content-visibility:auto]',
    officialMain: 'h-24 w-full max-w-214 px-4 [content-visibility:auto]',
    officialPanelMain: 'h-24 w-full max-w-214 px-4 [content-visibility:auto]',
    officialPending: 'h-px overflow-hidden',
    content:
      'bg-base-300 relative flex h-full items-center overflow-hidden rounded',
    legacyContent: '!rounded-none !bg-transparent',
  },
  // 状态样式
  states: {
    error: 'flex flex-1 items-center justify-center',
  },
  // 骨架样式
  skeleton: 'skeleton h-full w-full rounded',
  legacySkeleton: '!rounded-none',
  // 视频封面
  cover: {
    container: [
      'flex h-full w-full overflow-hidden select-none',
    ],
    legacyContainer: 'justify-center gap-px overflow-x-auto',
    thumbItem: [
      'aspect-video h-full',
      'overflow-hidden',
      'cursor-zoom-in no-underline',
      'transition-opacity hover:opacity-90',
    ],
    legacyThumbItem: '!h-[150px]',
    thumbImage: ['h-full w-full object-contain object-center align-top'],
    legacyThumbImage: '!h-[150px] !w-auto !object-cover',
  },
})

/** 根元素引用 */
const rootRef = ref<HTMLElement>()
/** PhotoSwipe 实例 */
const lightbox = ref<PhotoSwipeLightbox | null>(null)

/** 滚动目标 ref（用于 useScroll） */
const scrollTargetRef = computed(() => props.listScrollBoxNode)

/** 选项 */
const options = computed(() => ({
  sha1: props.sha1,
  pickCode: props.pickCode,
  coverNum: FILELIST_VIDEO_COVER_NUM,
  duration: Number(props.duration),
}))

/** 配置 */
const config = {
  elementRef: rootRef,
  scrollTarget: scrollTargetRef,
}

/** smart 视频封面 hook */
const { videoCover } = useSmartVideoCover(options, config)

/** 初始化 PhotoSwipe */
function initPhotoSwipe() {
  if (lightbox.value) {
    lightbox.value.destroy()
    lightbox.value = null
  }

  lightbox.value = new PhotoSwipeLightbox({
    dataSource: videoCover.state.map(item => ({
      src: item.img,
      width: item.width,
      height: item.height,
      alt: '视频封面',
    })),
    showHideAnimationType: 'fade',
    pswpModule: PhotoSwipe,
    mouseMovePan: true,
    initialZoomLevel: 'fit',
    secondaryZoomLevel: 2,
    maxZoomLevel: 4,
    wheelToZoom: true,
    bgOpacity: 0.9,
  })

  lightbox.value.init()
}

/** 打开 PhotoSwipe */
function openPhotoSwipe(index: number) {
  if (!lightbox.value || !videoCover.isReady)
    return
  lightbox.value.loadAndOpen(index)
}

// 监听有效图片变化，初始化 PhotoSwipe
watch(
  () => videoCover.isReady,
  async (isReady) => {
    if (isReady) {
      await nextTick()
      initPhotoSwipe()
    }
  },
)

// 组件销毁时清理
onBeforeUnmount(() => {
  if (lightbox.value) {
    lightbox.value.destroy()
    lightbox.value = null
  }
})
</script>
