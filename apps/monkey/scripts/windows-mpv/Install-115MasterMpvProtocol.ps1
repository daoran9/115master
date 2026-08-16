param(
  [Parameter(Mandatory = $true)]
  [string]$MpvPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

class Logger {
  [void] info([string]$Message) {
    Write-Host "[115Master MPV] $Message"
  }
}

$logger = [Logger]::new()

<#
 ================================================================================
 步骤1：校验 MPV 程序
 ================================================================================
 目标：协议处理器只能启动用户明确指定的 mpv.exe。
 数据源：命令行参数 MpvPath。
 操作：
 1) 解析绝对路径
 2) 校验文件名和扩展名
#>
$logger.info('开始校验 MPV 程序')

$resolvedMpv = (Resolve-Path -LiteralPath $MpvPath).Path
if (-not (Test-Path -LiteralPath $resolvedMpv -PathType Leaf)) {
  throw "找不到 MPV：$resolvedMpv"
}
if ([IO.Path]::GetFileName($resolvedMpv) -ine 'mpv.exe') {
  throw 'MpvPath 必须指向 mpv.exe'
}

$logger.info('MPV 程序校验完成')

<#
 ================================================================================
 步骤2：安装当前用户协议处理器
 ================================================================================
 目标：注册 master115-mpv://，不需要管理员权限。
 数据源：随仓库提供的 Open-115MasterMpv.ps1。
 操作：
 1) 复制启动脚本到 LocalAppData
 2) 写入 HKCU Software Classes 协议命令
#>
$logger.info('开始安装当前用户 MPV 协议处理器')

$sourceLauncher = Join-Path $PSScriptRoot 'Open-115MasterMpv.ps1'
if (-not (Test-Path -LiteralPath $sourceLauncher -PathType Leaf)) {
  throw "缺少启动脚本：$sourceLauncher"
}

$installRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) '115Master\mpv-protocol'
$installedLauncher = Join-Path $installRoot 'Open-115MasterMpv.ps1'
New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
Copy-Item -LiteralPath $sourceLauncher -Destination $installedLauncher -Force

$protocolKey = 'HKCU:\Software\Classes\master115-mpv'
$commandKey = Join-Path $protocolKey 'shell\open\command'
New-Item -Path $commandKey -Force | Out-Null
Set-Item -Path $protocolKey -Value 'URL:115Master MPV Protocol'
New-ItemProperty -Path $protocolKey -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null

$powershellPath = Join-Path $PSHOME 'powershell.exe'
$command = ('"{0}" -NoProfile -ExecutionPolicy Bypass -File "{1}" -RequestUri "%1" -MpvPath "{2}"' -f `
  $powershellPath, $installedLauncher, $resolvedMpv)
Set-Item -Path $commandKey -Value $command

$logger.info('当前用户 MPV 协议处理器安装完成')
Write-Host '现在可在 115Master 播放页点击“MPV 播放”。'
