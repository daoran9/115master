/**
 * 热键 Const
 * @link Keyboard_event_code_values https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_code_values
 * @link Keyboard_event_key_values https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_key_values
 * @link KeyboardEvent/key https://developer.mozilla.org/zh-CN/docs/Web/API/KeyboardEvent/key
 * @link KeyboardEvent/code https://developer.mozilla.org/zh-CN/docs/Web/API/KeyboardEvent/code
 */

import type {
  ActionGroup,
  DefaultActionKey,
  DisplayKeyNameMap,
  KeyBindings,
  Platform,
} from './shortcuts.types'

/** 导出配置文件名前缀 */
export const EXPORT_FILE_PREFIX = `xplayer-shortcuts-config`

/** 绑定键分隔符 */
export const KEY_BINDING_SEPARATOR = '+'

/** 视频色彩偏移 */
export const ENHANCE_OFFSET = 10

/** 快进 / 后退偏移 */
export const FAST_JUMP_OFFSET = 5

/** 高速快进 / 后退偏移 */
export const HIGH_FAST_JUMP_OFFSET = 30

/** 音量调整偏移 */
export const VOLUME_OFFSET = 5

/** 多层按键映射表 */
export const MULTI_LAYER_KEYS: Record<string, string> = {
  Space: 'Space', // 为了替换原本 Space key 是 ' ' 的问题，导致配置看起来比较怪异
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: '\'',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
}

/** 动作分组定义 */
export const ACTION_GROUPS = {
  PLAY: { key: 'play', name: '播放 / 进度' },
  SOUND: { key: 'sound', name: '声音' },
  EPISODE: { key: 'episode', name: '播放列表 / 画质' },
  SUBTITLE: { key: 'subtitle', name: '字幕' },
  WINDOW: { key: 'window', name: '窗口' },
  TRANSFORM: { key: 'transform', name: '画面变换' },
  ENHANCE: { key: 'enhance', name: '视频色彩' },
  EXTERNAL: { key: 'external', name: '扩展功能' },
  OTHER: { key: 'other', name: '其他' },
} as const satisfies Record<string, ActionGroup>

/** 修饰键 */
export const MODIFIERS = {
  Shift: 'Shift',
  Alt: 'Alt',
  Control: 'Control',
  Meta: 'Meta',
}

/** 按键显示名称映射（基础部分） */
export const BASE_DISPLAY_KEY_NAME_MAP: DisplayKeyNameMap = {
  // 特殊键
  Enter: '↵',
  Backspace: '⌫',
  Delete: 'Del',
  Escape: 'Esc',
  Tab: 'Tab',
  CapsLock: 'Caps',

  // 方向键
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',

  // 修饰键（静态默认值）
  Control: 'Ctrl',
  Shift: '⇧',

  // 功能键
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  Insert: 'Ins',
}

/** 按键显示名称映射（动态部分, 按 Platform 映射） */
export const PLATFORM_DISPLAY_KEY_NAME_MAP = {
  windows: {
    Meta: 'Win',
    Alt: 'Alt',
  },
  linux: {
    Meta: 'Super',
    Alt: 'Alt',
  },
  mac: {
    Meta: '⌘',
    Alt: '⌥',
  },
} satisfies Record<Platform, DisplayKeyNameMap>

/** 默认动作绑定键   */
export const DEFAULT_ACTION_KEY_BINDINGS = {
  // play
  togglePlay: ['Space'],
  fastForward: ['ArrowRight', 'd'],
  fastBackward: ['ArrowLeft', 'a'],
  highFastForward: ['ArrowUp', 'w'],
  highFastBackward: ['ArrowDown', 's'],
  percentageFastForward: [],
  percentageFastBackward: [],
  progress: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
  playbackRateUp: [],
  playbackRateDown: [],

  // sound
  volumeUp: ['='],
  volumeDown: ['-'],
  toggleMute: ['m'],

  // subtitle
  toggleSubtitle: ['c'],
  nextSubtitle: [],
  prevSubtitle: [],

  // window
  toggleTheatre: ['v'],
  toggleFullscreen: ['f'],
  togglePictureInPicture: ['p'],

  // episode
  toggleShowSider: ['\\'],
  playPrevious: ['['],
  playNext: [']'],
  qualityDown: ['q'],

  // transform
  rotateLeft: ['Shift+['],
  rotateRight: ['Shift+]'],
  resetRotation: ['Shift+`'],
  toggleFlipX: ['Shift+\\'],
  toggleFlipY: ['Shift+-'],

  // enhance
  brightnessUp: [],
  brightnessDown: [],
  contrastUp: [],
  contrastDown: [],
  highlightsUp: [],
  highlightsDown: [],
  shadowsUp: [],
  shadowsDown: [],
  saturationUp: [],
  saturationDown: [],
  colorTempUp: [],
  colorTempDown: [],
  hueUp: [],
  hueDown: [],
  skinWhiteningUp: [],
  skinWhiteningDown: [],
  skinRangeUp: [],
  skinRangeDown: [],
  sharpnessUp: [],
  sharpnessDown: [],
  resetVideoEnhance: [],
  hdr: [],

  // other
  shortcuts: ['Shift+k'],
  statistics: ['Shift+s'],
} satisfies Record<DefaultActionKey, KeyBindings>
