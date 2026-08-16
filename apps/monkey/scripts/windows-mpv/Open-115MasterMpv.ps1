param(
  [Parameter(Mandatory = $true)]
  [string]$RequestUri,

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

function ConvertFrom-ProtocolQuery {
  param([Parameter(Mandatory = $true)][Uri]$Uri)

  $values = @{}
  foreach ($part in $Uri.Query.TrimStart('?').Split('&', [StringSplitOptions]::RemoveEmptyEntries)) {
    $pair = $part.Split('=', 2)
    $name = [Uri]::UnescapeDataString($pair[0].Replace('+', ' '))
    $value = if ($pair.Length -eq 2) {
      [Uri]::UnescapeDataString($pair[1].Replace('+', ' '))
    }
    else {
      ''
    }
    $values[$name] = $value
  }
  return $values
}

<#
 ================================================================================
 步骤1：校验协议请求
 ================================================================================
 目标：协议入口只接受固定动作和 HTTP(S) 媒体地址。
 数据源：master115-mpv://play 请求。
 操作：
 1) 校验 scheme 和 host
 2) 拒绝换行、引号和非 HTTP(S) 地址
#>
$logger.info('开始校验 MPV 协议请求')

$protocolUri = [Uri]$RequestUri
if ($protocolUri.Scheme -ne 'master115-mpv' -or $protocolUri.Host -ne 'play') {
  throw '无效的 115Master MPV 协议请求'
}

$query = ConvertFrom-ProtocolQuery -Uri $protocolUri
$mediaUrl = [string]$query['url']
$userAgent = [string]$query['userAgent']
$cookie = [string]$query['cookie']
$mediaUri = [Uri]$mediaUrl
if ($mediaUri.Scheme -notin @('http', 'https')) {
  throw 'MPV 只接受 HTTP(S) 媒体地址'
}
foreach ($value in @($mediaUrl, $userAgent, $cookie)) {
  if ($value -match '[\r\n"]') {
    throw '协议参数包含非法字符'
  }
}

$resolvedMpv = (Resolve-Path -LiteralPath $MpvPath).Path
if ([IO.Path]::GetFileName($resolvedMpv) -ine 'mpv.exe') {
  throw '协议配置中的 MPV 路径无效'
}

$logger.info('MPV 协议请求校验完成')

<#
 ================================================================================
 步骤2：启动 MPV
 ================================================================================
 目标：把 115 下载地址及必要请求头作为独立参数交给 MPV。
 数据源：已校验的协议字段。
 操作：
 1) 构造固定 MPV 参数
 2) 启动独立 MPV 进程
#>
$logger.info('开始启动 MPV')

$arguments = @('--force-window=yes')
if ($userAgent) {
  $arguments += "--user-agent=$userAgent"
}
if ($cookie) {
  $arguments += "--http-header-fields=Cookie: $cookie"
}
$arguments += $mediaUrl

$quotedArguments = $arguments | ForEach-Object { '"' + $_ + '"' }
Start-Process -FilePath $resolvedMpv -ArgumentList $quotedArguments

$logger.info('MPV 启动完成')
