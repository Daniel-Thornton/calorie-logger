# Calorie Logger

A static web app hosted on GitHub Pages that lets you log meals by voice or text, estimates calories using a local Ollama model, and keeps a daily running total.

---

## One-time setup

### 1. Deploy to GitHub Pages

1. Create a new repository on GitHub (e.g. `calorie-logger`)
2. Push these files to the `main` branch
3. Go to **Settings → Pages → Source** and set it to `main` branch, root folder
4. Your app will be live at `https://yourusername.github.io/calorie-logger`

### 2. Install cloudflared on your home PC

Download the Windows installer from: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

No account needed for quick tunnels. Just download and make sure `cloudflared` is on your PATH (or place it in the same folder as `start-tunnel.ps1`).

### 3. Make sure Ollama is installed and has a model pulled

```powershell
ollama pull llama3.2
```

---

## Using the app away from home

1. **On your home PC**, run `start-tunnel.ps1` (right-click → Run with PowerShell):
   ```powershell
   .\start-tunnel.ps1
   ```
   It starts Ollama and opens a tunnel. After a few seconds you will see a URL like:
   ```
   https://xxxx-xxxx-xxxx.trycloudflare.com
   ```

2. **In the web app**, tap the gear icon and paste that URL into **Cloudflare Tunnel URL**. Save.

3. Log meals. The tunnel URL changes each session, so repeat step 2 each time you restart the tunnel.

> **Your home PC must stay on and the script must keep running** for the app to work remotely.

---

## Using the app at home

The tunnel URL approach works at home too — just run `start-tunnel.ps1` the same way.

If you want to skip the tunnel at home, change the Tunnel URL in Settings to `http://localhost:11434` and make sure Ollama is running with CORS open:

```powershell
$env:OLLAMA_ORIGINS = "*"
ollama serve
```

---

## Data

All calorie logs are stored in your browser's `localStorage`. They are private to your device and browser — nothing is sent anywhere except to your own Ollama instance.
