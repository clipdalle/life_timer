// --- Configuration ---
const DEFAULT_CONFIG = {
    actions: [
        { id: 'custom_task', label: '⏱️ 记录事情', type: 'tag', tag: '#记录 ' },

        { id: 'eat', label: '🍽️ 记录吃饭', type: 'tag', tag: '#吃饭 ' },
        { id: 'weight', label: '⚖️ 记录体重', type: 'tag', tag: '#体重 ' },
        { id: 'exercise', label: '🏋️ 记录锻炼', type: 'tag', tag: '#锻炼 ' }

    ]
};

const STORAGE_KEY = 'life_logger_v1';

// --- State Management ---
let state = {
    currentActivity: {
        id: 'idle',
        name: '空闲',
        startTime: Date.now()
    },
    // Events: Array of { id, type, name, detail, time, duration? }
    history: []
};

let viewDate = new Date(); // Tracks the currently viewed date
let timeDialState = {
    mode: 'now', // 'now' or 'manual'
    hour: null,
    minute: null,
    duration: 0 // Duration in minutes. 0 means "Point in time" (Switch Context), >0 means "Time Span" (Log Record)
};




// --- UI Elements ---
const ui = {
    date: document.getElementById('date-display'),
    dateWrapper: document.getElementById('date-display-wrapper'), // New wrapper ref
    datePicker: document.getElementById('date-picker'),
    clock: document.getElementById('clock-display'),

    // Time Dial UI
    dialRow: document.getElementById('time-dial-row'),
    btnNow: document.getElementById('btn-time-now'),
    dialHours: document.getElementById('dial-hours'),
    dialMinutes: document.getElementById('dial-minutes'),
    dialDuration: document.getElementById('dial-duration'),



    currentName: document.getElementById('current-activity-name'),
    currentTimer: document.getElementById('current-activity-timer'),
    stream: document.getElementById('event-stream'),
    quickActions: document.getElementById('quick-actions'),
    input: document.getElementById('main-input'),
    sendBtn: document.getElementById('send-btn'),
    // Modals (Removed as per request, but keeping overlay div for potential future use or cleanup)
    // Modals
    modal: document.getElementById('modal-overlay'),
    modalTitle: document.getElementById('modal-title'),
    modalName: document.getElementById('modal-input-name'),
    modalTime: document.getElementById('modal-input-time'),
    modalDetail: document.getElementById('modal-input-detail'),
    modalEditId: document.getElementById('modal-edit-id'),
    modalCancel: document.getElementById('modal-cancel'),
    modalConfirm: document.getElementById('modal-confirm')
};

// --- Initialization ---
function init() {
    renderQuickActions();
    renderTimeDial(); // Init Dial
    loadState();

    // Dial Listeners
    if (ui.btnNow) {
        ui.btnNow.addEventListener('click', () => {
            console.log('Now Clicked'); // Debug
            setTimeMode('now');
        });
    }



    // Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(() => console.log('Service Worker Registered'))
            .catch(err => console.error('Service Worker Failed', err));
    }

    // Start tick functionality
    setInterval(tick, 1000); // Unified tick
    tick(); // Initial call

    // Event Listeners
    ui.sendBtn.addEventListener('click', handleTextInput);
    ui.input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleTextInput();
    });

    // Date Picker Listener
    if (ui.datePicker) {
        ui.datePicker.addEventListener('change', handleDateChange);

        // Wrapper click triggers picker
        if (ui.dateWrapper) {
            ui.dateWrapper.addEventListener('click', () => {
                try {
                    ui.datePicker.showPicker();
                } catch (err) {
                    console.warn('showPicker not supported, fallback to focus');
                    ui.datePicker.focus();
                    ui.datePicker.click(); // Fallback try
                }
            });
        }
    }



    // Modal Listeners
    if (ui.modalConfirm) {
        ui.modalConfirm.addEventListener('click', saveEdit);
    }
    if (ui.modalCancel) {
        ui.modalCancel.addEventListener('click', () => {
            ui.modal.classList.remove('open');
        });
    }

    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.stream-actions') && !e.target.closest('.item-options')) {
            closeAllDropdowns();
        }
    });

    handleDateChange({ target: { value: getFormattedDate(new Date()) } }); // Init date
}

// --- Core Logic ---

function handleAction(configId) {
    const config = DEFAULT_CONFIG.actions.find(a => a.id === configId);
    if (!config) return;

    if (config.type === 'tag') {
        insertTag(config.tag);
    }
}

function insertTag(tag) {
    // Check if input already has text
    const currentVal = ui.input.value;
    if (currentVal.startsWith('#')) {
        // Replace existing tag? Or just append? 
        // Let's replace the tag part if it exists at the start
        const spaceIndex = currentVal.indexOf(' ');
        if (spaceIndex > 0) {
            ui.input.value = tag + currentVal.substring(spaceIndex + 1);
        } else {
            ui.input.value = tag;
        }
    } else {
        ui.input.value = tag + currentVal;
    }

    ui.input.focus();
}

function deleteEvent(eventId) {
    const index = state.history.findIndex(e => e.id === eventId);
    if (index === -1) return;

    const eventToDelete = state.history[index];

    // Confirmation usually good, but user wants fast Undo?
    // Let's rely on the fact they opened a menu to click delete.
    if (!confirm('确定删除这条记录吗？')) return;

    // Logic: If it is the VERY LATEST event (index 0), apply "Undo" logic (Smart Revert)
    // ONLY if it has duration (meaning it was a context switch)
    if (index === 0 && eventToDelete.duration) {
        // Restore the old activity
        state.currentActivity = {
            name: eventToDelete.name,
            startTime: eventToDelete.time - eventToDelete.duration
        };
    }

    // Remove from array
    state.history.splice(index, 1);

    saveState();
    renderStatus();
    renderHistory();
}

function editEvent(eventId) {
    const event = state.history.find(e => e.id === eventId);
    if (!event) return;

    // Populate Modal
    ui.modalEditId.value = eventId;
    ui.modalName.value = event.name;
    ui.modalDetail.value = event.detail || '';

    // Format Time for input[type="time"] (HH:MM)
    const dateObj = new Date(event.time);
    const timeStr = pad(dateObj.getHours()) + ':' + pad(dateObj.getMinutes());
    ui.modalTime.value = timeStr;

    // Show Modal
    ui.modal.classList.add('open');
    // Close dropdown
    closeAllDropdowns();
}

function saveEdit() {
    console.log('saveEdit clicked');
    const eventId = ui.modalEditId.value;
    console.log('Event ID:', eventId);

    const event = state.history.find(e => e.id === eventId);
    if (!event) {
        console.error('Event not found for ID:', eventId);
        return;
    }

    // Get Values
    const newName = ui.modalName.value.trim();
    const newDetail = ui.modalDetail.value.trim();
    const newTimeStr = ui.modalTime.value;

    console.log('Values:', newName, newDetail, newTimeStr);

    if (!newName) {
        alert('活动名称不能为空');
        return;
    }

    // Update Name/Detail
    event.name = newName;
    event.detail = newDetail;

    // Update Time
    if (newTimeStr) {
        const [h, m] = newTimeStr.split(':').map(Number);
        if (!isNaN(h) && !isNaN(m)) {
            const dateObj = new Date(event.time);
            dateObj.setHours(h);
            dateObj.setMinutes(m);
            event.time = dateObj.getTime();
        }
    }

    // Sort & Save
    state.history.sort((a, b) => b.time - a.time);
    saveState();
    renderHistory();

    // Close Modal
    ui.modal.classList.remove('open');
}

// Old switchContext removed, new one is defined below handleTextInput

function handleDateChange(e) {
    const val = e.target.value;
    if (!val) return;

    // Reset dial to Auto when changing date? Usually safer.
    setTimeMode('now');

    // Create date from YYYY-MM-DD string, treating it as local midnight

    // We append T00:00:00 to ensure local time construction
    viewDate = new Date(val + 'T00:00:00');

    const now = new Date();
    if (isSameDay(viewDate, now)) {
        viewDate = now; // Use actual 'now' object if it is today
        document.body.classList.remove('viewing-history');
    } else {
        document.body.classList.add('viewing-history');
    }

    renderStatus(); // Will call renderDateDisplay
    renderHistory();
}

function isSameDay(d1, d2) {
    return d1.getFullYear() === d2.getFullYear() &&
        d1.getMonth() === d2.getMonth() &&
        d1.getDate() === d2.getDate();
}

function handleTextInput() {
    const rawText = ui.input.value.trim();
    if (!rawText) return;

    // 1. Determine Base Time
    // If viewing history, use that date + current wall clock time
    let baseDate = new Date();
    const now = new Date();

    if (timeDialState.mode === 'manual' && timeDialState.hour !== null && timeDialState.minute !== null) {
        // MANUAL MODE: Use viewDate (day) + Dial (time)
        baseDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), viewDate.getDate(),
            timeDialState.hour, timeDialState.minute, 0);
    } else {
        // AUTO MODE (NOW)
        if (!isSameDay(viewDate, now)) {
            // Viewing history -> preserve Day, use Current Time
            baseDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), viewDate.getDate(),
                now.getHours(), now.getMinutes(), now.getSeconds());
        } else {
            // Viewing Today -> Just Now
            baseDate = now;
        }
    }


    // 2. Parsing Time Modifiers
    // Patterns: " -15m", " -15", " @10:30"
    let text = rawText;
    let customTime = baseDate.getTime();

    // Check for @HH:MM
    const atMatch = text.match(/\s+@(\d{1,2}[:：]\d{2})\s*$/);
    // Check for -Mm or -M
    const minusMatch = text.match(/\s+-(\d+)(m?)\s*$/);

    if (atMatch) {
        const timeStr = atMatch[1].replace('：', ':');
        const [hours, mins] = timeStr.split(':').map(Number);

        // Use baseDate's Year/Month/Day
        const date = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), hours, mins);
        customTime = date.getTime();
        text = text.substring(0, atMatch.index).trim();
    } else if (minusMatch) {
        const minutes = parseInt(minusMatch[1]);
        customTime = customTime - (minutes * 60 * 1000);
        text = text.substring(0, minusMatch.index).trim();
    }

    // 3. Dispatch
    if (text.startsWith('#记录 ')) {
        const content = text.replace('#记录 ', '').trim();

        // Logic Branch: Duration vs Context Switch
        // If we have a duration set in the dial, AND we are in manual mode (implied), treats as "Log Event" (Insertion)
        if (timeDialState.mode === 'manual' && timeDialState.duration > 0) {
            // Calculate duration in ms
            const durationMs = timeDialState.duration * 60 * 1000;
            // Log event with duration. 
            // Note: The 'customTime' is the START time.
            logEvent(content, `补录 (${formatDuration(durationMs)})`, durationMs, customTime);
        }
        // Prevent changing LIVE context if we are editing history (Safety check)
        else if (!isSameDay(viewDate, now)) {
            logEvent('补录: ' + content, '历史记录', null, customTime);
        } else {
            if (content) switchContext(content, customTime);
        }
    } else if (text.startsWith('#吃饭 ')) {

        const content = text.replace('#吃饭 ', '').trim();
        logEvent('吃饭', content, null, customTime);
    } else if (text.startsWith('#锻炼 ')) {
        const content = text.replace('#锻炼 ', '').trim();
        logEvent('锻炼', content, null, customTime);
    } else if (text.startsWith('#体重 ')) {

        const content = text.replace('#体重 ', '').trim();
        const num = parseFloat(content);
        if (!isNaN(num)) logEvent('体重', num + ' kg', null, customTime);
        else logEvent('体重', content, null, customTime);
    } else {
        logEvent('记录事情', text, null, customTime);
    }

    // Reset dial after send if manual
    if (timeDialState.mode === 'manual') {
        setTimeMode('now');
    }

    ui.input.value = '';
}



// Re-introducing switchContext which was accidentally deleted
function switchContext(newActivityName, startTime = Date.now()) {
    // Prevent duplicate
    if (state.currentActivity.name === newActivityName) return;

    // 1. Log previous activity
    if (state.currentActivity.name) {
        // Fix: Use the actual start time of the context as the end time of previous
        const endTime = startTime;
        let duration = endTime - state.currentActivity.startTime;
        if (duration < 0) duration = 0; // Protect against weird times

        logEvent(state.currentActivity.name, '持续时长 ' + formatDuration(duration), duration, endTime);
    }

    // 2. Set new activity
    state.currentActivity = {
        name: newActivityName,
        startTime: startTime
    };

    renderStatus();
    saveState();
}

function logEvent(name, detail, duration = null, time = Date.now()) {
    const event = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2),
        name,
        detail,
        time: time,
        duration
    };
    // Insert: Since time might be in past, 'unshift' (add to top) might break chronological visual order if we strictly sorted?
    // But 'history' is usually just a log stack.
    // However, if I add a past event, it visually should perhaps appear below newer events?
    // Current renderHistory reverses the array.
    // Let's just push to history array (which is new -> old sorted usually in my mind? No, unshift makes index 0 newest).
    // If I insert an old event, I should find correct spot? 
    // For MVP, simply putting it at top is fine, but sorting is better.

    state.history.push(event); // Add to end first
    // Sort history by time descending (newest first)
    state.history.sort((a, b) => b.time - a.time);

    // Re-render whole stream to ensure order
    renderHistory();
    saveState();
}

// --- Persistence ---

function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
        try {
            const loaded = JSON.parse(raw);
            state = { ...state, ...loaded };
        } catch (e) {
            console.error('Failed to load state', e);
        }
    }

    // Render
    renderStatus();
    renderHistory();
}

// --- Rendering ---

function renderQuickActions() {
    ui.quickActions.innerHTML = '';
    DEFAULT_CONFIG.actions.forEach(action => {
        const btn = document.createElement('div');
        btn.className = 'action-chip';
        // Undo special style removed as button is removed
        btn.textContent = action.label;
        btn.onclick = () => handleAction(action.id);
        ui.quickActions.appendChild(btn);
    });
}

function renderStatus() {
    ui.currentName.textContent = state.currentActivity.name;
    tick();
}

function tick() {
    const now = new Date();

    // 1. Update Date
    const isToday = isSameDay(viewDate, now);

    // Only update the display automatically if we are viewing "Today"
    // OR if we need to initialize the text
    if (isToday) {
        renderDateDisplay(now);
    } else {
        // If we are viewing history, ensure text matches viewDate (should happen on change, but safe to enforce)
        renderDateDisplay(viewDate);
    }

    // 2. Update Wall Clock


    // 2. Update Wall Clock
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    // ui.clock might be missing if I messed up the order, but ui definition is updated.
    if (ui.clock) ui.clock.textContent = `${hours}:${minutes}`;

    // 3. Update Activity Timer
    const diff = Date.now() - state.currentActivity.startTime;
    if (ui.currentTimer) ui.currentTimer.textContent = formatDuration(diff);
}

function renderDateDisplay(dateObj) {
    if (!ui.date) return;

    const month = dateObj.getMonth() + 1;
    const day = dateObj.getDate();
    const weeks = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const week = weeks[dateObj.getDay()];

    let text = `${month}月${day}日 ${week}`;

    // If viewing history, maybe add year if not current year?
    const now = new Date();
    if (!isSameDay(dateObj, now)) {
        if (dateObj.getFullYear() !== now.getFullYear()) {
            text = `${dateObj.getFullYear()}年${text}`;
        }
    }

    ui.date.innerText = text; // textContent might wipe child nodes if I wasn't careful? 
    // Wait, ui.date points to #date-display span inside the wrapper. Safe.
}


function renderHistory() {
    ui.stream.innerHTML = '';

    if (state.history.length === 0) {
        ui.stream.innerHTML = `<div class="stream-empty"><p>今天还没有记录</p><p>点击底部开始</p></div>`;
        return;
    }

    // history is now sorted descending (newest at index 0)

    // Filter by viewDate
    const filteredHistory = state.history.filter(event => {
        const d = new Date(event.time);
        return isSameDay(d, viewDate);
    });

    if (filteredHistory.length === 0) {
        // Different empty message for history?
        const isToday = isSameDay(viewDate, new Date());
        const msg = isToday ? '今天还没有记录<br>点击底部开始' : '这一天没有记录';
        ui.stream.innerHTML = `<div class="stream-empty"><p>${msg}</p></div>`;
        return;
    }

    filteredHistory.forEach(event => {

        renderStreamItem(event);
    });
}

function renderStreamItem(event) {
    const div = document.createElement('div');
    div.className = 'stream-item';
    div.id = `event-${event.id}`;

    const date = new Date(event.time);
    const timeStr = date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');

    const isDuration = !!event.duration;
    const extraClass = isDuration ? 'type-duration' : 'type-point';

    div.classList.add(extraClass);

    // Structure: Time | Content | Menu
    div.innerHTML = `
        <div class="stream-time">${timeStr}</div>
        <div class="stream-content">
            <div class="stream-title">${event.name}</div>
            <div class="stream-detail">${event.detail}</div>
        </div>
        <div class="stream-actions">
            <button class="btn-more" onclick="toggleItemMenu('${event.id}')">⋮</button>
            <div id="menu-${event.id}" class="item-options">
                <button class="btn-edit" onclick="editEvent('${event.id}')">✏️ 编辑</button>
                <button class="btn-delete" onclick="deleteEvent('${event.id}')">🗑️ 删除</button>
            </div>
        </div>
    `;

    const empty = ui.stream.querySelector('.stream-empty');
    if (empty) empty.remove();

    // ui.stream.prepend(div); // OLD logic
    ui.stream.appendChild(div); // NEW logic: append because we iterate sorted array
}

function toggleItemMenu(eventId) {
    // Close others
    closeAllDropdowns();
    const menu = document.getElementById(`menu-${eventId}`);
    if (menu) {
        menu.classList.toggle('show');
    }
}

function closeAllDropdowns() {
    document.querySelectorAll('.item-options.show').forEach(el => el.classList.remove('show'));
}

// --- Time Dial Logic ---

// --- Time Dial Logic ---

// Config
const ITEM_HEIGHT = 32;

function renderTimeDial() {
    if (!ui.dialHours || !ui.dialMinutes) return;

    // Hours 00-23
    ui.dialHours.innerHTML = '';
    // No spacers needed, padding handles it
    for (let i = 0; i < 24; i++) {
        const el = document.createElement('div');
        el.className = 'dial-item';
        el.textContent = pad(i);
        el.dataset.val = i;
        el.onclick = () => scrollToItem(ui.dialHours, i);
        ui.dialHours.appendChild(el);
    }

    // Minutes 00, 10, ... 50
    ui.dialMinutes.innerHTML = '';
    for (let i = 0; i < 60; i += 10) {
        const el = document.createElement('div');
        el.className = 'dial-item';
        el.textContent = pad(i);
        el.dataset.val = i;
        el.onclick = () => scrollToItem(ui.dialMinutes, i / 10); // Index is i/10
        ui.dialMinutes.appendChild(el);
    }

    // Duration Dial
    if (ui.dialDuration) {
        const DURATION_OPTIONS = [0, 5, 10, 15, 20, 25, 30, 40, 45, 50, 60, 90, 120, 180, 240];
        ui.dialDuration.innerHTML = '';
        DURATION_OPTIONS.forEach((min, index) => {
            const el = document.createElement('div');
            el.className = 'dial-item dial-duration-item';

            // Format text: "0" -> "-", "5" -> "5m", "60" -> "1h"
            let text = min === 0 ? '-' : min + 'm';
            if (min >= 60) {
                const h = Math.floor(min / 60);
                const m = min % 60;
                text = m > 0 ? `${h}h${m}` : `${h}h`;
            }

            el.textContent = text;
            el.dataset.val = min;
            el.onclick = () => scrollToItem(ui.dialDuration, index);
            ui.dialDuration.appendChild(el);
        });
        ui.dialDuration.addEventListener('scroll', debounce(() => handleScroll('duration'), 50));
    }

    // Scroll Listeners
    ui.dialHours.addEventListener('scroll', debounce(() => handleScroll('hour'), 50));
    ui.dialMinutes.addEventListener('scroll', debounce(() => handleScroll('minute'), 50));
}

function scrollToItem(container, index) {
    container.scrollTo({
        top: index * ITEM_HEIGHT,
        behavior: 'smooth'
    });
}

function handleScroll(type) {
    let container;
    if (type === 'hour') container = ui.dialHours;
    else if (type === 'minute') container = ui.dialMinutes;
    else if (type === 'duration') container = ui.dialDuration;

    if (!container) return;

    const scrollTop = container.scrollTop;
    const index = Math.round(scrollTop / ITEM_HEIGHT);
    const nodes = container.querySelectorAll('.dial-item');

    if (index >= 0 && index < nodes.length) {
        const val = parseInt(nodes[index].dataset.val);

        if (type === 'duration') {
            if (timeDialState.duration !== val) {
                timeDialState.duration = val;
                timeDialState.mode = 'manual';

                // Smart Interaction: If I pick a duration, and hour/min are null, default them to NOW?
                if (timeDialState.hour === null) timeDialState.hour = new Date().getHours();
                if (timeDialState.minute === null) timeDialState.minute = 0;

                updateDialVisuals();
            }
            return;
        }

        // Only update state if changed to avoid loop
        if (type === 'hour') {
            if (timeDialState.hour !== val) {
                timeDialState.hour = val;
                if (timeDialState.minute === null) timeDialState.minute = 0;
                timeDialState.mode = 'manual';
                updateDialVisuals();
            }
        } else {
            if (timeDialState.minute !== val) {
                timeDialState.minute = val;
                if (timeDialState.hour === null) timeDialState.hour = new Date().getHours();
                timeDialState.mode = 'manual';
                updateDialVisuals();
            }
        }
    }
}

// Simple debounce
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// handleDialClick removed in favor of scroll logic, but we kept scrollToItem



function setTimeMode(mode) {
    timeDialState.mode = mode;
    if (mode === 'now') {
        timeDialState.hour = null;
        timeDialState.minute = null;

        // Also reset duration to 0? Yes, Current = Now Point
        timeDialState.duration = 0;
        if (ui.dialDuration) scrollToItem(ui.dialDuration, 0);
    }

    updateDialVisuals();
}

function updateDialVisuals() {
    // "Now" Button
    if (timeDialState.mode === 'now') {
        ui.btnNow.classList.add('active');
        ui.btnNow.classList.remove('dimmed');
        // Dim the Dial
        if (ui.dialRow) ui.dialRow.classList.add('mode-now');
        if (ui.dialRow) ui.dialRow.classList.remove('mode-manual');
    } else {
        ui.btnNow.classList.remove('active');
        ui.btnNow.classList.add('dimmed');
        // Un-dim the Dial
        if (ui.dialRow) ui.dialRow.classList.remove('mode-now');
        if (ui.dialRow) ui.dialRow.classList.add('mode-manual');
    }


    // Highlight Items logic changed to scrolling
    // We just highlight the one that matches state
    const hItems = ui.dialHours.querySelectorAll('.dial-item');
    hItems.forEach(el => {
        if (timeDialState.mode === 'manual' && parseInt(el.dataset.val) === timeDialState.hour) {
            el.classList.add('selected');
        } else {
            el.classList.remove('selected');
        }
    });

    const mItems = ui.dialMinutes.querySelectorAll('.dial-item');
    mItems.forEach(el => {
        if (timeDialState.mode === 'manual' && parseInt(el.dataset.val) === timeDialState.minute) {
            el.classList.add('selected');
        } else {
            el.classList.remove('selected');
        }
    });

    if (ui.dialDuration) {
        const dItems = ui.dialDuration.querySelectorAll('.dial-item');
        dItems.forEach(el => {
            if (parseInt(el.dataset.val) === timeDialState.duration) {
                el.classList.add('selected');
            } else {
                el.classList.remove('selected');
            }
        });
    }
}




// --- Helpers ---

function formatDuration(ms) {
    if (ms < 0) ms = 0;
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const s_remain = s % 60;
    return `${pad(h)}:${pad(m)}:${pad(s_remain)}`;
}

function pad(n) {
    return n.toString().padStart(2, '0');
}

function closeModal() {
    if (ui.modal) ui.modal.classList.remove('open');
}

// Expose global functions for HTML inline onclick
window.handleAction = handleAction;
window.toggleItemMenu = toggleItemMenu;
window.editEvent = editEvent;
window.deleteEvent = deleteEvent;

// Run
init();
