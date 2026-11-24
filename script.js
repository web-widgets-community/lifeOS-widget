/* =========================================================
   SOLO // PLANNER  –  Player System Task Manager
   All data lives in localStorage
========================================================= */

const STORAGE_KEY = "solo_planner_v2";

const RANKS = [
    { min: 1,  rank: "E", title: "E-Rank Hunter" },
    { min: 5,  rank: "D", title: "D-Rank Hunter" },
    { min: 10, rank: "C", title: "C-Rank Hunter" },
    { min: 18, rank: "B", title: "B-Rank Hunter" },
    { min: 28, rank: "A", title: "A-Rank Hunter" },
    { min: 40, rank: "S", title: "S-Rank Hunter" },
    { min: 55, rank: "N", title: "National Level" },
    { min: 70, rank: "M", title: "Monarch" },
    { min: 90, rank: "∞", title: "Shadow Monarch" }
];

/* Shadow grades (lowest → highest) */
const SHADOW_GRADES = [
    { id: "soldier", label: "Shadow Soldier", powerBase: 10, icon: "♟", promoteCost: 50 },
    { id: "elite",   label: "Elite Soldier",  powerBase: 25, icon: "♞", promoteCost: 120 },
    { id: "knight",  label: "Shadow Knight",  powerBase: 55, icon: "♜", promoteCost: 300 },
    { id: "marshal", label: "Shadow Marshal", powerBase: 120, icon: "♛", promoteCost: 0 }
];

const SHADOW_NAMES = {
    soldier: ["Grim", "Shade", "Wraith", "Specter", "Hollow", "Dusk", "Veil", "Murk", "Gloom", "Phantom"],
    elite:   ["Igris", "Tank", "Iron", "Blade", "Fang", "Razor", "Storm", "Ash"],
    knight:  ["Beru", "Kaisel", "Tusk", "Jima", "Greed", "Nidhogg"],
    marshal: ["Bellion", "Ashborn", "Monarch's Hand"]
};

const defaultState = {
    player: {
        name: "Shadow Monarch",
        title: "E-Rank Hunter",
        level: 1,
        xp: 0,
        totalXP: 0,
        mana: 0           // spent on promotions
    },
    settings: {
        baseXP: 20,
        streakMultiplier: 1.1
    },
    quests: [],
    reminders: [],
    pages: [],
    shadows: [],          // shadow army
    extractsToday: 0,
    extractsDate: "",
    work: {},
    sessions: [],
    streakDays: {},
    timer: {
        seconds: 0,
        running: false,
        startedAt: null
    }
};

let state = load();
let questFilter = "all";
let shadowFilter = "all";
let editingQuestId = null;
let selectedShadowId = null;
let timerInterval = null;

/* -------------------------------------------------------
   STORAGE
------------------------------------------------------- */
function load() {
    try {
        let raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) raw = localStorage.getItem("solo_planner_v1"); // migrate
        if (!raw) return structuredClone(defaultState);
        const data = JSON.parse(raw);
        const merged = { ...structuredClone(defaultState), ...data };
        if (!merged.shadows) merged.shadows = [];
        if (merged.player && merged.player.mana == null) merged.player.mana = 0;
        return merged;
    } catch {
        return structuredClone(defaultState);
    }
}

function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* -------------------------------------------------------
   HELPERS
------------------------------------------------------- */
function todayKey() {
    return dateKey(new Date());
}

function dateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function formatTime(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return [h, m, s].map(x => String(x).padStart(2, "0")).join(":");
}

function formatHours(sec) {
    if (!sec) return "0m";
    if (sec < 3600) return Math.floor(sec / 60) + "m";
    return (sec / 3600).toFixed(1) + "h";
}

function escapeHTML(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function xpForLevel(level) {
    // Progressive XP curve
    return Math.floor(100 * Math.pow(1.25, level - 1));
}

function getRank(level) {
    let current = RANKS[0];
    for (const r of RANKS) {
        if (level >= r.min) current = r;
    }
    return current;
}

function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* -------------------------------------------------------
   NAVIGATION
------------------------------------------------------- */
function openPage(id, btn) {
    document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
    const page = document.getElementById(id);
    if (page) page.classList.add("active");

    document.querySelectorAll(".nav button").forEach(b => b.classList.remove("active"));
    if (btn) btn.classList.add("active");

    // Refresh page-specific content
    if (id === "dashboard") updateDashboard();
    if (id === "quests") renderQuests();
    if (id === "army") renderArmy();
    if (id === "calendar") renderCalendar();
    if (id === "timer") renderTimer();
    if (id === "stats") renderStats();
    if (id === "settings") renderSettings();
    if (id.startsWith("page-")) renderCustomPage(id.replace("page-", ""));
}

/* -------------------------------------------------------
   CLOCK
------------------------------------------------------- */
function updateClock() {
    const now = new Date();
    document.getElementById("clock").textContent = now.toLocaleTimeString("en-GB", {
        hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
}

/* -------------------------------------------------------
   PLAYER / LEVEL
------------------------------------------------------- */
function addXP(amount) {
    const streakMult = currentStreak() > 0
        ? Math.pow(state.settings.streakMultiplier, Math.min(currentStreak(), 10))
        : 1;
    const armyMult = 1 + armyXPBonus();
    const gained = Math.round(amount * streakMult * armyMult);

    state.player.xp += gained;
    state.player.totalXP += gained;
    // Mana for promotions (roughly 1 mana per 5 XP)
    state.player.mana = (state.player.mana || 0) + Math.max(1, Math.floor(gained / 5));

    let leveled = false;
    while (state.player.xp >= xpForLevel(state.player.level)) {
        state.player.xp -= xpForLevel(state.player.level);
        state.player.level += 1;
        leveled = true;
    }

    const rank = getRank(state.player.level);
    // Only overwrite title if it still looks like a rank title
    if (!state.player.title || state.player.title.includes("Rank") || state.player.title.includes("Monarch") || state.player.title.includes("National")) {
        state.player.title = rank.title;
    }

    save();
    updatePlayerUI();

    if (leveled) {
        showLevelUp(state.player.level, rank);
    }
    return gained;
}

function showLevelUp(level, rank) {
    const toast = document.getElementById("levelUpToast");
    document.getElementById("levelUpText").textContent =
        `You reached Level ${level} — ${rank.title}`;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 3500);
}

function updatePlayerUI() {
    const p = state.player;
    const rank = getRank(p.level);
    const needed = xpForLevel(p.level);
    const pct = Math.min(100, Math.round((p.xp / needed) * 100));

    document.getElementById("playerName").textContent = p.name;
    document.getElementById("playerTitle").textContent = p.title;
    document.getElementById("playerLevel").textContent = p.level;
    document.getElementById("playerXP").textContent = `${p.xp} / ${needed}`;
    document.getElementById("rankBadge").textContent = rank.rank;
    document.getElementById("xpFill").style.width = pct + "%";
    document.getElementById("xpText").textContent = pct + "%";
    document.getElementById("playerStreak").textContent = currentStreak();
    document.getElementById("playerQuestsDone").textContent =
        state.quests.filter(q => q.done).length;
}

/* -------------------------------------------------------
   SHADOW ARMY
------------------------------------------------------- */
function armyCapacity() {
    // Base 3 + 1 per 2 levels, rank bonuses
    const lvl = state.player.level;
    let cap = 3 + Math.floor(lvl / 2);
    const rank = getRank(lvl).rank;
    if (rank === "A" || rank === "S") cap += 3;
    if (rank === "N" || rank === "M") cap += 6;
    if (rank === "∞") cap += 12;
    return cap;
}

function shadowPower(s) {
    const g = SHADOW_GRADES.find(x => x.id === s.grade) || SHADOW_GRADES[0];
    return Math.round(g.powerBase * (1 + (s.level - 1) * 0.15) * (1 + (s.loyalty || 0) * 0.02));
}

function totalArmyPower() {
    return (state.shadows || []).reduce((sum, s) => sum + shadowPower(s), 0);
}

function armyXPBonus() {
    // ~1% per 40 power, capped at 50%
    return Math.min(0.5, totalArmyPower() / 4000);
}

function resetExtractsIfNeeded() {
    const today = todayKey();
    if (state.extractsDate !== today) {
        state.extractsToday = 0;
        state.extractsDate = today;
    }
}

function pickGradeForQuest(q) {
    // Higher priority / harder types → better shadows
    const roll = Math.random();
    if (q.priority === "urgent" || q.type === "monthly") {
        if (roll < 0.08) return "marshal";
        if (roll < 0.30) return "knight";
        if (roll < 0.65) return "elite";
        return "soldier";
    }
    if (q.priority === "high" || q.type === "weekly") {
        if (roll < 0.04) return "marshal";
        if (roll < 0.20) return "knight";
        if (roll < 0.55) return "elite";
        return "soldier";
    }
    if (roll < 0.02) return "knight";
    if (roll < 0.20) return "elite";
    return "soldier";
}

function randomShadowName(grade) {
    const pool = SHADOW_NAMES[grade] || SHADOW_NAMES.soldier;
    const used = new Set((state.shadows || []).map(s => s.name));
    const available = pool.filter(n => !used.has(n));
    if (available.length) return available[Math.floor(Math.random() * available.length)];
    return pool[Math.floor(Math.random() * pool.length)] + " " + (Math.floor(Math.random() * 90) + 10);
}

function canExtract(q) {
    resetExtractsIfNeeded();
    if ((state.shadows || []).length >= armyCapacity()) return false;
    // Daily extract limit scales with level
    const maxExtracts = 2 + Math.floor(state.player.level / 10);
    if (state.extractsToday >= maxExtracts) return false;

    // Chance based on quest
    let chance = 0.25;
    if (q.priority === "high") chance = 0.45;
    if (q.priority === "urgent") chance = 0.70;
    if (q.type === "weekly") chance = Math.max(chance, 0.55);
    if (q.type === "monthly") chance = Math.max(chance, 0.75);
    if (q.type === "daily" && q.priority === "low") chance = 0.12;

    return Math.random() < chance;
}

function extractShadow(q) {
    if (!canExtract(q)) return null;

    const grade = pickGradeForQuest(q);
    const shadow = {
        id: uid(),
        name: randomShadowName(grade),
        grade,
        level: 1,
        loyalty: 10,
        origin: q.name,
        extractedAt: new Date().toISOString(),
        sourceQuestId: q.id
    };

    state.shadows = state.shadows || [];
    state.shadows.push(shadow);
    state.extractsToday = (state.extractsToday || 0) + 1;
    state.extractsDate = todayKey();
    save();

    showArise(shadow);
    return shadow;
}

function showArise(shadow) {
    const g = SHADOW_GRADES.find(x => x.id === shadow.grade);
    const toast = document.getElementById("ariseToast");
    document.getElementById("ariseText").textContent =
        `${shadow.name} (${g ? g.label : shadow.grade}) has answered the call`;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 4000);
}

function setShadowFilter(f, btn) {
    shadowFilter = f;
    document.querySelectorAll("[data-sfilter]").forEach(b => b.classList.remove("active"));
    if (btn) btn.classList.add("active");
    renderArmy();
}

function renderArmy() {
    resetExtractsIfNeeded();
    const shadows = state.shadows || [];
    const cap = armyCapacity();
    const power = totalArmyPower();
    const bonus = armyXPBonus();

    document.getElementById("armySize").textContent = `${shadows.length} / ${cap}`;
    document.getElementById("armyPower").textContent = power;
    document.getElementById("armyXPBonus").textContent = `+${Math.round(bonus * 100)}%`;
    document.getElementById("armyExtracts").textContent = state.extractsToday || 0;

    const grades = shadows.map(s => s.grade);
    const order = ["marshal", "knight", "elite", "soldier"];
    const top = order.find(g => grades.includes(g));
    document.getElementById("armyTopGrade").textContent = top
        ? (SHADOW_GRADES.find(x => x.id === top) || {}).label || top
        : "—";

    // Bonuses chips
    const bonuses = document.getElementById("armyBonuses");
    const chips = [];
    chips.push(`<div class="bonus-chip">XP Boost <span>+${Math.round(bonus * 100)}%</span></div>`);
    if (shadows.length >= 5) chips.push(`<div class="bonus-chip">Legion <span>Streak shield (1 miss/week)</span></div>`);
    if (shadows.some(s => s.grade === "marshal")) chips.push(`<div class="bonus-chip">Marshal Presence <span>+10% quest XP</span></div>`);
    if (power >= 500) chips.push(`<div class="bonus-chip">Dominion <span>Extra daily extract</span></div>`);
    bonuses.innerHTML = chips.join("") || `<span style="color:var(--muted);font-size:12px">Complete quests to extract shadows and unlock bonuses.</span>`;

    let list = shadows;
    if (shadowFilter !== "all") list = shadows.filter(s => s.grade === shadowFilter);

    list = [...list].sort((a, b) => {
        const oa = order.indexOf(a.grade);
        const ob = order.indexOf(b.grade);
        if (oa !== ob) return oa - ob;
        return shadowPower(b) - shadowPower(a);
    });

    const el = document.getElementById("shadowList");
    if (!list.length) {
        el.innerHTML = `<div class="empty-state" style="grid-column:1/-1">No shadows yet. Complete high-priority or weekly/monthly quests and command them: <strong>ARISE</strong>.</div>`;
        return;
    }

    el.innerHTML = list.map(s => {
        const g = SHADOW_GRADES.find(x => x.id === s.grade) || SHADOW_GRADES[0];
        return `
        <div class="shadow-card grade-${s.grade}" onclick="openShadow('${s.id}')">
            <div class="shadow-avatar">${g.icon}</div>
            <div class="shadow-name">${escapeHTML(s.name)}</div>
            <div class="shadow-grade">${g.label}</div>
            <div class="shadow-meta">
                <span>Lv.${s.level}</span>
                <span class="shadow-power">${shadowPower(s)} PWR</span>
            </div>
        </div>`;
    }).join("");
}

function openShadow(id) {
    const s = (state.shadows || []).find(x => x.id === id);
    if (!s) return;
    selectedShadowId = id;
    const g = SHADOW_GRADES.find(x => x.id === s.grade) || SHADOW_GRADES[0];
    const gIdx = SHADOW_GRADES.findIndex(x => x.id === s.grade);
    const next = SHADOW_GRADES[gIdx + 1];

    document.getElementById("shadowModalTitle").textContent = s.name;
    document.getElementById("shadowModalBody").innerHTML = `
        <div class="shadow-detail-row"><span class="shadow-detail-label">Grade</span><span class="shadow-detail-value">${g.label}</span></div>
        <div class="shadow-detail-row"><span class="shadow-detail-label">Level</span><span class="shadow-detail-value">${s.level}</span></div>
        <div class="shadow-detail-row"><span class="shadow-detail-label">Power</span><span class="shadow-detail-value">${shadowPower(s)}</span></div>
        <div class="shadow-detail-row"><span class="shadow-detail-label">Loyalty</span><span class="shadow-detail-value">${s.loyalty || 0}</span></div>
        <div class="shadow-detail-row"><span class="shadow-detail-label">Origin</span><span class="shadow-detail-value">${escapeHTML(s.origin || "Unknown")}</span></div>
        <div class="shadow-detail-row"><span class="shadow-detail-label">Your Mana</span><span class="shadow-detail-value">${state.player.mana || 0}</span></div>
        ${next ? `<div class="shadow-detail-row"><span class="shadow-detail-label">Promote to</span><span class="shadow-detail-value">${next.label} (${g.promoteCost} mana)</span></div>` : `<div class="shadow-detail-row"><span class="shadow-detail-label">Status</span><span class="shadow-detail-value">Max grade</span></div>`}
    `;

    const promoBtn = document.getElementById("shadowPromoteBtn");
    if (next) {
        promoBtn.style.display = "";
        promoBtn.textContent = `PROMOTE (${g.promoteCost} mana)`;
        promoBtn.disabled = (state.player.mana || 0) < g.promoteCost;
    } else {
        promoBtn.style.display = "none";
    }

    document.getElementById("shadowModal").classList.add("open");
}

function promoteShadow() {
    const s = (state.shadows || []).find(x => x.id === selectedShadowId);
    if (!s) return;
    const gIdx = SHADOW_GRADES.findIndex(x => x.id === s.grade);
    const g = SHADOW_GRADES[gIdx];
    const next = SHADOW_GRADES[gIdx + 1];
    if (!next) return alert("Already maximum grade.");
    if ((state.player.mana || 0) < g.promoteCost) return alert("Not enough mana.");

    state.player.mana -= g.promoteCost;
    s.grade = next.id;
    s.level += 1;
    s.loyalty = (s.loyalty || 0) + 15;
    save();
    closeModal("shadowModal");
    renderArmy();
    updateDashboard();
    showArise(s);
}

function dismissShadow() {
    if (!confirm("Dismiss this shadow permanently?")) return;
    state.shadows = (state.shadows || []).filter(x => x.id !== selectedShadowId);
    save();
    closeModal("shadowModal");
    renderArmy();
    updateDashboard();
}

function trainShadowsOnQuestComplete(q) {
    // Shadows gain loyalty / level slowly when you complete quests
    (state.shadows || []).forEach(s => {
        s.loyalty = Math.min(100, (s.loyalty || 0) + 1);
        if (Math.random() < 0.15) {
            s.level = Math.min(50, (s.level || 1) + 1);
        }
    });
}

/* -------------------------------------------------------
   STREAK
------------------------------------------------------- */
function currentStreak() {
    let streak = 0;
    const d = new Date();
    // Allow today or yesterday as the start
    if (!state.streakDays[dateKey(d)]) {
        d.setDate(d.getDate() - 1);
        if (!state.streakDays[dateKey(d)]) return 0;
    }
    while (state.streakDays[dateKey(d)]) {
        streak++;
        d.setDate(d.getDate() - 1);
    }
    return streak;
}

function longestStreak() {
    const keys = Object.keys(state.streakDays).sort();
    if (!keys.length) return 0;
    let max = 1, cur = 1;
    for (let i = 1; i < keys.length; i++) {
        const prev = new Date(keys[i - 1]);
        const now = new Date(keys[i]);
        const diff = (now - prev) / 86400000;
        if (diff === 1) {
            cur++;
            max = Math.max(max, cur);
        } else {
            cur = 1;
        }
    }
    return max;
}

function markStreakDay() {
    const key = todayKey();
    state.streakDays[key] = (state.streakDays[key] || 0) + 1;
    save();
}

/* -------------------------------------------------------
   QUESTS
------------------------------------------------------- */
function showQuestModal(id = null) {
    editingQuestId = id;
    const modal = document.getElementById("questModal");
    document.getElementById("questModalTitle").textContent = id ? "EDIT QUEST" : "NEW QUEST";

    // Populate page select
    const pageSelect = document.getElementById("qPage");
    pageSelect.innerHTML = '<option value="">Main Board</option>';
    state.pages.forEach(p => {
        pageSelect.innerHTML += `<option value="${p.id}">${escapeHTML(p.icon)} ${escapeHTML(p.name)}</option>`;
    });

    if (id) {
        const q = state.quests.find(x => x.id === id);
        if (!q) return;
        document.getElementById("qName").value = q.name;
        document.getElementById("qType").value = q.type;
        document.getElementById("qPriority").value = q.priority;
        document.getElementById("qCategory").value = q.category || "";
        document.getElementById("qXP").value = q.xp;
        document.getElementById("qDate").value = q.date || "";
        document.getElementById("qTime").value = q.time || "";
        document.getElementById("qPage").value = q.pageId || "";
        document.getElementById("qNotes").value = q.notes || "";
    } else {
        document.getElementById("qName").value = "";
        document.getElementById("qType").value = "daily";
        document.getElementById("qPriority").value = "medium";
        document.getElementById("qCategory").value = "";
        document.getElementById("qXP").value = state.settings.baseXP;
        document.getElementById("qDate").value = todayKey();
        document.getElementById("qTime").value = "";
        document.getElementById("qPage").value = "";
        document.getElementById("qNotes").value = "";
    }
    modal.classList.add("open");
}

function saveQuest() {
    const name = document.getElementById("qName").value.trim();
    if (!name) return alert("Quest name is required.");

    const data = {
        name,
        type: document.getElementById("qType").value,
        priority: document.getElementById("qPriority").value,
        category: document.getElementById("qCategory").value.trim(),
        xp: Number(document.getElementById("qXP").value) || state.settings.baseXP,
        date: document.getElementById("qDate").value,
        time: document.getElementById("qTime").value,
        pageId: document.getElementById("qPage").value,
        notes: document.getElementById("qNotes").value.trim(),
        done: false,
        createdAt: new Date().toISOString()
    };

    if (editingQuestId) {
        const idx = state.quests.findIndex(q => q.id === editingQuestId);
        if (idx !== -1) {
            state.quests[idx] = { ...state.quests[idx], ...data };
        }
    } else {
        state.quests.push({ id: uid(), ...data });
    }

    save();
    closeModal("questModal");
    renderQuests();
    updateDashboard();
}

function toggleQuest(id) {
    const q = state.quests.find(x => x.id === id);
    if (!q) return;

    q.done = !q.done;
    if (q.done) {
        // Marshal presence bonus
        let xp = q.xp;
        if ((state.shadows || []).some(s => s.grade === "marshal")) {
            xp = Math.round(xp * 1.1);
        }
        addXP(xp);
        markStreakDay();
        trainShadowsOnQuestComplete(q);
        extractShadow(q); // may ARISE a new shadow
    }
    save();
    renderQuests();
    updateDashboard();
    updatePlayerUI();
    if (document.getElementById("army")?.classList.contains("active")) renderArmy();
}

function deleteQuest(id) {
    if (!confirm("Delete this quest?")) return;
    state.quests = state.quests.filter(q => q.id !== id);
    save();
    renderQuests();
    updateDashboard();
}

function setQuestFilter(f, btn) {
    questFilter = f;
    document.querySelectorAll(".filter").forEach(b => b.classList.remove("active"));
    if (btn) btn.classList.add("active");
    renderQuests();
}

function renderQuests(pageId = null) {
    const list = pageId
        ? document.getElementById(`pageQuestList-${pageId}`)
        : document.getElementById("questList");
    if (!list) return;

    let quests = state.quests;

    if (pageId) {
        quests = quests.filter(q => q.pageId === pageId);
    } else {
        // Main board – no page or filter
        if (questFilter === "done") {
            quests = quests.filter(q => q.done);
        } else if (questFilter !== "all") {
            quests = quests.filter(q => q.type === questFilter && !q.done);
        } else {
            quests = quests.filter(q => !q.done || questFilter === "all");
            // show all but put done at bottom
            quests.sort((a, b) => Number(a.done) - Number(b.done));
        }
    }

    // Sort by priority then date
    const prio = { urgent: 0, high: 1, medium: 2, low: 3 };
    quests.sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        return (prio[a.priority] || 2) - (prio[b.priority] || 2);
    });

    if (!quests.length) {
        list.innerHTML = `<div class="empty-state">No quests found. Create one to begin your journey.</div>`;
        return;
    }

    list.innerHTML = quests.map(q => questHTML(q)).join("");
}

function questHTML(q) {
    const prioClass = q.priority === "high" || q.priority === "urgent"
        ? `priority-${q.priority}` : "";
    return `
    <div class="task ${q.done ? "done" : ""}" onclick="toggleQuest('${q.id}')">
        <div class="task-checkbox">${q.done ? "✓" : ""}</div>
        <div class="task-info">
            <div class="task-name">${escapeHTML(q.name)}</div>
            <div class="task-meta">
                <span class="tag">${q.type}</span>
                ${q.category ? `<span class="tag">${escapeHTML(q.category)}</span>` : ""}
                <span class="${prioClass}">${q.priority}</span>
                <span>+${q.xp} XP</span>
                ${q.date ? `<span>${q.date}${q.time ? " " + q.time : ""}</span>` : ""}
            </div>
        </div>
        <div class="task-actions">
            <button onclick="event.stopPropagation();showQuestModal('${q.id}')" title="Edit">✎</button>
            <button onclick="event.stopPropagation();deleteQuest('${q.id}')" title="Delete">✕</button>
        </div>
    </div>`;
}

/* -------------------------------------------------------
   REMINDERS
------------------------------------------------------- */
function showReminderModal() {
    document.getElementById("rTitle").value = "";
    document.getElementById("rDate").value = todayKey();
    document.getElementById("rTime").value = "";
    document.getElementById("rNotes").value = "";
    document.getElementById("reminderModal").classList.add("open");
}

function saveReminder() {
    const title = document.getElementById("rTitle").value.trim();
    if (!title) return alert("Title required.");
    state.reminders.push({
        id: uid(),
        title,
        date: document.getElementById("rDate").value,
        time: document.getElementById("rTime").value,
        notes: document.getElementById("rNotes").value.trim(),
        done: false
    });
    save();
    closeModal("reminderModal");
    renderCalendar();
    updateDashboard();
}

function deleteReminder(id) {
    state.reminders = state.reminders.filter(r => r.id !== id);
    save();
    renderCalendar();
    updateDashboard();
}

function renderCalendar() {
    const rList = document.getElementById("reminderList");
    const sList = document.getElementById("scheduledList");

    const upcoming = state.reminders
        .filter(r => !r.done)
        .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

    rList.innerHTML = upcoming.length
        ? upcoming.map(r => `
            <div class="task">
                <div class="task-info">
                    <div class="task-name">${escapeHTML(r.title)}</div>
                    <div class="task-meta">
                        <span>${r.date}${r.time ? " • " + r.time : ""}</span>
                        ${r.notes ? `<span>${escapeHTML(r.notes)}</span>` : ""}
                    </div>
                </div>
                <div class="task-actions">
                    <button onclick="deleteReminder('${r.id}')">✕</button>
                </div>
            </div>`).join("")
        : `<div class="empty-state">No upcoming reminders.</div>`;

    const scheduled = state.quests
        .filter(q => q.date && q.date >= todayKey() && !q.done)
        .sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));

    sList.innerHTML = scheduled.length
        ? scheduled.map(q => questHTML(q)).join("")
        : `<div class="empty-state">No scheduled quests.</div>`;
}

/* -------------------------------------------------------
   TIMER
------------------------------------------------------- */
function startTimer() {
    if (state.timer.running) return;
    state.timer.running = true;
    state.timer.startedAt = Date.now() - state.timer.seconds * 1000;
    save();
    timerInterval = setInterval(() => {
        state.timer.seconds = Math.floor((Date.now() - state.timer.startedAt) / 1000);
        document.getElementById("timerDisplay").textContent = formatTime(state.timer.seconds);
    }, 250);
}

function pauseTimer() {
    if (!state.timer.running) return;
    state.timer.running = false;
    state.timer.seconds = Math.floor((Date.now() - state.timer.startedAt) / 1000);
    clearInterval(timerInterval);
    save();
}

function resetTimer() {
    const sec = state.timer.seconds;
    if (sec >= 60) {
        // Award XP for completed session
        const cat = document.getElementById("timerCategory").value;
        const xpPer25 = Number(document.getElementById("timerXP").value) || 15;
        const xp = Math.round((sec / 1500) * xpPer25);

        state.sessions.push({
            id: uid(),
            date: todayKey(),
            category: cat,
            seconds: sec,
            xp
        });

        const key = todayKey();
        state.work[key] = (state.work[key] || 0) + sec;

        if (xp > 0) {
            addXP(xp);
            markStreakDay();
        }
    }

    state.timer.seconds = 0;
    state.timer.running = false;
    state.timer.startedAt = null;
    clearInterval(timerInterval);
    save();
    renderTimer();
    updateDashboard();
}

function renderTimer() {
    document.getElementById("timerDisplay").textContent = formatTime(state.timer.seconds);
    const list = document.getElementById("sessionList");
    const todaySessions = state.sessions.filter(s => s.date === todayKey()).reverse();
    list.innerHTML = todaySessions.length
        ? todaySessions.map(s => `
            <div class="task">
                <div class="task-info">
                    <div class="task-name">${escapeHTML(s.category)}</div>
                    <div class="task-meta">
                        <span>${formatHours(s.seconds)}</span>
                        <span>+${s.xp} XP</span>
                    </div>
                </div>
            </div>`).join("")
        : `<div class="empty-state">No sessions today. Start the timer!</div>`;
}

/* -------------------------------------------------------
   CUSTOM PAGES
------------------------------------------------------- */
function showAddPageModal() {
    document.getElementById("pName").value = "";
    document.getElementById("pIcon").value = "📁";
    document.getElementById("pageModal").classList.add("open");
}

function savePage() {
    const name = document.getElementById("pName").value.trim();
    if (!name) return alert("Page name required.");
    const icon = document.getElementById("pIcon").value.trim() || "📁";
    const id = uid();
    state.pages.push({ id, name, icon });
    save();
    closeModal("pageModal");
    buildCustomPages();
    renderSettings();
}

function deletePage(id) {
    if (!confirm("Delete this page? Quests on it will remain but lose the page link.")) return;
    state.pages = state.pages.filter(p => p.id !== id);
    // Clear pageId from quests
    state.quests.forEach(q => { if (q.pageId === id) q.pageId = ""; });
    save();
    buildCustomPages();
    renderSettings();
}

function buildCustomPages() {
    const nav = document.getElementById("customNav");
    const container = document.getElementById("customPagesContainer");
    nav.innerHTML = "";
    container.innerHTML = "";

    state.pages.forEach(p => {
        // Nav button
        const btn = document.createElement("button");
        btn.dataset.page = "page-" + p.id;
        btn.textContent = `${p.icon} ${p.name}`;
        btn.onclick = function () { openPage("page-" + p.id, this); };
        nav.appendChild(btn);

        // Page section
        const sec = document.createElement("section");
        sec.id = "page-" + p.id;
        sec.className = "page";
        sec.innerHTML = `
            <div class="page-header">
                <div>
                    <h1>${escapeHTML(p.icon)} ${escapeHTML(p.name)}</h1>
                    <p>Custom quest board</p>
                </div>
                <button class="btn primary" onclick="showQuestModal()">+ NEW QUEST</button>
            </div>
            <div id="pageQuestList-${p.id}" class="task-list"></div>
        `;
        container.appendChild(sec);
    });
}

function renderCustomPage(pageId) {
    renderQuests(pageId);
}

/* -------------------------------------------------------
   DASHBOARD
------------------------------------------------------- */
function updateDashboard() {
    const today = todayKey();
    document.getElementById("todayDate").textContent = new Date().toLocaleDateString("en-GB", {
        weekday: "long", year: "numeric", month: "long", day: "numeric"
    });

    updatePlayerUI();

    // Today quests
    const todayQuests = state.quests.filter(q => {
        if (q.type === "daily") return true;
        if (q.date === today) return true;
        return false;
    });
    const done = todayQuests.filter(q => q.done).length;
    const total = todayQuests.length;
    const pct = total ? Math.round((done / total) * 100) : 0;

    document.getElementById("dashProgress").textContent = pct + "%";
    document.getElementById("dashWork").textContent = formatHours(state.work[today] || 0);
    document.getElementById("dashActive").textContent = state.quests.filter(q => !q.done).length;
    const armyEl = document.getElementById("dashArmy");
    if (armyEl) armyEl.textContent = (state.shadows || []).length;

    // Today list
    const list = document.getElementById("todayQuestsList");
    const show = todayQuests.filter(q => !q.done).slice(0, 8);
    list.innerHTML = show.length
        ? show.map(q => questHTML(q)).join("")
        : `<div class="empty-state">All clear for today. Great work, Hunter.</div>`;

    renderContribGraph();
}

function renderContribGraph() {
    const graph = document.getElementById("contribGraph");
    const days = 53 * 7; // ~1 year
    const today = new Date();
    let html = "";
    let total = 0;

    // Start from ~1 year ago, aligned to week
    const start = new Date(today);
    start.setDate(start.getDate() - days + 1);

    for (let i = 0; i < days; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        const key = dateKey(d);
        const count = state.streakDays[key] || 0;
        total += count > 0 ? 1 : 0;

        let cls = "";
        if (count >= 5) cls = "l4";
        else if (count >= 3) cls = "l3";
        else if (count >= 2) cls = "l2";
        else if (count >= 1) cls = "l1";

        html += `<div class="contrib-day ${cls}" title="${key}: ${count} activities"></div>`;
    }
    graph.innerHTML = html;
    document.getElementById("contribCount").textContent =
        `${total} contributions in the last year`;
}

/* -------------------------------------------------------
   STATS
------------------------------------------------------- */
function renderStats() {
    document.getElementById("statTotalXP").textContent = state.player.totalXP;
    document.getElementById("statLongestStreak").textContent = longestStreak();

    const totalSec = Object.values(state.work).reduce((a, b) => a + b, 0);
    document.getElementById("statTotalWork").textContent = formatHours(totalSec);

    // Week bars
    const bars = document.getElementById("weekBars");
    const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    let html = "";
    let max = 1;
    const values = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const sec = state.work[dateKey(d)] || 0;
        values.push({ sec, label: labels[d.getDay()] });
        if (sec > max) max = sec;
    }
    values.forEach(v => {
        const h = Math.max(4, Math.round((v.sec / max) * 100));
        html += `<div class="week-bar" style="height:${h}%"><span>${v.label}</span></div>`;
    });
    bars.innerHTML = html;

    // Category breakdown
    const cats = {};
    state.sessions.forEach(s => {
        cats[s.category] = (cats[s.category] || 0) + s.seconds;
    });
    const catTotal = Object.values(cats).reduce((a, b) => a + b, 0) || 1;
    const catEl = document.getElementById("categoryBreakdown");
    catEl.innerHTML = Object.entries(cats).length
        ? Object.entries(cats)
            .sort((a, b) => b[1] - a[1])
            .map(([name, sec]) => `
                <div class="cat-row">
                    <span style="width:80px">${escapeHTML(name)}</span>
                    <div class="cat-bar"><div class="cat-fill" style="width:${Math.round((sec / catTotal) * 100)}%"></div></div>
                    <span>${formatHours(sec)}</span>
                </div>`).join("")
        : `<div class="empty-state">No session data yet.</div>`;
}

/* -------------------------------------------------------
   SETTINGS
------------------------------------------------------- */
function renderSettings() {
    document.getElementById("setName").value = state.player.name;
    document.getElementById("setTitle").value = state.player.title;
    document.getElementById("setBaseXP").value = state.settings.baseXP;
    document.getElementById("setStreakMult").value = state.settings.streakMultiplier;

    const list = document.getElementById("customPagesList");
    list.innerHTML = state.pages.length
        ? state.pages.map(p => `
            <div class="task" style="margin-bottom:6px">
                <div class="task-info">
                    <div class="task-name">${escapeHTML(p.icon)} ${escapeHTML(p.name)}</div>
                </div>
                <div class="task-actions">
                    <button onclick="deletePage('${p.id}')">✕</button>
                </div>
            </div>`).join("")
        : `<div class="empty-state" style="padding:10px">No custom pages yet.</div>`;
}

function saveProfile() {
    state.player.name = document.getElementById("setName").value.trim() || "Shadow Monarch";
    state.player.title = document.getElementById("setTitle").value.trim() || getRank(state.player.level).title;
    save();
    updatePlayerUI();
    alert("Profile saved.");
}

function saveXPSettings() {
    state.settings.baseXP = Number(document.getElementById("setBaseXP").value) || 20;
    state.settings.streakMultiplier = Number(document.getElementById("setStreakMult").value) || 1.1;
    save();
    alert("XP settings saved.");
}

function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `solo-planner-backup-${todayKey()}.json`;
    a.click();
}

function importData() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            try {
                const data = JSON.parse(ev.target.result);
                state = { ...structuredClone(defaultState), ...data };
                save();
                location.reload();
            } catch {
                alert("Invalid JSON file.");
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

function resetAllData() {
    if (!confirm("This will wipe ALL data. Are you sure?")) return;
    if (!confirm("Really? This cannot be undone.")) return;
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
}

/* -------------------------------------------------------
   MODAL HELPERS
------------------------------------------------------- */
function closeModal(id) {
    document.getElementById(id).classList.remove("open");
}

document.querySelectorAll(".modal-overlay").forEach(overlay => {
    overlay.addEventListener("click", e => {
        if (e.target === overlay) overlay.classList.remove("open");
    });
});

/* -------------------------------------------------------
   DAILY QUEST RESET (simple)
------------------------------------------------------- */
function checkDailyReset() {
    const last = localStorage.getItem("solo_last_reset");
    const today = todayKey();
    if (last === today) return;

    // Reset daily quests that were completed
    state.quests.forEach(q => {
        if (q.type === "daily" && q.done) {
            q.done = false;
        }
    });
    localStorage.setItem("solo_last_reset", today);
    save();
}

/* -------------------------------------------------------
   INIT
------------------------------------------------------- */
function init() {
    checkDailyReset();
    resetExtractsIfNeeded();
    buildCustomPages();
    updateClock();
    setInterval(updateClock, 1000);
    updateDashboard();
    renderQuests();
    renderArmy();
    renderCalendar();
    renderTimer();
    renderStats();
    renderSettings();

    // Restore timer if it was running
    if (state.timer.running && state.timer.startedAt) {
        state.timer.seconds = Math.floor((Date.now() - state.timer.startedAt) / 1000);
        startTimer();
    }
}

document.addEventListener("DOMContentLoaded", init);
