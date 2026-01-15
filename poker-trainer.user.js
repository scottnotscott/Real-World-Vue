// ==UserScript==
// @name         Torn PDA –PSA (v3.8)
// @namespace    local.torn.poker.assist.v38.viewporttop.modes
// @version      3.8.2
// @match        https://www.torn.com/page.php?sid=holdem*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  /* ===================== CONFIG ===================== */
  const OPPONENTS = 8;
  const ITERS = 850;
  const DIST_ITERS = 2400;

  const LS_PROFILES = "tpda_poker_profiles_v1";
  const LS_SEENFEED = "tpda_poker_feedseen_v1";
  const PROFILE_MAX_RECENT = 40;

  const SEAT_BADGES = true;
  const BLURT_TTL_MS = 12000;
  const GIVEUP_WINDOW_ACTS = 6;
  const CONF_SOFTCAP = 18;

  const LS_MODE = "tpda_poker_mode_v1";
  const MODES = [
    { key: "strict", label: "Strict", desc: "Reduce losses", callEdge: +0.08, bluffEdge: +0.10, betPot: [0.45, 0.60, 0.80], raisePot: [0.70, 0.95, 1.25] },
    { key: "normal", label: "Normal", desc: "Standard risk", callEdge: +0.03, bluffEdge: +0.05, betPot: [0.55, 0.70, 0.90], raisePot: [0.85, 1.10, 1.35] },
    { key: "gambler", label: "Gambler", desc: "Profit-hungry, calculated", callEdge: -0.03, bluffEdge: -0.02, betPot: [0.70, 0.85, 1.05], raisePot: [1.05, 1.35, 1.70] },
    { key: "maniac", label: "Maniac", desc: "Aggressive, high-risk reward", callEdge: -0.08, bluffEdge: -0.10, betPot: [0.85, 1.05, 1.35], raisePot: [1.35, 1.80, 2.40] }
  ];

  // HUD pinned to top, wider, shorter (more horizontal layout)
  const HUD = {
    tickMs: 850,

    // Top pin
    topPx: 8,
    navSafePx: 0,

    // Overall sizing (shorter)
    maxWidthVw: 99,
    maxHeightVh: 44, // keep it compact vertically
    padY: 6,
    padX: 10,

    // Readability
    fontPx: 11,
    titlePx: 13,
    barHeightPx: 7,

    // Show preflop summary
    showPreflop: true,
    showWhenNoHero: true
  };

  /* ===================== CARD PARSING ===================== */
  const R = { "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10, "J": 11, "Q": 12, "K": 13, "A": 14 };
  const R_INV = { 2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9", 10: "10", 11: "J", 12: "Q", 13: "K", 14: "A" };

  const SUITS = ["hearts", "diamonds", "clubs", "spades"];
  const S_SYM = { hearts: "♥", diamonds: "♦", clubs: "♣", spades: "♠" };

  const CAT_NAMES = { 8: "StrFl", 7: "Quads", 6: "FH", 5: "Flush", 4: "Str", 3: "Trips", 2: "2Pair", 1: "Pair", 0: "High" };
  const HAND_NAMES = {
    8: "Straight Flush",
    7: "Four of a Kind",
    6: "Full House",
    5: "Flush",
    4: "Straight",
    3: "Three of a Kind",
    2: "Two Pair",
    1: "One Pair",
    0: "High Card"
  };

  function parseCard(el) {
    const cls = el && el.className ? String(el.className) : "";
    for (const s of SUITS) {
      const m = cls.match(new RegExp(`${s}-([0-9JQKA]+)`));
      if (m) return { suit: s, rank: R[m[1]], txt: (m[1] + S_SYM[s]) };
    }
    return null;
  }

  function isFaceDown(el) {
    const w = el.closest("div[class*='flipperWrap']");
    return !!(w && String(w.className).includes("flipped"));
  }

  function getHeroSeatEl() {
    return document.querySelector("div[id^='player-'][class*='self___']");
  }

  function getHeroCards() {
    const self = getHeroSeatEl();
    if (!self) return [];
    const els = [...self.querySelectorAll("div[class*='fourColors']")]
      .filter(el => !isFaceDown(el))
      .map(parseCard)
      .filter(Boolean);
    return els.slice(0, 2);
  }

  function getBoardCards() {
    const boardEls = [...document.querySelectorAll("ul li div[class*='fourColors']")]
      .filter(el => !isFaceDown(el));

    const cards = boardEls.map(parseCard).filter(Boolean);
    const seen = new Set();
    const out = [];
    for (const c of cards) {
      const k = c.rank + ":" + c.suit;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(c);
      if (out.length >= 5) break;
    }
    return out;
  }

  /* ===================== HAND EVAL ===================== */
  function combos(a, k) {
    const r = [];
    (function f(s, c) {
      if (c.length === k) return r.push(c.slice());
      for (let i = s; i < a.length; i++) { c.push(a[i]); f(i + 1, c); c.pop(); }
    })(0, []);
    return r;
  }

  function rankCounts(cards) {
    const counts = {};
    for (const c of cards) counts[c.rank] = (counts[c.rank] || 0) + 1;
    return counts;
  }

  function eval5(cs) {
    const rs = cs.map(c => c.rank).sort((a, b) => b - a);
    const ss = cs.map(c => c.suit);
    const cnt = rankCounts(cs);

    const flush = new Set(ss).size === 1;

    const uniq = Object.keys(cnt).map(Number).sort((a, b) => b - a);
    let straightTop = 0;
    if (uniq.length === 5 && uniq[0] - uniq[4] === 4) straightTop = uniq[0];
    if (!straightTop && uniq.length === 5 && uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) straightTop = 5;

    const groups = Object.entries(cnt)
      .map(([rank, count]) => ({ rank: Number(rank), count }))
      .sort((a, b) => b.count - a.count || b.rank - a.rank);

    if (straightTop && flush) return { cat: 8, name: HAND_NAMES[8], ranks: [straightTop] };
    if (groups[0].count === 4) {
      return { cat: 7, name: HAND_NAMES[7], ranks: [groups[0].rank, groups[1].rank] };
    }
    if (groups[0].count === 3 && groups[1].count === 2) {
      return { cat: 6, name: HAND_NAMES[6], ranks: [groups[0].rank, groups[1].rank] };
    }
    if (flush) return { cat: 5, name: HAND_NAMES[5], ranks: rs.slice() };
    if (straightTop) return { cat: 4, name: HAND_NAMES[4], ranks: [straightTop] };
    if (groups[0].count === 3) {
      const kickers = groups.slice(1).map(g => g.rank).sort((a, b) => b - a);
      return { cat: 3, name: HAND_NAMES[3], ranks: [groups[0].rank, ...kickers] };
    }
    if (groups[0].count === 2 && groups[1].count === 2) {
      const highPair = Math.max(groups[0].rank, groups[1].rank);
      const lowPair = Math.min(groups[0].rank, groups[1].rank);
      return { cat: 2, name: HAND_NAMES[2], ranks: [highPair, lowPair, groups[2].rank] };
    }
    if (groups[0].count === 2) {
      const kickers = groups.slice(1).map(g => g.rank).sort((a, b) => b - a);
      return { cat: 1, name: HAND_NAMES[1], ranks: [groups[0].rank, ...kickers] };
    }
    return { cat: 0, name: HAND_NAMES[0], ranks: rs.slice() };
  }

  function compareHands(a, b) {
    if (!a && !b) return 0;
    if (!a) return -1;
    if (!b) return 1;
    if (a.cat !== b.cat) return a.cat - b.cat;
    const len = Math.max(a.ranks.length, b.ranks.length);
    for (let i = 0; i < len; i++) {
      const ar = a.ranks[i] || 0;
      const br = b.ranks[i] || 0;
      if (ar !== br) return ar - br;
    }
    return 0;
  }

  function bestHand(cards) {
    if (!cards || cards.length < 5) return { cat: -1, name: "NO HIT", ranks: [] };
    let best = null;
    for (const c of combos(cards, 5)) {
      const r = eval5(c);
      if (!best || compareHands(r, best) > 0) best = r;
    }
    return best || { cat: -1, name: "NO HIT", ranks: [] };
  }

  /* ===================== MONTE CARLO ===================== */
  function deck(ex) {
    const d = [];
    for (const s of SUITS) for (let r = 2; r <= 14; r++) {
      if (!ex.some(c => c.rank === r && c.suit === s)) d.push({ rank: r, suit: s, txt: (R_INV[r] + S_SYM[s]) });
    }
    return d;
  }

  // Also returns "loseTo" (top threats) to show "what you can lose to"
  function simulateEquity(hero, board, opps = OPPONENTS, it = ITERS) {
    let win = 0, tie = 0, beatsSum = 0;

    const loseCatCounts = new Array(9).fill(0); // best opponent category when hero is behind

    for (let i = 0; i < it; i++) {
      const d = deck([...hero, ...board]).sort(() => Math.random() - 0.5);
      const b = board.slice();
      while (b.length < 5) b.push(d.pop());

      const hBest = bestHand(hero.concat(b));

      let bestOpp = null;
      const oppHands = [];
      for (let j = 0; j < opps; j++) {
        const o = [d.pop(), d.pop()];
        const rHand = bestHand(o.concat(b));
        oppHands.push(rHand);
        if (!bestOpp || compareHands(rHand, bestOpp) > 0) bestOpp = rHand;
      }

      let beats = 0;
      for (const r of oppHands) if (compareHands(hBest, r) > 0) beats++;
      beatsSum += beats;

      const cmp = compareHands(hBest, bestOpp);
      if (cmp > 0) win++;
      else if (cmp === 0) tie++;
      else if (bestOpp) {
        loseCatCounts[bestOpp.cat] = (loseCatCounts[bestOpp.cat] || 0) + 1;
      }
    }

    const loseTo = loseCatCounts
      .map((c, cat) => ({ cat, p: Math.round((c / it) * 100) }))
      .filter(x => x.p > 0)
      .sort((a, b) => b.p - a.p)
      .slice(0, 3)
      .map(x => `${CAT_NAMES[x.cat]} ${x.p}%`);

    return {
      winPct: Math.round(win / it * 100),
      splitPct: Math.round(tie / it * 100),
      beatsAvg: Math.max(0, Math.min(opps, Math.round(beatsSum / it))),
      loseTo
    };
  }

  function finalDistribution(hero, board) {
    const remaining = 5 - board.length;
    if (remaining <= 0) return null;

    const base = hero.concat(board);
    const d0 = deck(base);

    const counts = new Array(9).fill(0);
    let total = 0;

    if (remaining <= 2) {
      const runouts = combos(d0, remaining);
      for (const extra of runouts) {
        total++;
        counts[bestHand(base.concat(extra)).cat]++;
      }
    } else {
      for (let i = 0; i < DIST_ITERS; i++) {
        const d = d0.slice().sort(() => Math.random() - 0.5);
        const extra = [d.pop(), d.pop(), d.pop()].slice(0, remaining);
        total++;
        counts[bestHand(base.concat(extra)).cat]++;
      }
    }

    const pct = counts.map(c => Math.round((c / total) * 100));
    const top = pct
      .map((p, cat) => ({ cat, p }))
      .sort((a, b) => b.p - a.p)
      .filter(x => x.p > 0)
      .slice(0, 3)
      .map(x => `${CAT_NAMES[x.cat]} ${x.p}%`);

    const atLeast = (minCat) => {
      let s = 0; for (let c = minCat; c <= 8; c++) s += counts[c];
      return Math.round((s / total) * 100);
    };

    return {
      top,
      reach: [
        `Str+ ${atLeast(4)}%`,
        `Fl+ ${atLeast(5)}%`,
        `FH+ ${atLeast(6)}%`
      ],
      reachPct: {
        strPlus: atLeast(4),
        flPlus: atLeast(5),
        fhPlus: atLeast(6)
      }
    };
  }

  function street(n) { return n < 3 ? "Pre" : n === 3 ? "Flop" : n === 4 ? "Turn" : "River"; }

  function boardRisks(board) {
    const risks = [];

    const suitCount = {};
    for (const c of board) suitCount[c.suit] = (suitCount[c.suit] || 0) + 1;
    const maxSuit = Object.entries(suitCount).sort((a, b) => b[1] - a[1])[0];
    if (maxSuit && maxSuit[1] >= 3) risks.push(`Flush draw ${S_SYM[maxSuit[0]]}`);

    const ranks = [...new Set(board.map(c => c.rank))].sort((a, b) => a - b);
    if (ranks.length >= 3) {
      const span = ranks[ranks.length - 1] - ranks[0];
      if (span <= 4) risks.push("Risk of Straight");
      const high = ranks.some(r => r >= 10);
      const ace = ranks.includes(14);
      if (high && (ace || ranks.some(r => r >= 11))) risks.push("High ranks");
    }

    const cnt = {}; for (const c of board) cnt[c.rank] = (cnt[c.rank] || 0) + 1;
    if (Object.values(cnt).some(v => v >= 2)) risks.push("Paired board");

    return risks.slice(0, 2);
  }

  function pairContext(hero, board) {
    if (!hero || hero.length < 2) return { text: "", boardOnly: false, boardPaired: false };

    const boardCounts = rankCounts(board);
    const boardRanks = Object.keys(boardCounts).map(Number);
    const boardPaired = Object.values(boardCounts).some(v => v >= 2);
    const boardTripsRank = boardRanks.find(r => boardCounts[r] === 3);
    const boardQuadsRank = boardRanks.find(r => boardCounts[r] === 4);
    const boardPairRanks = boardRanks.filter(r => boardCounts[r] === 2);

    const h1 = hero[0].rank;
    const h2 = hero[1].rank;
    const pocketPair = h1 === h2 ? h1 : null;
    const heroPairsBoard = !!(boardCounts[h1] || boardCounts[h2]);
    const boardOnly = boardPaired && !pocketPair && !heroPairsBoard;
    const maxBoard = board.length ? Math.max(...board.map(c => c.rank)) : 0;

    if (boardOnly) {
      let text = "Board pair only";
      if (boardQuadsRank) text = "Board quads only";
      else if (boardTripsRank && boardPairRanks.length) text = "Board full house only";
      else if (boardTripsRank) text = "Board trips only";
      else if (boardPairRanks.length >= 2) text = "Board two pair only";
      return { text, boardOnly, boardPaired };
    }

    if (pocketPair) {
      const boardMatch = boardCounts[pocketPair] || 0;
      if (boardMatch >= 2) return { text: `Quads (${R_INV[pocketPair]}${R_INV[pocketPair]})`, boardOnly, boardPaired };
      if (boardMatch === 1) return { text: `Set (${R_INV[pocketPair]}${R_INV[pocketPair]})`, boardOnly, boardPaired };
      if (boardTripsRank) return { text: `Full house (${R_INV[boardTripsRank]}s over ${R_INV[pocketPair]}s)`, boardOnly, boardPaired };
      if (boardPairRanks.length) return { text: `Two pair (${R_INV[pocketPair]} + board)`, boardOnly, boardPaired };
      if (pocketPair > maxBoard) return { text: `Overpair (${R_INV[pocketPair]}${R_INV[pocketPair]})`, boardOnly, boardPaired };
      if (pocketPair < maxBoard) return { text: `Underpair (${R_INV[pocketPair]}${R_INV[pocketPair]})`, boardOnly, boardPaired };
      return { text: `Pocket pair (${R_INV[pocketPair]}${R_INV[pocketPair]})`, boardOnly, boardPaired };
    }

    if (heroPairsBoard) {
      const pairRank = boardCounts[h1] ? h1 : h2;
      const kicker = (h1 === pairRank) ? h2 : h1;
      const boardMatch = boardCounts[pairRank] || 0;
      if (boardMatch >= 2) {
        if (boardMatch >= 3) return { text: `Quads (${R_INV[pairRank]})`, boardOnly, boardPaired };
        return { text: `Trips (${R_INV[pairRank]})`, boardOnly, boardPaired };
      }
      if (boardTripsRank && boardTripsRank !== pairRank) {
        return { text: `Full house (${R_INV[boardTripsRank]}s over ${R_INV[pairRank]}s)`, boardOnly, boardPaired };
      }
      if (boardPairRanks.length && !boardPairRanks.includes(pairRank)) {
        return { text: `Two pair (${R_INV[pairRank]} + board)`, boardOnly, boardPaired };
      }
      const pairedNote = boardPaired ? " on paired board" : "";
      if (pairRank === maxBoard) return { text: `Top pair (k ${R_INV[kicker]})${pairedNote}`, boardOnly, boardPaired };
      return { text: `Pair (${R_INV[pairRank]})${pairedNote}`, boardOnly, boardPaired };
    }

    return { text: "", boardOnly, boardPaired };
  }

  /* ===================== TABLE INFO (POT / TO CALL / BLINDS) ===================== */
  function toInt(v) {
    if (v == null) return 0;
    return Number(String(v).replace(/[^\d]/g, "")) || 0;
  }

  function getActionFeedText() {
    const candidates = [
      document.querySelector(".recent-history-content"),
      document.getElementById("recent-history-wrapper")?.querySelector(".recent-history-content"),
      ...document.querySelectorAll("div[class*='history'], div[class*='log'], div[class*='feed']")
    ].filter(Boolean);

    for (const el of candidates) {
      const t = nodeText(el);
      if (t && /(fold|call|check|bet|raise|won|wins|all[- ]in|posted small blind|posted big blind)/i.test(t) && t.length > 40) return t;
    }
    return "";
  }

  function normalizeFeedLines(raw) {
    if (!raw) return [];
    return raw.split("\n").map(x => x.trim()).filter(Boolean).slice(-120);
  }

  function findPot() {
    const potEl = document.querySelector("div[class*='totalPotWrap'], div[class*='potsWrapper'], div[class*='pot']");
    const candidates = [
      ...document.querySelectorAll("div[class*='totalPotWrap'], div[class*='potsWrapper'], div[class*='pot'], div")
    ].slice(0, 400);

    for (const el of candidates) {
      const t = (el && el.textContent) ? String(el.textContent) : "";
      if (!t) continue;
      const m = t.match(/POT:\s*\$?([\d,]+)/i);
      if (m) return toInt(m[1]);
    }
    if (potEl) {
      const t = String(potEl.textContent || "");
      const m = t.match(/POT:\s*\$?([\d,]+)/i);
      if (m) return toInt(m[1]);
    }
    return 0;
  }

  function findToCall() {
    const btns = [
      ...document.querySelectorAll("button, [role='button'], a, div")
    ].slice(0, 500);

    let sawCheck = false;
    let callAmount = 0;
    let allInAmount = 0;

    for (const el of btns) {
      const t = (el && el.textContent) ? String(el.textContent).trim() : "";
      if (!t) continue;

      if (/^Check\b/i.test(t) || /Check\s*\/\s*Fold/i.test(t)) sawCheck = true;

      const m1 = t.match(/^Call\s*\$?([\d,]+)/i);
      if (m1) callAmount = Math.max(callAmount, toInt(m1[1]));

      if (/Call Any/i.test(t)) callAmount = 0;

      const m2 = t.match(/All\s*In\s*\$?([\d,]+)/i);
      if (m2) allInAmount = Math.max(allInAmount, toInt(m2[1]));
    }

    if (callAmount > 0) return callAmount;
    if (allInAmount > 0) return allInAmount;
    return sawCheck ? 0 : 0;
  }

  function findBlindsFromFeed() {
    const raw = getActionFeedText();
    if (!raw) return { sb: 0, bb: 0 };

    let sb = 0, bb = 0;
    const lines = normalizeFeedLines(raw).slice(-80);
    for (const line of lines) {
      const s = String(line || "");
      const msb = s.match(/posted\s+small\s+blind\s+\$?([\d,]+)/i);
      if (msb) sb = Math.max(sb, toInt(msb[1]));
      const mbb = s.match(/posted\s+big\s+blind\s+\$?([\d,]+)/i);
      if (mbb) bb = Math.max(bb, toInt(mbb[1]));
    }
    return { sb, bb };
  }

  function potOddsPct(pot, toCall) {
    if (!toCall || toCall <= 0) return 0;
    const denom = (pot + toCall);
    if (denom <= 0) return 0;
    return Math.round((toCall / denom) * 100);
  }

  function fmtMoney(n) {
    n = Number(n || 0);
    if (!isFinite(n) || n <= 0) return "$0";
    return "$" + Math.round(n).toLocaleString("en-US");
  }

  /* ===================== LOCALSTORAGE HELPERS ===================== */
  function loadLS(key, fallback) {
    try { const v = localStorage.getItem(key); if (!v) return fallback; return JSON.parse(v); }
    catch { return fallback; }
  }
  function saveLS(key, obj) { try { localStorage.setItem(key, JSON.stringify(obj)); } catch { } }

  function getMode() {
    const v = loadLS(LS_MODE, null);
    const key = (v && v.key) ? String(v.key) : "maniac";
    return MODES.find(m => m.key === key) || MODES[3];
  }
  function setModeKey(k) { saveLS(LS_MODE, { key: k }); }

  /* ===================== FEED PARSING (seat reads unchanged) ===================== */
  function nodeText(el) { return el ? String(el.textContent || "").trim() : ""; }
  function normName(s) { return String(s || "").trim().toLowerCase().replace(/\s+/g, " "); }

  function extractSeatName(playerEl) {
    if (!playerEl) return "";
    const details = playerEl.querySelector("div[class*='details___']");
    if (details) {
      const ps = [...details.querySelectorAll("p")].map(nodeText).filter(Boolean);
      const clean = ps.filter(t => {
        if (!t) return false;
        if (t.includes("$")) return false;
        if (/^\d+$/.test(t)) return false;
        if (/^(active|folded|waiting bb|waiting|big blind|small blind|dealer|sitting out|all[- ]in|check|call|raise|fold)$/i.test(t)) return false;
        if (t.length > 28) return false;
        return true;
      });
      if (clean.length) return clean[0];
    }
    const pTags = [...playerEl.querySelectorAll("p")].map(nodeText).filter(Boolean);
    const nm = pTags.find(t => !t.includes("$") && t.length <= 22 && !/^(active|folded|waiting|big blind|small blind|dealer|sitting out)$/i.test(t));
    return nm || "";
  }

  function buildNameToSeatMap() {
    const map = {};
    const els = [...document.querySelectorAll("div[id^='player-']")];
    for (const el of els) {
      const id = el.id;
      const nm = extractSeatName(el);
      if (nm) map[normName(nm)] = id;
    }
    return map;
  }

  function hashLine(s) {
    s = String(s || "");
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16);
  }

  function parseActionLine(line) {
    const s = String(line || "").trim();

    if (/^(preflop|pre-flop|flop|turn|river|showdown)/i.test(s)) {
      const tag = s.split(/\s+/)[0].toLowerCase();
      const norm =
        tag.startsWith("flop") ? "Flop" :
          tag.startsWith("turn") ? "Turn" :
            tag.startsWith("river") ? "River" :
              tag.startsWith("show") ? "Showdown" :
                "Pre";
      return { type: "street", street: norm, raw: s };
    }

    const m1 = s.match(/^(.+?)\s+(bets|calls|checks|folds)\b/i);
    if (m1) {
      const name = m1[1].trim();
      const act = m1[2].toLowerCase();
      if (act === "checks") return { type: "check", name, raw: s };
      if (act === "folds") return { type: "fold", name, raw: s };
      return { type: act === "bets" ? "bet" : "call", name, raw: s };
    }

    const m2 = s.match(/^(.+?)\s+raises\s+to\b/i);
    if (m2) return { type: "raise", name: m2[1].trim(), raw: s };

    const m3 = s.match(/^(.+?)\s+(won|wins)\b/i);
    if (m3) return { type: "won", name: m3[1].trim(), raw: s };

    return null;
  }

  function confPct(samples) {
    const c = 1 - Math.exp(-(Math.max(0, samples) / Math.max(1, CONF_SOFTCAP)));
    return Math.max(0, Math.min(1, c));
  }

  function pushRecent(pr, evt) {
    if (!Array.isArray(pr.recent)) pr.recent = [];
    pr.recent.push({ t: Date.now(), ...evt });
    if (pr.recent.length > PROFILE_MAX_RECENT) pr.recent.shift();
  }

  function ensureProfile(profiles, playerId, displayName) {
    if (!playerId) return null;
    if (!profiles[playerId]) {
      profiles[playerId] = {
        id: playerId,
        name: displayName || "",
        samples: 0,
        bets: 0, raises: 0, calls: 0, checks: 0, folds: 0, wins: 0,
        aggScore: 0,
        bluffScore: 0,
        recent: [],
        _actSeq: 0,
        _street: "Pre",
        _lastAggSeq: -999,
        _lastAggStreet: "Pre",
        _lastBlurtAt: 0,
        _blurts: []
      };
    } else if (displayName && !profiles[playerId].name) {
      profiles[playerId].name = displayName;
    }
    return profiles[playerId];
  }

  function addBlurt(pr, text, conf) {
    const t = Date.now();
    if (!Array.isArray(pr._blurts)) pr._blurts = [];
    pr._blurts.push({ t, text, conf: Math.max(0, Math.min(1, conf)) });
    if (pr._blurts.length > 6) pr._blurts = pr._blurts.slice(-6);
    pr._lastBlurtAt = t;
  }

  function activeBlurts(pr) {
    const cut = Date.now() - BLURT_TTL_MS;
    pr._blurts = (pr._blurts || []).filter(b => b.t >= cut);
    return pr._blurts;
  }

  function ingestActionFeed(profiles) {
    const nameToSeat = buildNameToSeatMap();
    const raw = getActionFeedText();
    const lines = normalizeFeedLines(raw);

    let seen = loadLS(LS_SEENFEED, null);
    if (!seen || typeof seen !== "object") seen = {};
    if (!Array.isArray(seen.hashes)) seen.hashes = [];

    for (const line of lines) {
      const h = hashLine(line);
      if (seen.hashes.includes(h)) continue;
      seen.hashes.push(h);
      if (seen.hashes.length > 260) seen.hashes.shift();

      const evt = parseActionLine(line);
      if (!evt) continue;

      if (evt.type === "street") {
        const st = evt.street || "Pre";
        for (const k of Object.keys(profiles)) if (profiles[k]) profiles[k]._street = st;
        continue;
      }

      const nm = normName(evt.name);
      const pid = nameToSeat[nm];
      if (!pid) continue;

      const pr = ensureProfile(profiles, pid, nm);
      if (!pr) continue;

      pr._actSeq = (pr._actSeq || 0) + 1;

      if (evt.type === "bet") {
        pr.bets++;
        pr._lastAggSeq = pr._actSeq;
        pr._lastAggStreet = pr._street || "Pre";
        pushRecent(pr, { a: "bet", st: pr._street || "Pre" });
      }
      if (evt.type === "raise") {
        pr.raises++;
        pr._lastAggSeq = pr._actSeq;
        pr._lastAggStreet = pr._street || "Pre";
        pushRecent(pr, { a: "raise", st: pr._street || "Pre" });
      }
      if (evt.type === "call") { pr.calls++; pushRecent(pr, { a: "call", st: pr._street || "Pre" }); }
      if (evt.type === "check") { pr.checks++; pushRecent(pr, { a: "check", st: pr._street || "Pre" }); }

      if (evt.type === "fold") {
        pr.folds++;
        pushRecent(pr, { a: "fold", st: pr._street || "Pre" });

        const sameStreet = (pr._street || "Pre") === (pr._lastAggStreet || "Pre");
        const within = (pr._actSeq - (pr._lastAggSeq || -999)) <= GIVEUP_WINDOW_ACTS;
        if (sameStreet && within) {
          const c = confPct(pr.samples || (pr.bets + pr.raises + pr.calls + pr.checks + pr.folds));
          addBlurt(pr, "BLUFF?", Math.max(0.25, Math.min(0.85, c)));
          pr.bluffScore = Math.max(0, Math.min(100, (pr.bluffScore || 0) + 6));
        }
      }

      if (evt.type === "won") { pr.wins++; pushRecent(pr, { a: "won", st: pr._street || "Pre" }); }
    }

    saveLS(LS_SEENFEED, seen);
  }

  function scoreProfiles(profiles) {
    for (const k of Object.keys(profiles)) {
      const p = profiles[k];
      const totalActs = p.bets + p.raises + p.calls + p.checks + p.folds;
      p.samples = totalActs;
      if (totalActs <= 0) continue;

      const agg = (p.raises * 2 + p.bets * 1.2) / Math.max(1, totalActs);
      const foldRate = p.folds / Math.max(1, totalActs);
      const callRate = p.calls / Math.max(1, totalActs);

      p.aggScore = Math.max(0, Math.min(100, Math.round(agg * 80)));
      p.bluffScore = Math.max(0, Math.min(100, Math.round((p.aggScore * 0.6 + foldRate * 100 * 0.4) - callRate * 30)));
      activeBlurts(p);
    }
  }

  /* ===================== SEAT BADGES ===================== */
  function ensureSeatStyle() {
    if (document.getElementById("tpda-seat-style")) return;
    const st = document.createElement("style");
    st.id = "tpda-seat-style";
    st.textContent = `
      .tpda-seatReads{ margin-top:4px; display:flex; gap:4px; flex-wrap:wrap; justify-content:flex-end; pointer-events:none; }
      .tpda-pill{ display:inline-flex; align-items:center; font-size:10px; line-height:1; padding:3px 5px; border-radius:999px;
        background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.18); color:#f2f2f2; white-space:nowrap;
        text-shadow: 0 1px 2px rgba(0,0,0,0.85); }
      .tpda-pill--blurt{ font-weight:900; background: rgba(0,0,0,0.78); border-color: rgba(255,255,255,0.28); }
      .tpda-pill--green{ color:#b7ffb7; } .tpda-pill--amber{ color:#ffd7a3; } .tpda-pill--red{ color:#ffb3b3; } .tpda-pill--blue{ color:#bfe7ff; }
    `;
    document.head.appendChild(st);
  }

  function pillColorByScore(x) { return x >= 65 ? "tpda-pill--green" : x >= 45 ? "tpda-pill--amber" : "tpda-pill--red"; }

  function ensureSeatBox(playerEl) {
    if (!playerEl) return null;
    const details = playerEl.querySelector("div[class*='details___']");
    const anchor = details || playerEl;
    let box = anchor.querySelector(":scope > .tpda-seatReads");
    if (box) return box;
    box = document.createElement("div");
    box.className = "tpda-seatReads";
    anchor.appendChild(box);
    return box;
  }

  function renderSeatBadges(players, profiles) {
    if (!SEAT_BADGES) return;
    ensureSeatStyle();

    for (const pl of players) {
      if (!pl || !pl.id) continue;
      const playerEl = document.getElementById(pl.id);
      if (!playerEl) continue;

      const pr = profiles[pl.id];
      if (!pr || (pr.samples || 0) < 3) {
        const box0 = ensureSeatBox(playerEl);
        if (box0) box0.innerHTML = "";
        continue;
      }

      const box = ensureSeatBox(playerEl);
      if (!box) continue;

      const a = pr.aggScore || 0;
      const b = pr.bluffScore || 0;
      const c = Math.round(confPct(pr.samples || 0) * 100);

      const blurts = activeBlurts(pr);
      const blurt = blurts.length ? blurts[blurts.length - 1] : null;

      const pills = [];
      if (blurt) {
        const conf = Math.round((blurt.conf || 0) * 100);
        pills.push(`<span class="tpda-pill tpda-pill--blurt tpda-pill--red">${blurt.text} ${conf}%</span>`);
      }
      pills.push(`<span class="tpda-pill ${pillColorByScore(a)}">AGG ${a}</span>`);
      pills.push(`<span class="tpda-pill ${pillColorByScore(b)}">PRESS ${b}</span>`);
      pills.push(`<span class="tpda-pill tpda-pill--blue">CONF ${c}%</span>`);

      box.innerHTML = pills.join("");
    }
  }

  /* ===================== HUD (TOP OF VIEWPORT) ===================== */
  let _lastHitCat = -1;
  let _lastKey = "";
  let _lastModeKey = getMode().key;

  function ensureHudStyle() {
    if (document.getElementById("tp-hud-style")) return;
    const st = document.createElement("style");
    st.id = "tp-hud-style";
    st.textContent = `
      #tp_holdem_hud{
        position: fixed !important;
        z-index: 2147483647 !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
        top: ${HUD.topPx + HUD.navSafePx}px !important;
        bottom: auto !important;
        max-width: ${HUD.maxWidthVw}vw;
        width: ${HUD.maxWidthVw}vw;
        pointer-events: none;
        user-select: none;
        -webkit-user-select: none;
        font-family: system-ui, Segoe UI, Roboto, sans-serif;
        color: #fff;
      }
      #tp_holdem_hud .tp-wrap{
        pointer-events: auto; /* allow mode toggle */
        background: rgba(10,10,12,0.80);
        border: 1px solid rgba(255,255,255,0.14);
        box-shadow: 0 10px 20px rgba(0,0,0,0.42);
        border-radius: 16px;
        padding: ${HUD.padY}px ${HUD.padX}px;
        backdrop-filter: blur(5px);
        max-height: ${HUD.maxHeightVh}vh;
        overflow: hidden;
      }

      /* Header */
      #tp_holdem_hud .tp-head{
        display:flex; align-items:center; gap:10px;
      }
      #tp_holdem_hud .tp-badge{
        font-weight: 950;
        font-size: ${HUD.titlePx}px;
        letter-spacing: 0.5px;
        padding: 4px 10px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,0.18);
        background: rgba(255,255,255,0.06);
        text-shadow: 0 1px 2px rgba(0,0,0,0.85);
        white-space: nowrap;
      }
      #tp_holdem_hud .tp-modeBtn{
        cursor: pointer;
        font-weight: 900;
        font-size: ${HUD.fontPx}px;
        padding: 4px 10px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,0.18);
        background: rgba(255,255,255,0.08);
        color: #fff;
      }
      #tp_holdem_hud .tp-sub{
        flex: 1;
        min-width: 0;
        font-size: ${HUD.fontPx}px;
        opacity: 0.95;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #tp_holdem_hud .tp-street{
        font-weight: 950;
        opacity: 0.95;
        padding: 2px 8px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,0.18);
        background: rgba(255,255,255,0.05);
        white-space: nowrap;
      }

      /* Strength bar */
      #tp_holdem_hud .tp-bar{
        margin-top: 6px;
        height: ${HUD.barHeightPx}px;
        border-radius: 999px;
        overflow: hidden;
        background: rgba(255,255,255,0.10);
        border: 1px solid rgba(255,255,255,0.12);
      }
      #tp_holdem_hud .tp-bar > div{
        height: 100%;
        width: 0%;
        background: rgba(255,255,255,0.60);
        transition: width 180ms ease;
      }

      /* ===== Layout FIXES =====
         - Price column auto-sizes to its content
         - Advice column takes remaining space
         - Advice text wraps (no ellipsis)
      */
      #tp_holdem_hud .tp-grid{
        margin-top: 8px;
        display: grid;
        grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr) max-content minmax(0, 1fr);
        gap: 8px;
        align-items: stretch;
      }
      @media (max-width: 420px){
        #tp_holdem_hud .tp-grid{
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        }
      }

      #tp_holdem_hud .tp-card{
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.12);
        background: rgba(255,255,255,0.05);
        padding: 7px 8px;
        overflow: hidden;
        min-width: 0;
      }
      #tp_holdem_hud .tp-card h4{
        margin: 0 0 5px 0;
        font-size: ${HUD.fontPx}px;
        font-weight: 950;
        letter-spacing: 0.2px;
        opacity: 0.95;
      }

      /* Default lines stay compact */
      #tp_holdem_hud .tp-line{
        font-size: ${HUD.fontPx}px;
        line-height: 1.25;
        opacity: 0.92;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
      }
      #tp_holdem_hud .tp-big{
        font-size: ${HUD.titlePx}px;
        font-weight: 950;
        opacity: 0.98;
        text-shadow: 0 2px 10px rgba(0,0,0,0.55);
      }
      #tp_holdem_hud .tp-dim{ opacity: 0.75; }

      /* Price card: fit content width (column is max-content) */
      #tp_holdem_hud .tp-card.tp-price{
        width: fit-content;
        justify-self: start;
      }
      #tp_holdem_hud .tp-card.tp-price .tp-line{
        white-space: nowrap;
      }

      /* Advice card: wrap text so it stays INSIDE the pill */
      #tp_holdem_hud .tp-card.tp-advice{
        min-width: 0;
      }
      #tp_holdem_hud .tp-card.tp-advice .tp-line{
        white-space: normal !important;
        overflow: visible !important;
        text-overflow: unset !important;
        word-break: break-word;
        overflow-wrap: anywhere;
      }
      #tp_holdem_hud .tp-card.tp-advice .tp-advice{
        font-weight: 950;
        letter-spacing: 0.2px;
        text-shadow: 0 0 12px rgba(255,255,255,0.18), 0 1px 2px rgba(0,0,0,0.85);
      }

      /* Glow/pulse on strong hits */
      #tp_holdem_hud.tp-hit-8 .tp-wrap,
      #tp_holdem_hud.tp-hit-7 .tp-wrap,
      #tp_holdem_hud.tp-hit-6 .tp-wrap{
        box-shadow: 0 0 0 1px rgba(255,255,255,0.15), 0 0 22px rgba(255,255,255,0.22), 0 14px 28px rgba(0,0,0,0.48);
      }
      #tp_holdem_hud.tp-hit-5 .tp-wrap,
      #tp_holdem_hud.tp-hit-4 .tp-wrap{
        box-shadow: 0 0 0 1px rgba(255,255,255,0.14), 0 0 14px rgba(255,255,255,0.16), 0 14px 28px rgba(0,0,0,0.48);
      }
      #tp_holdem_hud.tp-pop .tp-wrap{
        animation: tpPop 420ms ease;
      }
      @keyframes tpPop{
        0%{ transform: translateZ(0) scale(0.985); }
        55%{ transform: translateZ(0) scale(1.02); }
        100%{ transform: translateZ(0) scale(1.0); }
      }

      /* prevent HUD blocking page scroll */
      #tp_holdem_hud .tp-wrap *{ -webkit-tap-highlight-color: transparent; }
    `;
    document.head.appendChild(st);
  }

  function ensureHud() {
    ensureHudStyle();
    let hud = document.getElementById("tp_holdem_hud");
    if (hud) return hud;

    hud = document.createElement("div");
    hud.id = "tp_holdem_hud";
    hud.innerHTML = `
      <div class="tp-wrap">
        <div class="tp-head">
          <div class="tp-badge" id="tp_badge">TP</div>
          <button class="tp-modeBtn" id="tp_modeBtn" type="button">Mode: …</button>
          <div class="tp-sub" id="tp_sub">Loading…</div>
        </div>

        <div class="tp-bar"><div id="tp_bar"></div></div>

        <div class="tp-grid">
          <div class="tp-card">
            <h4>Hand</h4>
            <div class="tp-line tp-big" id="tp_hit">…</div>
            <div class="tp-line tp-dim" id="tp_you">Your Hand: …</div>
          </div>

          <div class="tp-card">
            <h4>Chances</h4>
            <div class="tp-line" id="tp_win">Win: …</div>
            <div class="tp-line tp-dim" id="tp_split">% of tie: …</div>
            <div class="tp-line tp-dim" id="tp_beats">Better than: …</div>
          </div>

          <div class="tp-card tp-price">
            <h4>Price</h4>
            <div class="tp-line" id="tp_price">…</div>
            <div class="tp-line tp-dim" id="tp_pot">Pot: …</div>
            <div class="tp-line tp-dim" id="tp_blinds">Blinds: …</div>
          </div>

          <div class="tp-card tp-advice">
            <h4>Advice</h4>
            <div class="tp-line tp-advice" id="tp_advice">…</div>
            <div class="tp-line tp-dim" id="tp_why">…</div>
            <div class="tp-line tp-dim" id="tp_risks">…</div>
            <div class="tp-line tp-dim" id="tp_loseTo">…</div>
          </div>
        </div>
      </div>
    `;
    document.documentElement.appendChild(hud);

    // Mode cycling
    const btn = hud.querySelector("#tp_modeBtn");
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const cur = getMode();
      const idx = MODES.findIndex(m => m.key === cur.key);
      const next = MODES[(idx + 1 + MODES.length) % MODES.length];
      setModeKey(next.key);
      _lastModeKey = next.key;
      _lastKey = "";
      renderHud(_lastRenderedState || null);
    }, { passive: false });

    return hud;
  }

  function positionHud() {
    const hud = ensureHud();
    hud.style.left = "50%";
    hud.style.transform = "translateX(-50%)";
    hud.style.top = (HUD.topPx + HUD.navSafePx) + "px";
    hud.style.bottom = "auto";
  }

  function toneByWin(winPct) {
    if (typeof winPct !== "number") return "mute";
    return winPct >= 65 ? "good" : winPct >= 45 ? "info" : "warn";
  }

  function excitementLabel(cat) {
    if (cat >= 8) return "🚨 STRAIGHT FLUSH";
    if (cat === 7) return "🚨 QUADS";
    if (cat === 6) return "🔥 FULL HOUSE";
    if (cat === 5) return "🔥 FLUSH";
    if (cat === 4) return "⚡ STRAIGHT";
    if (cat === 3) return "💥 TRIPS";
    if (cat === 2) return "✅ TWO PAIR";
    if (cat === 1) return "✅ PAIR";
    return "NO HIT";
  }

  function wantsNextCards(dist) {
    if (!dist) return null;
    const top = dist.top?.length ? dist.top.join(" · ") : "";
    const reach = dist.reach?.length ? dist.reach.join(" · ") : "";
    return { top, reach };
  }

  function recommendAction(mode, streetName, winPct, risks, dist, pot, toCall, heroCat, pairInfo) {
    const eq = typeof winPct === "number" ? winPct : 0;
    const riskCount = (risks || []).length;
    const boardOnly = !!(pairInfo && pairInfo.boardOnly);
    const adjustedCat = (boardOnly && heroCat <= 3) ? Math.max(0, heroCat - 1) : heroCat;

    const improve =
      dist?.reachPct
        ? Math.max(dist.reachPct.strPlus || 0, dist.reachPct.flPlus || 0, dist.reachPct.fhPlus || 0)
        : 0;

    const priceNeed = potOddsPct(pot, toCall);

    const callThresh = Math.max(0, Math.min(100, priceNeed + Math.round(mode.callEdge * 100)));
    const bluffThresh = Math.max(0, Math.min(100, priceNeed + Math.round(mode.bluffEdge * 100)));

    const isRiver = streetName === "River";
    const hasDrawyBoard = risks && (risks.includes("Risk of Straight") || risks.some(r => r.includes("Flush")));
    const monster = adjustedCat >= 6;
    const strong = adjustedCat >= 4;
    const medium = adjustedCat >= 2;

    const sizeBucket = monster ? 2 : strong ? 1 : 0;
    const betFrac = mode.betPot[sizeBucket];
    const raiseFrac = mode.raisePot[sizeBucket];

    const suggestedBet = pot > 0 ? Math.max(1, Math.round(pot * betFrac)) : 0;
    const suggestedRaise = pot > 0 ? Math.max(1, Math.round(pot * raiseFrac)) : 0;

    if (!toCall || toCall <= 0) {
      if (boardOnly && adjustedCat <= 1) {
        return { act: "CHECK", why: "Board pair only. Keep the pot small.", tone: "mute" };
      }
      if (monster) return { act: `BET ${suggestedBet ? fmtMoney(suggestedBet) : "BIG"}`, why: "You hit huge. Build a pot.", tone: "good" };
      if (strong) return { act: `BET ${suggestedBet ? fmtMoney(suggestedBet) : "MED"}`, why: hasDrawyBoard ? "Charge draws." : "Push advantage.", tone: "info" };
      if (medium) {
        if (mode.key === "strict") return { act: "CHECK", why: boardOnly ? "Board pair only. Pot control." : "Medium hand, keep it tidy.", tone: "mute" };
        return { act: `BET ${suggestedBet ? fmtMoney(suggestedBet) : "SMALL"}`, why: boardOnly ? "Thin value on a paired board." : "Apply pressure, maybe takes it down.", tone: "info" };
      }
      if (mode.key === "strict") return { act: "CHECK", why: "No hand yet. Avoid donating.", tone: "mute" };
      if (!isRiver && improve >= (mode.key === "maniac" ? 20 : 28)) return { act: `BET ${suggestedBet ? fmtMoney(Math.max(1, Math.round(pot * 0.55))) : "SMALL"}`, why: `Semi-bluff. Improve chance ~${improve}%.`, tone: "info" };
      return { act: "CHECK", why: "No hand yet. Check if you can.", tone: "mute" };
    }

    if (eq >= Math.max(70, callThresh + 15)) {
      return { act: `RAISE ${suggestedRaise ? fmtMoney(suggestedRaise) : "BIG"}`, why: "Crushing. Get paid.", tone: "good" };
    }

    if (eq >= Math.max(callThresh + 6, 55)) {
      return { act: `CALL (or RAISE ${suggestedRaise ? fmtMoney(suggestedRaise) : "BIG"})`, why: hasDrawyBoard ? "Ahead—punish draws." : "Ahead often enough.", tone: "info" };
    }

    if (eq >= callThresh) {
      if (!isRiver && improve >= (mode.key === "maniac" ? 18 : 24) && eq < 55) {
        return { act: "CALL", why: `Price is OK + improve ~${improve}%.`, tone: "info" };
      }
      return { act: "CALL", why: `Price OK. Need ~${priceNeed}%; you have ~${eq}%.`, tone: "info" };
    }

    if (!isRiver && improve >= (mode.key === "maniac" ? 22 : mode.key === "gambler" ? 28 : 35) && eq >= bluffThresh) {
      return { act: `CALL (DRAW)`, why: `Behind now, but improve ~${improve}%. Need ~${priceNeed}%.`, tone: "info" };
    }

    if (mode.key === "maniac" && eq >= Math.max(35, priceNeed - 8) && riskCount === 0 && !isRiver) {
      return { act: "CALL (PUNT)", why: "Mode bias: take shots when close.", tone: "warn" };
    }

    return { act: "FOLD", why: `Too expensive. Need ~${priceNeed}%; you have ~${eq}%.`, tone: "warn" };
  }

  let _lastRenderedState = null;

  function renderHud(state) {
    const hud = ensureHud();
    positionHud();

    const mode = getMode();

    const badge = hud.querySelector("#tp_badge");
    const modeBtn = hud.querySelector("#tp_modeBtn");
    const sub = hud.querySelector("#tp_sub");
    // const streetEl = hud.querySelector("#tp_street");
    const bar = hud.querySelector("#tp_bar");

    const hitEl = hud.querySelector("#tp_hit");
    const youEl = hud.querySelector("#tp_you");

    const winEl = hud.querySelector("#tp_win");
    const splitEl = hud.querySelector("#tp_split");
    const beatsEl = hud.querySelector("#tp_beats");

    const priceEl = hud.querySelector("#tp_price");
    const potEl = hud.querySelector("#tp_pot");
    const blindsEl = hud.querySelector("#tp_blinds");

    const advEl = hud.querySelector("#tp_advice");
    const whyEl = hud.querySelector("#tp_why");
    const risksEl = hud.querySelector("#tp_risks");
    const loseToEl = hud.querySelector("#tp_loseTo");

    modeBtn.textContent = `Mode: ${mode.label}`;
    modeBtn.title = mode.desc;

    if (!state) {
      badge.textContent = "PMON v3.8";
      sub.textContent = "Waiting…";
      // streetEl.textContent = "";
      bar.style.width = "0%";

      hitEl.textContent = "->";
      youEl.textContent = "Your hand: ->";

      winEl.textContent = "Win: …";
      splitEl.textContent = "Odds of splitting pot: …";
      beatsEl.textContent = "Better hand than: …";

      priceEl.textContent = "…";
      potEl.textContent = "Pot: …";
      blindsEl.textContent = "Blinds: …";

      advEl.textContent = "…";
      whyEl.textContent = "";
      risksEl.textContent = "";
      loseToEl.textContent = "";

      hud.className = "";
      _lastRenderedState = state;
      return;
    }

    hud.classList.remove("tp-pop");
    for (let i = 0; i <= 8; i++) hud.classList.remove(`tp-hit-${i}`);

    const cat = typeof state.hitCat === "number" ? state.hitCat : -1;
    if (cat >= 0) hud.classList.add(`tp-hit-${cat}`);
    if (cat > _lastHitCat) hud.classList.add("tp-pop");
    _lastHitCat = cat;

    badge.textContent = "PMON v3.8";
    sub.textContent = state.titleLine || "…";
    // streetEl.textContent = state.street || "";

    const w = typeof state.winPct === "number" ? Math.max(0, Math.min(100, state.winPct)) : 0;
    bar.style.width = w + "%";

    hitEl.textContent = state.hitLabel || state.currentHit || "…";
    youEl.textContent = `Your hand: ${state.heroText || "N/A"}`;

    if (state.boardLen >= 3 && typeof state.winPct === "number") {
      winEl.textContent = `Win: ${state.winPct}%`;
      splitEl.textContent = `Split: ${state.splitPct}%`;
      beatsEl.textContent = `Beats: ~${state.beats}/8`;
    } else {
      winEl.textContent = HUD.showPreflop ? "Win: will start after flop" : "Win: …";
      splitEl.textContent = "";
      beatsEl.textContent = "";
    }

    const priceNeed = potOddsPct(state.pot || 0, state.toCall || 0);
    if (state.toCall > 0) {
      priceEl.textContent = `Need: ~${priceNeed}% (call ${fmtMoney(state.toCall)})`;
    } else {
      priceEl.textContent = "Need: 0% (free)";
    }
    potEl.textContent = `Pot: ${fmtMoney(state.pot || 0)}`;
    blindsEl.textContent = `Blinds: ${state.sb ? fmtMoney(state.sb) : "$?"}/${state.bb ? fmtMoney(state.bb) : "$?"}`;

    advEl.classList.remove("good", "warn", "mute");
    const tone = state.rec?.tone || toneByWin(state.winPct);
    advEl.classList.add(tone === "good" ? "good" : tone === "warn" ? "warn" : "mute");
    advEl.textContent = state.rec ? state.rec.act : "…";
    whyEl.textContent = state.rec ? state.rec.why : "";

    const risksTxt = (state.risks && state.risks.length) ? `Board: ${state.risks.join(" · ")}` : "";
    risksEl.textContent = risksTxt;

    const loseToTxt = (state.loseTo && state.loseTo.length) ? `Lose to: ${state.loseTo.join(" · ")}` : "";
    loseToEl.textContent = loseToTxt;

    _lastRenderedState = state;
  }

  /* ===================== MAIN LOOP ===================== */
  function ensureModeSync() {
    const m = getMode();
    if (m.key !== _lastModeKey) {
      _lastModeKey = m.key;
      _lastKey = "";
    }
  }

  setInterval(() => {
    ensureModeSync();

    const hero = getHeroCards();
    const board = getBoardCards();

    const profiles = loadLS(LS_PROFILES, {}) || {};
    ingestActionFeed(profiles);
    scoreProfiles(profiles);
    saveLS(LS_PROFILES, profiles);

    if (SEAT_BADGES) {
      ensureSeatStyle();
      const playersEls = [...document.querySelectorAll("div[id^='player-']")];
      const players = playersEls.map(el => ({ id: el.id }));
      renderSeatBadges(players, profiles);
    }

    positionHud();

    const pot = findPot();
    const toCall = findToCall();
    const blinds = findBlindsFromFeed();

    if (hero.length !== 2) {
      if (HUD.showWhenNoHero) {
        renderHud({
          // street: street(board.length),
          heroText: "",
          boardText: board.map(c => c.txt).join(" "),
          boardLen: board.length,
          titleLine: "Waiting for your hole cards…",
          winPct: null,
          pot,
          toCall,
          sb: blinds.sb,
          bb: blinds.bb
        });
      } else {
        renderHud(null);
      }
      _lastKey = "";
      return;
    }

    const st = street(board.length);
    const key = hero.map(c => c.txt).join("") + "|" + board.map(c => c.txt).join("") + "|" + getMode().key + "|" + pot + "|" + toCall;

    if (key === _lastKey) return;
    _lastKey = key;

    if (board.length < 3) {
      const bh = bestHand(hero);
      const hitCat = bh.cat;
      const hitLabel = excitementLabel(hitCat);
      renderHud({
        // street: st,
        heroText: hero.map(c => c.txt).join(" "),
        boardText: board.map(c => c.txt).join(" "),
        boardLen: board.length,
        titleLine: `Preflop: ${bh.name}`,
        currentHit: bh.name,
        hitCat,
        hitLabel,
        winPct: null,
        pot,
        toCall,
        sb: blinds.sb,
        bb: blinds.bb,
        rec: { act: "WAIT FOR FLOP", why: "There is no pre-flop advice, enter at your own risk", tone: "mute" },
        risks: []
      });
      return;
    }

    const mode = getMode();

    const eq = simulateEquity(hero, board, OPPONENTS, ITERS);
    const bestNow = bestHand(hero.concat(board));
    const currentHit = bestNow.name;
    const hitCat = bestNow.cat;
    const hitLabel = excitementLabel(hitCat);

    const risks = boardRisks(board);
    const pairInfo = pairContext(hero, board);

    const dist = (board.length === 3 || board.length === 4) ? finalDistribution(hero, board) : null;
    const want = wantsNextCards(dist);

    const rec = recommendAction(mode, st, eq.winPct, risks, dist, pot, toCall, hitCat, pairInfo);

    const subtitleBits = [];
    subtitleBits.push(pairInfo.text ? `${currentHit} · ${pairInfo.text}` : `${currentHit}`);
    if (board.length >= 3 && typeof eq.winPct === "number") subtitleBits.push(`Win ${eq.winPct}%`);
    if (toCall > 0) subtitleBits.push(`Need ~${potOddsPct(pot, toCall)}%`);

    let whyExtra = "";
    if (want && (st === "Flop" || st === "Turn")) {
      const improve = dist?.reachPct ? Math.max(dist.reachPct.strPlus || 0, dist.reachPct.flPlus || 0, dist.reachPct.fhPlus || 0) : 0;
      if (improve >= 20) whyExtra = `Likely by river: ${want.reach || want.top || ""}`.trim();
    }

    renderHud({
      // street: st,
      heroText: hero.map(c => c.txt).join(" "),
      boardText: board.map(c => c.txt).join(" "),
      boardLen: board.length,

      winPct: eq.winPct,
      splitPct: eq.splitPct,
      beats: eq.beatsAvg,

      currentHit,
      hitCat,
      hitLabel,

      risks,
      pairCtx: pairInfo.text,

      pot,
      toCall,
      sb: blinds.sb,
      bb: blinds.bb,

      loseTo: eq.loseTo || [],

      rec: {
        act: rec.act,
        why: rec.why + (whyExtra ? ` · ${whyExtra}` : ""),
        tone: rec.tone
      },

      titleLine: subtitleBits.join("  |  ")
    });

  }, HUD.tickMs);

  window.addEventListener("resize", () => { try { positionHud(); } catch { } }, { passive: true });

  ensureHud();
  renderHud({ titleLine: "Loading…" });
})();
