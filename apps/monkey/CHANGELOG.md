# @115master/monkey

## 2.0.0-beta.83

### Patch Changes

- 修复播放器切换影片资料标签后演员头像回落到 MissAV 的问题；补齐 gfriends CDN 请求权限，已命中 gfriends 的演员不再查询或采用 MissAV 头像，单个失败头像也只查询对应演员。

## 2.0.0-beta.82

### Patch Changes

- 播放器演员头像固定按 gfriends 文件列表头像库、JavDB/JavBus 等影片资料源、MissAV 排序；演员名出现后主动读取 gfriends，MissAV 只在前两级图片全部失败后按需兜底。

## 2.0.0-beta.81

### Patch Changes

- MissAV 番号页演员短名或旧链接没有头像时，改用播放器完整姓名搜索唯一演员卡片；兼容“白川ゆず/白川柚子”等写法，并继续拒绝多结果猜测。

## 2.0.0-beta.80

### Patch Changes

- 修复 MissAV 演员页把站点 Logo 误当头像的问题；现在读取页面真实演员头像，并在同一番号只有一个候选时兼容来源省略姓氏的演员名。

## 2.0.0-beta.79

### Patch Changes

- 播放器现有演员头像全部失败后，按当前番号和精确演员名从 MissAV 演员页补头像；请求复用 MissAV Cookie 分区，成功映射按演员名长期缓存，不增加可见资料标签或文件列表批量请求。

## 2.0.0-beta.78

### Patch Changes

- 播放器当前资料源的剧照被 Cloudflare 拦截时，现在会按同一序号自动尝试 JavBus、JavLibrary 等已加载来源的图片；JavDB 详情无需手动切标签即可显示可用剧照。

## 2.0.0-beta.77

### Patch Changes

- 修复 Tampermonkey 图片请求不回调时演员头像和预览图永久加载的问题；图片加载器现在会独立超时、中止卡住的 GM 请求，并继续原图或原生图片回退。
- 播放器预览图单候选超时缩短为 3 秒，避免缩略图失效时整个预览区长时间显示骨架屏。

## 2.0.0-beta.76

### Patch Changes

- 修复播放器详情预览图只请求缩略图的问题；现在依次尝试缩略图、原图和无 Referer 原生图片，全部失败后才移除对应剧照格。
- 预览图 GM 请求复用详情来源的 Cookie 分区，兼容需要来源会话的图片域名。

## 2.0.0-beta.75

### Patch Changes

- 修复播放器普通模式和剧院模式的演员头像、封面及剧照加载；演员页优先作为头像 Referer，旧详情缓存无需清除即可恢复真实头像，失败图片会自动回退或隐藏。
- 剧院模式改为页面流中的全宽首屏播放器，保留一屏观看区域，同时允许向下滚动查看完整影片详情。

## 2.0.0-beta.74

### Patch Changes

- 修复播放器 JavDB 演员头像和剧照在 115 页面内被防盗链拦截的问题；图片统一带详情页 Referer 请求，剧照优先缩略图，失败剧照自动退出网格，演员头像失败时显示默认头像。
- 修复新版 115 加载更多后 React 把完整文件名放进内层 `title` 节点时增强无法恢复的问题；详情、预览和操作栏会自动重挂载且保持单份。
- 旧版 115 大目录的视频预览改为视口附近懒挂载；300 行目录不再同时创建数百个 Shadow DOM 和 Vue 应用，滚动后按需加载。

## 2.0.0-beta.73

### Patch Changes

- 无品牌词的 MyFans 账号文件不再被识别为普通番号；`ティアくん(tiakun_404)…` 和 `五条ライ(raikun325)…` 不再生成错误详情面板。

## 2.0.0-beta.72

### Patch Changes

- 移除 MyFansDB 资料源、MyFans 文件识别和 `fans` 目录隐式查询，避免账号尾号误走普通番号来源。
- 保留 FC2 PPV 的 FD2PPV 优先来源、封面域名和 Cookie 分区支持。

## 2.0.0-beta.71

### Patch Changes

- 修复旧版 115 在列表初始化早于页面标题同步时，`fans` 目录中的无账号描述型视频无法识别 MyFans 详情的问题；现在优先读取旧版面包屑最后一级目录。
- 普通目录、字幕文件和 `719.mp4` 等纯数字短文件仍不会启用隐式 MyFans 查询。

## 2.0.0-beta.70

### Patch Changes

- 修复 MyFans 括号账号被普通番号规则误判的问题；`(banbi_555)`、`(tiakun_404)` 等现在优先按创作者账号和文件标题查询 MyFansDB。
- 修复 `restored_prob43`、`restored_iris31` 等下载尾标被误判成 `PROB-43`、`IRIS-31` 的问题。
- 新旧 115 的 `fans` 专用目录中，无账号、无 MyFans 品牌标记的描述型视频会按大概文件名查询；纯数字短文件名仍跳过。

## 2.0.0-beta.69

### Patch Changes

- 修复 MyFans 文件名含下载来源说明时短词仍过长、候选评分被附加文字拉低的问题；现在取首段作品名匹配，并固定用八字符前缀补查。
- 现场故障文件“肉便器堕ち59人目なな … myfans”已加入回归样本。

## 2.0.0-beta.68

### Patch Changes

- 修复 MyFansDB 完整标题因站点分词规则返回零结果时详情缺失的问题；完整标题无可靠候选后，会用短标题前缀补查，再按完整文件名评分。
- MyFans 文件中含账号时仍强制核对创作者；短词只扩大召回，不会绕过标题置信度和创作者门禁。

## 2.0.0-beta.67

### Patch Changes

- 修复无账号 MyFans 文件把品牌词写在文件名末尾时无法识别或只搜索“マイファンズ”的问题；现在从完整文件名剥离品牌、恢复批次和来源标记后，再按实际标题匹配帖子。
- MyFans 仍优先按大概文件名召回；文件中有账号时再核对创作者，没有账号时只采用高置信标题结果。

## 2.0.0-beta.66

### Patch Changes

- FC2 PPV 文件优先使用 FD2PPV 详情，读取标题、日期、时长、卖家、演员、标签、封面和预览图。
- MyFans 文件先按大概文件名搜索帖子；文件中有账号时再核对创作者。无账号文件也可按高置信标题匹配，同账号不同文件使用独立缓存键，低置信结果只回退创作者资料。
- 文件列表和 Fusion 播放器都接入 FD2PPV、MyFansDB；补齐来源页面、封面域名、Cookie 分区和本机测试桥白名单。

## 2.0.0-beta.65

### Patch Changes

- 新版 115 的演员头像恢复旧版 50×50 圆形裁切外观；头像仍只挂在 Fusion 附加区，不改动原生文件行。

## 2.0.0-beta.64

### Patch Changes

- 新版 115 改写浏览器标题后，Fusion 会按当前面包屑重新恢复目录标题。

## 2.0.0-beta.63

### Patch Changes

- 新版 115 的演员头像改为 40×40 小圆角完整缩放，不再用圆形裁掉竖图主体。
- 旧版 115 继续使用 50×50 圆形头像，不改变原有列表效果。

## 2.0.0-beta.62

### Patch Changes

- 修复旧版 115 文件列表把女优头像按原图尺寸显示的问题；头像恢复为 50×50，列表行状态类也回到正确节点。
- 新版列表和网格附加区继续使用 40×40 头像，不写入或挤压 115 原生文件行。

## 2.0.0-beta.61

### Patch Changes

- 字幕融合 115 内置/上传、迅雷、SubtitleCat、AVSubtitles 和爱译网；外部来源按来源名隔离七天缓存。
- 番号视频统一使用标准番号查询字幕，迅雷保留原始文件名与时长、指纹评分；同番号和时长接近的结果优先。
- 相似番号不再按字符串包含关系误判，`JAC-0890` 等冲突字幕不会混入 `JAC-089`。
- AVSubtitles 支持会话下载页和 ZIP 解包；字幕菜单来源、预览、下载和实际渲染均纳入自动化回归。

## 2.0.0-beta.60

### Patch Changes

- 允许读取 JavDB 当前使用的 `c0.jdbstatic.com` 及其子域封面，修复详情正常但冷缓存封面全部失败。
- 图片加载失败原因写入只读诊断属性，现场可区分请求、解码和浏览器显示错误。

## 2.0.0-beta.59

### Patch Changes

- 允许读取 MissAV 当前使用的 `fourhoi.com` 封面，修复 `JAC-068` 等 MissAV 详情正常但封面加载失败。
- 无码整理标签后的三位恢复序号不再并入番号；`[无码破解]390JAC-072` 和 `【无码流出】483SGK-079` 分别识别为 `JAC-072`、`SGK-079`。

## 2.0.0-beta.58

### Patch Changes

- 旧版页面在后台标签大跨度滚动时立即检查视口附近详情，不再同时受 `requestAnimationFrame` 和定时器节流而长期留空面板。

## 2.0.0-beta.57

### Patch Changes

- 已显示的番号详情只要番号精确且具备标题和封面，就写入融合缓存；缺少演员、导演或分类时刷新页面也能立即恢复。
- JavBus、JavDB、MissAV 等后备来源的可展示缓存与 JavLibrary 一样直接复用，不再因来源优先级重复联网。

## 2.0.0-beta.56

### Patch Changes

- 刷新页面时立即复用已缓存的完整融合详情，不再因上次采用 JavBus 等后备来源而重复等待 JavLibrary。
- 冷缓存详情并发从两个番号调整为三个，JavLibrary 首选等待窗口缩短到 5 秒；首屏后续面板不再按 12 秒一批累积排队。
- JavLibrary 超时取消会中断已启动的 GM 请求，避免旧目录请求继续占用浏览器和来源连接。
- 后台轮询同时检查节点几何位置；目录切换或 115 原生列表重排未改变 `scrollTop` 时，进入视口附近的详情仍会自动挂载。

## 2.0.0-beta.55

### Patch Changes

- 恢复文件的三位顺序号不再并入番号；`390JAC-089`、`483SGK-079` 分别还原为 `JAC-089`、`SGK-079`，合法数字系列仍保留。
- 同一文件名出现多个番号候选时选择位置最靠前的结果，`NCYF-014` 不再被标题中的 `140CM-18` 覆盖。
- MissAV 兼容当前 Open Graph 页面结构；JavLibrary、JavBus 无结果时仍能返回精确番号、标题和封面。
- 详情保留同源单页图及低优先级来源封面，主封面加载失败后自动尝试后备图片。

## 2.0.0-beta.54

### Patch Changes

- 预加载兜底改为观察滚动位置变化，不再依赖 `document.hidden` 或滚动事件；115 恢复列表位置但未派发事件时，后续番号详情仍会自动挂载。

## 2.0.0-beta.53

### Patch Changes

- 后台标签增加低频预加载坐标检查；浏览器完全省略滚动事件时，进入视口附近的番号详情和视频预览仍会自动挂载。

## 2.0.0-beta.52

### Patch Changes

- 新旧版页面的滚动预加载增加后台定时器兜底；标签页退到后台且 `requestAnimationFrame` 暂停时，滚入范围的番号详情和视频预览仍会挂载，不再依赖刷新页面。

## 2.0.0-beta.51

### Patch Changes

- 冷缓存详情每页最多同时加载两个番号，后续番号排队复用空闲槽；避免首屏同时启动几十条跨站请求，导致本可用的 JavLibrary、JavBus 和 JavDB 响应整体超时。

## 2.0.0-beta.50

### Patch Changes

- 根据正常 115Browser 现场时延分层等待资料源：JavLibrary 保留 12 秒第一优先窗口，JavBus 再保留 8 秒回退窗口，避免 10–15 秒的有效响应被提前丢弃。

## 2.0.0-beta.49

### Patch Changes

- 旧版和新版列表增加共享滚动预加载兜底；后台标签暂停 `IntersectionObserver` 时，滚到文件附近仍会挂载详情。
- 番号详情只增强真实视频文件，文件夹、ISO 和非视频文件不再生成错误面板。
- 修正恢复文件中的粘连番号，`hnd00134hhb`、`migd00781` 和 `wanz00665` 分别识别为 `HND-134`、`MIGD-781` 和 `WANZ-665`，并忽略社交账号尾号。
- JavLibrary 保留第一优先级，但单个来源最多等待 5 秒；超时后采用已经完成的 JavBus 或 JavDB 详情，并释放 JavLibrary 工作队列。

## 2.0.0-beta.48

### Patch Changes

- 新版 115 虚拟列表增加低频高度复核；详情异步变高但 `ResizeObserver` 未回调时，也会重新排列后续文件行。
- 清除文件名外层的 `[url]...[/url]` 标签后再提取番号，`MUDR-278` 不再被站点前缀误识别为 `WWW-98`。

## 2.0.0-beta.47

### Patch Changes

- 将下载站文件名前导序号 `1TANF-006` 还原为真实番号 `TANF-006`，不影响三位数字开头的无码系列。

## 2.0.0-beta.46

### Patch Changes

- 修正字幕时间码的小数解析，`37.100` 不再被误算为 `37.001`。
- 增加字幕轨只读诊断属性，并补充播放时间进入、离开 cue 的推进测试。

## 2.0.0-beta.45

### Patch Changes

- 兼容迅雷真实 SRT 的 CRLF 换行，修复部分字幕整份解析为空、显示时有时无。
- 快速切换字幕时丢弃较慢的旧加载结果，避免字幕名称与实际文本串轨。
- 迅雷字幕按当前视频时长辅助排序，更接近片长的同番号字幕优先。
- 查看和下载恢复为原新版的圆形图标按钮，并保留边框、底色和悬浮提示。

## 2.0.0-beta.44

### Patch Changes

- 播放器字幕首次加载时自动启用排序后的 No.1；用户明确选择或关闭字幕后，列表刷新仍保留该状态。
- 字幕查看和下载改为带文字的高对比按钮，点击操作不再误触字幕切换。

## 2.0.0-beta.43

### Patch Changes

- 播放器字幕先按当前视频番号匹配，再按文件名相似度排序；115 上传字幕中的同番号条目不再排在无关字幕后面。

## 2.0.0-beta.42

### Patch Changes

- 番号后紧跟单字母版本标记或 `ver` 时仍保留完整番号，修复 `MIRD-150J`、`TMY-004ver` 和 `TMY-013ver` 详情缺失。

## 2.0.0-beta.41

### Patch Changes

- 新版 115 在后台刷新时按列表几何位置即时挂载首屏附近详情，不再等待可能被浏览器暂停的 `IntersectionObserver` 回调。
- 远处详情继续按 600px 预加载范围懒加载，避免大目录一次请求全部番号。

## 2.0.0-beta.40

### Patch Changes

- JavLibrary worker 只在 `/cn/` 主页运行，普通详情页不再同时抢占任务。
- 延长后台 worker 心跳宽限，115 刷新后不再因标签计时器降频重复打开 JavLibrary 主页。

## 2.0.0-beta.39

### Patch Changes

- JavLibrary 跨标签结果增加 GM 存储轮询兜底；Tampermonkey 偶发漏发值变更事件时，失败回退和后续详情不再整批卡住。
- 识别 `BF-304RQ～标题` 这类番号后紧接全大写标题缩写的文件名。

## 2.0.0-beta.38

### Patch Changes

- 新版文件列表扫描不再依赖后台标签会暂停的动画帧；刷新、切页和筛选后即使 115 不在前台也能挂载详情与预览。
- JavLibrary 工作页成功完成任务后清除上一条失败诊断，现场状态不再混合新旧结果。

## 2.0.0-beta.37

### Patch Changes

- JavLibrary 第一方工作页增加不可见的版本、心跳、当前任务和最近结果诊断属性，便于在正常浏览器中确认 worker 是否真实注入并处理请求。

## 2.0.0-beta.36

### Patch Changes

- JavLibrary 第一方工作页与 GM 分区请求改为延迟并发，工作队列阻塞时仍能及时显示精确详情。
- JavLibrary 工作队列增加遗留槽位回收和任务取消，页面刷新后不再永久卡住后续番号。
- JavLibrary 第一方工作页支持从搜索结果继续请求精确详情页，并限制单次请求占槽时间。

## 2.0.0-beta.35

### Patch Changes

- 允许读取 JavLibrary 使用的 DMM 封面和重定向图片域名，修复详情资料正常但封面显示“图片加载失败”。

## 2.0.0-beta.34

### Patch Changes

- 新版文件列表适配器增加启动和扫描异常诊断，现场页面可区分尚未扫描与扫描报错。
- 扫描异常只写入插件诊断属性，不修改 115 原生列表或请求链路。

## 2.0.0-beta.33

### Patch Changes

- 新版工具组在浮动回退后有限次数复查“新建”按钮，补足首屏工具栏晚挂载且不再触发 DOM 变化的时序空档。
- 新版文件适配增加只读现场诊断状态，不包装 115 原生 `fetch`，用于定位真实页面首屏补查和文件身份匹配故障。

## 2.0.0-beta.32

### Patch Changes

- JavLibrary 新增后台第一方工作页，复用正常页面会话读取详情，避开 GM 跨域 Cloudflare Cookie 分区失败。
- JavLibrary 详情解析增加页面标题和错误识别码字段兜底，兼容现场标题节点为空、识别码返回日期的页面结构。
- JavLibrary 工作任务按单标签串行处理，减少大目录同时请求造成的页面和网络拥塞。

## 2.0.0-beta.31

### Patch Changes

- JavLibrary 跨域请求绑定 `https://javlibrary.com` 顶层 Cookie 分区，复用正常浏览时签发的 Cloudflare 会话。
- JavLibrary 请求记录 HTTP 状态和 Cloudflare 挑战页判定，便于在普通启动的 115Browser 中核对真实回退原因。

## 2.0.0-beta.30

### Patch Changes

- 番号提取先做 Unicode 兼容规范化，清除零宽字符，并把不同横线统一为 `-`。
- 复核真实 FC2 与无码文件名，兼容 `FC2PPV- 4818259-C`、`PGD​​-934` 等格式，避免不可见字符导致详情缺失。

## 2.0.0-beta.29

### Patch Changes

- 区分真实数字前缀与文件名杂质：保留 `1TANF-006`、`345SIMM-729`，把 `1YMDD-322`、`1NHDTB-922` 还原为 `YMDD-322`、`NHDTB-922`。
- 真实新版 `否` 目录复核时发现并修正上述边界，避免详情源因多出的 `1` 无法命中。

## 2.0.0-beta.28

### Patch Changes

- 番号提取改为完整令牌匹配，兼容 `345SIMM-729`、`390JAC-086` 等数字前缀，以及恢复文件附带的 `B`、`D`、`M`、`hhb`、`mp4` 等尾标记。
- 收紧前后边界，避免从长前缀或普通哈希中截取局部番号；FC2、HEYZO、Tokyo-Hot、日期型番号和长前缀继续按专用规则识别。
- JavLibrary、JavBus、JavDB、MissAV 的缓存、网络响应和融合字段统一核对完整番号；相似番号结果不再显示或写入当前番号缓存。
- JavDB 搜索页只打开精确番号卡片，避免默认采用相似结果第一项。

## 2.0.0-beta.27

### Patch Changes

- 收紧麻豆 `MD` 系列番号规则，避免把 `MDHR-001` 截断成 `MD-001` 并加载错误详情。
- 新旧 115 页面继续共用同一番号提取规则，旧错误缓存不会被新番号键继续命中。

## 2.0.0-beta.26

### Patch Changes

- 新版普通列表和“加载更多”后的虚拟列表统一恢复旧版行内详情、预览、演员、播放和下载表现，不再要求逐文件打开 Fusion 独立面板。
- 行内详情和预览高度通过 115 自带的 TanStack Virtual `resizeItem` 接口回报，后续视频和总滚动高度随内容动态重排，修复 `beta.23` 的详情与下一视频重叠。
- 作者 v2、顶部 Fusion 入口和网格独立详情层继续保留，作为独立能力及后续可选显示模式，不替代新旧 115 页面主线。

## 2.0.0-beta.25

### Patch Changes

- 旧版和新版 115 页面继续共用同一套 Fusion 详情、预览、演员、播放和下载能力；旧版保留原注入式 UI，新版只在独立面板首次打开后加载资料模块。
- 修复新版虚拟列表详情面板初始隐藏导致详情组件不挂载、没有资料源请求的问题。
- 修复新版搜索页在 URL 没有搜索参数时无法识别原生 `/files/search` 请求的问题，避免跨目录视频详情空白。
- 修复新版面板内演员区与详情、预览横向挤压；加载更多和 React 行复用后继续按当前文件 ID 清理旧面板。

## 2.0.0-beta.24

### Patch Changes

- 新版绝对定位虚拟列表改用行内小型 Fusion 入口和独立详情层，详情、预览不再撑高原生行或覆盖下一视频。
- 视频等跨目录筛选从当前 React 文件行补齐真实 `fid`、`pick_code` 和文件名，加载更多后仍能绑定当前文件。
- 目录补查签名加入原生请求地址，分页不再因服务端返回条数小于请求上限而提前停止。

## 2.0.0-beta.23

### Patch Changes

- 番号详情源优先级调整为 JavLibrary、JavBus、JavDB、MissAV。
- 高优先级来源缺少封面、演员或分类时，用后续来源补齐，不覆盖 JavLibrary 已有字段。
- 新增融合详情缓存；只有具备番号、标题和封面的完整结果才长期缓存。

## 2.0.0-beta.22

### Patch Changes

- JavLibrary 的成人确认 Cookie 改为合并到浏览器 Cookie 集，不再覆盖 Cloudflare 人工验证生成的 `cf_clearance`。
- JavLibrary 仍受站点 Cloudflare 挑战约束；遇到 403 时须在同一浏览器完成一次人工验证。

## 2.0.0-beta.21

### Patch Changes

- 大目录的番号详情改为视口附近按需挂载；115 个视频不再同时创建 115 个 Vue 应用和 Shadow DOM。
- 同一文档内的详情组件共享构造样式表，避免每行重复解析约 210 KB 样式。
- 四个资料源缓存改为并行读取；慢源等待时提前启动下一源，但结果仍严格遵循 JavBus、JavLibrary、JavDB、MissAV 优先级。
- 相同番号的并发查询合并为一次外部请求。

## 2.0.0-beta.20

### Patch Changes

- 番号详情源优先级调整为 JavBus、JavLibrary、JavDB、MissAV；缓存和联网回退使用同一顺序。

## 2.0.0-beta.19

### Patch Changes

- 修复真实 115 新版网格卡片没有定位上下文时，所有 Fusion 入口重叠到同一坐标的问题。
- 旧版顶层浮动兼容入口只保留 Fusion；文件预览继续使用 iframe 内真实开关，并同步提示和选中状态。
- 中日文标题改为保留番号边界，兼容 `ENKI-049` 后接标题数字；资料源异常继续回退且不再抛出页面错误。

## 2.0.0-beta.18

### Minor Changes

- 新增 JavLibrary 番号资料源，支持标题、日期、时长、导演、演员、片商、发行商、系列、类别、评分、封面及预览图。
- JavLibrary 通过用户脚本跨域请求和独立站点解析器接入；搜索结果严格匹配完整番号，避免相似番号串数据。
- MASTER、新旧版 115 文件详情把 JavLibrary 加入回退来源，播放器增加独立 JavLibrary 页签。
- 官方新版页面不再因提前加载 MASTER Hash Router 而被追加 `#/`；Windows MPV 协议改用符合 URI 规范的 `master115-mpv://`。

## 2.0.0-beta.17

### Minor Changes

- 新版文件适配同时识别列表和网格；网格卡片只增加小型 Fusion 图标，详情、预览、播放和下载放在独立面板中，不挤压原生卡片。
- 新版星标页按跨目录范围补查真实文件信息，搜索页使用专用搜索接口；操作记录和回收站不强套文件增强。
- 新版目录、搜索、星标及列表/网格视图分别保存会话内滚动位置，SPA 往返时恢复对应位置。
- 大目录补查支持分页，并按当前 DOM 文件 ID 和名称重新补查同目录变化；继续保持 115 原生 `fetch` 不变。

## 2.0.0-beta.16

### Patch Changes

- 修复从“字幕”返回“看”时，父目录同番号文件短暂显示子目录视频详情的问题。
- 新版文件行存在稳定 ID 时必须同时核对文件 ID 和完整名称；字段尚未同步时先移除详情与预览，数据一致后再恢复。
- 保留长文件名截断显示兼容，并增加反向切目录及 React 行复用回归。

## 2.0.0-beta.15

### Patch Changes

- 生产构建内联所有动态模块，不再把 `__monkey.entry-*` 误解析到 115 新版页面的 `/_next` 目录。
- 消除该回退请求引起的 404、`text/plain` MIME 和 SystemJS Error #3，同时保留单文件用户脚本。

## 2.0.0-beta.14

### Patch Changes

- 修正 `SORA-636ch`、`YMDD-502` 和 `1TANF-006` 的番号边界，避免从前缀中间截断或丢失开头数字。

## 2.0.0-beta.13

### Patch Changes

- 新版 SPA 切目录时不再按旧接口顺序猜测文件，避免详情面板显示相邻文件内容。
- 文件 ID、番号、完整名称或同名文件大小尚未同步时先保持折叠，数据一致后再挂详情与预览。
- 移除新版页面启动时无关的拖拽图标联网预热，消除 115 CSP 拦截 Iconify 在线接口的报错。

## 2.0.0-beta.12

### Minor Changes

- 新版 `/storage/allfiles` 补齐旧版演员头像、文件夹中键和文件名播放模块。
- 文件名单击、双击打开 Fusion 播放器；视频中键打开 115 官方播放器；文件夹中键在新标签打开。
- 新版交互只绑定文件名，不拦截复选框、行空白、拖拽和原生操作区。
- 演员头像只挂在 Fusion 附加区，不修改 115 原生文件名 DOM。
- 新版面包屑按旧版规则同步 `document.title`，不添加重复的返回按钮。
- 增加加载更多、第二页和 React 行复用回归，确保每个可见文件只保留一份对应增强。

## 2.0.0-beta.11

### Patch Changes

- 按115当前真实源码补齐双层 `.file-list-item` 结构测试。
- 只增强带 `data-file-id` 的外层文件行，忽略同一文件内部没有 ID 的同名嵌套行。
- 修复同一文件出现两组 Master 播放、两份详情，以及外层误绑定下一文件的问题。

## 2.0.0-beta.10

### Patch Changes

- 对比 beta.2-beta.9 后确认，beta.6 引入的行外兄弟面板是重复显示的来源。
- Fusion 独立容器恢复挂到对应原生行末尾，随 React 行一起复用；原生文件名、按钮和事件保持不变。
- 自动清理 beta.6-beta.9 遗留的兄弟面板和附加区外旧详情，防止同一文件同时显示两块面板。
- 保留 beta.9 的可见番号优先、稳定 ID 防串行和隐藏行清理。

## 2.0.0-beta.9

### Patch Changes

- 修复新版列表隐藏或回收原生文件行后残留额外 Fusion 面板的问题。
- 监听新版行的隐藏属性和可见布局，只为当前可见原生行保留一份相邻附加区。
- 忽略 Fusion 附加区内部异步内容变化，避免详情或预览加载触发重复扫描。
- 原生行可见番号优先于复用行残留的 `data-file-id`，避免 SORA 与 MURIKURI 详情错位。
- 稳定 ID 已被当前行占用时不再回退绑定到另一条文件。

## 2.0.0-beta.8

### Patch Changes

- 修复工具组误插入“新建”下拉容器导致原生工具栏被撑成两行的问题。
- 工具组改为跟随“新建”的顶层工具项，并与上传、新建按钮保持同排、等高。
- 预览和 Fusion 按钮缩为 32px 高、14px 字号，降低工具栏占用。

## 2.0.0-beta.7

### Patch Changes

- 预览开关和 Fusion 入口合并为插件工具组，优先显示在新版“新建”按钮后面。
- 眼睛、关闭预览和 Fusion 图标改为脚本内置 Ionicons，不再依赖在线图标接口。
- 工具按钮改为与 115 原生工具栏一致的白底、细边框和紧凑选中态；窄屏或找不到工具栏时保留浮动兜底。

## 2.0.0-beta.6

### Patch Changes

- 新版适配改为只读原生文件行，详情、预览、播放和下载全部挂到插件自有附加区。
- 视频预览开关改为 `body` 下的独立 Shadow DOM 浮钮，不再查找或修改 115 原生工具栏。
- 新版详情和预览未拿到真实内容前保持折叠，不再显示永久占位的灰色骨架。
- 关闭预览只卸载插件截图区，番号详情和 115 原生文件行保持不变。

## 2.0.0-beta.5

### Patch Changes

- 取消启动阶段对 115 原生 `fetch` 的覆盖，改用适配器目录补查，避免干扰新版 React 首屏加载。
- 全页 DOM 监听改为每动画帧最多扫描一次，并忽略字符内容变化，降低新版页面加载开销。
- 预览开关由新版文件列表适配器独立维护，优先挂到工具栏，工具栏不可用时使用固定位置。

## 2.0.0-beta.4

### Patch Changes

- 新版文件列表工具栏补回视频预览开关，关闭后只隐藏详情下方的视频截图行；工具栏无法识别时使用固定位置兜底。
- 新版文件行优先使用 `data-file-id` 精确绑定接口文件，避免相同恢复文件名错位。
- 清理 React 复用行和旧适配器遗留的详情、预览及操作栏，确保每行只显示当前文件的一份增强。
- 当前目录映射不再回退使用其他目录的旧接口数据。

## 2.0.0-beta.3

### Patch Changes

- 番号资料与视频预览改为兼容共存，两个增强开关互不影响。
- 识别 `MURIKURI-009` 等 6 至 10 位、带连字符的长前缀番号。
- 修复新版页面相同 `original_name` 或截断文本导致文件行重复绑定的问题。
- 新版文件行详情始终使用当前文件名解析，并用文件大小和接口顺序消除歧义。

## 2.0.0-beta.2

### Minor Changes

- 适配 `https://115.com/storage/allfiles` 新版原生文件列表。
- 捕获新版文件接口并映射文件行，复用旧版番号资料、演员头像、视频预览、播放和下载增强。
- 保持番号资料与视频预览互斥；不能解析为番号的视频继续显示预览。
- 兼容新版文件夹中键打开、文件名单击和双击播放、官方播放及单文件下载。
- 保留右下角 MASTER 入口，作为新版 DOM 再次变化时的兜底。

## 2.0.0-beta.1

### Minor Changes

- 新增 `115Master Fusion` 独立脚本身份、更新源和构建产物。
- 兼容新版或未知 115 页面，提供可自恢复的 MASTER 文件管理器入口。
- 恢复旧版番号资料、演员头像、播放页影片详情和剧院模式。
- 增强功能改为运行时开关，不再依赖 Plus 编译版本。
- MASTER 文件列表支持番号资料卡，旧版官方页面继续使用 DOM 增强。

## 1.11.1

### Patch Changes

- [#326](https://github.com/cbingb666/115master/pull/326) [`01bd054`](https://github.com/cbingb666/115master/commit/01bd054f0b1698ffe7a4af9dcebe5b80612d3540) Thanks [@cbingb666](https://github.com/cbingb666)! - fix(monkey/xplayer): the player's HUD display cannot switch between play and pause

## 1.11.0

### Minor Changes

- [#325](https://github.com/cbingb666/115master/pull/325) [`fbfa1b0`](https://github.com/cbingb666/115master/commit/fbfa1b0f156689a66b06f8de67060f59671996e1) Thanks [@WzLYVg387U](https://github.com/WzLYVg387U)! - feat(monkey/playlist): add middle click support for items in breadcrumb and playlist

## 1.10.2

### Patch Changes

- [`4e2c652`](https://github.com/cbingb666/115master/commit/4e2c65247ab301f94f9b4ab2627c1fce0b71e182) Thanks [@cbingb666](https://github.com/cbingb666)! - fix(monkey): The playlist was not updated after refreshing the playback page following the movement of the file (#315)

## 1.10.1

### Patch Changes

- [#323](https://github.com/cbingb666/115master/pull/323) [`825962a`](https://github.com/cbingb666/115master/commit/825962a9ec0822baa4e74e2911cd47666cfaa323) Thanks [@cbingb666](https://github.com/cbingb666)! - update descrition in package.json

## 1.10.0

### Minor Changes

- [#296](https://github.com/cbingb666/115master/pull/296) [`85ae35a`](https://github.com/cbingb666/115master/commit/85ae35a69352baca69f7db1c13c639d7d64bad23) Thanks [@cbingb666](https://github.com/cbingb666)! - feat: add file operations for video page

### Patch Changes

- [#310](https://github.com/cbingb666/115master/pull/310) [`10cbfc7`](https://github.com/cbingb666/115master/commit/10cbfc70c9547a81bd0b34c34e7ac5406f218af9) Thanks [@cbingb666](https://github.com/cbingb666)! - chore: migrate to monorepo structure with pnpm workspaces and Turbo

- [#308](https://github.com/cbingb666/115master/pull/308) [`efe4c7d`](https://github.com/cbingb666/115master/commit/efe4c7d3650eb28c755be82fea25189eb597d849) Thanks [@cbingb666](https://github.com/cbingb666)! - fix: upgrade hls.js to v1.6.15 to resolve audio distortion issue

- [#307](https://github.com/cbingb666/115master/pull/307) [`73d451e`](https://github.com/cbingb666/115master/commit/73d451eb0424cff8f6c851fc419e553b1d117952) Thanks [@cbingb666](https://github.com/cbingb666)! - fix: file move not working in production build

- [#300](https://github.com/cbingb666/115master/pull/300) [`398f71a`](https://github.com/cbingb666/115master/commit/398f71a54de66324ccc399bdc75233958c3a3a6c) Thanks [@cbingb666](https://github.com/cbingb666)! - fix: restore missing folder link feature (#298)

- [#302](https://github.com/cbingb666/115master/pull/302) [`82a2e77`](https://github.com/cbingb666/115master/commit/82a2e77000c6b6e387f6406e7bf5d137c60f4e0b) Thanks [@cbingb666](https://github.com/cbingb666)! - refactor: migrate to @/ alias imports for better code consistency

- [#301](https://github.com/cbingb666/115master/pull/301) [`d651f6b`](https://github.com/cbingb666/115master/commit/d651f6b384558f2ca5988d6ab77c0b6f4e8bf7bc) Thanks [@cbingb666](https://github.com/cbingb666)! - refactor: reorganize XPlayer control layer with ControlButtonGroup component
