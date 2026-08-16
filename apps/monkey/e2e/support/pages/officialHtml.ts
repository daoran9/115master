/** 新版官方页面空壳。 */
export function officialHtml() {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>115 新版文件页</title>
</head>
<body>
  <main id="new-drive-root">新版官方页面</main>
</body>
</html>`
}

/** 新版 /storage/allfiles 原生列表最小结构。 */
export function officialStorageHtml() {
  const row = (fileId: string, title: string, text: string, size: string) => `
    <div class="file-list-item" data-file-id="${fileId}">
      <div class="group relative file-list-item">
        <div class="flex items-center pl-4 pr-8 py-1 min-w-0 relative z-10">
          <div class="flex-shrink-0 w-10">VIDEO</div>
          <div class="flex-1 min-w-0 px-4 pl-2">
            <div class="flex flex-col justify-center">
              <div class="flex items-center space-x-2">
                <div class="file-name-responsive" title="${title}">${text}</div>
              </div>
            </div>
          </div>
          <div class="file-info-responsive">${size}</div>
        </div>
      </div>
    </div>`

  const restored = 'www.98T.la@shared-restored.mp4'
  const truncated = 'www.98T.la...restored.mp4'

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>115 新版全部文件</title>
<style>
  body { margin: 0; color: #27364a; font-family: Arial, sans-serif; }
  [data-native-toolbar] { display: flex; align-items: center; gap: 8px; padding: 8px 10px 24px; }
  [data-native-action] { display: inline-flex; flex-direction: column; }
  [data-native-toolbar] button { height: 32px; padding: 0 12px; border: 1px solid #d4d9e1; border-radius: 4px; background: #fff; font-size: 14px; }
  [data-native-upload-action] button { border-color: #2878ed; background: #2878ed; color: #fff; }
  .file-list-item { min-height: 72px; border-bottom: 1px solid #edf0f4; }
</style>
</head>
<body>
  <main id="new-storage-root">
    <div data-native-breadcrumb class="flex items-center text-xs overflow-x-auto gap-3">
      <button type="button" title="根目录">根目录</button>
    </div>
    <div data-native-toolbar>
      <div data-native-action data-native-upload-action>
        <button type="button">上传</button>
      </div>
      <div data-native-action data-native-new-action>
        <button type="button" data-native-new>新建</button>
      </div>
    </div>
    <div style="height: 760px; overflow-y: auto">
      ${row('official-file-1', restored, truncated, '14.54 GB')}
      ${row('official-file-2', restored, truncated, '7.69 GB')}
      ${row('official-file-3', '家庭录像.mp4', '家庭录像.mp4', '1.50 GB')}
    </div>
  </main>
</body>
</html>`
}
