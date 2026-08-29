import type { Page, Route } from '@playwright/test'
import type { MockApi } from '../../support'
import { CORS, FILES_RE, json, MASTER_URL, setupHarness } from '../../support'

/**
 * 视频页 spec 自用 fixture 与 helper（不改动共享 support）
 * - EPISODES：3 集连续剧（parent 目录 2001），中文文件名避免触发番号（jav）请求
 * - installVideoMocks：files/video、播放列表（type=4）、历史、115 内嵌字幕的默认 mock
 * - download: true 时出现 Ultra 源，媒体请求被网络沙箱 abort → 原生内核加载错误态
 * - subtitles: true 时 thunder 返回两条字幕（subtitlecat 无番号恒空、115 内嵌为空列表）
 */

export interface VideoEpisode {
  fid: string
  n: string
  pc: string
}

export const EPISODES: readonly VideoEpisode[] = [
  { pc: 'e2e0000000001vid', n: '剧集 第01集.mp4', fid: '910000000000000001' },
  { pc: 'e2e0000000002vid', n: '剧集 第02集.mp4', fid: '910000000000000002' },
  { pc: 'e2e0000000003vid', n: '剧集 第03集.mp4', fid: '910000000000000003' },
] as const

/** JAV 字幕多来源回归用视频。 */
export const JAV_EPISODE: VideoEpisode = {
  pc: 'e2ejac0890000vid',
  n: 'JAC-089.mp4',
  fid: '910000000000000089',
}

/** 剧集所在目录 */
export const CID = '2001'

/** MASTER 视频页 URL */
export function videoUrl(pc: string) {
  return `${MASTER_URL}#/video/${pc}`
}

/** files/video 响应（形状对齐 Api.VideoApi.Res.FilesVideo） */
function videoInfo(ep: VideoEpisode) {
  return {
    state: true,
    inlay_power: 0,
    video_push_state: false,
    download_url: [],
    file_status: 1,
    thumb_url: '',
    height: '1080',
    width: '1920',
    video_url: '',
    video_url_demo: '',
    definition_list: {},
    multitrack_list: [],
    play_long: '3661',
    subtitle_info: [],
    outline_info: [],
    pick_code: ep.pc,
    file_name: ep.n,
    file_size: '1500000000',
    parent_id: CID,
    file_id: ep.fid,
    is_mark: '0',
    sha1: ep.fid.padStart(40, '0'),
    audio_list: '',
    user_def: 0,
    user_rotate: 0,
    user_turn: 0,
  }
}

/** 播放列表响应（/files?type=4，3 集 + path） */
function playlist(episodes: readonly VideoEpisode[] = EPISODES) {
  return {
    state: true,
    count: episodes.length,
    file_count: episodes.length,
    folder_count: 0,
    is_asc: 1,
    order: 'file_name',
    fc_mix: 0,
    offset: 0,
    cur: 1,
    data: episodes.map((ep, i) => ({
      m: 0,
      n: ep.n,
      ns: ep.n,
      pc: ep.pc,
      s: 1500000000 + i * 1000000,
      t: 1753000000,
      tu: 1753000000,
      play_long: 3661,
      current_time: 0,
      sha: ep.fid.padStart(40, '0'),
      iv: 1,
      fc: 1,
      ico: 'mp4',
      pid: CID,
      vdi: 4,
      is_top: 0,
      u: '',
      score: 0,
      fid: ep.fid,
    })),
    path: [
      { cid: '0', name: '根目录', aid: '0', pid: '' },
      { cid: CID, name: '剧集', aid: '0', pid: '0' },
    ],
  }
}

/** 播放历史响应（未观看） */
function history() {
  return {
    state: true,
    data: {
      add_time: 0,
      category: 1,
      file_name: '',
      hash: '',
      pick_code: '',
      thumb: '',
      time: 0,
    },
  }
}

/** thunder 字幕项（形状对齐 subtitle-source 的 ThunderItem） */
function thunderItem(id: string, name: string) {
  return {
    gcid: `gcid-${id}`,
    cid: `cid-${id}`,
    url: `https://subs.e2e.local/${id}.srt`,
    ext: 'srt',
    name,
    duration: 3661000,
    languages: ['zh-CN'],
    source: 1,
    score: 100,
    fingerprintf_score: 100,
    extra_name: '',
    mt: 1,
  }
}

/** 字幕内容：首条 cue 覆盖 0s，播放器内核无时长也能命中 */
const SRT = `1
00:00:00,000 --> 00:00:04,000
第一行字幕

2
00:00:05,000 --> 00:00:09,000
第二行字幕
`

const JAV_SRT: Record<string, string> = {
  'thunder': SRT.replace('第一行字幕', 'Thunder JAC-089'),
  'thunder-wrong': SRT.replace('第一行字幕', 'Thunder JAC-0890'),
  'subtitlecat': SRT.replace('第一行字幕', 'SubtitleCat JAC-089'),
  'avsubtitles': SRT.replace('第一行字幕', 'AVSubtitles JAC-089'),
  'aiyi': SRT.replace('第一行字幕', '爱译网 JAC-089'),
  'built-in': SRT.replace('第一行字幕', '115内置 JAC-089'),
}

async function fulfillText(
  route: Route,
  body: string,
  contentType = 'text/plain; charset=utf-8',
  headers: Record<string, string> = {},
): Promise<true> {
  await route.fulfill({
    body,
    contentType,
    headers: { ...CORS, ...headers },
  })
  return true
}

function installJavSubtitleMocks(api: MockApi) {
  /*
   * ================================================================================
   * 步骤1：装配 JAV 字幕来源
   * ================================================================================
   * 目标：覆盖迅雷、SubtitleCat、AVSubtitles、爱译网和 115 内置字幕的完整链路。
   * 数据源：JAC-089 精确结果和 JAC-0890 冲突结果。
   * 操作：
   * 1) 为每个来源返回可区分的字幕文本
   * 2) 保留错误番号，验证播放器最终会过滤
   */
  console.info('[e2e] 开始装配 JAV 字幕来源')

  // 1.1 给同页触发的 JavBus/JavDB 资料请求返回最小精确资料，隔离字幕断言。
  api.override(/^https:\/\/www\.javbus\.com\/JAC-089/, ({ route }) => {
    return fulfillText(route, `
      <div class="container">
        <h3>JAC-089 E2E</h3>
        <div class="movie"><div class="info"><p><span class="header">識別碼:</span><span>JAC-089</span></p></div></div>
      </div>
    `, 'text/html; charset=utf-8')
  })
  api.override(/^https:\/\/javdb\.com\/search/, ({ route }) => {
    return fulfillText(route, '<div class="movie-list"><div class="item"><a href="/v/jac089"><span class="video-title"><strong>JAC-089</strong></span></a></div></div>', 'text/html; charset=utf-8')
  })
  api.override(/^https:\/\/javdb\.com\/v\/jac089/, ({ route }) => {
    return fulfillText(route, '<div class="current-title">JAC-089 E2E</div><div class="container"><div class="panel-block"><strong>番號:</strong><span class="value">JAC-089</span></div></div>', 'text/html; charset=utf-8')
  })

  // 1.2 迅雷同时返回正确和错误番号，交给统一排序层过滤。
  api.override(/^https:\/\/api-shoulei-ssl\.xunlei\.com\/oracle\/subtitle/, ({ route }) => {
    return json(route, {
      code: 0,
      result: 'ok',
      data: [
        thunderItem('thunder', 'JAC-089.thunder.srt'),
        thunderItem('thunder-wrong', 'JAC-0890.wrong.srt'),
      ],
    })
  })

  // 1.3 SubtitleCat 搜索页包含近似番号，来源层只下载精确结果。
  api.override(/^https:\/\/subtitlecat\.com\/index\.php/, ({ route }) => {
    return fulfillText(route, `
      <table class="sub-table"><tbody>
        <tr><td><a href="subtitles/jac-089.html">JAC-089 SubtitleCat.srt</a> translated from Japanese</td><td><i class="fa-thumbs-up"></i></td><td>89</td></tr>
        <tr><td><a href="subtitles/jac-0890.html">JAC-0890 wrong.srt</a></td><td></td><td>999</td></tr>
      </tbody></table>
    `, 'text/html; charset=utf-8')
  })
  api.override(/^https:\/\/subtitlecat\.com\/subtitles\/jac-089\.html/, ({ route }) => {
    return fulfillText(route, '<a id="download_zh-CN" href="/download/jac-089-subtitlecat.srt">下载</a>', 'text/html; charset=utf-8')
  })

  // 1.4 AVSubtitles 走搜索、影片页、详情页和会话下载页。
  api.override(/^https:\/\/www\.avsubtitles\.com\/search_results\.php/, ({ route }) => {
    return fulfillText(route, '<a href="/movie1/jac-089/">JAC-089</a><a href="/movie1/jac-0890/">JAC-0890</a>', 'text/html; charset=utf-8')
  })
  api.override(/^https:\/\/www\.avsubtitles\.com\/movie1\/jac-089\//, ({ route }) => {
    return fulfillText(route, '<a href="/subtitles/zh/101">中文字幕</a>', 'text/html; charset=utf-8')
  })
  api.override(/^https:\/\/www\.avsubtitles\.com\/subtitles\/zh\/101/, ({ route }) => {
    return fulfillText(route, '<input name="subid" value="101"><input name="revid" value="7"><span class="text-mono">JAC-089.avsubtitles.srt</span>', 'text/html; charset=utf-8')
  })
  api.override(/^https:\/\/www\.avsubtitles\.com\/download_page\.php/, ({ route }) => {
    return fulfillText(route, '<a href="/download_sub.php?subid=101&revid=7">下载</a>', 'text/html; charset=utf-8')
  })
  api.override(/^https:\/\/www\.avsubtitles\.com\/download_sub\.php/, ({ route }) => {
    return fulfillText(route, JAV_SRT.avsubtitles!, 'application/x-subrip', {
      'content-disposition': 'attachment; filename="JAC-089.avsubtitles.srt"',
    })
  })

  // 1.5 爱译网用 WordPress API 找到精确文章，再下载直链字幕。
  api.override(/^https:\/\/www\.aiyi1\.com\/wp-json\/wp\/v2\/search/, ({ route }) => {
    return json(route, [
      { title: 'JAC-089 中文字幕', url: 'https://www.aiyi1.com/101.html' },
      { title: 'JAC-0890 错误字幕', url: 'https://www.aiyi1.com/102.html' },
    ])
  })
  api.override(/^https:\/\/www\.aiyi1\.com\/101\.html/, ({ route }) => {
    return fulfillText(route, '<a href="/downloads/JAC-089.aiyi.srt">下载字幕</a>', 'text/html; charset=utf-8')
  })

  // 1.6 所有实际字幕下载复用同一沙箱域名，并按文件名返回独立内容。
  api.override(/^https:\/\/(?:subs\.e2e\.local|subtitlecat\.com\/download|www\.aiyi1\.com\/downloads)\//, ({ route, url }) => {
    const id = url.pathname.includes('subtitlecat')
      ? 'subtitlecat'
      : url.pathname.includes('aiyi')
        ? 'aiyi'
        : url.pathname.split('/').pop()?.replace(/\.srt$/i, '') ?? ''
    return fulfillText(route, JAV_SRT[id] ?? SRT, 'application/x-subrip')
  })

  console.info('[e2e] JAV 字幕来源装配完成')
}

export interface VideoMockOptions {
  /** 提供原文件下载地址（出现 Ultra 源；媒体请求被沙箱 abort → 加载错误态） */
  download?: boolean
  /** thunder 返回两条字幕搜索结果 */
  subtitles?: boolean
  /** 当前视频；默认使用三集剧集夹具。 */
  episode?: VideoEpisode
  /** 装配 JAC-089 的四个外部来源和 115 内置字幕。 */
  javSubtitles?: boolean
}

/** 安装视频页默认 mock；返回 files/video 的 pickcode 请求记录 */
export function installVideoMocks(api: MockApi, options: VideoMockOptions = {}) {
  const requested: string[] = []
  const episodes = options.episode ? [options.episode] : EPISODES

  api.override(/^https:\/\/webapi\.115\.com\/files\/video/, ({ route, url }) => {
    const pc = url.searchParams.get('pickcode') ?? ''
    requested.push(pc)
    const ep = episodes.find(e => e.pc === pc)
    if (!ep)
      return json(route, { state: false, error: `unknown pickcode: ${pc}` })
    return json(route, videoInfo(ep))
  })

  /** 播放列表走 /files?type=4；其余 /files 请求落回共享默认 mock */
  api.override(FILES_RE, ({ route, url }) => {
    if (url.searchParams.get('type') !== '4')
      return
    return json(route, playlist(episodes))
  })

  api.override(/^https:\/\/webapi\.115\.com\/files\/history/, ({ route, request }) => {
    if (request.method() === 'POST')
      return json(route, { state: true })
    return json(route, history())
  })

  api.override(/^https:\/\/webapi\.115\.com\/movies\/subtitle/, ({ route }) => {
    const list = options.javSubtitles
      ? [{
          sid: 'built-in-jac-089',
          url: 'http://subs.e2e.local/built-in.srt',
          title: 'JAC-089.115.srt',
          file_id: '',
          language: 'zh-CN',
          type: 'srt',
        }]
      : []
    return json(route, { state: true, data: { autoload: {}, list } })
  })

  if (options.download) {
    api.override(/^https:\/\/webapi\.115\.com\/files\/download/, ({ route }) => {
      return json(route, { state: true, file_url: 'https://media.e2e.local/video.mp4' })
    })
  }

  if (options.subtitles) {
    api.override(/^https:\/\/api-shoulei-ssl\.xunlei\.com\/oracle\/subtitle/, ({ route }) => {
      return json(route, {
        code: 0,
        result: 'ok',
        data: [
          thunderItem('chs', '剧集 第01集.chs.srt'),
          thunderItem('eng', '剧集 第01集.eng.srt'),
        ],
      })
    })
    api.override(/^https:\/\/subs\.e2e\.local\//, async ({ route }) => {
      await route.fulfill({
        contentType: 'text/plain; charset=utf-8',
        headers: CORS,
        body: SRT,
      })
      return true
    })
  }

  if (options.javSubtitles)
    installJavSubtitleMocks(api)

  return { requested }
}

export interface SetupOptions extends VideoMockOptions {
  /** 初始 GM 值（透传 setupHarness） */
  gmValues?: Record<string, unknown>
}

/** 一键装配视频页 harness */
export async function setupVideo(page: Page, options: SetupOptions = {}) {
  let requested: string[] = []
  await setupHarness(page, {
    gmValues: options.gmValues,
    mocks: (api) => {
      requested = installVideoMocks(api, options).requested
    },
  })
  return { requested }
}

/** 移动鼠标使控制栏显示，并悬停在控制栏上保持可见（播放键 disabled 时无法 hover，用画质键代替） */
export async function showControls(page: Page) {
  await page.mouse.move(720, 450)
  const quality = page.locator('button[title^="画质"]')
  await quality.waitFor({ state: 'attached' })
  await quality.hover()
}

/** 播放列表 modal Drawer。 */
export function sider(page: Page) {
  return page.locator('dialog[aria-label="播放列表"]')
}

export { gmStore, watch } from '../../support'
