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
- Respond with ONLY the JSON object, nothing else.`;

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
        if (deleteBtn) {
            deleteLogEntry(Number(deleteBtn.dataset.id));
        }
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

    // Strip accidental markdown code fences some models add despite instructions
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

// ── Rendering ──

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

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ── Start ──

init();
