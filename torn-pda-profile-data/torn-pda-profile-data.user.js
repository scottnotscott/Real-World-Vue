// ==UserScript==
// @name         Torn PDA - Profile Data Panel
// @namespace    local.torn.pda.profiledata
// @version      0.1.0
// @description  Mobile-friendly profile stats panel for Torn PDA.
// @match        https://www.torn.com/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const SCRIPT_ID = "tpda-profile-data-panel";
  const STYLE_ID = "tpda-profile-data-style";
  const API_BASE_URL = "https://api.torn.com/v2";
  const API_KEY = "###PDA-APIKEY###";
  const API_KEY_PLACEHOLDER = `${"#".repeat(3)}PDA-APIKEY${"#".repeat(3)}`;
  const WINDOW_DAYS = 30;
  const WINDOW_SECONDS = WINDOW_DAYS * 86400;
  const POLL_INTERVAL_MS = 1200;
  const CACHE_TTL_MS = 5 * 60 * 1000;
  const MAX_CACHE_ENTRIES = 30;

  const MONTHLY_STAT_NAMES = [
    "timeplayed",
    "xantaken",
    "overdosed",
    "cantaken",
    "refills",
    "nerverefills",
    "boostersused",
    "statenhancersused",
    "networth"
  ];

  const CURRENT_STAT_NAMES = [
    "timeplayed",
    "xantaken",
    "overdosed",
    "cantaken",
    "refills",
    "nerverefills",
    "boostersused",
    "statenhancersused",
    "networth",
    "activestreak",
    "bestactivestreak",
    "rankedwarhits",
    "attackswon",
    "reviveskill",
    "racingskill",
    "respectforfaction",
    "rehabcost",
    "totalworkingstats"
  ];

  const state = {
    profileId: null,
    requestId: 0,
    root: null,
    cache: new Map()
  };

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${SCRIPT_ID} {
        box-sizing: border-box;
        width: min(980px, calc(100vw - 16px));
        margin: 8px auto;
        padding: 10px;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(20, 20, 24, 0.92);
        color: #e5e5e5;
        font-family: Arial, sans-serif;
        line-height: 1.25;
      }
      #${SCRIPT_ID} * {
        box-sizing: border-box;
      }
      #${SCRIPT_ID} .tpda-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 8px;
      }
      #${SCRIPT_ID} .tpda-title {
        font-size: 16px;
        font-weight: 700;
      }
      #${SCRIPT_ID} .tpda-subtitle {
        font-size: 11px;
        color: #bdbdbd;
      }
      #${SCRIPT_ID} .tpda-btn {
        border: 1px solid #4b4b4b;
        background: #2a2a2a;
        color: #f0f0f0;
        border-radius: 5px;
        padding: 4px 8px;
        font-size: 12px;
      }
      #${SCRIPT_ID} .tpda-btn:active {
        transform: translateY(1px);
      }
      #${SCRIPT_ID} .tpda-status {
        padding: 6px 8px;
        border-radius: 6px;
        margin-bottom: 8px;
        font-size: 12px;
      }
      #${SCRIPT_ID} .tpda-status.is-error {
        background: rgba(155, 48, 48, 0.2);
        border: 1px solid rgba(195, 78, 78, 0.5);
        color: #ffcfcf;
      }
      #${SCRIPT_ID} .tpda-status.is-info {
        background: rgba(62, 90, 141, 0.2);
        border: 1px solid rgba(99, 145, 225, 0.45);
        color: #d7e7ff;
      }
      #${SCRIPT_ID} .tpda-section-title {
        margin: 10px 0 6px;
        font-size: 12px;
        font-weight: 700;
        color: #d9d9d9;
        text-transform: uppercase;
        letter-spacing: 0.03em;
      }
      #${SCRIPT_ID} .tpda-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
      }
      #${SCRIPT_ID} .tpda-card {
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.06);
        padding: 7px 8px;
        min-height: 62px;
      }
      #${SCRIPT_ID} .tpda-label {
        color: #bfbfbf;
        font-size: 11px;
      }
      #${SCRIPT_ID} .tpda-value {
        margin-top: 2px;
        font-size: 18px;
        font-weight: 700;
      }
      #${SCRIPT_ID} .tpda-value.tpda-gold {
        color: #d7a544;
      }
      #${SCRIPT_ID} .tpda-meta {
        margin-top: 2px;
        font-size: 11px;
        color: #bfbfbf;
      }
      #${SCRIPT_ID} .tpda-footnote {
        margin-top: 10px;
        font-size: 11px;
        color: #adadad;
      }
      @media (max-width: 520px) {
        #${SCRIPT_ID} {
          width: calc(100vw - 10px);
          margin: 6px auto;
          padding: 8px;
        }
        #${SCRIPT_ID} .tpda-grid {
          grid-template-columns: 1fr;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function isProfilePage(urlText) {
    return /profiles\.php/i.test(urlText) || /(?:\?|&)sid=profiles(?:&|$)/i.test(urlText) || /(?:\?|&)step=profile(?:&|$)/i.test(urlText);
  }

  function getIdFromUrl(urlText) {
    if (!isProfilePage(urlText)) return null;
    const tryMatch = (text) => {
      const match = text.match(/(?:XID|xid|user2ID|user2id|userid|userId|ID|id)=([0-9]{1,12})/);
      return match ? match[1] : null;
    };
    try {
      const url = new URL(urlText);
      const keys = ["XID", "xid", "user2ID", "user2id", "userid", "userId", "ID", "id"];
      for (const key of keys) {
        const raw = url.searchParams.get(key);
        if (raw && /^[0-9]{1,12}$/.test(raw)) return raw;
      }
      const hashId = tryMatch(url.hash || "");
      if (hashId) return hashId;
    } catch (err) {
      const fallbackId = tryMatch(urlText);
      if (fallbackId) return fallbackId;
    }
    const domCandidates = [
      'a[href*="profiles.php?XID="]',
      'a[href*="user2ID="]',
      'a[href*="XID="]'
    ];
    for (const selector of domCandidates) {
      const anchor = document.querySelector(selector);
      if (!anchor || !anchor.href) continue;
      const anchorId = tryMatch(anchor.href);
      if (anchorId) return anchorId;
    }
    return null;
  }

  function findMountTarget() {
    const selectors = [
      "#mainContainer .content-wrapper",
      "#mainContainer .content",
      "#mainContainer",
      ".content-wrapper",
      "main",
      "#skip-to-content",
      "body"
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return document.body || null;
  }

  function ensureRoot() {
    ensureStyle();
    if (!state.root) {
      const root = document.createElement("section");
      root.id = SCRIPT_ID;
      root.addEventListener("click", handleRootClick);
      state.root = root;
    }
    const target = findMountTarget();
    if (!target) return null;
    if (state.root.parentNode !== target) {
      target.prepend(state.root);
    }
    return state.root;
  }

  function removeRoot() {
    if (state.root && state.root.parentNode) {
      state.root.parentNode.removeChild(state.root);
    }
  }

  function isApiKeyReady() {
    const key = String(API_KEY || "").trim();
    if (!key) return false;
    if (key === API_KEY_PLACEHOLDER) return false;
    if (/PDA-APIKEY/i.test(key)) return false;
    return true;
  }

  function chunkList(list, size) {
    const chunks = [];
    for (let i = 0; i < list.length; i += size) {
      chunks.push(list.slice(i, i + size));
    }
    return chunks;
  }

  function toNumber(value) {
    if (value == null) return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  async function apiGet(path, params) {
    const url = new URL(`${API_BASE_URL}${path}`);
    if (isApiKeyReady()) {
      url.searchParams.set("key", API_KEY);
    }
    url.searchParams.set("comment", "tpda-profile-data");

    if (params && typeof params === "object") {
      for (const [key, rawValue] of Object.entries(params)) {
        if (rawValue == null) continue;
        if (Array.isArray(rawValue)) {
          if (!rawValue.length) continue;
          url.searchParams.set(key, rawValue.join(","));
        } else {
          url.searchParams.set(key, String(rawValue));
        }
      }
    }

    const response = await fetch(url.toString(), { method: "GET", credentials: "omit" });
    let payload = null;
    try {
      payload = await response.json();
    } catch (err) {
      throw new Error(`Torn API returned an unreadable response (HTTP ${response.status}).`);
    }
    if (!response.ok) {
      const message = payload && payload.error && payload.error.error
        ? payload.error.error
        : `HTTP ${response.status}`;
      throw new Error(message);
    }
    if (payload && payload.error) {
      throw new Error(payload.error.error || "Unknown Torn API error.");
    }
    return payload;
  }

  function normalizeStatBlock(personalstats) {
    const stats = {};
    if (Array.isArray(personalstats)) {
      for (const row of personalstats) {
        if (!row || typeof row.name !== "string") continue;
        const value = toNumber(row.value);
        if (value == null) continue;
        stats[row.name.toLowerCase()] = value;
      }
      return stats;
    }
    if (personalstats && typeof personalstats === "object") {
      for (const [name, value] of Object.entries(personalstats)) {
        const parsed = toNumber(value);
        if (parsed == null) continue;
        stats[name.toLowerCase()] = parsed;
      }
    }
    return stats;
  }

  async function fetchStatsSnapshot(profileId, statNames, timestamp) {
    const chunks = chunkList(statNames, 10);
    const responses = await Promise.all(chunks.map((chunk) => apiGet(
      `/user/${profileId}/personalstats`,
      timestamp == null ? { stat: chunk } : { stat: chunk, timestamp }
    )));
    const merged = {};
    for (const payload of responses) {
      Object.assign(merged, normalizeStatBlock(payload ? payload.personalstats : null));
    }
    return merged;
  }

  async function fetchDaysInFaction(profileId) {
    const payload = await apiGet(`/user/${profileId}/faction`);
    const days = payload && payload.faction ? toNumber(payload.faction.days_in_faction) : null;
    return days == null ? null : Math.max(0, Math.floor(days));
  }

  function delta(currentValue, oldValue, allowNegative) {
    const current = toNumber(currentValue);
    const previous = toNumber(oldValue);
    if (current == null || previous == null) return null;
    const value = current - previous;
    if (allowNegative) return value;
    return Math.max(0, value);
  }

  function decimal(value, digits) {
    if (!Number.isFinite(value)) return "--";
    const output = value.toFixed(digits == null ? 2 : digits);
    return output.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
  }

  function formatInteger(value) {
    if (!Number.isFinite(value)) return "--";
    return new Intl.NumberFormat("en-US").format(Math.round(value));
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds)) return "--";
    let remaining = Math.max(0, Math.floor(seconds));
    const days = Math.floor(remaining / 86400);
    remaining -= days * 86400;
    const hours = Math.floor(remaining / 3600);
    remaining -= hours * 3600;
    const minutes = Math.floor(remaining / 60);
    remaining -= minutes * 60;
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (days > 0 || hours > 0) parts.push(`${hours}h`);
    if (days > 0 || hours > 0 || minutes > 0) parts.push(`${minutes}m`);
    parts.push(`${remaining}s`);
    return parts.join(" ");
  }

  function formatCurrencyCompact(value) {
    if (!Number.isFinite(value)) return "--";
    const sign = value < 0 ? "-" : "";
    const absolute = Math.abs(value);
    const units = [
      { amount: 1e12, suffix: "t" },
      { amount: 1e9, suffix: "b" },
      { amount: 1e6, suffix: "m" },
      { amount: 1e3, suffix: "k" }
    ];
    for (const unit of units) {
      if (absolute >= unit.amount) {
        return `${sign}$${decimal(absolute / unit.amount, 2)}${unit.suffix}`;
      }
    }
    return `${sign}$${formatInteger(absolute)}`;
  }

  function buildModel(current, historic, daysInFaction) {
    const timePlayed = delta(current.timeplayed, historic.timeplayed, false);
    const xanaxTaken = delta(current.xantaken, historic.xantaken, false);
    const overdoses = delta(current.overdosed, historic.overdosed, false);
    const cansUsed = delta(current.cantaken, historic.cantaken, false);
    const refillEnergy = delta(current.refills, historic.refills, false);
    const refillNerve = delta(current.nerverefills, historic.nerverefills, false);
    const boostersUsed = delta(current.boostersused, historic.boostersused, false);
    const statEnhancers30d = delta(current.statenhancersused, historic.statenhancersused, false);
    const networthGain = delta(current.networth, historic.networth, true);

    let miscBoosters = null;
    if (boostersUsed != null && cansUsed != null && statEnhancers30d != null) {
      miscBoosters = Math.max(0, boostersUsed - cansUsed - statEnhancers30d);
    }

    const xanaxWithoutOdDaily = (xanaxTaken != null && overdoses != null)
      ? xanaxTaken / Math.max(1, WINDOW_DAYS - overdoses)
      : null;

    return {
      monthly: {
        timePlayed,
        timePlayedDailyHours: timePlayed == null ? null : (timePlayed / 3600) / WINDOW_DAYS,
        xanaxTaken,
        xanaxDaily: xanaxTaken == null ? null : xanaxTaken / WINDOW_DAYS,
        overdoses,
        xanaxWithoutOdDaily,
        cansUsed,
        cansDaily: cansUsed == null ? null : cansUsed / WINDOW_DAYS,
        refillEnergy,
        refillNerve,
        miscBoosters,
        networthGain,
        statEnhancers30d
      },
      lifetime: {
        activeStreak: toNumber(current.activestreak),
        bestActiveStreak: toNumber(current.bestactivestreak),
        rankedWarHits: toNumber(current.rankedwarhits),
        attacksWon: toNumber(current.attackswon),
        reviveSkill: toNumber(current.reviveskill),
        racingSkill: toNumber(current.racingskill),
        totalNetworth: toNumber(current.networth),
        statEnhancersLifetime: toNumber(current.statenhancersused),
        totalRespect: toNumber(current.respectforfaction),
        daysInFaction,
        spentOnRehab: toNumber(current.rehabcost),
        totalWorkStats: toNumber(current.totalworkingstats)
      }
    };
  }

  function metricCard(label, value, meta, highlight) {
    return `
      <div class="tpda-card">
        <div class="tpda-label">${escapeHtml(label)}</div>
        <div class="tpda-value${highlight ? " tpda-gold" : ""}">${escapeHtml(value)}</div>
        ${meta ? `<div class="tpda-meta">${escapeHtml(meta)}</div>` : ""}
      </div>
    `;
  }

  function renderLoading(profileId) {
    const root = ensureRoot();
    if (!root) return;
    root.innerHTML = `
      <div class="tpda-head">
        <div>
          <div class="tpda-title">Profile Data</div>
          <div class="tpda-subtitle">User ID ${escapeHtml(profileId)}</div>
        </div>
        <button class="tpda-btn" data-action="refresh">Refresh</button>
      </div>
      <div class="tpda-status is-info">Loading profile stats from Torn API...</div>
    `;
  }

  function renderError(profileId, message) {
    const root = ensureRoot();
    if (!root) return;
    root.innerHTML = `
      <div class="tpda-head">
        <div>
          <div class="tpda-title">Profile Data</div>
          <div class="tpda-subtitle">User ID ${escapeHtml(profileId)}</div>
        </div>
        <button class="tpda-btn" data-action="refresh">Retry</button>
      </div>
      <div class="tpda-status is-error">${escapeHtml(message)}</div>
    `;
  }

  function renderStats(profileId, model) {
    const monthly = model.monthly;
    const lifetime = model.lifetime;

    const monthlyCards = [
      metricCard("Time Played", formatDuration(monthly.timePlayed), `Average: ${decimal(monthly.timePlayedDailyHours, 2)} hours / day`, true),
      metricCard("Xanax Taken", formatInteger(monthly.xanaxTaken), `Average: ${decimal(monthly.xanaxDaily, 2)} / day`, true),
      metricCard("Overdoses", formatInteger(monthly.overdoses), `Without ODs: ${decimal(monthly.xanaxWithoutOdDaily, 2)} / day`, true),
      metricCard("Cans Used", formatInteger(monthly.cansUsed), `Average: ${decimal(monthly.cansDaily, 2)} / day`, true),
      metricCard("Refills", `${formatInteger(monthly.refillEnergy)} E + ${formatInteger(monthly.refillNerve)} N`, null, true),
      metricCard("Misc Boosters", formatInteger(monthly.miscBoosters), null, true),
      metricCard("Networth Gain", formatCurrencyCompact(monthly.networthGain), null, true),
      metricCard("Stat Enhancers", formatInteger(monthly.statEnhancers30d), null, true)
    ].join("");

    const lifetimeCards = [
      metricCard("Activity Streak", formatInteger(lifetime.activeStreak), `Best Streak: ${formatInteger(lifetime.bestActiveStreak)}`, false),
      metricCard("Ranked War Hits", formatInteger(lifetime.rankedWarHits), null, false),
      metricCard("Attacks Won", formatInteger(lifetime.attacksWon), null, false),
      metricCard("Revive Skill", decimal(lifetime.reviveSkill, 2), null, false),
      metricCard("Racing Skill", decimal(lifetime.racingSkill, 2), null, false),
      metricCard("Total Networth", formatCurrencyCompact(lifetime.totalNetworth), null, false),
      metricCard("Lifetime SE Usage", formatInteger(lifetime.statEnhancersLifetime), null, false),
      metricCard("Total Respect", formatInteger(lifetime.totalRespect), null, false),
      metricCard("Days in Faction", formatInteger(lifetime.daysInFaction), null, false),
      metricCard("Spent on Rehab", formatCurrencyCompact(lifetime.spentOnRehab), null, false),
      metricCard("Total Work Stats", formatInteger(lifetime.totalWorkStats), null, false)
    ].join("");

    const root = ensureRoot();
    if (!root) return;
    root.innerHTML = `
      <div class="tpda-head">
        <div>
          <div class="tpda-title">Profile Data</div>
          <div class="tpda-subtitle">User ID ${escapeHtml(profileId)}</div>
        </div>
        <button class="tpda-btn" data-action="refresh">Refresh</button>
      </div>
      <div class="tpda-section-title">Last ${WINDOW_DAYS} days</div>
      <div class="tpda-grid">${monthlyCards}</div>
      <div class="tpda-section-title">Current / lifetime</div>
      <div class="tpda-grid">${lifetimeCards}</div>
      <div class="tpda-footnote">Values in gold show activity over the past ${WINDOW_DAYS} days. Other values are current or lifetime totals.</div>
    `;
  }

  function pruneCache() {
    if (state.cache.size <= MAX_CACHE_ENTRIES) return;
    const entries = Array.from(state.cache.entries()).sort((a, b) => a[1].time - b[1].time);
    while (entries.length > MAX_CACHE_ENTRIES) {
      const [key] = entries.shift();
      state.cache.delete(key);
    }
  }

  async function fetchProfileData(profileId, force) {
    const cached = state.cache.get(profileId);
    if (!force && cached && (Date.now() - cached.time) < CACHE_TTL_MS) {
      return cached.model;
    }

    const now = Math.floor(Date.now() / 1000);
    const monthAgo = now - WINDOW_SECONDS;

    const [currentStats, historicStats, daysInFaction] = await Promise.all([
      fetchStatsSnapshot(profileId, CURRENT_STAT_NAMES, now),
      fetchStatsSnapshot(profileId, MONTHLY_STAT_NAMES, monthAgo),
      fetchDaysInFaction(profileId).catch(() => null)
    ]);

    const model = buildModel(currentStats, historicStats, daysInFaction);
    state.cache.set(profileId, { time: Date.now(), model });
    pruneCache();
    return model;
  }

  async function loadProfile(profileId, force) {
    const thisRequestId = ++state.requestId;

    if (!isApiKeyReady()) {
      renderError(profileId, "PDA API key is missing. Keep API_KEY as the PDA placeholder token and install the script through Torn PDA UserScripts.");
      return;
    }

    renderLoading(profileId);

    try {
      const model = await fetchProfileData(profileId, !!force);
      if (thisRequestId !== state.requestId) return;
      renderStats(profileId, model);
    } catch (err) {
      if (thisRequestId !== state.requestId) return;
      const message = err && err.message ? err.message : "Failed to load profile data.";
      renderError(profileId, message);
    }
  }

  function handleRootClick(event) {
    const button = event.target.closest("button[data-action='refresh']");
    if (!button) return;
    if (!state.profileId) return;
    loadProfile(state.profileId, true);
  }

  function tick() {
    const href = window.location.href;
    const profileId = getIdFromUrl(href);

    if (!profileId) {
      state.requestId += 1;
      state.profileId = null;
      removeRoot();
      return;
    }

    ensureRoot();
    if (profileId !== state.profileId) {
      state.profileId = profileId;
      loadProfile(profileId, false);
    } else if (state.root && !document.contains(state.root)) {
      ensureRoot();
    }
  }

  function boot() {
    tick();
    setInterval(tick, POLL_INTERVAL_MS);
  }

  boot();
})();
