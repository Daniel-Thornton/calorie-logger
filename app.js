'use strict';

const STORAGE_KEY = 'calorie_log_v1';
const SETTINGS_KEY = 'calorie_settings_v1';

const SYSTEM_PROMPT = `You are a calorie estimation assistant. The user will describe food they have eaten.
You must respond ONLY with a valid JSON object and nothing else — no explanation, no markdown formatting, no code fences, no prose.
Use this exact structure:
{
  "items": [
    { "name": "food item description", "calories": 150 }
  ],
  "total_calories": 150,
  "notes": "brief note about the estimates, or empty string if nothing notable"
}
Rules:
- Estimate based on typical serving sizes when quantities are not specified.
- Keep item names short and clear.
- total_calories must equal the sum of all item calories.
- Respond with ONLY the JSON object, nothing else.

Known calorie values:
Huel drink = 400`;

// ── DOM references ──

const voiceBtn = document.getElementById('voice-btn');
const voiceStatus = document.getElementById('voice-status');
const mealInput = document.getElementById('meal-input');
const logBtn = document.getElementById('log-btn');
const loadingEl = document.getElementById('loading');
const logEntriesEl = document.getElementById('log-entries');
const totalCaloriesEl = document.getElementById('total-calories');
const currentDateEl = document.getElementById('current-date');
const errorBanner = document.getElementById('error-banner');
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const tunnelUrlInput = document.getElementById('tunnel-url');
const modelNameInput = document.getElementById('model-name');
const saveSettingsBtn = document.getElementById('save-settings');
const closeSettingsBtn = document.getElementById('close-settings');
const statsContent = document.getElementById('stats-content');

// ── State ──

let settings = loadSettings();
let recognition = null;
let isRecording = false;

// ── Boot ──

function init() {
    currentDateEl.textContent = formatDate(new Date());
    tunnelUrlInput.value = settings.tunnelUrl || '';
    modelNameInput.value = settings.model || 'llama3.2';
    renderLog();
    setupSpeechRecognition();
    setupEventListeners();
}

// ── Settings ──

function loadSettings() {
    try {
        return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
    } catch {
        return {};
    }
}

function persistSettings() {
    settings.tunnelUrl = tunnelUrlInput.value.trim().replace(/\/+$/, '');
    settings.model = modelNameInput.value.trim() || 'llama3.2';
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// ── Event wiring ──

function setupEventListeners() {
    settingsBtn.addEventListener('click', openSettings);
    saveSettingsBtn.addEventListener('click', () => { persistSettings(); closeSettings(); });
    closeSettingsBtn.addEventListener('click', closeSettings);
    settingsModal.addEventListener('click', (e) => { if (e.target === settingsModal) closeSettings(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSettings(); });

    voiceBtn.addEventListener('click', toggleRecording);
    logBtn.addEventListener('click', handleLogMeal);

    logEntriesEl.addEventListener('click', (e) => {
        const deleteBtn = e.target.closest('.log-delete');
        if (deleteBtn) deleteLogEntry(Number(deleteBtn.dataset.id));
    });

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
}

function openSettings() {
    tunnelUrlInput.value = settings.tunnelUrl || '';
    modelNameInput.value = settings.model || 'llama3.2';
    settingsModal.classList.remove('hidden');
    tunnelUrlInput.focus();
}

function closeSettings() {
    settingsModal.classList.add('hidden');
}

// ── Tabs ──

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tab);
        b.setAttribute('aria-selected', b.dataset.tab === tab);
    });
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    document.getElementById(`tab-${tab}`).classList.remove('hidden');
    if (tab === 'stats') renderStats();
}

// ── Speech Recognition ──

function setupSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        voiceStatus.textContent = 'Voice input not supported in this browser (try Chrome)';
        voiceBtn.disabled = true;
        return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.addEventListener('result', (e) => {
        const transcript = Array.from(e.results).map(r => r[0].transcript).join('');
        mealInput.value = transcript;
    });

    recognition.addEventListener('end', () => {
        isRecording = false;
        voiceBtn.classList.remove('recording');
        voiceStatus.textContent = 'Tap to speak';
    });

    recognition.addEventListener('error', (e) => {
        isRecording = false;
        voiceBtn.classList.remove('recording');
        voiceStatus.textContent = e.error === 'not-allowed' ? 'Microphone access denied' : `Error: ${e.error}`;
    });
}

function toggleRecording() {
    if (!recognition) return;
    if (isRecording) {
        recognition.stop();
    } else {
        mealInput.value = '';
        recognition.start();
        isRecording = true;
        voiceBtn.classList.add('recording');
        voiceStatus.textContent = 'Listening...';
    }
}

// ── Meal logging ──

async function handleLogMeal() {
    const text = mealInput.value.trim();
    if (!text) {
        showError('Please describe what you ate first.');
        return;
    }
    if (!settings.tunnelUrl) {
        showError('No tunnel URL set. Open Settings and paste your Cloudflare tunnel URL.');
        return;
    }

    clearError();
    setLoading(true);

    try {
        const result = await callOllama(text);
        addLogEntry(result);
        mealInput.value = '';
        renderLog();
    } catch (err) {
        showError(err.message);
    } finally {
        setLoading(false);
    }
}

async function callOllama(mealDescription) {
    const model = settings.model || 'llama3.2';
    const url = `${settings.tunnelUrl}/api/chat`;

    let response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: mealDescription }
                ],
                stream: false
            })
        });
    } catch {
        throw new Error(
            'Could not reach your home PC. Check that Ollama is running and your Cloudflare tunnel is active, then update the URL in Settings.'
        );
    }

    if (!response.ok) {
        throw new Error(`Ollama returned an error (HTTP ${response.status}). Check the model name in Settings.`);
    }

    const data = await response.json();
    const raw = data?.message?.content ?? '';
    const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();

    let parsed;
    try {
        parsed = JSON.parse(cleaned);
    } catch {
        throw new Error(
            `The model returned text that isn't valid JSON. Try a different model or simplify your description.\n\nModel response: "${cleaned.slice(0, 200)}"`
        );
    }

    if (!Array.isArray(parsed.items) || typeof parsed.total_calories !== 'number') {
        throw new Error('The model response was missing expected fields. Try rephrasing or switching to a more capable model.');
    }

    return parsed;
}

// ── Log storage ──

function getTodayKey() {
    return new Date().toISOString().slice(0, 10);
}

function loadLog() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
        return {};
    }
}

function addLogEntry(calorieData) {
    const log = loadLog();
    const today = getTodayKey();
    if (!log[today]) log[today] = [];

    log[today].push({
        id: Date.now(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        items: calorieData.items,
        total: calorieData.total_calories,
        notes: calorieData.notes || ''
    });

    localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
}

function deleteLogEntry(id) {
    const log = loadLog();
    const today = getTodayKey();
    if (log[today]) {
        log[today] = log[today].filter(e => e.id !== id);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
    }
    renderLog();
}

// ── Today rendering ──

function renderLog() {
    const log = loadLog();
    const today = getTodayKey();
    const entries = log[today] || [];

    const total = entries.reduce((sum, e) => sum + e.total, 0);
    totalCaloriesEl.textContent = `${total} kcal`;

    if (entries.length === 0) {
        logEntriesEl.innerHTML = '<p class="empty-log">No meals logged today</p>';
        return;
    }

    logEntriesEl.innerHTML = entries.map(entry => `
        <div class="log-entry">
            <div class="log-entry-header">
                <span class="log-entry-time">${escapeHtml(entry.time)}</span>
                <div class="log-entry-right">
                    <span class="log-entry-kcal">${entry.total} kcal</span>
                    <button class="log-delete" data-id="${entry.id}" aria-label="Delete entry">remove</button>
                </div>
            </div>
            ${entry.items.map(item => `
                <div class="log-item">
                    <span class="log-item-name">${escapeHtml(item.name)}</span>
                    <span class="log-item-cal">${item.calories} kcal</span>
                </div>
            `).join('')}
            ${entry.notes ? `<p class="log-entry-note">${escapeHtml(entry.notes)}</p>` : ''}
        </div>
    `).join('');
}

// ── Stats rendering ──

function renderStats() {
    const log = loadLog();

    const dailyTotals = Object.entries(log)
        .map(([date, entries]) => ({
            date,
            total: entries.reduce((s, e) => s + e.total, 0),
            meals: entries.length
        }))
        .filter(d => d.total > 0)
        .sort((a, b) => a.date.localeCompare(b.date));

    if (dailyTotals.length === 0) {
        statsContent.innerHTML = '<div class="stats-empty">No data yet — start logging meals to see statistics.</div>';
        return;
    }

    const avg = Math.round(dailyTotals.reduce((s, d) => s + d.total, 0) / dailyTotals.length);
    const highest = dailyTotals.reduce((m, d) => d.total > m.total ? d : m);
    const lowest = dailyTotals.reduce((m, d) => d.total < m.total ? d : m);
    const streak = calcStreak(dailyTotals.map(d => d.date));

    statsContent.innerHTML = `
        <div class="stat-cards">
            <div class="stat-card">
                <div class="stat-card-value">${avg.toLocaleString()}</div>
                <div class="stat-card-label">Avg kcal / day</div>
            </div>
            <div class="stat-card">
                <div class="stat-card-value">${dailyTotals.length}</div>
                <div class="stat-card-label">Days logged</div>
            </div>
            <div class="stat-card">
                <div class="stat-card-value">${highest.total.toLocaleString()}</div>
                <div class="stat-card-label">Highest day</div>
                <div class="stat-card-sub">${formatShortDate(highest.date)}</div>
            </div>
            <div class="stat-card">
                <div class="stat-card-value">${lowest.total.toLocaleString()}</div>
                <div class="stat-card-label">Lowest day</div>
                <div class="stat-card-sub">${formatShortDate(lowest.date)}</div>
            </div>
            <div class="stat-card">
                <div class="stat-card-value">${streak}</div>
                <div class="stat-card-label">Day streak</div>
            </div>
            <div class="stat-card">
                <div class="stat-card-value">${(dailyTotals.reduce((s, d) => s + d.total, 0) / 1000).toFixed(0)}k</div>
                <div class="stat-card-label">Total kcal logged</div>
            </div>
        </div>

        <div class="chart-card">
            <h3>Last ${Math.min(dailyTotals.length, 14)} days</h3>
            <div class="chart-wrap">
                ${buildChart(dailyTotals, avg)}
            </div>
        </div>

        <div class="history-card">
            <h3>All days</h3>
            ${[...dailyTotals].reverse().map(d => `
                <div class="history-row">
                    <span class="history-date">${formatShortDate(d.date)}</span>
                    <span class="history-meals">${d.meals} meal${d.meals !== 1 ? 's' : ''}</span>
                    <span class="history-kcal">${d.total.toLocaleString()} kcal</span>
                </div>
            `).join('')}
        </div>
    `;
}

function buildChart(dailyTotals, avg) {
    const recent = dailyTotals.slice(-14);
    const svgW = 540;
    const svgH = 190;
    const padL = 8;
    const padR = 8;
    const padTop = 24;
    const padBottom = 32;
    const barAreaH = svgH - padTop - padBottom;
    const barAreaW = svgW - padL - padR;
    const slot = barAreaW / recent.length;
    const barW = Math.max(Math.floor(slot * 0.6), 4);
    const maxVal = Math.max(...recent.map(d => d.total), avg * 1.1);

    const avgY = padTop + barAreaH - Math.round((avg / maxVal) * barAreaH);

    const bars = recent.map((d, i) => {
        const barH = Math.max(Math.round((d.total / maxVal) * barAreaH), 2);
        const x = padL + i * slot + (slot - barW) / 2;
        const y = padTop + barAreaH - barH;
        const labelDate = `${parseInt(d.date.slice(8))}/${parseInt(d.date.slice(5, 7))}`;
        const isToday = d.date === getTodayKey();

        return `
            <rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="3"
                  fill="${isToday ? 'var(--green-dark)' : 'var(--green)'}" opacity="${isToday ? '1' : '0.75'}"/>
            <text x="${x + barW / 2}" y="${y - 5}" text-anchor="middle"
                  font-size="9" fill="var(--text-muted)" font-family="inherit">${d.total >= 1000 ? Math.round(d.total / 100) / 10 + 'k' : d.total}</text>
            <text x="${x + barW / 2}" y="${svgH - padBottom + 14}" text-anchor="middle"
                  font-size="9" fill="${isToday ? 'var(--green-dark)' : 'var(--text-muted)'}"
                  font-weight="${isToday ? '600' : '400'}" font-family="inherit">${labelDate}</text>
        `;
    });

    const avgLine = `
        <line x1="${padL}" y1="${avgY}" x2="${svgW - padR}" y2="${avgY}"
              stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="4 3" opacity="0.5"/>
        <text x="${svgW - padR - 2}" y="${avgY - 4}" text-anchor="end"
              font-size="8" fill="var(--text-muted)" font-family="inherit">avg</text>
    `;

    return `<svg viewBox="0 0 ${svgW} ${svgH}" style="width:100%;display:block;overflow:visible">
        ${avgLine}
        ${bars.join('')}
    </svg>`;
}

function calcStreak(sortedDates) {
    if (sortedDates.length === 0) return 0;
    const today = getTodayKey();
    const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    const last = sortedDates[sortedDates.length - 1];
    if (last !== today && last !== yesterday) return 0;

    let streak = 1;
    for (let i = sortedDates.length - 2; i >= 0; i--) {
        const curr = new Date(sortedDates[i + 1]);
        const prev = new Date(sortedDates[i]);
        const diff = (curr - prev) / 864e5;
        if (diff === 1) streak++;
        else break;
    }
    return streak;
}

// ── UI helpers ──

function setLoading(on) {
    loadingEl.classList.toggle('hidden', !on);
    logBtn.disabled = on;
    voiceBtn.disabled = on;
}

function showError(msg) {
    errorBanner.textContent = msg;
    errorBanner.classList.remove('hidden');
}

function clearError() {
    errorBanner.textContent = '';
    errorBanner.classList.add('hidden');
}

function formatDate(date) {
    return date.toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
}

function formatShortDate(isoDate) {
    const [y, m, d] = isoDate.split('-');
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric'
    });
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ── Start ──

init();
