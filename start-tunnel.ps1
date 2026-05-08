# Run this script on your home PC before using the calorie logger away from home.
# It starts Ollama with CORS enabled and opens a Cloudflare tunnel, then prints the URL to paste into the app.

$model = "llama3.2"   # Change this to match the model you have pulled in Ollama

# Set OLLAMA_ORIGINS permanently in Windows user environment
[System.Environment]::SetEnvironmentVariable("OLLAMA_ORIGINS", "*", "User")
$env:OLLAMA_ORIGINS = "*"

Write-Host ""
Write-Host "Stopping any existing Ollama processes..."
taskkill /F /IM "ollama.exe" /T 2>$null
taskkill /F /IM "ollama app.exe" /T 2>$null
Start-Sleep -Seconds 3

Write-Host "Starting Ollama with CORS enabled..."
Start-Process "ollama" -ArgumentList "serve" -WindowStyle Minimized -Environment @{ OLLAMA_ORIGINS = "*" }
Start-Sleep -Seconds 4

Write-Host "Pulling model if not already present..."
& ollama pull $model

Write-Host ""
Write-Host "Opening Cloudflare tunnel..."
Write-Host "------------------------------------------------------------"
Write-Host "When the URL appears below, copy it and paste it into"
Write-Host "the app Settings (gear icon) as the Cloudflare Tunnel URL."
Write-Host "------------------------------------------------------------"
Write-Host ""

$cloudflared = Join-Path $PSScriptRoot "cloudflared-windows-amd64.exe"
if (-not (Test-Path $cloudflared)) {
    Write-Host "ERROR: cloudflared.exe not found in this folder." -ForegroundColor Red
    Write-Host "Download it and place it in: $PSScriptRoot" -ForegroundColor Red
    exit 1
}

& $cloudflared tunnel --url http://localhost:11434
