# Run this script on your home PC before using the calorie logger away from home.
# It starts Ollama with CORS enabled and opens a Cloudflare tunnel, then prints the URL to paste into the app.

$model = "llama3.2"   # Change this to match the model you have pulled in Ollama

Write-Host ""
Write-Host "Starting Ollama..."
$env:OLLAMA_ORIGINS = "*"
Start-Process "ollama" -ArgumentList "serve" -WindowStyle Minimized

Start-Sleep -Seconds 2

Write-Host "Pulling model if not already present..."
& ollama pull $model

Write-Host ""
Write-Host "Opening Cloudflare tunnel..."
Write-Host "------------------------------------------------------------"
Write-Host "When the URL appears below, copy it and paste it into"
Write-Host "the app Settings (gear icon) as the Cloudflare Tunnel URL."
Write-Host "------------------------------------------------------------"
Write-Host ""

& cloudflared tunnel --url http://localhost:11434
