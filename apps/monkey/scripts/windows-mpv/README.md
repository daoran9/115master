# Windows MPV 协议

播放器页的“MPV 播放”按钮使用 `master115-mpv://`。首次使用时，在 PowerShell 运行：

```powershell
& '.\scripts\windows-mpv\Install-115MasterMpvProtocol.ps1' -MpvPath 'D:\Apps\mpv\mpv.exe'
```

安装器只写当前用户的 `HKCU\Software\Classes\master115-mpv`，并把启动脚本复制到 `%LOCALAPPDATA%\115Master\mpv-protocol`。不需要管理员权限。
