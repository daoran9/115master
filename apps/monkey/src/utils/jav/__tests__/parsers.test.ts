import { JSDOM } from 'jsdom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const testLogger = {
  info: vi.fn(),
}

const requestMocks = vi.hoisted(() => ({
  constructorOptions: [] as unknown[],
  get: vi.fn(),
}))
const performerFaceCacheMocks = vi.hoisted(() => ({
  getByName: vi.fn(),
  setByName: vi.fn(),
}))

vi.mock('@/utils/logger', () => ({
  appLogger: {
    sub: () => testLogger,
  },
}))
vi.mock('@/utils/request/gmRequest', () => ({
  GMRequest: class {
    get = requestMocks.get

    constructor(options?: unknown) {
      requestMocks.constructorOptions.push(options)
    }
  },
}))
vi.mock('@/utils/cache/javCache', () => ({
  javCache: {
    get: vi.fn(),
    set: vi.fn(),
  },
}))
vi.mock('@/utils/cache/performerFaceCache', () => ({
  performerFaceCache: performerFaceCacheMocks,
}))

const { JavBus } = await import('../javBus')
const { JavDB } = await import('../javDB')
const { JavLibrary } = await import('../javLibrary')
const { MissAV } = await import('../missAV')
const { Fd2Ppv } = await import('../fd2Ppv')
const { createJavInfoSources } = await import('../sources')

function documentOf(html: string): Document {
  return new JSDOM(html).window.document
}

describe('jav source parsers', () => {
  beforeEach(() => {
    testLogger.info.mockClear()
    requestMocks.constructorOptions.length = 0
    requestMocks.get.mockReset()
    performerFaceCacheMocks.getByName.mockReset()
    performerFaceCacheMocks.getByName.mockResolvedValue(null)
    performerFaceCacheMocks.setByName.mockReset()
    performerFaceCacheMocks.setByName.mockResolvedValue(undefined)
    vi.stubGlobal('DOMParser', new JSDOM('').window.DOMParser)
  })

  it('javDB 从 covers 地址生成有效 thumbs 单页封面', () => {
    /*
     * ================================================================================
     * 步骤1：验证 JavDB 单页封面映射
     * ================================================================================
     * 目标：禁止返回旧版 TODO 中的空 URL。
     * 数据源：JavDB 详情页 video-cover。
     * 操作：
     * 1) 解析 covers URL
     * 2) 核对 thumbs URL 和 Referer
     */
    testLogger.info('开始验证 JavDB 单页封面映射')

    const parser = new JavDB()
    parser.detailUrl = 'https://javdb.com/v/example'
    const cover = parser.parseCoverSingle(documentOf(`
      <img class="video-cover" src="https://c0.jdbstatic.com/covers/ab/example.jpg">
    `))

    expect(cover).toEqual({
      url: 'https://c0.jdbstatic.com/thumbs/ab/example.jpg',
      referer: parser.detailUrl,
    })
    testLogger.info('JavDB 单页封面映射验证完成')
  })

  it('javDB 延迟加载封面优先读取 data-src', () => {
    /*
     * ================================================================================
     * 步骤1：验证 JavDB 延迟封面地址优先级
     * ================================================================================
     * 目标：避免把 lazy-load 占位 src 送入图片加载器。
     * 数据源：详情页 video-cover 的 data-src 和占位 src。
     * 操作：
     * 1) 同时提供真实 data-src 与 data: 占位 src
     * 2) 核对双页和单页封面都使用真实地址
     */
    testLogger.info('开始验证 JavDB 延迟封面地址优先级')

    const parser = new JavDB()
    parser.detailUrl = 'https://javdb.com/v/example'
    const dom = documentOf(`
      <img class="video-cover" data-src="https://c0.jdbstatic.com/covers/kk/example.jpg" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==">
    `)

    expect(parser.parseCover(dom)).toEqual({
      url: 'https://c0.jdbstatic.com/covers/kk/example.jpg',
      referer: parser.detailUrl,
    })
    expect(parser.parseCoverSingle(dom)).toEqual({
      url: 'https://c0.jdbstatic.com/thumbs/kk/example.jpg',
      referer: parser.detailUrl,
    })
    testLogger.info('JavDB 延迟封面地址优先级验证完成')
  })

  it('javDB 搜索结果只选择精确番号', () => {
    /*
     * ================================================================================
     * 步骤1：验证 JavDB 精确搜索结果
     * ================================================================================
     * 目标：相似番号排在第一项时仍定位目标详情页。
     * 数据源：两个 JavDB 搜索结果卡片。
     * 操作：
     * 1) 建立相似番号和精确番号卡片
     * 2) 核对精确详情链接
     */
    testLogger.info('开始验证 JavDB 精确番号匹配')
    const parser = new JavDB()
    const detailUrl = parser.getDetailUrl(`
      <div class="movie-list">
        <div class="item"><a href="/v/wrong"><div class="video-title"><strong>SORA-636-C</strong></div></a></div>
        <div class="item"><a href="/v/right"><div class="video-title"><strong>SORA_636</strong></div></a></div>
      </div>
    `, 'SORA-636')

    expect(detailUrl).toBe('https://javdb.com/v/right')
    testLogger.info('JavDB 精确番号匹配验证完成')
  })

  it('javDB 演员头像携带当前详情页 Referer', async () => {
    /*
     * ================================================================================
     * 步骤1：验证 JavDB 演员头像防盗链信息
     * ================================================================================
     * 目标：播放器头像统一交给 GM 图片加载器请求。
     * 数据源：JavDB 演员详情块和当前影片详情页。
     * 操作：
     * 1) 解析带演员链接的详情页
     * 2) 核对头像 URL 与 Referer 同时返回
     */
    testLogger.info('开始验证 JavDB 演员头像防盗链信息')

    const parser = new JavDB()
    parser.detailUrl = 'https://javdb.com/v/nmsl045'
    const info = await parser.parseInfo(`
      <div class="container">
        <div class="panel-block">
          <strong>演員:</strong>
          <span class="value"><a href="/actors/ABCD1234">测试演员</a><span class="female"></span></span>
        </div>
      </div>
    `)

    expect(info?.actors).toEqual([{
      name: '测试演员',
      url: 'https://javdb.com/actors/ABCD1234',
      face: 'https://c0.jdbstatic.com/avatars/ab/ABCD1234.jpg',
      faceReferer: 'https://javdb.com/actors/ABCD1234',
      sex: 1,
    }])
    testLogger.info('JavDB 演员头像防盗链信息验证完成')
  })

  it('missAV 优先生成 cover-n 单页封面', () => {
    /*
     * ================================================================================
     * 步骤1：验证 MissAV 单页封面映射
     * ================================================================================
     * 目标：把列表缩略资源 cover-t 映射成单页资源 cover-n。
     * 数据源：MissAV og:image。
     * 操作：
     * 1) 解析 Open Graph 图片
     * 2) 核对 cover-n URL
     */
    testLogger.info('开始验证 MissAV 单页封面映射')

    const parser = new MissAV()
    parser.detailUrl = 'https://missav.ws/dm26/cn/JAC-089'
    const cover = parser.parseCoverSingle(documentOf(`
      <meta property="og:image" content="https://fourhoi.com/asset/cover-t.jpg">
    `))

    expect(cover).toEqual({
      url: 'https://fourhoi.com/asset/cover-n.jpg',
      referer: parser.detailUrl,
    })
    testLogger.info('MissAV 单页封面映射验证完成')
  })

  it('missAV 从当前 Open Graph 元数据恢复番号和标题', async () => {
    /*
     * ================================================================================
     * 步骤1：验证 MissAV 新页面兜底解析
     * ================================================================================
     * 目标：详情标签缺失时仍返回精确番号、标题和封面。
     * 数据源：当前 MissAV 页面稳定的 Open Graph 元数据。
     * 操作：
     * 1) 只提供 og:title 和 og:image
     * 2) 核对解析结果不会因旧标签缺失而被来源门禁拒绝
     */
    testLogger.info('开始验证 MissAV Open Graph 兜底解析')

    const parser = new MissAV()
    parser.detailUrl = 'https://missav.ws/dm26/cn/JAC-089'
    const info = await parser.parseInfo(`
      <title>JAC-089 示例标题 - MissAV | 免费高清AV在线看</title>
      <meta property="og:title" content="JAC-089 示例标题">
      <meta property="og:image" content="https://fourhoi.com/jac-089/cover-t.jpg">
    `)

    expect(info).toMatchObject({
      avNumber: 'JAC-089',
      title: '示例标题',
      cover: {
        url: 'https://fourhoi.com/jac-089/cover-t.jpg',
        referer: parser.detailUrl,
      },
      coverSingle: {
        url: 'https://fourhoi.com/jac-089/cover-n.jpg',
        referer: parser.detailUrl,
      },
    })
    testLogger.info('MissAV Open Graph 兜底解析验证完成')
  })

  it('missAV 演员链接保持绝对地址和正确性别', async () => {
    /*
     * ================================================================================
     * 步骤1：验证 MissAV 演员链接解析
     * ================================================================================
     * 目标：播放器可以用演员页路径核对跨语言姓名并补头像。
     * 数据源：MissAV 影片详情的女优标签。
     * 操作：
     * 1) 解析相对演员页地址
     * 2) 核对绝对地址和女性标记
     */
    testLogger.info('开始验证 MissAV 演员链接解析')

    const parser = new MissAV()
    const info = await parser.parseInfo(`
      <div class="space-y-2">
        <div><span>女优:</span><a href="/dm26/actresses/%E8%97%A4%E7%94%B0%E3%82%86%E3%81%9A">藤田柚子</a></div>
      </div>
    `)

    expect(info?.actors).toEqual([{
      name: '藤田柚子',
      url: 'https://missav.ws/dm26/actresses/%E8%97%A4%E7%94%B0%E3%82%86%E3%81%9A',
      sex: 1,
    }])
    testLogger.info('MissAV 演员链接解析验证完成')
  })

  it('missAV 只在姓名门禁通过后缓存演员页头像', async () => {
    /*
     * ================================================================================
     * 步骤1：验证 MissAV 演员头像后备链
     * ================================================================================
     * 目标：中文显示名不同时可用演员页路径精确匹配，错误页面不能写入缓存。
     * 数据源：播放器姓名、MissAV 影片演员链接和演员页 Open Graph 图片。
     * 操作：
     * 1) 模拟影片详情返回跨语言演员名
     * 2) 核对 HTTPS 头像、Referer 和长期缓存键
     */
    testLogger.info('开始验证 MissAV 演员头像后备链')

    const parser = new MissAV()
    vi.spyOn(parser, 'getInfoByCache').mockResolvedValue(undefined)
    vi.spyOn(parser, 'getInfoByAvNumber').mockResolvedValue({
      source: parser.source,
      baseUrl: parser.baseUrl,
      detailUrl: 'https://missav.ws/cn/NMSL-045',
      searchUrl: '',
      avNumber: 'NMSL-045',
      actors: [{
        name: '藤田柚子',
        url: 'https://missav.ws/dm26/actresses/%E8%97%A4%E7%94%B0%E3%82%86%E3%81%9A',
        sex: 1,
      }],
    })
    requestMocks.get.mockResolvedValue(new Response(`
      <title>藤田ゆず出演的 AV 在线看 - MissAV</title>
      <link rel="canonical" href="https://missav.ws/dm26/actresses/%E8%97%A4%E7%94%B0%E3%82%86%E3%81%9A">
      <meta property="og:image" content="https://missav.ws/missav/logo-square.png">
      <img src="https://fourhoi.com/actress/1054998-t.jpg">
    `, { status: 200 }))

    const actors = await parser.getActorFacesByAvNumber('NMSL-045', ['藤田ゆず'])

    expect(actors).toEqual([{
      name: '藤田ゆず',
      url: 'https://missav.ws/dm26/actresses/%E8%97%A4%E7%94%B0%E3%82%86%E3%81%9A',
      sex: 1,
      face: 'https://fourhoi.com/actress/1054998-t.jpg',
      faceReferer: 'https://missav.ws/dm26/actresses/%E8%97%A4%E7%94%B0%E3%82%86%E3%81%9A',
    }])
    expect(performerFaceCacheMocks.setByName).toHaveBeenCalledWith('藤田ゆず', {
      actor: actors[0],
      source: 'MissAV',
    })
    expect(requestMocks.constructorOptions).toContainEqual(expect.objectContaining({
      cookiePartition: { topLevelSite: 'https://missav.ws' },
    }))
    testLogger.info('MissAV 演员头像后备链验证完成')
  })

  it('missAV 番号页短名无头像后按完整姓名搜索', async () => {
    /*
     * ================================================================================
     * 步骤1：验证 MissAV 完整姓名搜索回退
     * ================================================================================
     * 目标：番号页“ゆず”演员页无头像时，按“白川ゆず”找到唯一正式演员卡片。
     * 数据源：SIMM-729 现场演员短名和 MissAV 完整姓名搜索结果。
     * 操作：
     * 1) 模拟影片详情中的唯一短名演员
     * 2) 核对正式演员 URL、卡片头像和搜索页 Referer
     */
    testLogger.info('开始验证 MissAV 完整姓名搜索回退')

    /** 1.1 建立与 SIMM-729 现场一致的姓名差异和演员页图片。 */
    const parser = new MissAV()
    vi.spyOn(parser, 'getInfoByCache').mockResolvedValue(undefined)
    vi.spyOn(parser, 'getInfoByAvNumber').mockResolvedValue({
      source: parser.source,
      baseUrl: parser.baseUrl,
      detailUrl: 'https://missav.ws/cn/SIMM-729',
      searchUrl: '',
      avNumber: 'SIMM-729',
      actors: [{
        name: 'ゆず',
        url: 'https://missav.ws/dm26/cn/actresses/%E3%82%86%E3%81%9A',
        sex: 1,
      }],
    })
    requestMocks.get
      .mockResolvedValueOnce(new Response(`
      <title>ゆず出演的 AV 在线看 - MissAV</title>
      <link rel="canonical" href="https://missav.ws/dm26/cn/actresses/%E3%82%86%E3%81%9A">
      <meta property="og:image" content="https://missav.ws/missav/logo-square.png">
      `, { status: 200 }))
      .mockResolvedValueOnce(new Response(`
        <a href="https://missav.ws/actresses/%E7%99%BD%E5%B7%9D%E6%9F%9A%E5%AD%90">
          <img src="https://fourhoi.com/actress/1057634-t.jpg">
        </a>
        <a href="https://missav.ws/actresses/%E7%99%BD%E5%B7%9D%E6%9F%9A%E5%AD%90">
          白川柚子 180 條影片
        </a>
      `, { status: 200 }))

    /** 1.2 读取真实头像并按播放器完整姓名写入长期缓存。 */
    const actors = await parser.getActorFacesByAvNumber('SIMM-729', ['白川ゆず'])
    expect(actors).toEqual([{
      name: '白川ゆず',
      url: 'https://missav.ws/actresses/%E7%99%BD%E5%B7%9D%E6%9F%9A%E5%AD%90',
      sex: 1,
      face: 'https://fourhoi.com/actress/1057634-t.jpg',
      faceReferer: 'https://missav.ws/search/%E7%99%BD%E5%B7%9D%E3%82%86%E3%81%9A',
    }])
    expect(performerFaceCacheMocks.setByName).toHaveBeenCalledWith('白川ゆず', {
      actor: actors[0],
      source: 'MissAV',
    })
    testLogger.info('MissAV 完整姓名搜索回退验证完成')
  })

  it('missAV 演员页姓名不一致时不采用头像', () => {
    /*
     * ================================================================================
     * 步骤1：验证 MissAV 演员页姓名门禁
     * ================================================================================
     * 目标：异常跳转或同名错误页面不能污染播放器头像。
     * 数据源：目标演员链接和另一个演员的页面元数据。
     * 操作：
     * 1) 解析姓名不一致的演员页
     * 2) 核对没有返回头像
     */
    testLogger.info('开始验证 MissAV 演员页姓名门禁')

    const parser = new MissAV()
    const actor = parser.parseActorFace(`
      <title>其他演员出演的 AV 在线看 - MissAV</title>
      <link rel="canonical" href="https://missav.ws/dm26/actresses/%E5%85%B6%E4%BB%96%E6%BC%94%E5%91%98">
      <meta property="og:image" content="https://fourhoi.com/actress/wrong-t.jpg">
    `, {
      name: '藤田柚子',
      url: 'https://missav.ws/dm26/actresses/%E8%97%A4%E7%94%B0%E3%82%86%E3%81%9A',
    }, '藤田ゆず')

    expect(actor).toBeUndefined()
    testLogger.info('MissAV 演员页姓名门禁验证完成')
  })

  it('missAV 多个短名候选时不猜演员头像', async () => {
    /*
     * ================================================================================
     * 步骤1：验证 MissAV 短名歧义门禁
     * ================================================================================
     * 目标：同一番号和完整姓名搜索都有多个候选时，避免缓存错误头像。
     * 数据源：完整播放器姓名、两个前后缀候选和两个搜索卡片。
     * 操作：
     * 1) 模拟两个都能匹配的演员短名
     * 2) 核对搜索后仍返回为空且没有写入缓存
     */
    testLogger.info('开始验证 MissAV 短名歧义门禁')

    /** 1.1 建立两个都属于完整姓名后缀的 MissAV 演员。 */
    const parser = new MissAV()
    vi.spyOn(parser, 'getInfoByCache').mockResolvedValue(undefined)
    vi.spyOn(parser, 'getInfoByAvNumber').mockResolvedValue({
      source: parser.source,
      baseUrl: parser.baseUrl,
      detailUrl: 'https://missav.ws/cn/TEST-001',
      searchUrl: '',
      avNumber: 'TEST-001',
      actors: [
        { name: 'ゆず', url: 'https://missav.ws/dm1/actresses/%E3%82%86%E3%81%9A' },
        { name: '川ゆず', url: 'https://missav.ws/dm2/actresses/%E5%B7%9D%E3%82%86%E3%81%9A' },
      ],
    })
    requestMocks.get.mockResolvedValue(new Response(`
      <a href="https://missav.ws/actresses/%E7%99%BD%E5%B7%9D%E6%9F%9A%E5%AD%90">
        <img src="https://fourhoi.com/actress/1057634-t.jpg">
      </a>
      <a href="https://missav.ws/actresses/%E7%99%BD%E5%B7%9D%E6%9F%9A%E5%AD%90">白川柚子 180 條影片</a>
      <a href="https://missav.ws/actresses/%E7%99%BD%E5%B7%9D%E3%82%86%E3%81%9A">
        <img src="https://fourhoi.com/actress/9999999-t.jpg">
      </a>
      <a href="https://missav.ws/actresses/%E7%99%BD%E5%B7%9D%E3%82%86%E3%81%9A">白川ゆず 2 條影片</a>
    `, { status: 200 }))

    // 1.2 完整姓名搜索仍有歧义时必须保持为空且不写入缓存。
    await expect(parser.getActorFacesByAvNumber('TEST-001', ['白川ゆず'])).resolves.toEqual([])
    expect(requestMocks.get).toHaveBeenCalledTimes(1)
    expect(performerFaceCacheMocks.setByName).not.toHaveBeenCalled()
    testLogger.info('MissAV 短名歧义门禁验证完成')
  })

  it('javBus 保留头像地址和详情页 Referer', async () => {
    /*
     * ================================================================================
     * 步骤1：验证 JavBus 演员头像解析
     * ================================================================================
     * 目标：给 GM 图片加载器提供绝对头像地址和防盗链 Referer。
     * 数据源：JavBus 演员列表。
     * 操作：
     * 1) 建立标签索引
     * 2) 核对演员链接、头像和 Referer
     */
    testLogger.info('开始验证 JavBus 演员头像解析')

    const parser = new JavBus()
    parser.detailUrl = 'https://www.javbus.com/SORA-636'
    const dom = documentOf(`
      <div class="container">
        <div class="movie">
          <div class="info">
            <p><span class="header">演員:</span></p>
            <div><ul><li>
              <a href="/star/example"><img data-src="/pics/actress/example.jpg" title="演员A"></a>
            </li></ul></div>
          </div>
        </div>
      </div>
    `)
    await parser.parseInfoBefore(dom)
    const actors = parser.parseActor()

    expect(actors).toEqual([{
      name: '演员A',
      url: 'https://www.javbus.com/star/example',
      sex: undefined,
      face: 'https://www.javbus.com/pics/actress/example.jpg',
      faceReferer: parser.detailUrl,
    }])
    testLogger.info('JavBus 演员头像解析验证完成')
  })

  it('javLibrary 解析完整详情字段和单页封面', async () => {
    /*
     * ================================================================================
     * 步骤1：验证 JavLibrary 详情页解析
     * ================================================================================
     * 目标：覆盖番号、标题、日期、时长、人物、厂商、类别、评分和图片字段。
     * 数据源：JavLibrary 详情页结构夹具。
     * 操作：
     * 1) 解析完整详情 HTML
     * 2) 核对字段映射、绝对链接与单页封面
     */
    testLogger.info('开始验证 JavLibrary 详情页解析')

    const parser = new JavLibrary()
    parser.searchUrl = 'https://www.javlibrary.com/cn/vl_searchbyid.php?keyword=SORA-636'
    const info = await parser.parseInfo(`
      <div id="video_title">
        <h3 class="post-title text"><a href="./?v=javli-example">SORA-636 示例标题</a></h3>
      </div>
      <div id="video_info">
        <div id="video_id"><span class="text">SORA-636</span></div>
        <div id="video_date"><span class="text">2025-01-02</span></div>
        <div id="video_length"><span class="text">120 分钟</span></div>
        <div id="video_director"><span class="text"><a href="vl_director.php?d=1">导演A</a></span></div>
        <div id="video_maker"><span class="text"><a href="vl_maker.php?m=1">片商A</a></span></div>
        <div id="video_label"><span class="text"><a href="vl_label.php?l=1">发行商A</a></span></div>
        <div id="video_series"><span class="text"><a href="vl_series.php?s=1">系列A</a></span></div>
        <div id="video_cast"><span class="cast"><span class="star"><a href="vl_star.php?s=1">演员A</a></span></span></div>
        <div id="video_genres"><span class="genre"><a href="vl_genre.php?g=1">类别A</a></span></div>
        <div id="video_review"><span class="score">(8.75)</span><span class="votes">123 票</span></div>
      </div>
      <img id="video_jacket_img" src="//pics.example.com/cover/abcpl.jpg">
      <div class="previewthumbs">
        <a href="//pics.example.com/sample/1.jpg"><img src="/thumb/1.jpg"></a>
      </div>
    `)

    expect(info).toMatchObject({
      avNumber: 'SORA-636',
      title: '示例标题',
      duration: 120,
      director: [{ name: '导演A', url: 'https://www.javlibrary.com/cn/vl_director.php?d=1' }],
      actors: [{ name: '演员A', url: 'https://www.javlibrary.com/cn/vl_star.php?s=1', sex: 1 }],
      studio: [{ name: '片商A', url: 'https://www.javlibrary.com/cn/vl_maker.php?m=1' }],
      publisher: [{ name: '发行商A', url: 'https://www.javlibrary.com/cn/vl_label.php?l=1' }],
      series: [{ name: '系列A', url: 'https://www.javlibrary.com/cn/vl_series.php?s=1' }],
      category: [{ name: '类别A', url: 'https://www.javlibrary.com/cn/vl_genre.php?g=1' }],
      cover: {
        url: 'https://pics.example.com/cover/abcpl.jpg',
        referer: 'https://www.javlibrary.com/cn/?v=javli-example',
      },
      coverSingle: {
        url: 'https://pics.example.com/cover/abcps.jpg',
        referer: 'https://www.javlibrary.com/cn/?v=javli-example',
      },
      preview: [{
        raw: 'https://pics.example.com/sample/1.jpg',
        thumbnail: 'https://www.javlibrary.com/thumb/1.jpg',
      }],
      score: 8.75,
      scoreCount: 123,
    })
    expect(info?.date).toBeGreaterThan(0)
    testLogger.info('JavLibrary 详情页解析验证完成')
  })

  it('javLibrary 兼容现场标题字段和错位识别码', async () => {
    /*
     * ================================================================================
     * 步骤1：验证现场 JavLibrary 页面兜底解析
     * ================================================================================
     * 目标：页面 h3 为空且识别码节点返回日期时仍保留正确番号和标题。
     * 数据源：正常浏览器现场复核的 JavLibrary 详情结构。
     * 操作：
     * 1) 用页面 title 提供番号和标题
     * 2) 确认日期字段不会被误当成番号
     */
    testLogger.info('开始验证 JavLibrary 现场字段兜底解析')

    const parser = new JavLibrary()
    const info = await parser.parseInfo(`
      <title>SORA-636 強●クスリ漬け 生意気な元キャバ嬢 - JAVLibrary</title>
      <div id="video_title"><h3 class="post-title text"></h3></div>
      <div id="video_info">
        <div id="video_id"><td class="text" id="avid">2026-07-28</td></div>
        <div id="video_date"><td class="text">2026-07-28</td></div>
        <div id="video_length"><span class="text">220</span></div>
      </div>
      <img id="video_jacket_img" src="https://pics.example.com/cover.jpg">
    `)

    expect(info).toMatchObject({
      avNumber: 'SORA-636',
      title: '強●クスリ漬け 生意気な元キャバ嬢',
      duration: 220,
    })
    testLogger.info('JavLibrary 现场字段兜底解析完成')
  })

  it('javLibrary 搜索结果只选择精确番号', () => {
    /*
     * ================================================================================
     * 步骤1：验证 JavLibrary 搜索结果匹配
     * ================================================================================
     * 目标：相似番号并存时只返回标准化后完全一致的详情链接。
     * 数据源：包含两个相似番号的搜索结果夹具。
     * 操作：
     * 1) 建立相似番号结果列表
     * 2) 核对精确结果链接
     */
    testLogger.info('开始验证 JavLibrary 精确番号匹配')

    const parser = new JavLibrary()
    const detailUrl = parser.getDetailUrl(`
      <div class="video"><a href="./wrong.html"><div class="id">SORA-636-C</div></a></div>
      <div class="video"><a href="./right.html"><div class="id">SORA-636</div></a></div>
    `, 'SORA636')

    expect(detailUrl).toBe('https://www.javlibrary.com/cn/right.html')
    testLogger.info('JavLibrary 精确番号匹配验证完成')
  })

  it('javLibrary 请求使用站点自己的 Cookie 分区', async () => {
    /*
     * ================================================================================
     * 步骤1：验证 JavLibrary 请求分区
     * ================================================================================
     * 目标：复用用户正常访问 JavLibrary 后签发的 Cloudflare Cookie。
     * 数据源：JavLibrary 详情页响应和站点顶层分区键。
     * 操作：
     * 1) 模拟返回精确番号详情页
     * 2) 核对请求绑定 javlibrary.com 顶层分区
     */
    testLogger.info('开始验证 JavLibrary Cookie 分区')
    requestMocks.get.mockResolvedValue(new Response(`
      <div id="video_title">
        <h3><a href="./?v=javli-example">SORA-636 示例标题</a></h3>
      </div>
      <div id="video_info">
        <div id="video_id"><span class="text">SORA-636</span></div>
      </div>
      <img id="video_jacket_img" src="//pics.example.com/cover/abcpl.jpg">
    `, { status: 200 }))

    const parser = new JavLibrary()
    const info = await parser.getInfoByAvNumber('SORA-636')

    expect(info?.avNumber).toBe('SORA-636')
    expect(requestMocks.get).toHaveBeenCalledWith(
      'https://www.javlibrary.com/cn/vl_searchbyid.php?keyword=SORA-636',
      expect.objectContaining({
        cookie: 'over18=18',
        cookiePartition: {
          topLevelSite: 'https://javlibrary.com',
        },
      }),
    )
    testLogger.info('JavLibrary Cookie 分区验证完成')
  })

  it('fD2PPV 解析 FC2 详情并使用站点 Cookie 分区', async () => {
    /*
     * ================================================================================
     * 步骤1：验证 FD2PPV 详情请求和字段解析
     * ================================================================================
     * 目标：FC2 文件优先取得专用来源的标题、封面、时长和标签。
     * 数据源：FD2 作品页稳定类名和 fd2ppv.cc 顶层分区。
     * 操作：
     * 1) 模拟 FC2 精确详情页
     * 2) 核对字段和 Cookie 分区
     */
    testLogger.info('开始验证 FD2PPV 详情解析')
    requestMocks.get.mockResolvedValue(new Response(`
      <div class="work-title">FC2 PPV 4818259</div>
      <div class="work-brief">FC2 示例标题</div>
      <div class="work-meta-label">發佈日期</div><div class="work-meta-value">2026-08-01</div>
      <div class="work-meta-label">片長</div><div class="work-meta-value">01:02:30</div>
      <div class="work-meta-label">賣家</div><div class="work-meta-value">示例卖家</div>
      <div class="artist-name"><a href="/artists/example">演员A</a></div>
      <div class="work-tags"><a href="/tags/example">标签A</a></div>
      <div class="work-photos"><img src="https://contents-thumbnail2.fc2.com/example.jpg"></div>
    `, { status: 200 }))

    const parser = new Fd2Ppv()
    const info = await parser.getInfoByAvNumber('FC2-PPV-4818259')

    expect(info).toMatchObject({
      avNumber: 'FC2-PPV-4818259',
      title: 'FC2 示例标题',
      duration: 63,
      studio: [{ name: '示例卖家' }],
      actors: [{ name: '演员A', url: 'https://fd2ppv.cc/artists/example', sex: 1 }],
      cover: {
        url: 'https://contents-thumbnail2.fc2.com/example.jpg',
        referer: 'https://fd2ppv.cc/articles/4818259',
      },
    })
    expect(requestMocks.get).toHaveBeenCalledWith(
      'https://fd2ppv.cc/articles/4818259',
      expect.objectContaining({
        cookiePartition: { topLevelSite: 'https://fd2ppv.cc' },
      }),
    )
    testLogger.info('FD2PPV 详情解析验证完成')
  })

  it('专用来源路由只为 FC2 增加 FD2PPV', () => {
    /*
     * ================================================================================
     * 步骤1：验证 FC2 专用来源路由
     * ================================================================================
     * 目标：保留 FC2 的 FD2PPV 优先级，普通番号继续使用四个通用来源。
     * 数据源：普通番号和 FC2 PPV 番号。
     * 操作：
     * 1) 核对普通来源顺序
     * 2) 核对 FD2PPV 位于 FC2 来源首位
     */
    testLogger.info('开始验证 FC2 专用来源路由')

    expect(createJavInfoSources('SORA-636').map(source => source.source)).toEqual([
      'JavLibrary',
      'JavBus',
      'JavDB',
      'MissAV',
    ])
    expect(createJavInfoSources('FC2-PPV-4818259').map(source => source.source)).toEqual([
      'FD2PPV',
      'JavLibrary',
      'JavBus',
      'JavDB',
      'MissAV',
    ])

    testLogger.info('FC2 专用来源路由验证完成')
  })
})
