# 115Master 正常浏览器测试桥

该工具让正常启动的 115Browser 接受本机只读验收命令，不需要
`--remote-debugging-port`，也不创建另一个浏览器配置。

测试桥匹配所有普通 HTTP(S) 顶层标签页，便于同时核对 115 和外部资料源。
浏览器内部页、扩展页、新标签页和其他受保护页面不属于用户脚本可读范围。

测试桥是独立 Tampermonkey 脚本。默认关闭，不修改 115Master 生产脚本。
控制端只监听 `127.0.0.1`，每次启动生成随机令牌。
控制端允许后台标签页最长两分钟没有轮询，兼容 Chromium 后台计时器节流。

## 首次连接

1. 在 Tampermonkey 安装 `115master-live-bridge.user.js`。更新测试桥时使用同一脚本名称，Tampermonkey 会保留连接配置。
2. 启动控制端：

   ```powershell
   node .\scripts\live-browser-bridge\bridge.mjs serve
   ```

3. 在正常启动的 115Browser 中打开 Tampermonkey 菜单。
4. 点击“115Master：连接本机测试桥”。
5. 粘贴控制端输出的 `connectionCode`，页面会刷新一次。

## 常用命令

```powershell
# 查看已连接的新旧页面
node .\scripts\live-browser-bridge\bridge.mjs clients

# 读取新版页面完整状态
node .\scripts\live-browser-bridge\bridge.mjs status --url /storage/allfiles

# 查询 Shadow DOM 内的预览按钮
node .\scripts\live-browser-bridge\bridge.mjs query `
  --url /storage/allfiles `
  --selector "[data-115master-controls] >>> [data-115master-preview-toggle]"

# 触发播放器悬停，让自动隐藏的控制栏进入可见态
node .\scripts\live-browser-bridge\bridge.mjs hover `
  --url "#/video/" `
  --selector "[data-video-player-shell]"

# 读取真实媒体进度、暂停状态、解码尺寸和缓冲区
node .\scripts\live-browser-bridge\bridge.mjs media-status `
  --url "#/video/"

# 用正常浏览器的 Tampermonkey 会话探测 JavLibrary
node .\scripts\live-browser-bridge\bridge.mjs probe-javlibrary `
  --url /storage/allfiles `
  --av-number SORA-636

# 在已通过 Cloudflare 的资料源标签内测试第一方同源请求
node .\scripts\live-browser-bridge\bridge.mjs fetch-same-origin `
  --url javlibrary.com `
  --to "https://www.javlibrary.com/cn/vl_searchbyid.php?keyword=SORA-636"

# 用 Tampermonkey Blob 与 Canvas 路径验证资料源封面
node .\scripts\live-browser-bridge\bridge.mjs probe-image `
  --url /storage/allfiles `
  --to "https://fourhoi.com/jac-068/cover-n.jpg" `
  --referer "https://missav.ws/dm26/cn/JAC-068"

# 只清除 Fusion 番号详情和详情图片缓存
node .\scripts\live-browser-bridge\bridge.mjs clear-fusion-detail-cache `
  --url /storage/allfiles

# 关闭本机控制端
node .\scripts\live-browser-bridge\bridge.mjs stop
```

## 本地自动更新

测试桥的更新地址固定为：

```text
http://127.0.0.1:11531/updates/bridge.meta.js
http://127.0.0.1:11531/updates/bridge.user.js
```

发布当前 Fusion 构建的本地更新副本：

```powershell
node .\scripts\live-browser-bridge\bridge.mjs publish-fusion
```

该命令读取 `dist/115master-fusion.user.js`，只改输出副本的
`@updateURL` 和 `@downloadURL`。正式构建文件保持不变。本地端点为：

```text
http://127.0.0.1:11531/updates/fusion.meta.js
http://127.0.0.1:11531/updates/fusion.user.js
```

`--url` 是当前标签 URL 的匹配片段。存在新旧两个页面时必须带该参数，避免
命令发给错误标签。

## 边界

- 导航命令只接受 `115.com` 和 `dl.115cdn.net`。
- 资料源请求只接受 JavLibrary、JavBus、JavDB、MissAV。
- 不提供任意 JavaScript 执行命令。
- 不提供上传、下载、删除、移动或重命名命令。
- 清缓存命令只处理 `115master_cache` 的 `jav_cache`、`image_cache` 及对应元数据。
- 断开时用 Tampermonkey 菜单“115Master：断开本机测试桥”。
