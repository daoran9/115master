import { expect, test } from '@playwright/test'
import {
  CORS,
  FILES_RE,
  filesRes,
  folder,
  json,
  OFFICIAL_STORAGE_URL,
  setupHarness,
  video,
} from '../../support'
import { gmStore, watch, watchTabs } from '../../support/homeUtils'

const items = [
  video('SORA-636.mp4', '0'),
  video('MURIKURI-009.mp4', '0'),
  video('家庭录像.mp4', '0'),
].map((item, index) => ({
  ...item,
  fid: `official-file-${index + 1}`,
  pc: `official-pick-${index + 1}`,
  sha: String(index + 1).padStart(40, '0'),
  s: [15612206121, 8257074627, 1610612736][index],
  original_name: index < 2 ? 'www.98T.la@shared-restored.mp4' : item.n,
}))

function setupStorageHarness(page: Parameters<typeof setupHarness>[0]) {
  return setupHarness(page, {
    mocks: (api) => {
      api.override(FILES_RE, ({ route, url }) => {
        return json(route, filesRes(
          { cid: '0', name: '根目录', items },
          Number(url.searchParams.get('offset') ?? 0),
          Number(url.searchParams.get('limit') ?? 1150),
        ))
      })
      api.override(/^https:\/\/(www\.javbus\.com|www\.javlibrary\.com|javdb\.com|missav\.ws)\//, ({ route }) => {
        return json(route, { state: false }, 404)
      })
    },
  })
}

/** 生成指定文件集合对应的新版原生列表文档。 */
function storageHtml(
  files: Array<{ cid?: string, fid?: string, n: string, s: number }>,
  nativeActions = false,
) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>115 新版长列表</title>
  <style>
    .native-hover-actions { display: none; }
    .file-list-item:hover > .file-list-item > .native-hover-actions { display: flex; }
  </style>
</head>
<body>
  <main id="new-storage-root">
    <div data-file-scroll style="height: 600px; overflow-y: auto">
      ${files.map(item => `
        <div class="file-list-item" data-file-id="${item.fid ?? item.cid ?? ''}">
          <div class="group relative file-list-item">
            ${nativeActions
              ? `
              <div class="native-hover-actions hidden group-hover:flex absolute left-0 right-0">
                <div class="flex items-center bg-white">
                  <div data-menu-action="下载"><button title="下载">下载</button></div>
                  <div data-menu-action="分享"><button title="分享">分享</button></div>
                  <div data-menu-action="移动"><button title="移动">移动</button></div>
                  <div data-menu-action="重命名"><button title="重命名">重命名</button></div>
                  <div data-menu-action="置顶"><button title="置顶">置顶</button></div>
                  <div data-menu-action="星标"><button title="星标">星标</button></div>
                  <div data-menu-action="删除"><button title="删除">删除</button></div>
                  <div><button title="更多">更多</button></div>
                </div>
              </div>
            `
              : ''}
            <div class="flex items-center">
              <div class="file-name-responsive" title="${item.n}">${item.n}</div>
              <div class="file-info-responsive">${(item.s / 1024 / 1024 / 1024).toFixed(2)} GB</div>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  </main>
</body>
</html>`
}

/** 生成与真实 115 视频筛选一致的绝对定位虚拟列表。 */
function storageVirtualHtml(files: Array<{
  cid?: string
  fc?: number
  fid?: string
  iv?: number
  n: string
  pc?: string
  pid?: string
  s: number
  sha?: string
}>) {
  const embeddedFiles = JSON.stringify(files).replaceAll('<', '\\u003c')
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>115 新版虚拟列表</title>
  <style>
    [data-file-scroll] { height: 300px; overflow-y: auto; position: relative; }
    [data-file-spacer] { height: ${files.length * 76}px; position: relative; }
    .file-list-item[data-file-id] { position: absolute; left: 0; width: 100%; }
    .file-list-item[data-file-id] > .file-list-item { height: 60px; }
  </style>
</head>
<body>
  <main id="new-storage-root">
    <div data-file-scroll>
      <div data-file-spacer>
        ${files.map((item, index) => `
          <div class="file-list-item" data-index="${index}" data-file-id="${item.fid ?? item.cid ?? ''}" style="transform: translateY(${index * 76}px)">
            <div class="group relative file-list-item">
              <div class="flex items-center">
                <div class="file-name-responsive" title="${item.n}">${item.n}</div>
                <div class="file-info-responsive">${(item.s / 1024 / 1024 / 1024).toFixed(2)} GB</div>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  </main>
  <script>
    const embeddedFiles = ${embeddedFiles};
    const rows = Array.from(document.querySelectorAll('.file-list-item[data-file-id]'));
    const sizes = embeddedFiles.map(() => 76);
    const spacer = document.querySelector('[data-file-spacer]');
    const virtualizer = {
      getVirtualItems() {
        return rows.map((row, index) => ({ index, size: sizes[index] }));
      },
      resizeItem(index, size) {
        sizes[index] = size;
        let start = 0;
        rows.forEach((row, rowIndex) => {
          row.style.transform = 'translateY(' + start + 'px)';
          start += sizes[rowIndex];
        });
        spacer.style.height = start + 'px';
      },
    };
    Object.defineProperty(window, '__officialVirtualizerFixture', {
      value: virtualizer,
    });
    rows.forEach((row, index) => {
      Object.defineProperty(row, '__reactProps$fixture', {
        value: { children: { props: { file: embeddedFiles[index] } } },
      });
      Object.defineProperty(row, '__reactFiber$fixture', {
        value: {
          memoizedState: null,
          return: {
            memoizedState: { memoizedState: virtualizer, next: null },
            return: null,
          },
        },
      });
    });
  </script>
</body>
</html>`
}

/** 生成指定文件集合对应的新版原生网格文档。 */
function storageGridHtml(files: Array<{ cid?: string, fid?: string, n: string }>) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>115 新版网格</title>
  <style>
    [data-file-scroll] { display: grid; grid-template-columns: repeat(4, 110px); gap: 12px; }
    .file-grid-item { position: static; width: 110px; height: 110px; overflow: hidden; }
    .file-grid-item img { display: block; width: 72px; height: 72px; }
  </style>
</head>
<body>
  <main id="new-storage-root">
    <div data-file-scroll style="height: 600px; overflow-y: auto">
      ${files.map(item => `
        <div class="file-grid-item" data-file-id="${item.fid ?? item.cid ?? ''}">
          <img title="${item.n}" alt="${item.n}" />
          <span title="${item.n}">${item.n}</span>
        </div>
      `).join('')}
    </div>
  </main>
</body>
</html>`
}

test.describe('新版 115 原生文件列表适配', () => {
  test('新版播放和 ED2K 入口合并到原生文件悬停操作条', async ({ page }) => {
    /*
     * ================================================================================
     * 步骤1：验证新版操作入口合并
     * ================================================================================
     * 目标：不再为 Fusion 创建常驻独立操作条，入口只在文件悬停时随原生操作显示。
     * 数据源：带原生悬停操作条的新版文件列表夹具。
     * 操作：
     * 1) 核对附加区不含独立操作条
     * 2) 悬停文件行后核对原生条同时包含播放、ED2K 和原生操作
     */
    await setupHarness(page, {
      mocks: (api) => {
        api.override(/^https:\/\/115\.com\/storage\/allfiles/, async ({ route, request }) => {
          if (!request.isNavigationRequest())
            return
          await route.fulfill({
            contentType: 'text/html; charset=utf-8',
            headers: { ...CORS, 'origin-agent-cluster': '?0' },
            body: storageHtml(items, true),
          })
          return true
        })
        api.override(FILES_RE, ({ route }) => json(route, filesRes({
          cid: '0',
          name: '根目录',
          items,
        }, 0, 1150)))
        api.override(/^https:\/\/(www\.javbus\.com|www\.javlibrary\.com|javdb\.com|missav\.ws)\//, ({ route }) => {
          return json(route, { state: false }, 404)
        })
      },
    })
    await page.goto(OFFICIAL_STORAGE_URL)

    const row = page.locator('.file-list-item[data-file-id="official-file-1"]')
    const addon = row.locator('[data-115master-row-addon]')
    const actions = row.locator('[data-115master-merged-actions]')
    await expect(addon.locator('[data-115master-native-actions]')).toHaveCount(0)
    await expect(actions).toHaveCount(1)
    await expect(actions).toBeHidden()
    await row.hover()
    await expect(actions).toBeVisible()
    await expect(actions.locator('a.master-player')).toHaveText('▶️ Master 播放')
    await expect(actions.locator('a[class="115-player"]')).toHaveText('5️⃣ 官方播放')
    await expect(actions.locator('a.ed2k-link')).toHaveText('ED2K')
    await expect(actions.getByRole('button', { name: '下载' })).toBeVisible()
    await expect(actions.locator('[data-115master-native-action-group]')).toHaveCount(1)
    const visualEntries = actions.locator([
      '[data-115master-native-action-group] > a',
      '[data-115master-native-action-group] > [data-115master-native-menu]',
    ].join(', '))
    await expect.poll(() => visualEntries.evaluateAll((nodes) => {
      /*
       * ================================================================================
       * 步骤2：核对悬停操作条视觉顺序
       * ================================================================================
       * 目标：验证新版操作入口按旧版从左到右显示，而不是误把 DOM 插入顺序当成 UI 顺序。
       * 数据源：操作条直接子节点的屏幕坐标和文字。
       * 操作：
       * 1) 读取每个入口的实际布局位置
       * 2) 按从上到下、从左到右排序后核对旧版顺序
       */
      return nodes
        .map(node => ({
          text: node.textContent?.trim() ?? '',
          rect: node.getBoundingClientRect(),
        }))
        .sort((left, right) => left.rect.top - right.rect.top || left.rect.left - right.rect.left)
        .map(node => node.text)
    })).toEqual([
      '▶️ Master 播放',
      '5️⃣ 官方播放',
      'ED2K',
      '置顶',
      '星标',
      '下载',
      '移动',
      '重命名',
      '删除',
      '分享',
      '更多',
    ])
  })

  test('新版原生悬停条延迟出现后回收独立兼容操作条', async ({ page }) => {
    /*
     * ================================================================================
     * 步骤1：验证延迟原生操作条接管
     * ================================================================================
     * 目标：React 延迟绘制原生操作条时，Fusion 不保留先前创建的独立兼容条。
     * 数据源：先无操作条、再异步插入原生结构的新版文件列表夹具。
     * 操作：
     * 1) 等待 Fusion 首轮创建独立兼容条
     * 2) 插入新版原生操作条并核对 Fusion 自动迁移
     */
    await setupHarness(page, {
      mocks: (api) => {
        api.override(/^https:\/\/115\.com\/storage\/allfiles/, async ({ route, request }) => {
          if (!request.isNavigationRequest())
            return
          await route.fulfill({
            contentType: 'text/html; charset=utf-8',
            headers: { ...CORS, 'origin-agent-cluster': '?0' },
            body: storageHtml(items),
          })
          return true
        })
        api.override(FILES_RE, ({ route }) => json(route, filesRes({
          cid: '0',
          name: '根目录',
          items,
        }, 0, 1150)))
        api.override(/^https:\/\/(www\.javbus\.com|www\.javlibrary\.com|javdb\.com|missav\.ws)\//, ({ route }) => {
          return json(route, { state: false }, 404)
        })
      },
    })
    await page.goto(OFFICIAL_STORAGE_URL)

    const row = page.locator('.file-list-item[data-file-id="official-file-1"]')
    const addon = row.locator('[data-115master-row-addon]')
    await expect(addon.locator('[data-115master-native-actions]')).toHaveCount(1)
    await expect(row.locator('[data-115master-merged-actions]')).toHaveCount(0)

    await row.evaluate((node) => {
      const interactionRow = node.querySelector<HTMLElement>(':scope > .group.relative.file-list-item')
      if (!interactionRow)
        throw new Error('缺少新版原生交互行')
      interactionRow.insertAdjacentHTML('afterbegin', `
        <div class="native-hover-actions hidden group-hover:flex absolute left-0 right-0">
          <div class="flex items-center bg-white">
            <div data-menu-action="下载"><button title="下载">下载</button></div>
            <div data-menu-action="分享"><button title="分享">分享</button></div>
            <div data-menu-action="移动"><button title="移动">移动</button></div>
            <div data-menu-action="重命名"><button title="重命名">重命名</button></div>
            <div data-menu-action="置顶"><button title="置顶">置顶</button></div>
            <div data-menu-action="星标"><button title="星标">星标</button></div>
            <div data-menu-action="删除"><button title="删除">删除</button></div>
            <div><button title="更多">更多</button></div>
          </div>
        </div>
      `)
    })

    const actions = row.locator('[data-115master-merged-actions]')
    await expect(actions).toHaveCount(1)
    await expect(addon.locator('[data-115master-native-actions]')).toHaveCount(0)
    await expect(actions.locator('[data-115master-native-action-group]')).toHaveCount(1)
    await expect(actions.locator('a.master-player')).toHaveText('▶️ Master 播放')
    await expect(actions.locator('a.ed2k-link')).toHaveText('ED2K')
  })

  test('后台标签暂停动画帧时仍完成首屏文件增强', async ({ page }) => {
    /**
     * ================================================================================
     * 步骤1：验证后台标签首屏扫描
     * ================================================================================
     * 目标：115 标签不在前台时，文件详情不能永久停在初始化状态。
     * 数据源：暂停 requestAnimationFrame 的新版文件列表夹具。
     * 操作：
     * 1) 禁用页面动画帧回调后加载真实脚本
     * 2) 核对短定时扫描仍挂载每个文件增强
     */
    const errors = watch(page)
    await setupStorageHarness(page)
    await page.goto(OFFICIAL_STORAGE_URL)

    const addons = page.locator('[data-115master-row-addon]')
    await expect(addons).toHaveCount(items.length)
    const ed2k = addons.first().getByRole('link', { name: 'ED2K' })
    await expect(ed2k).toBeVisible()
    await ed2k.click()
    const ed2kDialog = page.locator('[data-115master-ed2k-dialog]')
    await expect(ed2kDialog.locator('.name')).toHaveText('SORA-636.mp4')
    await ed2kDialog.locator('button.cancel').click()
    await expect(ed2kDialog).toHaveCount(0)
    await page.evaluate(() => {
      window.requestAnimationFrame = () => 1
      window.cancelAnimationFrame = () => {}
      const row = document.querySelector<HTMLElement>(
        '.file-list-item[data-file-id="official-file-1"]',
      )
      if (!row)
        throw new Error('缺少后台扫描测试文件行')
      const replacement = row.cloneNode(true) as HTMLElement
      replacement.querySelectorAll('[data-115master-row-addon]').forEach(node => node.remove())
      row.replaceWith(replacement)
    })

    await expect(page.locator(
      '.file-list-item[data-file-id="official-file-1"] > [data-115master-row-addon]',
    )).toHaveCount(1)
    await expect(page.locator('html')).toHaveAttribute(
      'data-115master-official-fallback-state',
      'complete',
    )
    expect(errors).toEqual([])
  })

  test('新版 ISO 光盘镜像按番号加载详情', async ({ page }) => {
    /*
     * ================================================================================
     * 步骤1：验证新版 ISO 番号资料
     * ================================================================================
     * 目标：新版列表中的 ISO 文件不再被视频扩展名门禁过滤。
     * 数据源：新版文件接口与原生行中的 SORA-636.iso。
     * 操作：
     * 1) 返回 ISO 文件并装配原生文件行
     * 2) 核对附加区挂载 SORA-636 详情
     */
    console.info('[e2e] 开始验证新版 ISO 番号资料')
    const errors = watch(page)
    const iso = {
      ...video('SORA-636.iso', '0'),
      fid: 'official-iso-file',
      pc: 'official-iso-pick',
      sha: '8'.repeat(40),
      s: 8589934592,
      ico: 'iso',
    }

    // 1.1 用同一 ISO 文件生成原生页面和接口响应
    await setupHarness(page, {
      mocks: (api) => {
        api.override(/^https:\/\/115\.com\/storage\/allfiles/, async ({ route, request }) => {
          if (!request.isNavigationRequest())
            return
          await route.fulfill({
            contentType: 'text/html; charset=utf-8',
            headers: { ...CORS, 'origin-agent-cluster': '?0' },
            body: storageHtml([iso]),
          })
          return true
        })
        api.override(FILES_RE, ({ route }) => json(route, filesRes({
          cid: '0',
          name: '根目录',
          items: [iso],
        }, 0, 1150)))
        api.override(/^https:\/\/(www\.javbus\.com|www\.javlibrary\.com|javdb\.com|missav\.ws)\//, ({ route }) => {
          return json(route, { state: false }, 404)
        })
      },
    })
    await page.goto(OFFICIAL_STORAGE_URL)

    /** 1.2 ISO 附加区挂载精确番号详情 */
    const addon = page.locator('[data-115master-row-addon][data-115master-file-key="official-iso-file"]')
    await expect(addon).toHaveCount(1)
    await expect(addon.locator('[data-115master-detail]'))
      .toHaveAttribute('data-115master-av-number', 'SORA-636')
    await expect(addon.locator('.ext-info-root')).toBeAttached()
    expect(errors).toEqual([])
    console.info('[e2e] 新版 ISO 番号资料验证完成')
  })

  test('React 重绘为嵌套完整标题后自动恢复文件增强', async ({ page }) => {
    const errors = watch(page)
    await setupStorageHarness(page)
    await page.goto(OFFICIAL_STORAGE_URL)

    /*
     * ================================================================================
     * 步骤1：验证嵌套标题重绘恢复
     * ================================================================================
     * 目标：加载更多重绘原生行后，不需要刷新页面即可恢复详情和预览。
     * 数据源：无 title 的 file-name-responsive 与内部完整 title 节点。
     * 操作：
     * 1) 模拟 React 删除插件附加区并写入截断文本
     * 2) 核对同一文件只恢复一份完整增强
     */
    console.info('[e2e] 开始核对嵌套标题重绘恢复')

    const row = page.locator('.file-list-item[data-file-id="official-file-1"]')
    await expect(row.locator(':scope > [data-115master-row-addon]')).toHaveCount(1)
    await row.evaluate((element) => {
      const name = element.querySelector<HTMLElement>('.file-name-responsive')
      name?.removeAttribute('title')
      if (name)
        name.innerHTML = '<span title="SORA-636.mp4">SORA-636…</span>'
      element.querySelectorAll(':scope > [data-115master-row-addon]').forEach(node => node.remove())
    })

    const addon = row.locator(':scope > [data-115master-row-addon]')
    await expect(addon).toHaveCount(1)
    await expect(addon).toHaveAttribute('data-115master-name', 'SORA-636.mp4')
    await expect(addon.locator('[data-115master-detail]'))
      .toHaveAttribute('data-115master-av-number', 'SORA-636')
    await expect(addon.locator('[data-115master-preview]'))
      .toHaveAttribute('data-115master-pick-code', items[0].pc)
    await expect(addon.locator('[data-115master-native-actions]')).toHaveCount(1)

    console.info('[e2e] 嵌套标题重绘恢复核对完成')
    expect(errors).toEqual([])
  })

  test('后台标签不触发可见性回调时仍挂载首屏详情', async ({ page }) => {
    /**
     * ================================================================================
     * 步骤1：验证后台标签详情挂载
     * ================================================================================
     * 目标：IntersectionObserver 被后台节流时，首屏番号资料仍开始加载。
     * 数据源：永不触发回调的可见性观察器和新版首屏文件行。
     * 操作：
     * 1) 页面启动前替换可见性观察器
     * 2) 核对视口附近详情按元素坐标即时挂载
     */
    const errors = watch(page)
    await page.addInitScript(() => {
      Object.defineProperty(window, 'IntersectionObserver', {
        configurable: true,
        value: class {
          root = null
          rootMargin = '0px'
          thresholds = [0]
          disconnect() {}
          observe() {}
          takeRecords() { return [] }
          unobserve() {}
        },
        writable: true,
      })
    })
    await setupStorageHarness(page)
    await page.goto(OFFICIAL_STORAGE_URL)

    await expect.poll(() => page.locator('[data-115master-detail]').evaluateAll(
      nodes => nodes.filter(node => node.shadowRoot?.querySelector('.ext-info-root')).length,
    )).toBe(2)
    expect(errors).toEqual([])
  })

  test('同一文件行同时显示番号详情和视频预览', async ({ page }) => {
    const errors = watch(page)
    await setupStorageHarness(page)
    await page.goto(OFFICIAL_STORAGE_URL)

    /** 新版适配在 document-start 包装 fetch，以捕获首个文件列表响应。 */
    expect(await page.evaluate(() =>
      '__115masterOfficialFileCapture__' in window.fetch,
    )).toBe(true)
    expect(await page.locator('html').getAttribute('data-115master-official-file-list'))
      .toBe('2.0.0-beta.101')

    /**
     * ================================================================================
     * 步骤1：验证旧版行增强挂到新版原生列表
     * ================================================================================
     * 目标：SORA 和 MURIKURI 都同时显示各自番号详情与视频预览。
     * 操作：
     * 1) 用115真实的双层同名文件行复现重复增强
     * 2) 核对只增强带稳定文件 ID 的外层，每行只有一份增强
     */
    const soraRow = page.locator('.file-list-item[data-file-id="official-file-1"]')
    const murikuriRow = page.locator('.file-list-item[data-file-id="official-file-2"]')
    const sora = page.locator('[data-115master-row-addon][data-115master-name="SORA-636.mp4"]')
    const murikuri = page.locator('[data-115master-row-addon][data-115master-name="MURIKURI-009.mp4"]')
    const homeVideo = page.locator('[data-115master-row-addon][data-115master-name="家庭录像.mp4"]')

    /** 1.1 插件只在原生行末尾追加独立容器，不修改原生内容节点、属性或样式类。 */
    const soraNative = soraRow.locator(':scope > .file-list-item > .flex.items-center')
    const murikuriNative = murikuriRow.locator(':scope > .file-list-item > .flex.items-center')
    await expect(soraNative.locator('[data-115master-detail], [data-115master-preview], [data-115master-native-actions]')).toHaveCount(0)
    await expect(murikuriNative.locator('[data-115master-detail], [data-115master-preview], [data-115master-native-actions]')).toHaveCount(0)
    await expect(soraRow).not.toHaveAttribute('data-115master-enhanced', '')
    await expect(soraRow).not.toHaveClass(/with-ext-/)
    await expect(sora).toHaveAttribute('data-115master-file-key', items[0].fid)
    await expect(murikuri).toHaveAttribute('data-115master-file-key', items[1].fid)
    await expect(page.locator('html')).toHaveAttribute(
      'data-115master-official-row-count',
      String(items.length),
    )
    await expect(page.locator('html')).toHaveAttribute(
      'data-115master-official-item-count',
      String(items.length),
    )
    await expect(page.locator('html')).toHaveAttribute(
      'data-115master-official-missing-count',
      '0',
    )
    await expect(page.locator('html')).toHaveAttribute(
      'data-115master-official-fallback-state',
      'complete',
    )
    expect(await sora.evaluate(addon => addon.parentElement?.getAttribute('data-file-id'))).toBe('official-file-1')
    expect(await murikuri.evaluate(addon => addon.parentElement?.getAttribute('data-file-id'))).toBe('official-file-2')
    await expect(page.locator('.file-list-item:not([data-file-id]) > [data-115master-row-addon]')).toHaveCount(0)
    await expect(page.locator('a.master-player')).toHaveCount(3)
    await expect(page.locator('a[class="115-player"]')).toHaveCount(3)

    /** 1.2 详情和预览只挂到插件自有附加区。 */
    await expect(sora.locator('[data-115master-detail]')).toHaveCount(1)
    await expect(sora.locator('[data-115master-detail]'))
      .toHaveAttribute('data-115master-av-number', 'SORA-636')
    await expect(sora.locator('[data-115master-preview]')).toHaveCount(1)
    await expect(sora.locator('[data-115master-preview]'))
      .toHaveAttribute('data-115master-pick-code', items[0].pc)

    await expect(murikuri.locator('[data-115master-detail]')).toHaveCount(1)
    await expect(murikuri.locator('[data-115master-detail]'))
      .toHaveAttribute('data-115master-av-number', 'MURIKURI-009')
    await expect(murikuri.locator('[data-115master-preview]')).toHaveCount(1)
    await expect(murikuri.locator('[data-115master-preview]'))
      .toHaveAttribute('data-115master-pick-code', items[1].pc)
    await expect(homeVideo.locator('[data-115master-preview]')).toHaveCount(1)
    await expect(homeVideo.locator('[data-115master-detail]')).toHaveCount(0)

    /** 1.3 未拿到真实内容前不显示大块骨架。 */
    await expect(page.locator('[data-115master-row-addon] .skeleton')).toHaveCount(0)
    expect((await sora.locator('[data-115master-detail]').boundingBox())?.height).toBeLessThanOrEqual(1)
    expect((await sora.locator('[data-115master-preview]').boundingBox())?.height).toBeLessThanOrEqual(1)

    /** 1.4 详情与预览按文档流上下排列，不允许互相覆盖。 */
    const soraDetailBox = await sora.locator('[data-115master-detail]').boundingBox()
    const soraPreviewBox = await sora.locator('[data-115master-preview]').boundingBox()
    const murikuriDetailBox = await murikuri.locator('[data-115master-detail]').boundingBox()
    const murikuriPreviewBox = await murikuri.locator('[data-115master-preview]').boundingBox()
    expect(soraDetailBox).not.toBeNull()
    expect(soraPreviewBox).not.toBeNull()
    expect(murikuriDetailBox).not.toBeNull()
    expect(murikuriPreviewBox).not.toBeNull()
    expect(soraPreviewBox!.y).toBeGreaterThanOrEqual(
      soraDetailBox!.y + soraDetailBox!.height,
    )
    expect(murikuriPreviewBox!.y).toBeGreaterThanOrEqual(
      murikuriDetailBox!.y + murikuriDetailBox!.height,
    )

    expect(await page.locator('[data-115master-row-addon][data-115master-file-key]').evaluateAll(rows =>
      rows.map(row => row.getAttribute('data-115master-file-key')),
    )).toEqual(items.map(item => item.fid))

    await expect(sora.locator('a.master-player')).toHaveText('▶️ Master 播放')
    await expect(sora.locator('a[class="115-player"]')).toHaveText('5️⃣ 官方播放')
    await expect(sora.locator('a[menu="download_one"]')).toHaveText('下载')
    expect(errors).toEqual([])
  })

  test('日文长标题保留番号边界且资料源失败不污染页面', async ({ page }) => {
    const errors = watch(page)
    const enki = {
      ...video('ENKI-049ハメ棒300本超えちゃった性欲止まんない変態娘生中うれし…restored.mp4', '0'),
      fid: 'official-enki-049',
      pc: 'official-enki-pick',
      sha: '9'.repeat(40),
      s: 12229929615,
    }
    const sourceRequests: string[] = []
    await setupHarness(page, {
      mocks: (api) => {
        api.override(/^https:\/\/115\.com\/storage\/allfiles/, async ({ route, request }) => {
          if (!request.isNavigationRequest())
            return
          await route.fulfill({
            contentType: 'text/html; charset=utf-8',
            headers: { ...CORS, 'origin-agent-cluster': '?0' },
            body: storageHtml([enki]),
          })
          return true
        })
        api.override(FILES_RE, ({ route }) => json(route, filesRes({
          cid: '0',
          name: '根目录',
          items: [enki],
        }, 0, 1150)))
        api.override(/^https:\/\/(www\.javbus\.com|www\.javlibrary\.com|javdb\.com|missav\.ws)\//, ({ route, url }) => {
          sourceRequests.push(url.hostname)
          return json(route, { state: false }, 500)
        })
      },
    })
    await page.goto(OFFICIAL_STORAGE_URL)

    /**
     * ================================================================================
     * 步骤1：验证长标题番号和资料源异常隔离
     * ================================================================================
     * 目标：ENKI-049 后接日文与标题数字时仍有详情容器，全部资料源失败也不抛 pageerror。
     * 数据源：真实缺陷同形的 ENKI-049 文件名和四个 HTTP 500 资料源。
     * 操作：
     * 1) 核对详情与预览仍绑定同一文件
     * 2) 核对 JavLibrary、JavBus、JavDB、MissAV 均已请求并检查页面错误
     */
    const addon = page.locator('[data-115master-row-addon][data-115master-file-key="official-enki-049"]')
    await expect(addon.locator('[data-115master-detail]'))
      .toHaveAttribute('data-115master-av-number', 'ENKI-049')
    await expect(addon.locator('[data-115master-preview]'))
      .toHaveAttribute('data-115master-pick-code', 'official-enki-pick')
    await expect.poll(() => [...new Set(sourceRequests)].sort()).toEqual([
      'www.javlibrary.com',
      'www.javbus.com',
      'javdb.com',
      'missav.ws',
    ].sort())
    expect(errors).toEqual([])
  })

  test('SPA 切目录等待文件身份同步，不显示上一目录详情', async ({ page }) => {
    const errors = watch(page)
    let releaseCurrentDirectory: () => void = () => {}
    const currentDirectoryReady = new Promise<void>((resolve) => {
      releaseCurrentDirectory = resolve
    })
    const staleSource = [
      video('KYMI-051.mp4', '0'),
      video('MRSS-018.mp4', '0'),
    ]
    const staleItems = staleSource.map(({ pid: _pid, ...item }, index) => ({
      ...item,
      fid: `stale-file-${index + 1}`,
    }))
    const currentItems = items.slice(0, 2).map(item => ({
      ...item,
      pid: 'current-directory',
    }))

    await setupHarness(page, {
      mocks: (api) => {
        api.override(/^https:\/\/115\.com\/storage\/allfiles/, async ({ route, request }) => {
          if (!request.isNavigationRequest())
            return
          await route.fulfill({
            contentType: 'text/html; charset=utf-8',
            headers: { ...CORS, 'origin-agent-cluster': '?0' },
            body: storageHtml(staleItems),
          })
          return true
        })
        api.override(FILES_RE, async ({ route, url }) => {
          if (url.searchParams.get('cid') === 'current-directory') {
            await currentDirectoryReady
            return json(
              route,
              filesRes({ cid: 'current-directory', name: '字幕', items: currentItems }, 0, 1150),
            )
          }

          return json(route, {
            ...filesRes({ cid: '0', name: '看', items: staleSource }, 0, 1150),
            data: staleItems,
          })
        })
        api.override(/^https:\/\/(www\.javbus\.com|www\.javlibrary\.com|javdb\.com|missav\.ws)\//, ({ route }) => {
          return json(route, { state: false }, 404)
        })
      },
    })
    await page.goto(OFFICIAL_STORAGE_URL)

    /**
     * ================================================================================
     * 步骤1：复现新版 SPA 先换 DOM、后到接口数据的时序
     * ================================================================================
     * 目标：新目录真实数据到达前，不允许沿用上一目录的详情和预览。
     * 数据源：缺少 pid 的旧目录响应与 SORA、MURIKURI 新目录行。
     * 操作：
     * 1) 切换 URL 和原生文件行，保留旧目录接口缓存
     * 2) 核对插件清空旧增强，不按列表顺序猜测
     */
    await expect(page.locator('[data-115master-row-addon]')).toHaveCount(2)
    await page.locator('[data-file-scroll]').evaluate((node, pageItems) => {
      history.pushState({}, '', '/storage/allfiles?cid=current-directory&mode=wangpan')
      node.innerHTML = pageItems.map(item => `
        <div class="file-list-item" data-file-id="${item.fid}">
          <div class="group relative file-list-item">
            <div class="flex items-center">
              <div class="file-name-responsive" title="${item.n}">${item.n}</div>
              <div class="file-info-responsive">${(item.s / 1024 / 1024 / 1024).toFixed(2)} GB</div>
            </div>
          </div>
        </div>
      `).join('')
    }, currentItems)

    await expect(page.locator('[data-115master-row-addon]')).toHaveCount(0)
    await expect(page.locator('[data-115master-detail], [data-115master-preview]')).toHaveCount(0)

    /**
     * ================================================================================
     * 步骤2：写入当前目录接口数据
     * ================================================================================
     * 目标：身份一致后恢复每个文件自己的详情和预览。
     * 数据源：当前目录 /files 响应。
     * 操作：
     * 1) 触发当前目录原生接口响应
     * 2) 核对 SORA 和 MURIKURI 各自恢复一份增强
     */
    releaseCurrentDirectory()

    const sora = page.locator('[data-115master-row-addon][data-115master-name="SORA-636.mp4"]')
    const murikuri = page.locator('[data-115master-row-addon][data-115master-name="MURIKURI-009.mp4"]')
    await expect(sora.locator('[data-115master-detail]'))
      .toHaveAttribute('data-115master-av-number', 'SORA-636')
    await expect(sora.locator('[data-115master-preview]'))
      .toHaveAttribute('data-115master-pick-code', items[0].pc)
    await expect(murikuri.locator('[data-115master-detail]'))
      .toHaveAttribute('data-115master-av-number', 'MURIKURI-009')
    await expect(murikuri.locator('[data-115master-preview]'))
      .toHaveAttribute('data-115master-pick-code', items[1].pc)
    expect(errors).toEqual([])
  })

  test('SPA 返回父目录时不按相同番号沿用子目录详情', async ({ page }) => {
    const errors = watch(page)
    let releaseParentDirectory: () => void = () => {}
    const parentDirectoryReady = new Promise<void>((resolve) => {
      releaseParentDirectory = resolve
    })
    const childItems = items.slice(0, 2).map(({ pid: _pid, ...item }) => item)
    const parentItems = [
      folder('parent-folder-sora', 'SORA-636ch', '0'),
      {
        ...video('MURIKURI-009.srt', '0'),
        fid: 'parent-subtitle-murikuri',
        iv: 0,
        ico: 'srt',
      },
    ]

    await setupHarness(page, {
      mocks: (api) => {
        api.override(/^https:\/\/115\.com\/storage\/allfiles/, async ({ route, request }) => {
          if (!request.isNavigationRequest())
            return
          await route.fulfill({
            contentType: 'text/html; charset=utf-8',
            headers: { ...CORS, 'origin-agent-cluster': '?0' },
            body: storageHtml(childItems),
          })
          return true
        })
        api.override(FILES_RE, async ({ route, url }) => {
          if ((url.searchParams.get('cid') ?? '0') === '0') {
            await parentDirectoryReady
            return json(
              route,
              filesRes({ cid: '0', name: '看', items: parentItems }, 0, 1150),
            )
          }

          return json(route, {
            ...filesRes({ cid: 'subtitle-directory', name: '字幕', items: childItems }, 0, 1150),
            data: childItems,
          })
        })
        api.override(/^https:\/\/(www\.javbus\.com|www\.javlibrary\.com|javdb\.com|missav\.ws)\//, ({ route }) => {
          return json(route, { state: false }, 404)
        })
      },
    })
    await page.goto(`${OFFICIAL_STORAGE_URL.replace('cid=0', 'cid=subtitle-directory')}`)

    /**
     * ================================================================================
     * 步骤1：复现从字幕返回看时先换 DOM、后到父目录接口数据的时序
     * ================================================================================
     * 目标：稳定文件 ID 不同但番号相同时，不沿用子目录视频详情和预览。
     * 数据源：子目录 SORA、MURIKURI 视频缓存与父目录同番号目录、字幕行。
     * 操作：
     * 1) 返回父目录并替换原生文件行，暂缓父目录接口响应
     * 2) 核对插件立即移除子目录附加区，不按番号跨 ID 绑定
     */
    await expect(page.locator('[data-115master-row-addon]')).toHaveCount(2)
    await page.locator('[data-file-scroll]').evaluate((node, pageItems) => {
      history.pushState({}, '', '/storage/allfiles?cid=0&mode=wangpan')
      node.innerHTML = pageItems.map(item => `
        <div class="file-list-item" data-file-id="${item.fid ?? item.cid}">
          <div class="group relative file-list-item">
            <div class="flex items-center">
              <div class="file-name-responsive" title="${item.n}">${item.n}</div>
              <div class="file-info-responsive">${(item.s / 1024 / 1024 / 1024).toFixed(2)} GB</div>
            </div>
          </div>
        </div>
      `).join('')
      void fetch('https://webapi.115.com/files?aid=1&cid=0&limit=1150&offset=0')
    }, parentItems)

    await expect(page.locator('[data-115master-row-addon]')).toHaveCount(0)
    await expect(page.locator('[data-115master-detail], [data-115master-preview]')).toHaveCount(0)

    /**
     * ================================================================================
     * 步骤2：写入父目录接口数据
     * ================================================================================
     * 目标：父目录身份确认后，只挂载父目录自己的增强。
     * 数据源：父目录 /files 响应。
     * 操作：
     * 1) 释放父目录接口响应
     * 2) 核对附加区稳定 ID 与父目录原生行一致
     */
    releaseParentDirectory()

    const soraFolder = page.locator('[data-115master-row-addon][data-115master-name="SORA-636ch"]')
    const murikuriSubtitle = page.locator('[data-115master-row-addon][data-115master-name="MURIKURI-009.srt"]')
    await expect(soraFolder).toHaveAttribute('data-115master-file-key', 'parent-folder-sora')
    await expect(soraFolder.locator('[data-115master-detail], [data-115master-preview]')).toHaveCount(0)
    await expect(murikuriSubtitle).toHaveAttribute('data-115master-file-key', 'parent-subtitle-murikuri')
    await expect(murikuriSubtitle.locator('[data-115master-detail], [data-115master-preview]')).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test('新版预览开关只控制第二行视频截图', async ({ page }) => {
    const errors = watch(page)
    await setupStorageHarness(page)
    await page.goto(OFFICIAL_STORAGE_URL)

    /**
     * ================================================================================
     * 步骤1：验证新版页面预览开关
     * ================================================================================
     * 目标：关闭预览只移除视频截图行，不影响番号详情。
     * 数据源：新版页面“新建”按钮后的预览按钮与 USER_SETTINGS。
     * 操作：
     * 1) 关闭预览并核对全部截图行卸载
     * 2) 重新开启并核对截图行恢复
     */
    const toggle = page.locator('[data-115master-preview-toggle]')
    const controls = page.locator('[data-115master-controls]')
    const toolbar = page.locator('[data-native-toolbar]')
    const nativeNewAction = page.locator('[data-native-new-action]')
    const launcher = controls.locator('[data-115master-launcher-link]')
    const nativeNew = page.locator('[data-native-new]')
    const soraRow = page.locator('.file-list-item[data-file-id="official-file-1"]')
    const soraNative = soraRow.locator(':scope > .file-list-item > .flex.items-center')
    const sora = page.locator('[data-115master-row-addon][data-115master-name="SORA-636.mp4"]')
    const murikuri = page.locator('[data-115master-row-addon][data-115master-name="MURIKURI-009.mp4"]')
    const nativeHeight = await soraNative.evaluate(row => row.getBoundingClientRect().height)

    await expect(toggle).toBeVisible()
    await expect(controls).toHaveAttribute('data-placement', 'toolbar')
    await expect(controls.locator('xpath=..')).toHaveAttribute('data-native-toolbar', '')
    await expect(controls.locator('xpath=preceding-sibling::*[1]')).toHaveAttribute('data-native-new-action', '')
    await expect(launcher).toBeVisible()
    await expect(toggle.locator('xpath=following-sibling::*[1]'))
      .toHaveAttribute('data-115master-launcher-link', '')
    await expect(toggle.locator('svg')).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await expect(toggle).toHaveAttribute('title', '关闭视频预览')

    /** 1.1 工具组必须与原生按钮同排、等高，不能撑高“新建”外层工具项。 */
    const [toolbarBox, newActionBox, nativeNewBox, controlsBox, toggleBox] = await Promise.all([
      toolbar.boundingBox(),
      nativeNewAction.boundingBox(),
      nativeNew.boundingBox(),
      controls.boundingBox(),
      toggle.boundingBox(),
    ])
    expect(toolbarBox).not.toBeNull()
    expect(newActionBox).not.toBeNull()
    expect(nativeNewBox).not.toBeNull()
    expect(controlsBox).not.toBeNull()
    expect(toggleBox).not.toBeNull()
    expect(controlsBox!.y).toBe(nativeNewBox!.y)
    expect(toggleBox!.height).toBe(nativeNewBox!.height)
    expect(newActionBox!.height).toBe(nativeNewBox!.height)
    expect(toolbarBox!.height).toBe(64)

    // 1.2 关闭预览后，两行详情保留，全部视频截图容器卸载。
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await expect(toggle).toHaveAttribute('title', '开启视频预览')
    await expect(toggle.locator('svg')).toBeVisible()
    await expect(page.locator('[data-115master-preview]')).toHaveCount(0)
    await expect(sora.locator('[data-115master-detail]')).toHaveCount(1)
    await expect(murikuri.locator('[data-115master-detail]')).toHaveCount(1)
    expect(await soraNative.evaluate(row => row.getBoundingClientRect().height)).toBe(nativeHeight)
    await expect.poll(async () => {
      const store = await gmStore(page)
      return (store.USER_SETTINGS as { enableFilelistPreview?: boolean } | undefined)
        ?.enableFilelistPreview
    }).toBe(false)

    // 1.3 重新开启预览后，每个视频恢复一份截图容器。
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('[data-115master-preview]')).toHaveCount(3)
    expect(await soraNative.evaluate(row => row.getBoundingClientRect().height)).toBe(nativeHeight)
    expect(errors).toEqual([])
  })

  test('新版选择文件时顶部操作栏覆盖 Fusion 工具组', async ({ page }) => {
    const errors = watch(page)
    await setupStorageHarness(page)
    await page.goto(OFFICIAL_STORAGE_URL)

    /**
     * ================================================================================
     * 步骤1：验证新版选择态工具栏覆盖
     * ================================================================================
     * 目标：选择文件后，Fusion 保留在顶部原位，由 115 原生批量操作栏覆盖。
     * 数据源：新版“新建”工具项、Fusion 宿主和模拟的选择操作栏。
     * 操作：
     * 1) 隐藏“新建”并显示选择操作栏
     * 2) 核对 Fusion 不回退到右下角且中心点由选择栏命中
     */
    const controls = page.locator('[data-115master-controls]')
    const toolbar = page.locator('[data-native-toolbar]')
    const nativeNewAction = page.locator('[data-native-new-action]')

    await expect(controls).toHaveAttribute('data-placement', 'toolbar')
    await toolbar.evaluate((node) => {
      const toolbar = node as HTMLElement
      toolbar.style.position = 'relative'
      const selection = document.createElement('div')
      selection.setAttribute('data-native-selection-toolbar', '')
      selection.textContent = '下载 移动 删除 取消'
      selection.style.cssText = [
        'position:absolute',
        'z-index:2',
        'inset:0',
        'display:flex',
        'align-items:center',
        'padding:0 10px',
        'box-sizing:border-box',
        'background:#fff',
      ].join(';')
      toolbar.append(selection)
    })
    await nativeNewAction.evaluate((node) => {
      ;(node as HTMLElement).style.display = 'none'
    })

    await expect.poll(() => controls.getAttribute('data-placement')).toBe('toolbar')
    await expect.poll(() => controls.evaluate((host) => {
      const rect = host.getBoundingClientRect()
      const top = host.ownerDocument.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      )
      return Boolean(top?.closest('[data-native-selection-toolbar]'))
    })).toBe(true)
    await expect(controls).toHaveJSProperty('isConnected', true)
    expect(errors).toEqual([])
  })

  test('清理错位详情并等待 React 复用文件行身份同步', async ({ page }) => {
    const errors = watch(page)
    await setupStorageHarness(page)
    await page.goto(OFFICIAL_STORAGE_URL)

    /**
     * ================================================================================
     * 步骤1：验证新版 React 行复用清理
     * ================================================================================
     * 目标：同一 HTMLElement 残留下一文件详情或身份字段未同步时，不显示错误增强。
     * 数据源：SORA 文件行和动态写入的 MURIKURI 遗留容器。
     * 操作：
     * 1) 注入下一文件详情与错误预览，核对自动修正
     * 2) 把同一行复用为 MURIKURI，等待 ID 和完整名称一致后恢复增强
     */
    const soraRow = page.locator('.file-list-item[data-file-id="official-file-1"]')
    const sora = page.locator('[data-115master-row-addon][data-115master-name="SORA-636.mp4"]')

    // 1.1 模拟旧适配器遗留的下一文件详情和错误预览。
    await soraRow.evaluate((row) => {
      const detail = document.createElement('div')
      detail.setAttribute('data-115master-detail', '')
      detail.setAttribute('data-115master-av-number', 'MURIKURI-009')
      const preview = document.createElement('div')
      preview.setAttribute('data-115master-preview', '')
      preview.setAttribute('data-115master-pick-code', 'wrong-pick-code')
      row.append(detail, preview)
    })
    await expect(sora.locator('[data-115master-detail]')).toHaveCount(1)
    await expect(sora.locator('[data-115master-detail]'))
      .toHaveAttribute('data-115master-av-number', 'SORA-636')
    await expect(sora.locator('[data-115master-preview]')).toHaveCount(1)
    await expect(sora.locator('[data-115master-preview]'))
      .toHaveAttribute('data-115master-pick-code', items[0].pc)

    // 1.2 React 只同步 ID 和部分名称时，原 SORA 增强必须先完整移除。
    await page.locator('.file-list-item[data-file-id="official-file-2"]')
      .evaluate(row => row.remove())
    await soraRow.evaluate((row) => {
      row.setAttribute('data-file-id', 'official-file-2')
      const name = row.querySelector<HTMLElement>('.file-name-responsive')
      const info = row.querySelector<HTMLElement>('.file-info-responsive')
      name?.setAttribute('title', 'www.98T.la@shared-restored.mp4')
      if (name)
        name.textContent = 'SORA-636.mp4'
      if (info)
        info.textContent = '7.69 GB'
    })
    const reusedRow = page.locator('.file-list-item[data-file-id="official-file-2"]')
    await expect(reusedRow.locator(':scope > [data-115master-row-addon]')).toHaveCount(0)

    // 1.3 React 完整同步 MURIKURI 名称后，只恢复当前文件增强。
    await reusedRow.evaluate((row) => {
      const name = row.querySelector<HTMLElement>('.file-name-responsive')
      name?.setAttribute('title', 'MURIKURI-009.mp4')
      if (name)
        name.textContent = 'MURIKURI-009.mp4'
    })
    const reused = reusedRow.locator(':scope > [data-115master-row-addon][data-115master-name="MURIKURI-009.mp4"]')
    await expect(reusedRow.locator(':scope > .file-list-item > .flex.items-center [data-115master-detail], :scope > .file-list-item > .flex.items-center [data-115master-preview]')).toHaveCount(0)
    await expect(reused.locator('[data-115master-detail]')).toHaveCount(1)
    await expect(reused.locator('[data-115master-detail]'))
      .toHaveAttribute('data-115master-av-number', 'MURIKURI-009')
    await expect(reused.locator('[data-115master-preview]')).toHaveCount(1)
    await expect(reused.locator('[data-115master-preview]'))
      .toHaveAttribute('data-115master-pick-code', items[1].pc)
    expect(errors).toEqual([])
  })

  test('原生行隐藏后不保留孤立 Fusion 面板', async ({ page }) => {
    const errors = watch(page)
    await setupStorageHarness(page)
    await page.goto(OFFICIAL_STORAGE_URL)

    /**
     * ================================================================================
     * 步骤1：验证隐藏行与 Fusion 面板同步
     * ================================================================================
     * 目标：115 虚拟列表隐藏或回收原生行时，不出现没有对应原生行的额外面板。
     * 数据源：MURIKURI 原生文件行和其相邻 Fusion 附加区。
     * 操作：
     * 1) 隐藏原生行并等待适配器清理附加区
     * 2) 恢复原生行并确认只恢复一份附加区
     */
    const murikuriRow = page.locator('.file-list-item[data-file-id="official-file-2"]')
    const murikuri = page.locator('[data-115master-row-addon][data-115master-name="MURIKURI-009.mp4"]')
    await expect(murikuri).toHaveCount(1)

    // 1.1 模拟新版虚拟列表把原生行移出当前渲染窗口。
    await murikuriRow.evaluate((row) => {
      row.style.display = 'none'
    })
    await expect(murikuri).toHaveCount(0)

    // 1.2 模拟滚回列表后恢复原生行。
    await murikuriRow.evaluate((row) => {
      row.style.display = ''
    })
    await expect(murikuri).toHaveCount(1)
    await expect(murikuri.locator('[data-115master-detail]')).toHaveCount(1)
    await expect(murikuri.locator('[data-115master-preview]')).toHaveCount(1)
    expect(await page.locator('[data-115master-row-addon]').evaluateAll(addons =>
      addons.map(addon => addon.parentElement?.getAttribute('data-file-id')),
    )).toEqual(['official-file-1', 'official-file-2', 'official-file-3'])
    expect(errors).toEqual([])
  })

  test('React 复用行等待稳定 ID 与完整名称同步后恢复', async ({ page }) => {
    const errors = watch(page)
    await setupStorageHarness(page)
    await page.goto(OFFICIAL_STORAGE_URL)

    /**
     * ================================================================================
     * 步骤1：验证新版 React 复用行的身份门禁
     * ================================================================================
     * 目标：React 复用行的 ID 或名称单独变化时，暂不绑定任何详情。
     * 数据源：保留 SORA 文件 ID、但显示 MURIKURI 文件名的原生行。
     * 操作：
     * 1) 先写入 MURIKURI 可见文件名，核对旧 SORA 附加区立即移除
     * 2) 再同步 MURIKURI 稳定 ID，核对当前文件增强恢复
     */
    await page.locator('.file-list-item[data-file-id="official-file-1"]').evaluate((row) => {
      row.setAttribute('data-reused-row', '')
      const name = row.querySelector<HTMLElement>('.file-name-responsive')
      name?.setAttribute('title', 'MURIKURI-009.mp4')
      if (name)
        name.textContent = 'MURIKURI-009.mp4'
    })
    const reusedRow = page.locator('[data-reused-row]')

    await expect(reusedRow.locator(':scope > [data-115master-row-addon]')).toHaveCount(0)
    await expect(page.locator('[data-115master-row-addon][data-115master-name="SORA-636.mp4"]'))
      .toHaveCount(0)

    await reusedRow.evaluate((row) => {
      row.setAttribute('data-file-id', 'official-file-2')
    })
    const murikuri = reusedRow.locator(':scope > [data-115master-row-addon][data-115master-name="MURIKURI-009.mp4"]')
    await expect(murikuri).toHaveCount(1)
    await expect(murikuri.locator('[data-115master-detail]'))
      .toHaveAttribute('data-115master-av-number', 'MURIKURI-009')
    await expect(murikuri.locator('[data-115master-preview]')).toHaveCount(1)
    expect(errors).toEqual([])
  })

  test('新版文件行播放入口使用对应 pick code', async ({ page }) => {
    const errors = watch(page)
    const tabs = watchTabs(page)
    await setupStorageHarness(page)
    await page.goto(OFFICIAL_STORAGE_URL)

    /**
     * ================================================================================
     * 步骤1：验证新版文件行播放链路
     * ================================================================================
     * 目标：新版 DOM 文件名正确映射接口 pick code，并复用 Master 播放入口。
     * 操作：
     * 1) 依次点击 SORA 和 MURIKURI 行的 Master 播放按钮
     * 2) 核对两行各自写入的 pick code 和新标签地址
     */
    const sora = page.locator('[data-115master-row-addon][data-115master-name="SORA-636.mp4"]')
    await expect(sora).toHaveAttribute('data-115master-file-key', items[0].fid)
    await sora.locator('a.master-player').click()

    await expect.poll(async () => {
      const store = await gmStore(page)
      return (store.playingVideoInfo as { pickCode?: string } | undefined)?.pickCode
    }).toBe(items[0].pc)
    await expect.poll(() => tabs.length).toBeGreaterThan(0)
    expect(tabs[0]).toBe(`https://115.com/web/lixian/master/#/video/${items[0].pc}`)

    const murikuri = page.locator('[data-115master-row-addon][data-115master-name="MURIKURI-009.mp4"]')
    await murikuri.locator('a.master-player').click()
    await expect.poll(async () => {
      const store = await gmStore(page)
      return (store.playingVideoInfo as { pickCode?: string } | undefined)?.pickCode
    }).toBe(items[1].pc)
    await expect.poll(() => tabs.length).toBeGreaterThan(1)
    expect(tabs[1]).toBe(`https://115.com/web/lixian/master/#/video/${items[1].pc}`)
    expect(errors).toEqual([])
  })

  test('新版文件名交互兼容单击、双击、中键和文件夹新标签', async ({ page }) => {
    const errors = watch(page)
    const tabs = watchTabs(page)
    const videoItem = {
      ...video('SORA-636.mp4', '0'),
      fid: 'interaction-video',
      pc: 'interaction-pick',
      s: 15612206121,
    }
    const folderItem = folder('interaction-folder', '字幕', '0')
    await setupHarness(page, {
      mocks: (api) => {
        api.override(/^https:\/\/115\.com\/storage\/allfiles/, async ({ route, request }) => {
          if (!request.isNavigationRequest())
            return
          await route.fulfill({
            contentType: 'text/html; charset=utf-8',
            headers: { ...CORS, 'origin-agent-cluster': '?0' },
            body: storageHtml([videoItem, folderItem]),
          })
          return true
        })
        api.override(FILES_RE, ({ route }) => json(route, filesRes({
          cid: '0',
          name: '根目录',
          items: [videoItem, folderItem],
        }, 0, 1150)))
        api.override(/^https:\/\/(www\.javbus\.com|www\.javlibrary\.com|javdb\.com|missav\.ws)\//, ({ route }) => {
          return json(route, { state: false }, 404)
        })
      },
    })
    await page.goto(OFFICIAL_STORAGE_URL)

    /**
     * ================================================================================
     * 步骤1：验证新版文件名交互边界
     * ================================================================================
     * 目标：恢复旧版文件名播放和文件夹中键打开，不拦截行空白区。
     * 数据源：新版原生文件名节点和 Fusion 的 GM_openInTab 记录。
     * 操作：
     * 1) 触发文件名单击、双击和中键
     * 2) 触发文件夹中键并核对目录 cid
     */
    const videoName = page.locator('.file-list-item[data-file-id="interaction-video"] .file-name-responsive')
    const folderName = page.locator('.file-list-item[data-file-id="interaction-folder"] .file-name-responsive')

    await videoName.click()
    await expect.poll(() => tabs.length).toBe(1)
    expect(tabs[0]).toBe('https://115.com/web/lixian/master/#/video/interaction-pick')

    tabs.length = 0
    await videoName.dispatchEvent('dblclick')
    await expect.poll(() => tabs.length).toBe(1)
    expect(tabs[0]).toBe('https://115.com/web/lixian/master/#/video/interaction-pick')

    tabs.length = 0
    await videoName.dispatchEvent('auxclick', { button: 1 })
    await expect.poll(() => tabs.length).toBe(1)
    expect(tabs[0]).toBe('https://115vod.com/?pickcode=interaction-pick&share_id=0')

    tabs.length = 0
    await folderName.dispatchEvent('auxclick', { button: 1 })
    await expect.poll(() => tabs.length).toBe(1)
    expect(tabs[0]).toBe('https://115.com/storage/allfiles?cid=interaction-folder&mode=wangpan')

    tabs.length = 0
    await page.locator('.file-list-item[data-file-id="interaction-video"] > .file-list-item > .flex.items-center').dispatchEvent('click')
    expect(tabs).toEqual([])
    expect(errors).toEqual([])
  })

  test('标签文件页按 URL 标签 ID 补查并挂载增强', async ({ page }) => {
    const errors = watch(page)
    const taggedItem = {
      ...items[0],
      fid: 'tagged-file',
    }
    const tagUrl = 'https://115.com/storage/filetags/tag-10'
    await setupHarness(page, {
      mocks: (api) => {
        api.override(/^https:\/\/115\.com\/storage\/filetags\/tag-10/, async ({ route, request }) => {
          if (!request.isNavigationRequest())
            return
          await route.fulfill({
            contentType: 'text/html; charset=utf-8',
            headers: { ...CORS, 'origin-agent-cluster': '?0' },
            body: storageHtml([taggedItem]),
          })
          return true
        })
        api.override(/^https:\/\/webapi\.115\.com\/files\/search(?:\?|$)/, ({ route, url }) => {
          expect(url.searchParams.get('file_label')).toBe('tag-10')
          return json(route, { state: true, count: 1, data: [taggedItem] })
        })
      },
    })
    await page.goto(tagUrl)

    /*
     * ================================================================================
     * 步骤1：验证标签文件页补查
     * ================================================================================
     * 目标：保留标签条件，不回退成根目录 /files 请求。
     * 数据源：/storage/filetags/tag-10 和 /files/search 响应。
     * 操作：
     * 1) 等待标签文件身份写入
     * 2) 核对对应 Fusion 附加区
     */
    await expect(page.locator('[data-115master-file-key="tagged-file"]')).toHaveCount(1)
    await expect(page.locator('[data-115master-file-key="tagged-file"] [data-115master-detail]'))
      .toHaveAttribute('data-115master-av-number', 'SORA-636')
    expect(errors).toEqual([])
  })

  test('家庭共享内部文件页复用 share_id，根页不挂载', async ({ page }) => {
    const errors = watch(page)
    const sharedItem = {
      ...items[1],
      fid: 'shared-file',
      pid: 'shared-root',
    }
    const shareUrl = 'https://115.com/storage/familyshare/share-1?cid=shared-root'
    await setupHarness(page, {
      mocks: (api) => {
        api.override(/^https:\/\/115\.com\/storage\/familyshare\/share-1/, async ({ route, request }) => {
          if (!request.isNavigationRequest())
            return
          await route.fulfill({
            contentType: 'text/html; charset=utf-8',
            headers: { ...CORS, 'origin-agent-cluster': '?0' },
            body: storageHtml([sharedItem]),
          })
          return true
        })
        api.override(/^https:\/\/webapi\.115\.com\/usershare\/filelist(?:\?|$)/, ({ route, url }) => {
          expect(url.searchParams.get('share_id')).toBe('share-1')
          return json(route, { state: true, count: 1, data: [sharedItem] })
        })
      },
    })
    await page.goto(shareUrl)

    /*
     * ================================================================================
     * 步骤1：验证家庭共享内部文件页
     * ================================================================================
     * 目标：仅在捕获当前 share_id 的文件请求后挂载增强。
     * 数据源：/usershare/filelist 原生只读请求。
     * 操作：
     * 1) 模拟新版页面读取共享文件
     * 2) 触发列表提交并核对增强
     */
    await page.evaluate(async () => {
      await fetch('https://webapi.115.com/usershare/filelist?share_id=share-1&cid=shared-root&offset=0&limit=20')
      document.querySelector('[data-file-scroll]')?.classList.add('shared-ready')
    })
    await expect(page.locator('[data-115master-file-key="shared-file"]')).toHaveCount(1)

    await page.evaluate(() => {
      history.pushState({}, '', '/storage/familyshare')
      document.querySelector('[data-file-scroll]')?.classList.add('share-root')
    })
    await expect(page.locator('[data-115master-row-addon]')).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test('回收站不复用上一页文件详情', async ({ page }) => {
    const errors = watch(page)
    await setupStorageHarness(page)
    await page.goto(OFFICIAL_STORAGE_URL)
    await expect(page.locator('[data-115master-row-addon]')).toHaveCount(3)

    /*
     * ================================================================================
     * 步骤1：验证特殊记录页隔离
     * ================================================================================
     * 目标：SPA 返回回收站时立即卸载上一文件页详情。
     * 数据源：同一批 React 复用行和回收站路由。
     * 操作：
     * 1) 切换路由但保留行 DOM
     * 2) 触发重绘并核对附加区清空
     */
    await page.evaluate(() => {
      history.pushState({}, '', '/storage/recyclebin')
      document.body.classList.add('recycle-ready')
    })
    await expect(page.locator('[data-115master-row-addon]')).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test.describe('115Browser 文件夹下载', () => {
    test.use({
      userAgent: 'Mozilla/5.0 Windows NT 10.0 115Browser/35.0 Chrome/130.0',
    })

    test('新版独立入口创建原生文件夹下载任务', async ({ page }) => {
      const errors = watch(page)
      const folderItem = {
        ...folder('download-folder', '待下载目录', '0'),
        pc: 'folder-pick-code',
        sc: 'folder-shortcut-code',
      }
      await page.addInitScript(() => {
        const target = window as unknown as {
          __folderDownloadTasks: string[]
          browserInterface: { CreateDownloadTask: (payload: string) => void }
        }
        target.__folderDownloadTasks = []
        target.browserInterface = {
          CreateDownloadTask(payload) {
            target.__folderDownloadTasks.push(payload)
          },
        }
      })
      await setupHarness(page, {
        mocks: (api) => {
          api.override(/^https:\/\/115\.com\/storage\/allfiles/, async ({ route, request }) => {
            if (!request.isNavigationRequest())
              return
            await route.fulfill({
              contentType: 'text/html; charset=utf-8',
              headers: { ...CORS, 'origin-agent-cluster': '?0' },
              body: storageHtml([folderItem]),
            })
            return true
          })
          api.override(FILES_RE, ({ route }) => json(route, filesRes({
            cid: '0',
            name: '根目录',
            items: [folderItem],
          }, 0, 1150)))
        },
      })
      await page.goto(OFFICIAL_STORAGE_URL)

      /*
       * ================================================================================
       * 步骤1：验证新版文件夹下载桥
       * ================================================================================
       * 目标：只调用 115Browser 原生接口，不触发网页文件下载。
       * 数据源：Fusion 文件夹行下载按钮和 browserInterface 记录。
       * 操作：
       * 1) 点击插件独立下载入口
       * 2) 解码并核对原生任务字段
       */
      await page.locator('[data-115master-name="待下载目录"] a[menu="download_dir_one"]')
        .dispatchEvent('click')
      await expect.poll(() => page.evaluate(() => (
        window as unknown as { __folderDownloadTasks: string[] }
      ).__folderDownloadTasks)).toHaveLength(1)
      const payload = await page.evaluate(() => {
        const task = (window as unknown as { __folderDownloadTasks: string[] })
          .__folderDownloadTasks[0]
        return JSON.parse(decodeURIComponent(task))
      })
      expect(payload).toEqual({
        list: [{
          n: '待下载目录',
          pc: 'folder-pick-code',
          is_dir: true,
          sc: 'folder-shortcut-code',
        }],
        count: 1,
        ref_url: OFFICIAL_STORAGE_URL,
      })
      expect(errors).toEqual([])
    })
  })

  test('新版演员头像紧邻原生文件名并在重绘后恢复', async ({ page }) => {
    const errors = watch(page)
    await setupHarness(page, {
      mocks: (api) => {
        api.override(/^https:\/\/fastly\.jsdelivr\.net\/gh\/gfriends\/gfriends[^/]*\/Filetree\.json/, ({ route }) =>
          json(route, {
            Content: {
              faces: {
                'SORA-636.mp4.jpg': 'SORA-636.mp4.jpg?t=1',
              },
            },
          }))
        api.override(/^https:\/\/115\.com\/storage\/allfiles/, async ({ route, request }) => {
          if (!request.isNavigationRequest())
            return
          await route.fulfill({
            contentType: 'text/html; charset=utf-8',
            headers: { ...CORS, 'origin-agent-cluster': '?0' },
            body: storageHtml(items),
          })
          return true
        })
        api.override(FILES_RE, ({ route }) => json(route, filesRes({
          cid: '0',
          name: '根目录',
          items,
        }, 0, 1150)))
        api.override(/^https:\/\/(www\.javbus\.com|www\.javlibrary\.com|javdb\.com|missav\.ws)\//, ({ route }) => {
          return json(route, { state: false }, 404)
        })
      },
    })
    await page.goto(OFFICIAL_STORAGE_URL)

    /**
     * ================================================================================
     * 步骤1：验证新版演员头像行内挂载
     * ================================================================================
     * 目标：复现旧版演员头像位置，同时保留独立 Fusion 附加区。
     * 数据源：本地头像数据库响应、新版文件名节点和 Fusion 附加区。
     * 操作：
     * 1) 等待 SORA 头像索引完成
     * 2) 核对头像紧邻文件名且不进入附加区
     * 3) 模拟 React 删除头像并核对自动恢复
     */
    const row = page.locator('.file-list-item[data-file-id="official-file-1"]')
    const sora = page.locator('[data-115master-row-addon][data-115master-name="SORA-636.mp4"]')
    const avatar = row.locator('[data-115master-actress]')
    await expect(avatar).toHaveCount(1)
    await expect(avatar).toHaveAttribute('alt', 'SORA-636.mp4.jpg?t=1')
    await expect(avatar).toHaveCSS('width', '50px')
    await expect(avatar).toHaveCSS('height', '50px')
    await expect(avatar).toHaveCSS('border-radius', '50%')
    await expect(avatar).toHaveCSS('object-fit', 'cover')
    await expect(avatar.locator('xpath=..')).toHaveAttribute('data-115master-actress-host', '')
    await expect(sora.locator('[data-115master-actress]')).toHaveCount(0)
    expect(await row.evaluate(element =>
      element.querySelector('[data-115master-actress]')?.nextElementSibling
      === element.querySelector('.file-name-responsive'),
    )).toBe(true)
    await expect.poll(async () => sora.evaluate(element =>
      element.getBoundingClientRect().height,
    )).toBeLessThan(50)

    await avatar.evaluate(node => node.remove())
    await expect(row.locator('[data-115master-actress]')).toHaveCount(1)
    expect(await row.evaluate(element =>
      element.querySelector('[data-115master-actress]')?.nextElementSibling
      === element.querySelector('.file-name-responsive'),
    )).toBe(true)
    expect(errors).toEqual([])
  })

  test('新版目录切换和加载更多后增强行仍与当前文件对应', async ({ page }) => {
    const errors = watch(page)
    const many = Array.from({ length: 39 }, (_, index) => ({
      ...video(`SAMPLE-${String(index + 1).padStart(3, '0')}.mp4`, '0'),
      fid: `many-file-${index + 1}`,
      pc: `many-pick-${index + 1}`,
    }))
    await setupHarness(page, {
      mocks: (api) => {
        api.override(/^https:\/\/115\.com\/storage\/allfiles/, async ({ route, request }) => {
          if (!request.isNavigationRequest())
            return
          await route.fulfill({
            contentType: 'text/html; charset=utf-8',
            headers: { ...CORS, 'origin-agent-cluster': '?0' },
            body: storageHtml(many.slice(0, 20)),
          })
          return true
        })
        api.override(FILES_RE, ({ route, url }) => json(route, filesRes(
          { cid: '0', name: '根目录', items: many },
          Number(url.searchParams.get('offset') ?? 0),
          Number(url.searchParams.get('limit') ?? 1150),
        )))
        api.override(/^https:\/\/(www\.javbus\.com|www\.javlibrary\.com|javdb\.com|missav\.ws)\//, ({ route }) => {
          return json(route, { state: false }, 404)
        })
      },
    })
    await page.goto(OFFICIAL_STORAGE_URL)

    /**
     * ================================================================================
     * 步骤1：验证新版分页和 React 行复用
     * ================================================================================
     * 目标：加载更多以及第二页重绘后，每条可见原生行只保留自己的 Fusion 附加区。
     * 数据源：39 条目录接口数据和新版虚拟列表 DOM。
     * 操作：
     * 1) 追加第 21 至 39 条文件，核对附加区数量
     * 2) 复用原有行切换到第二页，核对文件 key 和详情番号
     */
    const scroll = page.locator('[data-file-scroll]')
    await expect(page.locator('[data-115master-row-addon]')).toHaveCount(20)
    await scroll.evaluate((node, pageItems) => {
      for (const item of pageItems) {
        const row = document.createElement('div')
        row.className = 'file-list-item'
        row.dataset.fileId = item.fid
        row.innerHTML = `<div class="group relative file-list-item"><div class="flex items-center"><div class="file-name-responsive" title="${item.n}">${item.n}</div><div class="file-info-responsive">${(item.s / 1024 / 1024 / 1024).toFixed(2)} GB</div></div></div>`
        node.append(row)
      }
    }, many.slice(20))
    await expect(page.locator('[data-115master-row-addon]')).toHaveCount(39)

    await scroll.evaluate((node, pageItems) => {
      const rows = Array.from(node.querySelectorAll<HTMLElement>(':scope > .file-list-item'))
      rows.slice(pageItems.length).forEach(row => row.remove())
      pageItems.forEach((item, index) => {
        const row = rows[index]
        row.dataset.fileId = item.fid
        const name = row.querySelector<HTMLElement>('.file-name-responsive')
        const info = row.querySelector<HTMLElement>('.file-info-responsive')
        if (name) {
          name.title = item.n
          name.textContent = item.n
        }
        if (info)
          info.textContent = `${(item.s / 1024 / 1024 / 1024).toFixed(2)} GB`
      })
    }, many.slice(20))
    await expect(page.locator('[data-115master-row-addon]')).toHaveCount(19)
    await expect.poll(() => page.locator('[data-115master-row-addon]').evaluateAll(addons =>
      addons.map(addon => addon.getAttribute('data-115master-file-key')),
    )).toEqual(many.slice(20).map(item => item.fid))
    expect(errors).toEqual([])
  })

  test('新版加载更多切换虚拟列表后仍按真实详情高度重排文件行', async ({ page }) => {
    const errors = watch(page)
    const { pid: _pid, ...crossDirectoryItem } = {
      ...items[1],
      cid: 'nested-video-directory',
    }
    const virtualItems = [items[0], crossDirectoryItem]

    /**
     * ================================================================================
     * 步骤0：模拟真实页面 ResizeObserver 漏报
     * ================================================================================
     * 目标：异步详情改变行高后，即使页面观察器不回调也能写回虚拟列表。
     * 数据源：现场“加载更多”后详情覆盖下一行的真实故障。
     * 操作：
     * 1) 用静默观察器保留接口，但不发送尺寸回调
     * 2) 依赖适配器低频复核修正后续行位置
     */
    await page.addInitScript(() => {
      class SilentResizeObserver {
        disconnect() {}

        observe() {}

        unobserve() {}
      }
      window.ResizeObserver = SilentResizeObserver as unknown as typeof ResizeObserver
    })

    await setupHarness(page, {
      mocks: (api) => {
        api.override(/^https:\/\/115\.com\/storage\/allfiles/, async ({ route, request }) => {
          if (!request.isNavigationRequest())
            return

          await route.fulfill({
            contentType: 'text/html; charset=utf-8',
            headers: { ...CORS, 'origin-agent-cluster': '?0' },
            body: storageVirtualHtml(virtualItems),
          })
          return true
        })
        api.override(FILES_RE, ({ route }) => json(route, filesRes({
          cid: '0',
          name: '看',
          items: [items[0]],
        }, 0, 1150)))
        api.override(/^https:\/\/(www\.javbus\.com|www\.javlibrary\.com|javdb\.com|missav\.ws)\//, ({ route }) => {
          return json(route, { state: false }, 404)
        })
      },
    })
    await page.goto(OFFICIAL_STORAGE_URL)

    /**
     * ================================================================================
     * 步骤1：验证跨目录虚拟行身份和动态行高
     * ================================================================================
     * 目标：目录接口没有第二条视频时，仍从 React 行取得真实 fid 和 pick code。
     * 数据源：76px 固定步长虚拟行、普通目录响应和 React props 文件对象。
     * 操作：
     * 1) 核对两行都使用旧版行内详情、预览和操作栏
     * 2) 核对 115 虚拟列表按真实行高移动下一文件并更新总高度
     */
    const rows = page.locator('.file-list-item[data-file-id]')
    const secondAddon = page.locator(
      '[data-115master-row-addon][data-115master-file-key="official-file-2"]',
    )
    await expect(rows).toHaveCount(2)
    await expect(page.locator('[data-115master-row-addon][data-115master-view="virtual-list"]')).toHaveCount(2)
    await expect(secondAddon).toHaveCount(1)

    /** 1.1 虚拟列表不再创建逐文件 Fusion 入口或独立详情面板。 */
    await expect(page.locator('[data-115master-grid-toggle]')).toHaveCount(0)
    await expect(page.locator('[data-115master-grid-panel]')).toHaveCount(0)

    /** 1.2 第二行详情、预览、播放和下载都直接属于本文件附加区。 */
    await expect(secondAddon.locator('[data-115master-detail]'))
      .toHaveAttribute('data-115master-av-number', 'MURIKURI-009')
    await expect(secondAddon.locator('[data-115master-preview]'))
      .toHaveAttribute('data-115master-pick-code', 'official-pick-2')
    await expect(secondAddon.locator('a.master-player')).toHaveText('▶️ Master 播放')
    await expect(secondAddon.locator('a[class="115-player"]')).toHaveText('5️⃣ 官方播放')
    await expect(secondAddon.locator('a[menu="download_one"]')).toHaveText('下载')
    await expect.poll(() => secondAddon.locator('[data-115master-detail]').evaluate(detail => Boolean(detail.shadowRoot))).toBe(true)
    await expect.poll(() => secondAddon.locator('[data-115master-preview]').evaluate(preview => Boolean(preview.shadowRoot))).toBe(true)

    /** 1.3 模拟资料返回后附加区异步变高，且不依赖 ResizeObserver 回调。 */
    await page.locator('[data-115master-row-addon]').first().evaluate((addon) => {
      const delayedContent = document.createElement('div')
      delayedContent.setAttribute('data-delayed-detail-height', '')
      delayedContent.style.height = '120px'
      addon.append(delayedContent)
    })

    /** 1.4 第一行真实高度写回虚拟列表后，第二行必须位于其下方。 */
    await expect.poll(async () => rows.evaluateAll((nodes) => {
      const first = nodes[0].getBoundingClientRect()
      const second = nodes[1].getBoundingClientRect()
      return second.top - first.bottom
    })).toBeGreaterThanOrEqual(0)
    const layout = await rows.evaluateAll(nodes => nodes.map(node => ({
      height: node.getBoundingClientRect().height,
      transform: getComputedStyle(node).transform,
    })))
    expect(layout[0].height).toBeGreaterThan(76)
    expect(layout[1].transform).not.toBe('matrix(1, 0, 0, 1, 0, 76)')
    expect(await page.locator('[data-file-spacer]').evaluate(node =>
      node.getBoundingClientRect().height,
    )).toBeGreaterThan(152)
    expect(errors).toEqual([])
  })

  test('新版面包屑同步 document.title，不添加返回按钮', async ({ page }) => {
    const errors = watch(page)
    await setupStorageHarness(page)
    await page.goto(OFFICIAL_STORAGE_URL)
    await expect(page).toHaveTitle('根目录')

    await page.locator('[data-native-breadcrumb]').evaluate((node) => {
      node.innerHTML = '<button type="button" title="根目录">根目录</button><button type="button" title="看">看</button><button type="button" title="字幕">字幕</button>'
    })
    await expect(page).toHaveTitle('字幕 < 看')

    await page.evaluate(() => {
      document.title = '根目录'
    })
    await expect(page).toHaveTitle('字幕 < 看')
    await expect(page.locator('.master-back-button')).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test('115 个视频时详情按视口挂载且原生列表仍可滚动到底', async ({ page }) => {
    const errors = watch(page)
    const many = Array.from({ length: 115 }, (_, index) => ({
      ...video(`SAMPLE-${String(index + 1).padStart(3, '0')}.mp4`, '0'),
      fid: `many-file-${index + 1}`,
      pc: `many-pick-${index + 1}`,
    }))

    await setupHarness(page, {
      mocks: (api) => {
        api.override(/^https:\/\/115\.com\/storage\/allfiles/, async ({ route, request }) => {
          if (!request.isNavigationRequest())
            return

          await route.fulfill({
            contentType: 'text/html; charset=utf-8',
            headers: { ...CORS, 'origin-agent-cluster': '?0' },
            body: storageHtml(many),
          })
          return true
        })
        api.override(FILES_RE, ({ route, url }) => {
          return json(route, filesRes(
            { cid: '0', name: '根目录', items: many },
            Number(url.searchParams.get('offset') ?? 0),
            Number(url.searchParams.get('limit') ?? 1150),
          ))
        })
        api.override(/^https:\/\/(www\.javbus\.com|www\.javlibrary\.com|javdb\.com|missav\.ws)\//, ({ route }) => {
          return json(route, { state: false }, 404)
        })
      },
    })
    await page.goto(OFFICIAL_STORAGE_URL)

    /**
     * ================================================================================
     * 步骤1：验证长列表布局和滚动
     * ================================================================================
     * 目标：115 个文件都保留原生行，只有视口附近详情创建 Vue 和 Shadow DOM。
     * 操作：
     * 1) 核对原生行、附加区和已挂载详情数量
     * 2) 滚动到底并确认末行按需挂载
     */
    await expect(page.locator('.file-list-item[data-file-id]')).toHaveCount(115)
    await expect(page.locator('.file-list-item:not([data-file-id])')).toHaveCount(115)
    await expect(page.locator('[data-115master-row-addon]')).toHaveCount(115)
    await expect(page.locator('[data-115master-row-addon] .skeleton')).toHaveCount(0)
    await expect(page.locator('.file-list-item:not([data-file-id]) > .flex.items-center [data-115master-detail], .file-list-item:not([data-file-id]) > .flex.items-center [data-115master-preview]')).toHaveCount(0)
    const initiallyMounted = await page.locator('[data-115master-detail]').evaluateAll(details =>
      details.filter(detail => Boolean(detail.shadowRoot)).length,
    )
    expect(initiallyMounted).toBeGreaterThan(0)
    expect(initiallyMounted).toBeLessThan(30)
    expect(await page.locator('[data-115master-detail]').evaluateAll(details =>
      details.filter(detail => detail.shadowRoot).every(detail =>
        detail.shadowRoot!.adoptedStyleSheets.length === 1
        && detail.shadowRoot!.querySelectorAll('style').length === 0,
      ),
    )).toBe(true)

    const scroll = page.locator('[data-file-scroll]')
    await scroll.evaluate((node) => {
      node.scrollTop = node.scrollHeight
    })
    await expect(page.locator('.file-list-item[data-file-id="many-file-115"]')).toBeVisible()
    await expect.poll(async () => await page.locator('[data-115master-file-key="many-file-115"] [data-115master-detail]').evaluate(detail => Boolean(detail.shadowRoot))).toBe(true)
    expect(await page.locator('.file-list-item:not([data-file-id]) > .flex.items-center').evaluateAll(rows =>
      Math.max(...rows.map(row => row.getBoundingClientRect().height)),
    )).toBeLessThan(100)
    expect(errors).toEqual([])
  })

  test('新版网格使用小型入口打开独立详情与预览层', async ({ page }) => {
    const errors = watch(page)
    await setupHarness(page, {
      mocks: (api) => {
        api.override(/^https:\/\/115\.com\/storage\/allfiles/, async ({ route, request }) => {
          if (!request.isNavigationRequest())
            return
          await route.fulfill({
            contentType: 'text/html; charset=utf-8',
            headers: { ...CORS, 'origin-agent-cluster': '?0' },
            body: storageGridHtml(items),
          })
          return true
        })
        api.override(FILES_RE, ({ route }) => json(route, filesRes({
          cid: '0',
          name: '根目录',
          items,
        }, 0, 1150)))
        api.override(/^https:\/\/(www\.javbus\.com|www\.javlibrary\.com|javdb\.com|missav\.ws)\//, ({ route }) => {
          return json(route, { state: false }, 404)
        })
      },
    })
    await page.goto(OFFICIAL_STORAGE_URL)

    /**
     * ================================================================================
     * 步骤1：验证新版网格增强布局
     * ================================================================================
     * 目标：卡片保持原尺寸，详情与预览在插件独立层中共存。
     * 数据源：三个 110px 原生网格卡片。
     * 操作：
     * 1) 核对每张卡片只有一个 Fusion 图标入口
     * 2) 打开 SORA 面板并核对详情、预览和关闭状态
     */
    const cards = page.locator('.file-grid-item[data-file-id]')
    const soraCard = page.locator('.file-grid-item[data-file-id="official-file-1"]')
    await expect(cards).toHaveCount(3)
    await expect(page.locator('[data-115master-row-addon][data-115master-view="grid"]')).toHaveCount(3)
    await expect(page.locator('[data-115master-grid-toggle]')).toHaveCount(3)
    await expect(page.locator('[data-115master-grid-anchor]')).toHaveCount(3)
    expect(await soraCard.evaluate(node => ({
      height: node.getBoundingClientRect().height,
      width: node.getBoundingClientRect().width,
      position: getComputedStyle(node).position,
    }))).toEqual({ height: 110, width: 110, position: 'relative' })

    /** 1.1 每个按钮必须落在所属卡片内，且三张卡片不能共享同一坐标。 */
    const togglePositions = await cards.evaluateAll(cardNodes => cardNodes.map((card) => {
      const cardBox = card.getBoundingClientRect()
      const toggleBox = card.querySelector('[data-115master-grid-toggle]')!.getBoundingClientRect()
      return {
        key: `${toggleBox.x}:${toggleBox.y}`,
        inside: toggleBox.left >= cardBox.left
          && toggleBox.right <= cardBox.right
          && toggleBox.top >= cardBox.top
          && toggleBox.bottom <= cardBox.bottom,
      }
    }))
    expect(new Set(togglePositions.map(item => item.key)).size).toBe(3)
    expect(togglePositions.every(item => item.inside)).toBe(true)

    const toggle = soraCard.locator('[data-115master-grid-toggle]')
    const panel = page.locator('[data-115master-grid-panel][data-115master-file-key="official-file-1"]')
    await expect(panel.locator('[data-115master-detail]')).toHaveCount(0)
    await expect(panel.locator('[data-115master-preview]')).toHaveCount(0)
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(panel).toBeVisible()
    await expect(panel.locator('[data-115master-detail]')).toHaveCount(1)
    await expect(panel.locator('[data-115master-detail]')).toHaveAttribute('data-115master-av-number', 'SORA-636')
    await expect(panel.locator('[data-115master-preview]')).toHaveCount(1)
    await expect(panel.locator('[data-115master-preview]')).toHaveAttribute('data-115master-pick-code', 'official-pick-1')
    await expect(panel.locator('a.master-player')).toHaveText('▶️ Master 播放')
    await expect(panel.locator('a[class="115-player"]')).toHaveText('5️⃣ 官方播放')
    await expect.poll(() => panel.locator('[data-115master-detail]').evaluate(detail => Boolean(detail.shadowRoot))).toBe(true)
    await expect.poll(() => panel.locator('[data-115master-preview]').evaluate(preview => Boolean(preview.shadowRoot))).toBe(true)
    await expect(panel.getByText('未找到番号 [SORA-636] 信息')).toBeVisible()

    await panel.locator('[data-115master-grid-close]').click()
    await expect(panel).toBeHidden()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(errors).toEqual([])
  })

  test('新版星标页按跨目录文件范围挂载增强', async ({ page }) => {
    const errors = watch(page)
    const starred = {
      ...items[0],
      fid: 'starred-file',
      pc: 'starred-pick',
      pid: '987654321',
    }
    let requestedStar = ''
    await setupHarness(page, {
      mocks: (api) => {
        api.override(/^https:\/\/115\.com\/storage\/starredfiles/, async ({ route, request }) => {
          if (!request.isNavigationRequest())
            return
          await route.fulfill({
            contentType: 'text/html; charset=utf-8',
            headers: { ...CORS, 'origin-agent-cluster': '?0' },
            body: storageHtml([starred]),
          })
          return true
        })
        api.override(FILES_RE, ({ route, url }) => {
          requestedStar = url.searchParams.get('star') ?? ''
          return json(route, filesRes({
            cid: '0',
            name: '星标文件',
            items: [starred],
          }, 0, 1150))
        })
        api.override(/^https:\/\/(www\.javbus\.com|www\.javlibrary\.com|javdb\.com|missav\.ws)\//, ({ route }) => {
          return json(route, { state: false }, 404)
        })
      },
    })
    await page.goto('https://115.com/storage/starredfiles')

    /**
     * ================================================================================
     * 步骤1：验证新版星标页数据范围
     * ================================================================================
     * 目标：父目录不等于 cid=0 的星标文件仍取得自己的详情。
     * 数据源：带 pid=987654321 的星标视频。
     * 操作：
     * 1) 核对补查请求包含 star=1
     * 2) 核对附加区绑定真实文件 ID 和番号
     */
    const addon = page.locator('[data-115master-row-addon][data-115master-file-key="starred-file"]')
    await expect(addon).toHaveCount(1)
    await expect(addon.locator('[data-115master-detail]')).toHaveAttribute('data-115master-av-number', 'SORA-636')
    expect(requestedStar).toBe('1')
    expect(errors).toEqual([])
  })

  test('新版无 URL 搜索参数时按原生搜索请求挂载增强', async ({ page }) => {
    const errors = watch(page)
    const searchItem = {
      ...items[1],
      fid: 'official-search-file',
      pc: 'official-search-pick',
      pid: 'search-parent',
    }
    const searchRequests: string[] = []
    await page.addInitScript(() => {
      const resourceNames: string[] = []
      const nativeFetch = window.fetch.bind(window)
      const nativeGetEntriesByType = performance.getEntriesByType.bind(performance)

      window.fetch = async (...args) => {
        const response = await nativeFetch(...args)
        const input = args[0]
        resourceNames.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
        return response
      }
      Object.defineProperty(performance, 'getEntriesByType', {
        configurable: true,
        value: (type: string) => {
          const entries = nativeGetEntriesByType(type)
          return type === 'resource'
            ? [
                ...entries,
                ...resourceNames.map(name => ({ name }) as PerformanceEntry),
              ]
            : entries
        },
      })
    })
    await setupHarness(page, {
      mocks: (api) => {
        api.override(/^https:\/\/115\.com\/storage\/allfiles/, async ({ route, request }) => {
          if (!request.isNavigationRequest())
            return
          await route.fulfill({
            contentType: 'text/html; charset=utf-8',
            headers: { ...CORS, 'origin-agent-cluster': '?0' },
            body: storageHtml([searchItem]),
          })
          return true
        })
        api.override(/^https:\/\/webapi\.115\.com\/files\/search(?:\?|$)/, ({ route, url }) => {
          searchRequests.push(url.href)
          return json(route, {
            state: true,
            count: 1,
            data: [searchItem],
            offset: 0,
          })
        })
        api.override(FILES_RE, ({ route }) => json(route, filesRes({
          cid: '0',
          name: '根目录',
          items: [],
        }, 0, 1150)))
        api.override(/^https:\/\/(www\.javbus\.com|www\.javlibrary\.com|javdb\.com|missav\.ws)\//, ({ route }) => {
          return json(route, { state: false }, 404)
        })
      },
    })
    await page.goto(OFFICIAL_STORAGE_URL)

    /**
     * ================================================================================
     * 步骤1：验证新版原生搜索请求识别
     * ================================================================================
     * 目标：搜索词只存在于 /files/search 请求时仍绑定当前跨目录结果。
     * 数据源：URL 无搜索参数的文件页和一次原生搜索请求。
     * 操作：
     * 1) 发出页面原生搜索请求并触发 React 风格重绘
     * 2) 核对适配器使用相同搜索词补查并绑定真实文件 ID
     */
    console.info('[e2e] 开始核对无 URL 参数的新版原生搜索请求')

    /** 1.1 等首屏空目录补查结束，避免测试伪造的搜索与启动请求互相覆盖。 */
    await expect(page.locator('html'))
      .toHaveAttribute('data-115master-official-fallback-state', 'complete')
    await expect(page.locator('[data-115master-row-addon]')).toHaveCount(0)

    /** 1.2 发出原生搜索请求，并用无业务副作用的 class 变化触发列表复查。 */
    await page.evaluate(async () => {
      await fetch('https://webapi.115.com/files/search?aid=1&cid=0&search_value=MURIKURI-009&offset=0&limit=115')
      document.body.classList.toggle('native-search-finished')
    })
    expect(await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name)))
      .toContain('https://webapi.115.com/files/search?aid=1&cid=0&search_value=MURIKURI-009&offset=0&limit=115')

    const addon = page.locator('[data-115master-row-addon][data-115master-file-key="official-search-file"]')
    await expect(addon).toHaveCount(1)
    await expect(addon.locator('[data-115master-detail]'))
      .toHaveAttribute('data-115master-av-number', 'MURIKURI-009')
    expect(searchRequests.some(request => new URL(request).searchParams.get('search_value') === 'MURIKURI-009')).toBe(true)
    console.info('[e2e] 无 URL 参数的新版原生搜索请求核对完成')
    expect(errors).toEqual([])
  })

  test('新版保留原生云下载入口且不添加重复插件按钮', async ({ page }) => {
    const errors = watch(page)
    await setupHarness(page, {
      mocks: (api) => {
        api.override(/^https:\/\/115\.com\/storage\/allfiles/, async ({ route, request }) => {
          if (!request.isNavigationRequest())
            return
          await route.fulfill({
            contentType: 'text/html; charset=utf-8',
            headers: { ...CORS, 'origin-agent-cluster': '?0' },
            body: storageHtml(items).replace(
              '<main id="new-storage-root">',
              '<main id="new-storage-root"><a data-native-cloud-download href="/storage/clouddownload">云下载</a>',
            ),
          })
          return true
        })
        api.override(FILES_RE, ({ route }) => json(route, filesRes({
          cid: '0',
          name: '根目录',
          items,
        }, 0, 1150)))
        api.override(/^https:\/\/(www\.javbus\.com|www\.javlibrary\.com|javdb\.com|missav\.ws)\//, ({ route }) => {
          return json(route, { state: false }, 404)
        })
      },
    })
    await page.goto(OFFICIAL_STORAGE_URL)

    /**
     * ================================================================================
     * 步骤1：验证新版云下载入口归属
     * ================================================================================
     * 目标：使用 115 新版原生云下载，不重复增加插件入口。
     * 数据源：新版页面原生 /storage/clouddownload 链接。
     * 操作：
     * 1) 核对原生入口地址和数量保持不变
     * 2) 核对 Fusion 工具组仍只有预览与 Fusion 两项
     */
    await expect(page.locator('[data-native-cloud-download]')).toHaveCount(1)
    await expect(page.locator('[data-native-cloud-download]'))
      .toHaveAttribute('href', '/storage/clouddownload')
    await expect(page.locator('[data-115master-cloud-download]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /视频预览/ })).toHaveCount(1)
    await expect(page.getByRole('link', { name: '打开 115Master Fusion' })).toHaveCount(1)
    expect(errors).toEqual([])
  })

  test('新版目录往返恢复各自滚动位置', async ({ page }) => {
    const errors = watch(page)
    const rootItems = Array.from({ length: 12 }, (_, index) => ({
      ...video(`ROOT-${String(index + 1).padStart(3, '0')}.mp4`, '0'),
      fid: `root-${index + 1}`,
      pc: `root-pick-${index + 1}`,
      s: 1024,
    }))
    const childItems = Array.from({ length: 12 }, (_, index) => ({
      ...video(`CHILD-${String(index + 1).padStart(3, '0')}.mp4`, 'child'),
      fid: `child-${index + 1}`,
      pc: `child-pick-${index + 1}`,
      s: 1024,
    }))
    await setupHarness(page, {
      mocks: (api) => {
        api.override(/^https:\/\/115\.com\/storage\/allfiles/, async ({ route, request }) => {
          if (!request.isNavigationRequest())
            return
          await route.fulfill({
            contentType: 'text/html; charset=utf-8',
            headers: { ...CORS, 'origin-agent-cluster': '?0' },
            body: storageHtml(rootItems).replace(
              'style="height: 600px; overflow-y: auto"',
              'style="height: 180px; overflow-y: auto"',
            ).replaceAll('class="file-list-item" data-file-id=', 'style="min-height: 80px" class="file-list-item" data-file-id='),
          })
          return true
        })
        api.override(FILES_RE, ({ route, url }) => {
          const routeItems = url.searchParams.get('cid') === 'child' ? childItems : rootItems
          return json(route, filesRes({
            cid: url.searchParams.get('cid') ?? '0',
            name: '目录',
            items: routeItems,
          }, 0, 1150))
        })
        api.override(/^https:\/\/(www\.javbus\.com|www\.javlibrary\.com|javdb\.com|missav\.ws)\//, ({ route }) => {
          return json(route, { state: false }, 404)
        })
      },
    })
    await page.goto(OFFICIAL_STORAGE_URL)

    /**
     * ================================================================================
     * 步骤1：验证新版滚动历史
     * ================================================================================
     * 目标：同一滚动容器在 SPA 目录往返时恢复各目录独立位置。
     * 数据源：根目录和 child 目录各十二个文件。
     * 操作：
     * 1) 保存根目录和 child 目录的位置
     * 2) 返回根目录并核对恢复值
     */
    const scroll = page.locator('[data-file-scroll]')
    await expect(page.locator('[data-115master-row-addon]')).toHaveCount(12)
    await scroll.evaluate((node) => {
      node.scrollTop = 240
    })
    await page.waitForTimeout(100)

    await page.evaluate((nextItems) => {
      history.pushState({}, '', '/storage/allfiles?cid=child&mode=wangpan')
      const scrollBox = document.querySelector<HTMLElement>('[data-file-scroll]')!
      scrollBox.scrollTop = 0
      scrollBox.innerHTML = nextItems.map(item => `
        <div style="min-height: 80px" class="file-list-item" data-file-id="${item.fid}">
          <div class="group relative file-list-item"><div class="flex items-center">
            <div class="file-name-responsive" title="${item.n}">${item.n}</div>
            <div class="file-info-responsive">1 KB</div>
          </div></div>
        </div>
      `).join('')
      window.dispatchEvent(new PopStateEvent('popstate'))
    }, childItems)
    await expect(page.locator('[data-115master-row-addon][data-115master-file-key="child-1"]')).toHaveCount(1)
    await scroll.evaluate((node) => {
      node.scrollTop = 160
    })
    await page.waitForTimeout(100)

    await page.evaluate((nextItems) => {
      history.pushState({}, '', '/storage/allfiles?cid=0&mode=wangpan')
      const scrollBox = document.querySelector<HTMLElement>('[data-file-scroll]')!
      scrollBox.scrollTop = 0
      scrollBox.innerHTML = nextItems.map(item => `
        <div style="min-height: 80px" class="file-list-item" data-file-id="${item.fid}">
          <div class="group relative file-list-item"><div class="flex items-center">
            <div class="file-name-responsive" title="${item.n}">${item.n}</div>
            <div class="file-info-responsive">1 KB</div>
          </div></div>
        </div>
      `).join('')
      window.dispatchEvent(new PopStateEvent('popstate'))
    }, rootItems)
    await expect(page.locator('[data-115master-row-addon][data-115master-file-key="root-1"]')).toHaveCount(1)
    await expect.poll(() => scroll.evaluate(node => node.scrollTop)).toBe(240)
    expect(errors).toEqual([])
  })
})
