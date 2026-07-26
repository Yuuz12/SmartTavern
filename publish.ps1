<#
.SYNOPSIS
  SmartTavern 发布打包脚本

.DESCRIPTION
  自动构建后端，将前端、后端源码与构建产物打包成 zip。
  采用白名单方式复制，从源头排除高敏数据与运行时数据：
    - 高敏数据：backend/.env（密钥 / 凭据）
    - 运行时数据：backend/data（整个数据目录，含按用户隔离的 users/{用户ID}/ 下的
      角色卡、世界书、对话与用户设置，以及 system/ 系统配置）
    - 其它运行时：uploads / backups / logs
    - 依赖与缓存：node_modules / .trae / .git / *.log / *.tmp
  发布包首次启动时后端会自动创建 data / uploads / backups 目录，无需预置。
  包内附带 upgrade.sh 升级脚本，服务器上执行后可保留用户数据并清理旧版应用文件，
  解压新版包即可完成升级。

.PARAMETER OutputDir
  zip 输出目录，默认 release

.PARAMETER SkipBuild
  跳过后端构建步骤（使用已有 backend/dist）

.PARAMETER KeepStaging
  保留暂存目录（调试用）

.EXAMPLE
  .\publish.ps1
  .\publish.ps1 -SkipBuild
  .\publish.ps1 -OutputDir D:\Releases
#>
[CmdletBinding()]
param(
    [string]$OutputDir = "release",
    [switch]$SkipBuild,
    [switch]$KeepStaging
)

$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot

# 读取版本号
$rootPkg = Get-Content -Raw -LiteralPath (Join-Path $projectRoot "package.json") | ConvertFrom-Json
$version = $rootPkg.version
if (-not $version) { $version = "0.0.0" }
$releaseName = "SmartTavern-v$version"

# 版本一致性检查：根 package.json 与 backend/package.json 版本不一致时提醒（不阻断）
$backendPkgPath = Join-Path $projectRoot "backend\package.json"
if (Test-Path $backendPkgPath) {
    $backendPkg = Get-Content -Raw -LiteralPath $backendPkgPath | ConvertFrom-Json
    if ($backendPkg.version -and $backendPkg.version -ne $version) {
        Write-Warning "版本号不一致: 根 package.json = $version, backend/package.json = $($backendPkg.version)，建议同步后再发布"
    }
}

$stagingRoot = Join-Path $projectRoot ".release-staging"
$stagingPath = Join-Path $stagingRoot $releaseName
$zipPath     = Join-Path (Join-Path $projectRoot $OutputDir) "$releaseName.zip"

function Write-Step($msg) { Write-Host "`n>>> $msg" -ForegroundColor Yellow }
function Write-Ok($msg)   { Write-Host "    OK  $msg" -ForegroundColor Green }

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " SmartTavern 发布打包" -ForegroundColor Cyan
Write-Host " 版本: $version" -ForegroundColor Cyan
Write-Host " 产物: $zipPath" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# 1. 构建后端
if (-not $SkipBuild) {
    Write-Step "构建后端 (npm run build:backend)"
    # 依赖预检：避免因未安装依赖导致构建报错不直观
    if (-not (Test-Path (Join-Path $projectRoot "backend\node_modules"))) {
        throw "未找到 backend\node_modules，请先执行 npm run install:all 安装依赖"
    }
    Push-Location $projectRoot
    try {
        & npm run build:backend
        if ($LASTEXITCODE -ne 0) { throw "后端构建失败，请检查源码 / tsconfig" }
    } finally {
        Pop-Location
    }
    Write-Ok "后端构建完成 -> backend/dist"
} else {
    Write-Step "跳过后端构建"
    if (-not (Test-Path (Join-Path $projectRoot "backend\dist"))) {
        throw "未找到 backend\dist，请去掉 -SkipBuild 重新构建"
    }
}

# 2. 清理旧产物
Write-Step "清理旧产物"
if (Test-Path $stagingPath) { Remove-Item -Recurse -Force $stagingPath }
if (Test-Path $zipPath)     { Remove-Item -Force $zipPath }
New-Item -ItemType Directory -Force -Path $stagingPath | Out-Null
Write-Ok "已重置暂存目录"

# 3. 复制需要打包的内容（白名单方式，从源头避免敏感数据进入）
Write-Step "复制文件到暂存目录"

# 将 src（文件或目录）复制到 staging 内的相对父目录，保留原名称
function Copy-Into($src, $destParentRel) {
    $destParent = Join-Path $stagingPath $destParentRel
    if (-not (Test-Path $destParent)) { New-Item -ItemType Directory -Force -Path $destParent | Out-Null }
    if (Test-Path $src) {
        Copy-Item -LiteralPath $src -Destination $destParent -Recurse -Force
        return $true
    }
    Write-Warning "跳过（不存在）: $src"
    return $false
}

# 前端（完整目录）
if (Copy-Into (Join-Path $projectRoot "frontend") "") { Write-Ok "frontend/" }

# 后端源码与构建产物
if (Copy-Into (Join-Path $projectRoot "backend\src")  "backend") { Write-Ok "backend/src/" }
if (Copy-Into (Join-Path $projectRoot "backend\dist") "backend") { Write-Ok "backend/dist/" }

# 后端配置/元数据文件
$backendFiles = @("package.json", "package-lock.json", "tsconfig.json", "jest.config.js", ".env.example")
foreach ($f in $backendFiles) {
    if (Copy-Into (Join-Path $projectRoot "backend\$f") "backend") { Write-Ok "backend/$f" }
}

# 根目录文件
$rootFiles = @("package.json", "package-lock.json", ".gitignore", "INSTALL.md", "LICENSE", "README.md", "upgrade.sh")
foreach ($f in $rootFiles) {
    if (Copy-Into (Join-Path $projectRoot $f) "") { Write-Ok $f }
}

# 4. 防御性清理：移除任何意外混入的敏感数据 / 依赖 / 临时文件
Write-Step "校验并清理敏感数据与无关内容"

# 将 .sh 文件转为 LF 换行符（避免 Windows CRLF 导致 Linux 执行报错）
Get-ChildItem -Path $stagingPath -Recurse -Filter "*.sh" -ErrorAction SilentlyContinue | ForEach-Object {
    $content = [System.IO.File]::ReadAllText($_.FullName)
    [System.IO.File]::WriteAllText($_.FullName, $content.Replace("`r`n", "`n"))
    Write-Ok "已转换 LF: $($_.Name)"
}

# 高敏凭据 + 运行时数据 + IDE/版本库
$dangerPaths = @(
    "backend\.env",       # 密钥 / 凭据
    "backend\data",       # 用户、角色卡、世界书、对话、用户设置（全部运行时数据，按用户隔离）
    "backend\uploads",    # 上传文件
    "backend\backups",    # 备份
    "backend\logs",       # 日志
    ".trae",              # IDE 工作区文档
    ".git"                # 版本库
)
foreach ($p in $dangerPaths) {
    $full = Join-Path $stagingPath $p
    if (Test-Path $full) {
        Remove-Item -Recurse -Force $full
        Write-Ok "已移除 $p"
    }
}

# 移除任何 node_modules / 构建缓存
Get-ChildItem -Path $stagingPath -Recurse -Directory -Filter "node_modules" -ErrorAction SilentlyContinue |
    ForEach-Object { Remove-Item -Recurse -Force $_.FullName; Write-Ok "已移除 $($_.FullName.Replace($stagingPath, ''))" }

# 移除临时/系统文件
$junk = Get-ChildItem -Path $stagingPath -Recurse -Include "*.log", "*.tmp", "*.bak", "*.temp", "*.cache", "*.swp", "*.swo", "*.tsbuildinfo", ".DS_Store", "Thumbs.db", "desktop.ini", ".eslintcache" -ErrorAction SilentlyContinue
foreach ($j in $junk) { Remove-Item -Force $j.FullName }

# 5. 打包 zip
Write-Step "生成 zip"
$outDir = Split-Path $zipPath -Parent
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
# Compress-Archive 以传入目录的叶子名作为 zip 顶层目录
Compress-Archive -Path $stagingPath -DestinationPath $zipPath -CompressionLevel Optimal -Force
Write-Ok "已生成 $zipPath"

# 6. 清理暂存
if (-not $KeepStaging) {
    Remove-Item -Recurse -Force $stagingPath
    if ((Test-Path $stagingRoot) -and -not (Get-ChildItem $stagingRoot -Force)) {
        Remove-Item -Recurse -Force $stagingRoot
    }
} else {
    Write-Ok "保留暂存目录: $stagingPath"
}

# 完成
$size = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)
Write-Host "`n==========================================" -ForegroundColor Green
Write-Host " 打包完成！" -ForegroundColor Green
Write-Host " 产物:     $zipPath" -ForegroundColor Green
Write-Host " 大小:     ${size} MB" -ForegroundColor Green
Write-Host " 顶层目录: $releaseName\" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
