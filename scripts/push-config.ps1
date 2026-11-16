# Uploads private/config.json as the PRIVATE_CONFIG secret and redeploys.
$root = Split-Path -Parent $PSScriptRoot
$file = Join-Path $root 'private\config.json'
$raw = Get-Content -Raw -Encoding UTF8 -Path $file
$OutputEncoding = New-Object System.Text.UTF8Encoding $false   # else Windows PowerShell pipes emoji and dashes to gh as "?"
$null = $raw | ConvertFrom-Json   # stops here if the JSON is broken
$raw | gh secret set PRIVATE_CONFIG
gh workflow run deploy.yml
Write-Host 'Config uploaded. The dashboard updates within about 10 minutes.' -ForegroundColor Green
