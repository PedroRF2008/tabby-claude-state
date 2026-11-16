# Builds the plugin and installs it into Tabby's user plugin folder.
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1
# Restart Tabby afterwards.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    if (-not (Test-Path node_modules)) { npm install --no-audit --no-fund; if ($LASTEXITCODE) { throw 'npm install failed' } }
    npm run build; if ($LASTEXITCODE) { throw 'build failed' }

    $pluginsDir = Join-Path $env:APPDATA 'tabby\plugins'
    $dest = Join-Path $pluginsDir 'node_modules\tabby-claude-state'
    New-Item -ItemType Directory -Force $dest | Out-Null
    if (Test-Path (Join-Path $dest 'dist')) { Remove-Item -Recurse -Force (Join-Path $dest 'dist') }
    Copy-Item package.json $dest
    Copy-Item -Recurse dist (Join-Path $dest 'dist')

    # Tabby scans plugins\node_modules for packages with the "tabby-plugin" keyword.
    # We deliberately do NOT add it to plugins\package.json: it isn't on npm, so the
    # built-in plugin manager's `npm install` would fail trying to fetch it.

    Write-Host "Installed to $dest - restart Tabby to load it."
} finally { Pop-Location }
