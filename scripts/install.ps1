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
    foreach ($d in 'dist', 'hooks', 'scripts') {
        if (Test-Path (Join-Path $dest $d)) { Remove-Item -Recurse -Force (Join-Path $dest $d) }
        Copy-Item -Recurse $d (Join-Path $dest $d)
    }
    Copy-Item package.json, README.md, LICENSE $dest

    # Tabby scans plugins\node_modules for packages with the "tabby-plugin" keyword.
    # Not added to plugins\package.json on purpose: that file is managed by Tabby's
    # plugin manager (use it instead to install the published npm version).

    Write-Host "Installed to $dest - restart Tabby to load it."
} finally { Pop-Location }
