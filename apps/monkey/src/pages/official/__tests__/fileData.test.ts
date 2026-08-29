import { beforeEach, describe, expect, it, vi } from 'vitest'

const pageWindow = vi.hoisted(() => ({
  fetch: vi.fn(),
}))

const testLogger = {
  info: vi.fn(),
  warn: vi.fn(),
}

vi.mock('$', () => ({ unsafeWindow: pageWindow }))
vi.mock('@/utils/logger', () => ({
  appLogger: {
    sub: () => testLogger,
  },
}))

const {
  OfficialFileDataStore,
  installOfficialFileCapture,
  isOfficialFileListRequest,
  officialFileData,
} = await import('../fileData')

describe('officialFileDataStore', () => {
  beforeEach(() => {
    testLogger.info.mockClear()
    testLogger.warn.mockClear()
    officialFileData.clear()
  })

  it('按当前目录和同名序号匹配新版文件行', () => {
    /*
     * ================================================================================
     * 步骤1：验证新版文件数据索引
     * ================================================================================
     * 目标：同名文件存在时仍按当前目录和显示顺序稳定匹配。
     * 数据源：两个 /files 响应片段。
     * 操作：
     * 1) 写入不同目录和同目录同名文件
     * 2) 按目录及 occurrence 读取
     */
    testLogger.info('开始验证新版文件数据索引')

    const store = new OfficialFileDataStore()
    store.ingest({
      data: [
        { n: 'SORA-636.mp4', fid: '1', pc: 'pc1', pid: '0' },
        { n: 'SORA-636.mp4', fid: '2', pc: 'pc2', pid: '0' },
        { n: 'SORA-636.mp4', fid: '3', pc: 'pc3', pid: '100' },
      ],
    }, 'test')

    expect(store.findByName('SORA-636.mp4', '0', 0)?.pc).toBe('pc1')
    expect(store.findByName('SORA-636.mp4', '0', 1)?.pc).toBe('pc2')
    expect(store.findByName('SORA-636.mp4', '0', 2)).toBeNull()
    expect(store.findByName('SORA-636.mp4', '100', 0)?.pc).toBe('pc3')

    testLogger.info('新版文件数据索引验证完成')
  })

  it('按稳定 ID 更新重命名后的文件名索引', () => {
    /*
     * ================================================================================
     * 步骤1：验证新版文件重命名更新
     * ================================================================================
     * 目标：同一 fid 更新后不再通过旧文件名命中。
     * 数据源：同一文件的两次响应。
     * 操作：
     * 1) 写入旧名称
     * 2) 用同一 fid 写入新名称并核对索引
     */
    testLogger.info('开始验证新版文件重命名索引')

    const store = new OfficialFileDataStore()
    store.ingest({ data: [{ n: 'old.mp4', fid: '1', pid: '0' }] })
    store.ingest({ data: [{ n: 'new.mp4', fid: '1', pid: '0' }] })

    expect(store.findByName('old.mp4', '0')).toBeNull()
    expect(store.findByName('new.mp4', '0')?.fid).toBe('1')

    testLogger.info('新版文件重命名索引验证完成')
  })

  it('限制新版文件索引容量并保留新写入项', () => {
    /*
     * ================================================================================
     * 步骤1：验证新版文件索引容量
     * ================================================================================
     * 目标：用户连续浏览大量目录时，文件对象索引不会无限增长。
     * 数据源：容量为两个文件项的独立索引实例。
     * 操作：
     * 1) 写入两个旧文件
     * 2) 写入第三个文件，核对最早写入项被淘汰
     */
    testLogger.info('开始验证新版文件索引容量')

    const store = new OfficialFileDataStore(2)
    store.ingest({
      data: [
        { n: 'old-1.mp4', fid: 'old-1', pid: '0' },
        { n: 'old-2.mp4', fid: 'old-2', pid: '0' },
      ],
    })
    store.ingest({ data: [{ n: 'new.mp4', fid: 'new', pid: '0' }] })

    expect(store.size).toBe(2)
    expect(store.findByName('old-1.mp4', '0')).toBeNull()
    expect(store.findByName('old-2.mp4', '0')?.fid).toBe('old-2')
    expect(store.findByName('new.mp4', '0')?.fid).toBe('new')

    testLogger.info('新版文件索引容量验证完成')
  })

  it('只按当前目录并保持接口顺序列出文件', () => {
    /*
     * ================================================================================
     * 步骤1：验证新版文件候选顺序
     * ================================================================================
     * 目标：DOM 名称不足以区分文件时，不得使用其他目录的旧接口数据。
     * 数据源：跨两个目录的文件响应。
     * 操作：
     * 1) 写入交错目录文件
     * 2) 核对只返回当前目录文件且顺序不变
     */
    testLogger.info('开始验证新版文件候选顺序')

    const store = new OfficialFileDataStore()
    store.ingest({
      data: [
        { n: 'other.mp4', fid: '1', pid: '100' },
        { n: 'SORA-636.mp4', fid: '2', pid: '0' },
        { n: 'MURIKURI-009.mp4', fid: '3', pid: '0' },
      ],
    })

    expect(store.list('0').map(item => item.fid)).toEqual(['2', '3'])

    testLogger.info('新版文件候选顺序验证完成')
  })

  it('只捕获普通、标签、APS 和家庭共享文件接口', () => {
    /*
     * ================================================================================
     * 步骤1：验证新版文件接口白名单
     * ================================================================================
     * 目标：特殊记录列表不能被当作普通文件对象写入仓库。
     * 数据源：新版真实接口路径。
     * 操作：
     * 1) 核对四类文件接口
     * 2) 排除分享记录、最近接收和回收站接口
     */
    testLogger.info('开始验证新版文件接口白名单')

    expect(isOfficialFileListRequest('https://webapi.115.com/files?cid=0')).toBe(true)
    expect(isOfficialFileListRequest('https://webapi.115.com/files/search?file_label=10')).toBe(true)
    expect(isOfficialFileListRequest('https://aps.115.com/natsort/files.php?cid=0')).toBe(true)
    expect(isOfficialFileListRequest('https://webapi.115.com/usershare/filelist?share_id=1')).toBe(true)
    expect(isOfficialFileListRequest('https://webapi.115.com/share/slist')).toBe(false)
    expect(isOfficialFileListRequest('https://115.com/api/1.0/web/26.0/chat_history/file_read_dir')).toBe(false)
    expect(isOfficialFileListRequest('https://webapi.115.com/rb')).toBe(false)

    testLogger.info('新版文件接口白名单验证完成')
  })

  it('在页面 fetch 返回后立即索引新版文件数据', async () => {
    /*
     * ================================================================================
     * 步骤1：验证新版页面 fetch 捕获
     * ================================================================================
     * 目标：document-start 安装后不漏掉页面应用首次文件列表响应。
     * 数据源：页面原生 fetch 返回的 /files JSON。
     * 操作：
     * 1) 安装一次捕获器并发起页面请求
     * 2) 等待响应副本写入共用文件仓库
     */
    testLogger.info('开始验证新版页面 fetch 捕获')

    /** 1.1 原始响应仍交给页面，捕获器只解析 clone。 */
    const response = new Response(JSON.stringify({
      data: [{ n: '新版视频.mp4', fid: 'new-file', pc: 'new-pick', pid: '0' }],
    }), {
      headers: { 'content-type': 'application/json' },
      status: 200,
    })
    Object.defineProperty(response, 'url', {
      value: 'https://webapi.115.com/files?cid=0',
    })
    pageWindow.fetch.mockResolvedValue(response)
    installOfficialFileCapture()

    /** 1.2 页面拿到同一响应后，异步副本必须进入当前目录索引。 */
    await expect(
      pageWindow.fetch('https://webapi.115.com/files?cid=0'),
    ).resolves.toBe(response)
    await vi.waitFor(() => {
      expect(officialFileData.findByName('新版视频.mp4', '0')?.pc).toBe('new-pick')
    })

    testLogger.info('新版页面 fetch 捕获验证完成')
  })
})
