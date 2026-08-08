<div align="center">

<p><img src="./apps/monkey/src/assets/logo-wordmark.svg" alt="115Master Fusion" width="500" /></p>

[![GitHub Release](https://img.shields.io/github/v/release/daoran9/115master?include_prereleases&logo=github)](https://github.com/daoran9/115master/releases)
[![GitHub Downloads](https://img.shields.io/github/downloads/daoran9/115master/115master-fusion.user.js?logo=github)](https://github.com/daoran9/115master/releases)
[![License](https://img.shields.io/github/license/daoran9/115master)](LICENSE)

</div>

`115Master Fusion` 基于上游未发布的 v2 分支，融合旧版增强功能。脚本使用独立名称、namespace 和更新源，不会被官方 `115Master` 自动更新覆盖。

当前版本：`2.0.0-beta.1`。

## 使用前

请停用官方 `115Master`。两个脚本会接管相同页面，不能同时运行。

运行环境：

- Chrome 130+ 或 115Browser 35+
- Tampermonkey 5.3.3+ 或 ScriptCat
- 浏览器扩展开发者模式已开启

安装文件：[`115master-fusion.user.js`](https://github.com/daoran9/115master/releases/latest/download/115master-fusion.user.js)

## 功能

### 新版 115 页面

- 匹配全部 `https://115.com/*` 页面
- 右下角显示隔离的 MASTER 入口
- 入口不依赖官方 DOM 类名
- 新版单页应用重绘页面后自动恢复入口
- 点击后打开独立 MASTER 文件管理器

### MASTER 文件管理器

- 列表和卡片视图
- 路径导航、全局搜索、分页、排序和滚动位置恢复
- 多选、框选、拖拽移动和右键菜单
- 新建文件夹、置顶、星标、移动、重命名、标签和删除
- Magnet 离线任务
- 视频封面、番号资料和演员头像
- 图片及文件夹预览
- 浅色、深色和跟随系统主题

### 播放器

- Ultra 原画和多画质切换
- 视频缩略图
- 115、迅雷和 SubtitleCat 字幕
- IINA 唤起
- 播放列表和连续播放
- 剧院模式，默认快捷键 `V`
- 全屏和画中画
- 自定义快捷键
- 旋转、翻转和视频色彩调整
- JavDB、JavBus 影片详情
- 文件星标、移动、重命名和删除

### 旧版官方页面

检测到旧版文件列表 DOM 时，继续加载原注入式增强：

- 文件视频封面
- 番号资料
- 演员头像
- MASTER 播放和 IINA 播放
- 单文件下载
- 文件夹中键新标签页打开
- 路径标题、返回目录和滚动位置记忆

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
