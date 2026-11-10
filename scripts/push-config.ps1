# Uploads private/config.json as the PRIVATE_CONFIG secret and redeploys.
$root = Split-Path -Parent $PSScriptRoot
$file = Join-Path $root 'private\config.json'
$raw = Get-Content -Raw -Path $file
$null = $raw | ConvertFrom-Json   # stops here if the JSON is broken
$raw | gh secret set PRIVATE_CONFIG
gh workflow run deploy.yml
Write-Host 'Config uploaded. The dashboard updates within about 10 minutes.' -ForegroundColor Green
