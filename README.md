<div align="center">

<p><img src="./apps/monkey/src/assets/logo-wordmark.svg" alt="115Master Fusion" width="500" /></p>

[![GitHub Release](https://img.shields.io/github/v/release/daoran9/115master?include_prereleases&logo=github)](https://github.com/daoran9/115master/releases)
[![GitHub Downloads](https://img.shields.io/github/downloads/daoran9/115master/115master-fusion.user.js?logo=github)](https://github.com/daoran9/115master/releases)
[![License](https://img.shields.io/github/license/daoran9/115master)](LICENSE)

</div>

`115Master Fusion` 基于上游未发布的 v2 分支，融合旧版增强功能。脚本使用独立名称、namespace 和更新源，不会被官方 `115Master` 自动更新覆盖。

当前版本：`2.0.0-beta.83`。

## 使用前

请停用官方 `115Master`。两个脚本会接管相同页面，不能同时运行。

运行环境：

- Chrome 130+ 或 115Browser 35+
- Tampermonkey 5.3.3+ 或 ScriptCat
- 浏览器扩展开发者模式已开启

JavLibrary 或 FD2PPV 启用 Cloudflare 挑战时，须先在安装脚本的同一浏览器打开对应站点并完成人工验证。脚本会复用该站点的 Cookie 分区；它无法代替用户完成 Cloudflare 验证。若当前网络无法直连来源站点，须给该域名配置单域代理或自有 HTTPS 中转；脚本不能在无可用网络路由时绕过站点限制。

安装文件：[`115master-fusion.user.js`](https://github.com/daoran9/115master/releases/latest/download/115master-fusion.user.js)

## 功能

### 新版 115 页面

- 匹配全部 `https://115.com/*` 页面
- 适配 `https://115.com/storage/allfiles` 原生文件列表
- 只增强带稳定文件 ID 的外层文件行，忽略115内部同名嵌套行
- 原生文件名、按钮和事件保持不变；Fusion 独立容器挂在对应原生行末尾并随行复用
- “新建”按钮后的 Fusion 工具组提供预览开关和独立文件页入口
- 工具图标随脚本离线打包；找不到新版工具栏时才回退到浮动位置
- 详情和预览拿到真实内容后才展开，不显示永久占位的灰色骨架
- 识别长前缀、数字前缀和恢复文件尾标记，按完整 `前缀-数字` 令牌提取番号
- 新版 DOM 的文件 ID 与完整名称一致后才绑定；切目录字段尚未同步时先隐藏增强
- 缺少文件 ID 时才按完整名称、大小或唯一番号匹配，不跨 ID 沿用同番号详情
- 自动清理 React 复用后遗留的上一文件详情、预览和操作栏
- 原生行隐藏或回收后自动清理所属 Fusion 容器和 beta.6-beta.9 遗留的兄弟面板
- Fusion 附加区提供 Master 播放、115 官方播放和单文件下载
- 文件名单击、双击打开 Fusion 播放器；视频中键打开 115 播放器；文件夹中键在新标签打开
- 演员头像只显示在 Fusion 附加区，不写入 115 原生文件名和操作区
- 面包屑变化后同步浏览器标题，不添加旧版返回按钮
- 加载更多、分页和 React 文件行复用后自动重绑当前文件
- 新版绝对定位虚拟列表沿用行内详情和预览，并把实际高度回报给 115 自带的虚拟列表重排
- 视频等跨目录筛选直接读取当前 React 行的真实文件对象，补齐播放码和文件身份
- 网格视图使用卡片内小型 Fusion 图标打开独立详情层，不改变原生卡片尺寸
- 网格详情层同时支持番号资料、视频预览、播放和单文件下载
- 星标页按跨目录数据补查并绑定真实文件 ID；操作记录和回收站保持原生布局
- 目录、搜索、星标和列表/网格视图分别记忆本次会话的滚动位置
- 通过只读目录补查补齐新版 DOM 未暴露的文件信息，不覆盖 115 原生 `fetch`
- 新版已有原生云下载和面包屑，不重复添加插件按钮

### MASTER 文件管理器

- 列表和卡片视图
- 路径导航、全局搜索、分页、排序和滚动位置恢复
- 多选、框选、拖拽移动和右键菜单
- 新建文件夹、置顶、星标、移动、重命名、标签和删除
- Magnet 离线任务
- 视频封面、番号资料和演员头像
- 普通番号依次使用 JavLibrary、JavBus、JavDB、MissAV；FC2 优先使用 FD2PPV
- 图片预览，可连续浏览同目录图片
- 浅色、深色和跟随系统主题

### 播放器

- Ultra 原画和多画质切换
- 视频缩略图
- 115 内置/上传、迅雷、SubtitleCat、AVSubtitles 和爱译网字幕
- IINA 唤起
- 播放列表和连续播放
- 剧院模式，默认快捷键 `V`
- 全屏和画中画
- 自定义快捷键
- 旋转、翻转和视频色彩调整
- JavDB、JavBus、JavLibrary 和 FD2PPV 影片详情
- 文件星标和移动

### 旧版官方页面

检测到旧版文件列表 DOM 时，继续加载原注入式增强：

- 文件视频封面
- 番号资料
- 演员头像
- MASTER 播放和 IINA 播放
- 单文件下载
- 文件夹中键新标签页打开
- 路径标题、返回目录和滚动位置记忆

旧版和新版页面都加载 Fusion 详情、视频预览、演员头像、播放和单文件下载。新版原生文件列表只增加 Fusion 自有入口和独立面板，不改动原生行布局；旧版继续使用原注入式行内增强。

## 增强开关

在 `偏好设置 -> 增强` 中可分别控制：

- 文件视频封面
- 番号资料
- 演员头像
- 播放页影片详情

开关保存在 Tampermonkey 的 `USER_SETTINGS` 中。旧版页面增强会实时卸载或重新挂载。

## 固定入口

MASTER 文件管理器：

```text
https://115.com/web/lixian/master/#/drive
```

播放器：

```text
https://115.com/web/lixian/master/#/video/<pick_code>
```

## 开发

```bash
pnpm install --frozen-lockfile
pnpm type-check
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
```

构建产物：

```text
apps/monkey/dist/115master-fusion.user.js
apps/monkey/dist/115master-fusion.meta.js
```

## 上游与许可

上游项目：[cbingb666/115master](https://github.com/cbingb666/115master)

原作者：[@cbingb666](https://github.com/cbingb666)

Fusion 维护：[@daoran9](https://github.com/daoran9)

项目继续使用 [MIT](LICENSE) 许可证。原项目赞助入口保留给原作者。

## 免责声明

本软件仅供技术研究、学习和交流。使用者应遵守当地法律法规、115 服务条款和第三方权益要求，并自行承担使用风险。
