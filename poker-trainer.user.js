// ==UserScript==
// @name         Torn PDA –PSA (v3.8)
// @namespace    local.torn.poker.assist.v38.viewporttop.modes
// @version      3.9.9
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
  const PRE_ITERS = 480;
  const BANKROLL_RESERVED = 170000000;
  const CHEAP_STACK_RATIO = 0.03;
  const CHEAP_BANKROLL_RATIO = 0.002;

  const LS_PROFILES = "tpda_poker_profiles_v1";
  const LS_SEENFEED = "tpda_poker_feedseen_v1";
  const LS_STATS = "tpda_poker_stats_v1";
  const PROFILE_MAX_RECENT = 40;

  const BLURT_TTL_MS = 12000;
  const GIVEUP_WINDOW_ACTS = 6;
  const CONF_SOFTCAP = 18;

  const MODE = { key: "normal", label: "Normal", desc: "Standard risk", callEdge: +0.03, bluffEdge: +0.05, betPot: [0.55, 0.70, 0.90], raisePot: [0.85, 1.10, 1.35] };

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
    barHeightPx: 14,

    // Show preflop summary
    showPreflop: true,
    showWhenNoHero: true
  };

  const INSIGHT_SHOW_MS = 2600;
  const INSIGHT_GAP_MS = 450;
  const INSIGHT_DEDUPE_MS = 5000;

  let _insightQueue = [];
  let _insightActive = false;
  let _insightEl = null;
  let _insightTimer = null;
  let _insightLast = { text: "", t: 0 };
  let _insightBooted = false;

  function setInsightEl(el) {
    _insightEl = el || null;
  }

  function normalizeInsightTone(tone) {
    const t = String(tone || "").toLowerCase();
    if (t === "good" || t === "warn" || t === "info" || t === "mute" || t === "rainbow") return t;
    return "mute";
  }

  function queueInsight(text, tone) {
    const msg = String(text || "").trim();
    if (!msg) return;
    const now = Date.now();
    if (_insightLast.text === msg && (now - _insightLast.t) < INSIGHT_DEDUPE_MS) return;
    _insightLast = { text: msg, t: now };
    _insightQueue.push({ text: msg, tone: normalizeInsightTone(tone) });
    kickInsightLoop();
  }

  function kickInsightLoop() {
    if (_insightActive) return;
    if (!_insightEl) return;
    showNextInsight();
  }

  function showNextInsight() {
    if (!_insightEl) { _insightActive = false; return; }
    const next = _insightQueue.shift();
    if (!next) {
      _insightActive = false;
      _insightEl.classList.remove("show");
      return;
    }
    _insightActive = true;
    _insightEl.classList.remove("tone-mute", "tone-warn", "tone-mid", "tone-good", "rainbow", "tone-info");
    if (next.tone === "rainbow") _insightEl.classList.add("rainbow");
    else if (next.tone === "good") _insightEl.classList.add("tone-good");
    else if (next.tone === "warn") _insightEl.classList.add("tone-warn");
    else if (next.tone === "info") _insightEl.classList.add("tone-mid");
    else _insightEl.classList.add("tone-mute");
    _insightEl.textContent = next.text;
    _insightEl.classList.remove("show");
    void _insightEl.offsetWidth;
    _insightEl.classList.add("show");
    if (_insightTimer) clearTimeout(_insightTimer);
    _insightTimer = setTimeout(() => {
      if (_insightEl) _insightEl.classList.remove("show");
      _insightTimer = setTimeout(showNextInsight, INSIGHT_GAP_MS);
    }, INSIGHT_SHOW_MS);
  }

  function insightFromState(state, prev) {
    if (!state || !state.rec) return null;
    const act = String(state.rec.act || "");
    const prevAct = String(prev?.rec?.act || "");
    const toCall = state.toCall || 0;
    const prevToCall = prev?.toCall || 0;
    const win = typeof state.winPct === "number" ? state.winPct : null;
    const heroTurn = !!state.heroTurn;

    if (prev && act && prevAct && act !== prevAct) {
      if (/^FOLD/i.test(act) && /(CHECK|CALL)/i.test(prevAct)) {
        return { text: "Ah, raise alert. Fishing line snapped - fold time.", tone: "warn" };
      }
      if (/^RAISE/i.test(act) && /(CHECK|CALL)/i.test(prevAct)) {
        return { text: "Momentum shift. Time to apply pressure.", tone: "good" };
      }
      if (/^CALL/i.test(act) && /^FOLD/i.test(prevAct)) {
        return { text: "Price softened. You can take a peek.", tone: "info" };
      }
    }

    if (!heroTurn && prev && act && prevAct && act !== prevAct) {
      return { text: "Not your turn yet. Advice can swing.", tone: "mute" };
    }

    if (state.callUnknown) {
      return { text: "Price is fuzzy. Playing it cautious.", tone: "warn" };
    }

    if (prev && toCall > 0 && prevToCall > 0 && toCall > prevToCall * 1.5) {
      return { text: "Raise spotted. Price jumped.", tone: "warn" };
    }

    if (!heroTurn && !toCall && /^CHECK/i.test(act) && (state.boardLen || 0) >= 3 && typeof win === "number" && win < 45) {
      return { text: "If they fire big, we may have to duck out.", tone: "mute" };
    }

    if (state.hitText && state.hitText.includes("BOARD") && !String(prev?.hitText || "").includes("BOARD")) {
      return { text: "Board pair only. Nothing special yet.", tone: "mute" };
    }

    if (heroTurn && (state.boardLen || 0) >= 3 && (state.callUnknown || (state.toCall || 0) > 0) && prev && (state.opponents || 0) >= 4 && (state.opponents || 0) > (prev.opponents || 0)) {
      return { text: "Crowded pot. Tighten up.", tone: "warn" };
    }

    if (typeof win === "number" && win >= 80 && (!prev || (prev.winPct || 0) < 80)) {
      return { text: "Rainbow time. This one feels good.", tone: "rainbow" };
    }

    return null;
  }

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

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function randInt(max) {
    return Math.floor(Math.random() * max);
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
  function holeStrength(c1, c2) {
    if (!c1 || !c2) return 0;
    const hi = Math.max(c1.rank, c2.rank);
    const lo = Math.min(c1.rank, c2.rank);
    const gap = hi - lo;
    const broadway = (hi >= 10 && lo >= 10) ? 0.08 : 0;

    let score = ((hi - 2) / 12) * 0.6 + ((lo - 2) / 12) * 0.2 + broadway;
    if (hi === lo) score += 0.35 + ((hi - 2) / 12) * 0.25;
    if (c1.suit === c2.suit) score += 0.08;
    if (gap === 1) score += 0.06;
    else if (gap === 2) score += 0.03;
    else if (gap >= 4) score -= 0.05;

    return clamp(score, 0, 1);
  }

  function rangeBiasFromProfile(profile) {
    if (!profile || (profile.samples || 0) < 6) {
      return { tightness: 0.35, aggression: 0.35 };
    }
    const foldRate = (profile.folds || 0) / Math.max(1, profile.samples || 0);
    const aggN = clamp((profile.aggScore || 0) / 100, 0, 1);
    const bluffN = clamp((profile.bluffScore || 0) / 100, 0, 1);

    const tightness = clamp(0.25 + foldRate * 0.75 - aggN * 0.2, 0, 1);
    const aggression = clamp(aggN * 0.7 + bluffN * 0.3, 0, 1);
    return { tightness, aggression };
  }

  function handAcceptanceWeight(strength, bias) {
    const tight = clamp(bias?.tightness ?? 0.35, 0, 1);
    const aggr = clamp(bias?.aggression ?? 0.35, 0, 1);
    const base = 0.2 + 0.8 * strength;
    const effectiveTight = clamp(tight - aggr * 0.2, 0, 1);
    let weight = Math.pow(base, 1 + effectiveTight * 2);
    weight += aggr * 0.08 * (1 - strength);
    return clamp(weight, 0.03, 0.98);
  }

  function drawRandomCard(deck) {
    const idx = randInt(deck.length);
    return deck.splice(idx, 1)[0];
  }

  function drawWeightedHand(deck, bias) {
    const tries = 16;
    for (let t = 0; t < tries; t++) {
      if (deck.length < 2) break;
      const i = randInt(deck.length);
      let j = randInt(deck.length - 1);
      if (j >= i) j += 1;
      const c1 = deck[i];
      const c2 = deck[j];
      const strength = holeStrength(c1, c2);
      const weight = handAcceptanceWeight(strength, bias);
      if (Math.random() < weight) {
        const a = Math.max(i, j);
        const b = Math.min(i, j);
        deck.splice(a, 1);
        deck.splice(b, 1);
        return [c1, c2];
      }
    }
    return [drawRandomCard(deck), drawRandomCard(deck)];
  }

  function equityConfidence(iters) {
    const c = 1 - Math.exp(-Math.max(0, iters) / 700);
    return Math.round(clamp(c, 0, 1) * 100);
  }

  function deck(ex) {
    const d = [];
    for (const s of SUITS) for (let r = 2; r <= 14; r++) {
      if (!ex.some(c => c.rank === r && c.suit === s)) d.push({ rank: r, suit: s, txt: (R_INV[r] + S_SYM[s]) });
    }
    return d;
  }

  // Also returns "loseTo" (top threats) to show "what you can lose to"
  function simulateEquity(hero, board, opps = OPPONENTS, it = ITERS, opponentInfos = null) {
    let win = 0, tie = 0, beatsSum = 0;

    const oppCount = Array.isArray(opponentInfos) && opponentInfos.length ? opponentInfos.length : opps;
    if (oppCount <= 0) {
      return { winPct: 100, splitPct: 0, beatsAvg: 0, loseTo: [] };
    }

    const loseCatCounts = new Array(9).fill(0); // best opponent category when hero is behind

    for (let i = 0; i < it; i++) {
      const d = deck([...hero, ...board]);
      const b = board.slice();
      while (b.length < 5) b.push(drawRandomCard(d));

      const hBest = bestHand(hero.concat(b));

      let bestOpp = null;
      const oppHands = [];
      for (let j = 0; j < oppCount; j++) {
        const info = opponentInfos && opponentInfos[j] ? opponentInfos[j] : null;
        const bias = info?.bias || rangeBiasFromProfile(info?.profile);
        const o = drawWeightedHand(d, bias);
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
      beatsAvg: Math.max(0, Math.min(oppCount, Math.round(beatsSum / it))),
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
        const d = d0.slice();
        const extra = [];
        for (let k = 0; k < remaining; k++) extra.push(drawRandomCard(d));
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
    if (maxSuit && maxSuit[1] >= 5) risks.push(`Flush on board ${S_SYM[maxSuit[0]]}`);
    else if (maxSuit && maxSuit[1] === 4) risks.push(`Four to a flush ${S_SYM[maxSuit[0]]}`);
    else if (maxSuit && maxSuit[1] === 3) {
      risks.push(board.length === 3 ? `Monotone flop ${S_SYM[maxSuit[0]]}` : `Flush draw ${S_SYM[maxSuit[0]]}`);
    }

    const ranks = [...new Set(board.map(c => c.rank))].sort((a, b) => a - b);
    const ranksLow = ranks.includes(14) ? [1, ...ranks] : ranks.slice();
    let fourStraight = false;
    let threeStraight = false;
    if (ranksLow.length >= 4) {
      for (let i = 0; i <= ranksLow.length - 4; i++) {
        if (ranksLow[i + 3] - ranksLow[i] <= 4) {
          fourStraight = true;
          break;
        }
      }
    }
    if (!fourStraight && ranksLow.length >= 3) {
      for (let i = 0; i <= ranksLow.length - 3; i++) {
        if (ranksLow[i + 2] - ranksLow[i] <= 4) {
          threeStraight = true;
          break;
        }
      }
    }
    if (fourStraight) risks.push("Four to a straight");
    else if (threeStraight) risks.push("Three to a straight");

    const cnt = {}; for (const c of board) cnt[c.rank] = (cnt[c.rank] || 0) + 1;
    const counts = Object.values(cnt);
    const pairCount = counts.filter(v => v === 2).length;
    const maxCount = counts.length ? Math.max(...counts) : 0;
    if (maxCount >= 4) risks.push("Quads on board");
    else if (maxCount === 3 && pairCount >= 1) risks.push("Full house on board");
    else if (maxCount === 3) risks.push("Trips on board");
    else if (pairCount >= 2) risks.push("Double paired board");
    else if (pairCount === 1) risks.push("Paired board");

    const highCount = ranks.filter(r => r >= 10).length;
    if (highCount >= 2) risks.push("Broadway-heavy");

    return risks.slice(0, 3);
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

  function extractAmounts(text) {
    const t = String(text || "");
    const matches = t.match(/\$[\d,]+/g) || [];
    return matches.map(toInt).filter(n => n > 0);
  }

  function getElementTextVariants(el) {
    if (!el) return [];
    const t = String(el.textContent || "");
    const a = el.getAttribute ? el.getAttribute("aria-label") : "";
    const title = el.getAttribute ? el.getAttribute("title") : "";
    const tip = el.getAttribute ? el.getAttribute("data-tip") : "";
    const tooltip = el.getAttribute ? el.getAttribute("data-tooltip") : "";
    const orig = el.getAttribute ? el.getAttribute("data-original-title") : "";
    const dataAmount = el.getAttribute ? el.getAttribute("data-amount") : "";
    const dataValue = el.getAttribute ? el.getAttribute("data-value") : "";
    const dataBet = el.getAttribute ? el.getAttribute("data-bet") : "";
    const dataCall = el.getAttribute ? el.getAttribute("data-call") : "";
    const maybeNum = (v) => (v && /^\d[\d,]*$/.test(v) ? `$${v}` : v);
    return [t, a, title, tip, tooltip, orig, maybeNum(dataAmount), maybeNum(dataValue), maybeNum(dataBet), maybeNum(dataCall)].filter(Boolean);
  }

  function findToCall() {
    const btns = [
      ...document.querySelectorAll("button, [role='button'], a, div")
    ].slice(0, 500);

    let sawCheck = false;
    let sawCall = false;
    let sawAllIn = false;
    let sawRaise = false;
    let sawBet = false;
    let sawFold = false;
    let callAmount = 0;
    let allInAmount = 0;

    for (const el of btns) {
      const texts = getElementTextVariants(el);
      if (!texts.length) continue;

      for (const t0 of texts) {
        const t = String(t0 || "").trim();
        if (!t) continue;

        if (/^Check\b/i.test(t) || /Check\s*\/\s*Fold/i.test(t)) sawCheck = true;
        if (/Call\b/i.test(t)) sawCall = true;
        if (/All\s*In/i.test(t)) sawAllIn = true;
        if (/^Raise\b/i.test(t)) sawRaise = true;
        if (/^Bet\b/i.test(t)) sawBet = true;
        if (/^Fold\b/i.test(t) || /Fold\s*\/\s*Check/i.test(t)) sawFold = true;

        const amounts = extractAmounts(t);
        if (amounts.length) {
          if (/Call\b/i.test(t)) callAmount = Math.max(callAmount, ...amounts);
          if (/All\s*In/i.test(t)) allInAmount = Math.max(allInAmount, ...amounts);
        }

        const m1 = t.match(/^Call\s*\$?([\d,]+)/i);
        if (m1) callAmount = Math.max(callAmount, toInt(m1[1]));

        const m2 = t.match(/All\s*In\s*\$?([\d,]+)/i);
        if (m2) allInAmount = Math.max(allInAmount, toInt(m2[1]));

        if (/Call Any/i.test(t)) callAmount = 0;
      }
    }

    const amount = Math.max(callAmount, allInAmount);
    const unknown = amount <= 0 && (sawCall || sawAllIn);
    const heroTurn = sawCheck || sawCall || sawAllIn || sawRaise || sawBet || sawFold;
    return { amount, unknown, sawCheck, sawCall, sawAllIn, sawRaise, sawBet, sawFold, heroTurn };
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

  function wagerLabel(amount, fallback, heroStack) {
    if (heroStack > 0 && amount >= heroStack) return "ALL-IN";
    if (amount > 0) return fmtMoney(amount);
    return fallback;
  }

  /* ===================== LOCALSTORAGE HELPERS ===================== */
  function loadLS(key, fallback) {
    try { const v = localStorage.getItem(key); if (!v) return fallback; return JSON.parse(v); }
    catch { return fallback; }
  }
  function saveLS(key, obj) { try { localStorage.setItem(key, JSON.stringify(obj)); } catch { } }

  function getMode() {
    return MODE;
  }

  function loadStats() {
    return loadLS(LS_STATS, {
      handsPlayed: 0,
      handsFolded: 0,
      handsWon: 0,
      handsLost: 0,
      vpip: 0,
      pfr: 0,
      bets: 0,
      raises: 0,
      calls: 0,
      checks: 0,
      moneyWon: 0,
      moneyLost: 0,
      biggestWin: 0,
      biggestLoss: 0,
      lastUpdate: 0
    });
  }

  function saveStats(stats) {
    stats.lastUpdate = Date.now();
    saveLS(LS_STATS, stats);
  }

  function resetStats() {
    const blank = {
      handsPlayed: 0,
      handsFolded: 0,
      handsWon: 0,
      handsLost: 0,
      vpip: 0,
      pfr: 0,
      bets: 0,
      raises: 0,
      calls: 0,
      checks: 0,
      moneyWon: 0,
      moneyLost: 0,
      biggestWin: 0,
      biggestLoss: 0,
      lastUpdate: Date.now()
    };
    saveLS(LS_STATS, blank);
    return blank;
  }

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

  function getHeroNameNorm() {
    const heroEl = getHeroSeatEl();
    if (!heroEl) return "";
    return normName(extractSeatName(heroEl));
  }

  function extractMoneyFromLine(line) {
    const amounts = extractAmounts(line);
    if (!amounts.length) return 0;
    return Math.max(...amounts);
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

    const mRaiseTo = s.match(/^(.+?)\s+rais(?:ed|es)\s+\$?([\d,]+)\s+to\s+\$?([\d,]+)/i);
    if (mRaiseTo) {
      return { type: "raise", name: mRaiseTo[1].trim(), raiseBy: toInt(mRaiseTo[2]), raiseTo: toInt(mRaiseTo[3]), raw: s };
    }
    const mRaise = s.match(/^(.+?)\s+rais(?:ed|es)\s+to\s+\$?([\d,]+)/i);
    if (mRaise) return { type: "raise", name: mRaise[1].trim(), raiseTo: toInt(mRaise[2]), raw: s };

    const m1 = s.match(/^(.+?)\s+(bets|calls|checks|folds)\b/i);
    if (m1) {
      const name = m1[1].trim();
      const act = m1[2].toLowerCase();
      if (act === "checks") return { type: "check", name, raw: s };
      if (act === "folds") return { type: "fold", name, raw: s };
      return { type: act === "bets" ? "bet" : "call", name, raw: s };
    }

    const m3 = s.match(/^(.+?)\s+(won|wins|collects|collected|lost|loses)\b/i);
    if (m3) {
      const act = m3[2].toLowerCase();
      if (act === "lost" || act === "loses") return { type: "lost", name: m3[1].trim(), raw: s };
      return { type: "won", name: m3[1].trim(), raw: s };
    }

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

  function ingestActionFeed(profiles, heroNameNorm, stats, handState, blinds) {
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
        const bb = blinds?.bb || 0;
        const raiseTo = evt.raiseTo || 0;
        if (bb > 0 && raiseTo > 0) {
          const overPct = Math.round(((raiseTo - bb) / bb) * 100);
          if (overPct >= 50) {
            pr._bbRaiseCount = (pr._bbRaiseCount || 0) + 1;
            if (pr._bbRaiseCount === 3 || pr._bbRaiseCount === 6 || pr._bbRaiseCount === 9) {
              const nmLabel = pr.name || evt.name || "player";
              queueInsight(`Noticed ${nmLabel} raised about ${overPct}% over the big blind a few times now (${pr._bbRaiseCount}).`, "info");
            }
          }
        }
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

      if (heroNameNorm && nm === heroNameNorm && stats && handState) {
        const lineText = String(line || "");
        const money = extractMoneyFromLine(lineText);
        if (evt.type === "bet") {
          stats.bets++;
          if (!handState.vpip) { stats.vpip++; handState.vpip = true; }
        }
        if (evt.type === "raise") {
          stats.raises++;
          if (!handState.vpip) { stats.vpip++; handState.vpip = true; }
          if ((pr._street || "Pre") === "Pre" && !handState.pfr) { stats.pfr++; handState.pfr = true; }
        }
        if (evt.type === "call") {
          stats.calls++;
          if (!handState.vpip) { stats.vpip++; handState.vpip = true; }
        }
        if (evt.type === "check") stats.checks++;
        if (evt.type === "fold") {
          if (!handState.folded) {
            stats.handsFolded++;
            handState.folded = true;
          }
        }
        if (evt.type === "won") {
          if (!handState.won) {
            stats.handsWon++;
            handState.won = true;
          }
        }
        if (evt.type === "lost") {
          if (!handState.lost) {
            stats.handsLost++;
            handState.lost = true;
          }
        }
        if (/(won|wins|collects|collected)/i.test(lineText) && money > 0) {
          stats.moneyWon = (stats.moneyWon || 0) + money;
          stats.biggestWin = Math.max(stats.biggestWin || 0, money);
          if (!handState.won) {
            stats.handsWon++;
            handState.won = true;
          }
        }
        if (/(lost|loses)/i.test(lineText) && money > 0) {
          stats.moneyLost = (stats.moneyLost || 0) + money;
          stats.biggestLoss = Math.max(stats.biggestLoss || 0, money);
          if (!handState.lost) {
            stats.handsLost++;
            handState.lost = true;
          }
        }
      }
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

  /* ===================== SEAT / STACK INFO ===================== */
  function seatStatusFromText(txt) {
    const t = String(txt || "").toLowerCase();
    if (!t) return "unknown";
    if (t.includes("folded")) return "folded";
    if (t.includes("sitting out")) return "inactive";
    if (t.includes("waiting")) return "inactive";
    if (t.includes("empty")) return "inactive";
    return "active";
  }

  function extractSeatStack(playerEl) {
    if (!playerEl) return 0;
    const t = nodeText(playerEl);
    if (!t) return 0;
    const matches = t.match(/\$[\d,]+/g);
    if (!matches) return 0;
    let max = 0;
    for (const m of matches) max = Math.max(max, toInt(m));
    return max;
  }

  function getActiveOpponents(profiles) {
    const heroEl = getHeroSeatEl();
    const heroId = heroEl ? heroEl.id : "";
    const players = [...document.querySelectorAll("div[id^='player-']")];
    const opponents = [];

    for (const el of players) {
      if (!el || !el.id || el.id === heroId) continue;
      const name = extractSeatName(el);
      if (!name) continue;
      const status = seatStatusFromText(nodeText(el));
      if (status !== "active") continue;
      const pr = ensureProfile(profiles, el.id, name);
      opponents.push({
        id: el.id,
        name,
        profile: pr,
        stack: extractSeatStack(el),
        bias: rangeBiasFromProfile(pr)
      });
    }
    return opponents;
  }

  function opponentSignature(opponents) {
    if (!Array.isArray(opponents) || !opponents.length) return "";
    return opponents
      .map(o => {
        const t = Math.round((o.bias?.tightness || 0) * 10);
        const a = Math.round((o.bias?.aggression || 0) * 10);
        return `${t}${a}`;
      })
      .join(".");
  }

  function getHeroStack() {
    const heroEl = getHeroSeatEl();
    return heroEl ? extractSeatStack(heroEl) : 0;
  }

  function effectiveStack(heroStack, opponents) {
    if (!heroStack || !opponents || !opponents.length) return heroStack || 0;
    let eff = heroStack;
    for (const opp of opponents) {
      if (opp.stack > 0) eff = Math.min(eff, opp.stack);
    }
    return eff;
  }

  /* ===================== HUD (TOP OF VIEWPORT) ===================== */
  let _lastHitCat = -1;
  let _lastKey = "";
  let _preflopCache = { key: "", eq: null, iters: 0 };
  let _handState = { key: "", vpip: false, pfr: false, folded: false, won: false, lost: false };

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
        transition: opacity 160ms ease;
        pointer-events: none;
        user-select: none;
        -webkit-user-select: none;
        font-family: system-ui, Segoe UI, Roboto, sans-serif;
        color: #fff;
      }
      #tp_holdem_hud.tp-hidden{
        opacity: 0;
        pointer-events: none;
      }
      #tp_holdem_hud .tp-wrap{
        pointer-events: auto; /* allow mode toggle */
        background:
          radial-gradient(circle at 20% 20%, rgba(28,110,72,0.25), transparent 55%),
          radial-gradient(circle at 80% 80%, rgba(120,70,20,0.22), transparent 60%),
          linear-gradient(135deg, rgba(16,18,20,0.92), rgba(8,9,11,0.88));
        border: 1px solid rgba(255,214,120,0.22);
        box-shadow: 0 10px 20px rgba(0,0,0,0.42), inset 0 0 0 1px rgba(255,255,255,0.04);
        border-radius: 16px;
        padding: ${HUD.padY}px ${HUD.padX}px;
        backdrop-filter: blur(5px);
        max-height: ${HUD.maxHeightVh}vh;
        overflow: hidden;
        position: relative;
      }

      /* Header */
      #tp_holdem_hud .tp-head{
        display:flex; align-items:center; gap:10px;
      }
      #tp_holdem_hud .tp-badge{
        font-weight: 950;
        font-size: ${Math.max(2, Math.round(HUD.titlePx * 0.04))}px;
        letter-spacing: 0.5px;
        padding: 4px 10px;
        border-radius: 999px;
        border: 1px solid rgba(255,214,120,0.35);
        background: linear-gradient(90deg, rgba(255,214,120,0.2), rgba(255,214,120,0.06));
        text-shadow: 0 1px 2px rgba(0,0,0,0.85);
        white-space: nowrap;
      }
      #tp_holdem_hud .tp-sub{
        flex: 1;
        min-width: 0;
        font-size: ${Math.max(9, Math.round(HUD.fontPx * 0.75))}px;
        opacity: 0.95;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        transition: color 160ms ease, filter 160ms ease;
      }
      #tp_holdem_hud .tp-sub.tone-mute{ color: #c9c9cf; }
      #tp_holdem_hud .tp-sub.tone-warn{ color: #ff8e8e; }
      #tp_holdem_hud .tp-sub.tone-mid{ color: #f4d777; }
      #tp_holdem_hud .tp-sub.tone-good{ color: #9de58a; }
      #tp_holdem_hud .tp-sub.rainbow{
        background-image: linear-gradient(90deg, #ff5f6d, #ffc371, #f6ff00, #64ff6a, #52b7ff, #a855f7, #ff5fd7);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        -webkit-text-fill-color: transparent;
        filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5));
      }
      #tp_holdem_hud .tp-helpBtn{
        cursor: pointer;
        font-weight: 900;
        font-size: ${HUD.fontPx}px;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        border: 1px solid rgba(255,255,255,0.2);
        background: rgba(255,255,255,0.08);
        color: #fff;
        line-height: 1;
      }
      #tp_holdem_hud .tp-clipBtn,
      #tp_holdem_hud .tp-statsBtn{
        cursor: pointer;
        font-weight: 900;
        font-size: ${HUD.fontPx}px;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        border: 1px solid rgba(255,255,255,0.2);
        background: rgba(255,255,255,0.08);
        color: #fff;
        line-height: 1;
      }
      #tp_holdem_hud .tp-hideBtn{
        cursor: pointer;
        font-weight: 900;
        font-size: ${HUD.fontPx}px;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        border: 1px solid rgba(255,255,255,0.2);
        background: rgba(255,255,255,0.08);
        color: #fff;
        line-height: 1;
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
        position: relative;
        display: flex;
        align-items: center;
      }
      #tp_holdem_hud #tp_bar{
        height: 100%;
        width: 0%;
        background: rgba(255,255,255,0.60);
        transition: width 180ms ease;
      }
      #tp_holdem_hud .tp-insight{
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: ${Math.max(9, Math.round(HUD.fontPx * 0.85))}px;
        font-weight: 700;
        letter-spacing: 0.2px;
        opacity: 0;
        transition: opacity 260ms ease;
        text-shadow: 0 1px 2px rgba(0,0,0,0.65);
        pointer-events: none;
        padding: 0 8px;
        text-align: center;
      }
      #tp_holdem_hud .tp-insight.show{ opacity: 1; }
      #tp_holdem_hud .tp-insight.tone-mute{ color: #c9c9cf; }
      #tp_holdem_hud .tp-insight.tone-warn{ color: #ff9a9a; }
      #tp_holdem_hud .tp-insight.tone-mid{ color: #f4d777; }
      #tp_holdem_hud .tp-insight.tone-good{ color: #9de58a; }
      #tp_holdem_hud .tp-insight.rainbow{
        background-image: linear-gradient(90deg, #ff5f6d, #ffc371, #f6ff00, #64ff6a, #52b7ff, #a855f7, #ff5fd7);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        -webkit-text-fill-color: transparent;
        filter: drop-shadow(0 1px 2px rgba(0,0,0,0.6));
      }

      /* ===== Layout FIXES =====
         - Price column auto-sizes to its content
         - Advice column takes remaining space
         - Advice text wraps (no ellipsis)
      */
      #tp_holdem_hud .tp-grid{
        margin-top: 8px;
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 8px;
        align-items: stretch;
      }
      #tp_holdem_hud .tp-card.tp-advice{
        grid-column: 1 / -1;
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

      #tp_holdem_hud .tp-help{
        position: absolute;
        right: 10px;
        top: 38px;
        width: min(360px, 92vw);
        background: rgba(12,12,14,0.95);
        border: 1px solid rgba(255,255,255,0.16);
        border-radius: 12px;
        padding: 8px 10px;
        display: none;
        box-shadow: 0 12px 26px rgba(0,0,0,0.55);
      }
      #tp_holdem_hud .tp-stats{
        right: auto;
        left: 10px;
      }
      #tp_holdem_hud .tp-help.is-open{ display: block; }
      #tp_holdem_hud .tp-helpHead{
        display:flex;
        align-items:center;
        justify-content:space-between;
        font-weight: 900;
        font-size: ${HUD.fontPx}px;
        margin-bottom: 6px;
      }
      #tp_holdem_hud .tp-helpClose{
        cursor: pointer;
        border: 0;
        background: transparent;
        color: #fff;
        font-size: ${HUD.fontPx}px;
        padding: 0 4px;
      }
      #tp_holdem_hud .tp-helpBody{
        font-size: ${HUD.fontPx}px;
        line-height: 1.35;
        opacity: 0.92;
      }
      #tp_holdem_hud .tp-helpItem{ margin-top: 6px; }
      #tp_holdem_hud .tp-helpTerm{ font-weight: 900; }

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
        display: inline-flex;
        align-items: center;
        padding: 2px 8px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,0.14);
        background: linear-gradient(90deg, rgba(255,255,255,0.12), rgba(255,255,255,0.02));
        font-weight: 950;
        letter-spacing: 0.2px;
        text-shadow: 0 0 12px rgba(255,255,255,0.18), 0 1px 2px rgba(0,0,0,0.85);
      }
      #tp_holdem_hud .tp-card.tp-advice .tp-advice.good{
        border-color: rgba(46,194,126,0.55);
        color: #eafff2;
        background: linear-gradient(90deg, rgba(46,194,126,0.38), rgba(46,194,126,0.08));
      }
      #tp_holdem_hud .tp-card.tp-advice .tp-advice.warn{
        border-color: rgba(255,93,93,0.6);
        color: #ffe6e6;
        background: linear-gradient(90deg, rgba(255,93,93,0.4), rgba(255,93,93,0.08));
      }
      #tp_holdem_hud .tp-card.tp-advice .tp-advice.mute{
        border-color: rgba(255,255,255,0.16);
        color: #f0f0f0;
        background: linear-gradient(90deg, rgba(255,255,255,0.18), rgba(255,255,255,0.03));
      }
      #tp_holdem_hud .tp-risk{
        color: #ffbdbd;
      }
      #tp_holdem_hud .tp-lose{
        color: #ffc7c7;
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
    if (hud) {
      setInsightEl(hud.querySelector("#tp_insight"));
      return hud;
    }

    hud = document.createElement("div");
    hud.id = "tp_holdem_hud";
    hud.innerHTML = `
      <div class="tp-wrap">
        <div class="tp-head">
          <div class="tp-badge" id="tp_badge">TP</div>
          <div class="tp-sub" id="tp_sub">Loading…</div>
          <button class="tp-hideBtn" id="tp_hide_btn" type="button" title="Hide (10s)">🗿</button>
          <button class="tp-clipBtn" id="tp_clip_btn" type="button" title="Copy page scan">📋</button>
          <button class="tp-statsBtn" id="tp_stats_btn" type="button" title="Stats">📈</button>
          <button class="tp-helpBtn" id="tp_help_btn" type="button" title="Help">?</button>
        </div>

        <div class="tp-bar">
          <div id="tp_bar"></div>
          <div class="tp-insight" id="tp_insight">cat5 says good luck</div>
        </div>

        <div class="tp-grid">
          <div class="tp-card">
            <h4>Hit</h4>
            <div class="tp-line tp-big" id="tp_hit">…</div>
            <div class="tp-line tp-dim" id="tp_you"></div>
          </div>

          <div class="tp-card">
            <h4>Chances</h4>
            <div class="tp-line" id="tp_win">Win: …</div>
            <div class="tp-line tp-dim" id="tp_conf">Confidence: …</div>
          </div>

          <div class="tp-card tp-advice">
            <h4>Advice</h4>
            <div class="tp-line tp-advice" id="tp_advice">…</div>
            <div class="tp-line tp-dim" id="tp_why">…</div>
            <div class="tp-line tp-dim" id="tp_meta">…</div>
            <div class="tp-line tp-dim tp-risk" id="tp_risks">…</div>
            <div class="tp-line tp-dim tp-lose" id="tp_loseTo">…</div>
          </div>
        </div>

        <div class="tp-help" id="tp_help" role="dialog" aria-hidden="true">
          <div class="tp-helpHead">
            <div>Glossary</div>
            <button class="tp-helpClose" id="tp_help_close" type="button" aria-label="Close">×</button>
          </div>
          <div class="tp-helpBody">
            <div class="tp-helpItem"><span class="tp-helpTerm">Shove</span>: Go all-in.</div>
            <div class="tp-helpItem"><span class="tp-helpTerm">Need%</span>: Minimum win % to call profitably.</div>
            <div class="tp-helpItem"><span class="tp-helpTerm">VPIP</span>: % of hands you voluntarily put chips in preflop.</div>
            <div class="tp-helpItem"><span class="tp-helpTerm">PFR</span>: % of hands you raised preflop.</div>
            <div class="tp-helpItem"><span class="tp-helpTerm">Broadway</span>: A,K,Q,J,10 ranks.</div>
            <div class="tp-helpItem"><span class="tp-helpTerm">Tight</span>: Plays fewer hands.</div>
            <div class="tp-helpItem"><span class="tp-helpTerm">Loose</span>: Plays more hands.</div>
          </div>
        </div>
        <div class="tp-help tp-stats" id="tp_stats" role="dialog" aria-hidden="true">
          <div class="tp-helpHead">
            <div>Session stats</div>
            <button class="tp-helpClose" id="tp_stats_close" type="button" aria-label="Close">×</button>
          </div>
          <div class="tp-helpBody">
            <div class="tp-helpItem"><span class="tp-helpTerm">Hands played</span>: <span id="tp_stat_hands">0</span></div>
            <div class="tp-helpItem"><span class="tp-helpTerm">Hands scrapped</span>: <span id="tp_stat_folds">0</span></div>
            <div class="tp-helpItem"><span class="tp-helpTerm">Hands won</span>: <span id="tp_stat_wins">0</span></div>
            <div class="tp-helpItem"><span class="tp-helpTerm">Hands lost</span>: <span id="tp_stat_losses">0</span></div>
            <div class="tp-helpItem"><span class="tp-helpTerm">VPIP</span>: <span id="tp_stat_vpip">0</span></div>
            <div class="tp-helpItem"><span class="tp-helpTerm">PFR</span>: <span id="tp_stat_pfr">0</span></div>
            <div class="tp-helpItem"><span class="tp-helpTerm">Money won</span>: <span id="tp_stat_money_won">$0</span></div>
            <div class="tp-helpItem"><span class="tp-helpTerm">Money lost</span>: <span id="tp_stat_money_lost">$0</span></div>
            <div class="tp-helpItem"><span class="tp-helpTerm">Biggest win</span>: <span id="tp_stat_big_win">$0</span></div>
            <div class="tp-helpItem"><span class="tp-helpTerm">Biggest loss</span>: <span id="tp_stat_big_loss">$0</span></div>
            <div class="tp-helpItem"><span class="tp-helpTerm">Net</span>: <span id="tp_stat_net">$0</span></div>
            <button class="tp-helpClose" id="tp_stats_reset" type="button">Reset</button>
          </div>
        </div>
      </div>
    `;
    document.documentElement.appendChild(hud);

    setInsightEl(hud.querySelector("#tp_insight"));
    if (!_insightBooted) {
      _insightBooted = true;
      queueInsight("cat5 says good luck", "good");
    }

    const hideBtn = hud.querySelector("#tp_hide_btn");
    const clipBtn = hud.querySelector("#tp_clip_btn");
    const statsBtn = hud.querySelector("#tp_stats_btn");
    const helpBtn = hud.querySelector("#tp_help_btn");
    const help = hud.querySelector("#tp_help");
    const helpClose = hud.querySelector("#tp_help_close");
    const statsPanel = hud.querySelector("#tp_stats");
    const statsClose = hud.querySelector("#tp_stats_close");
    const statsReset = hud.querySelector("#tp_stats_reset");
    let hideTimer = null;

    const setHelpOpen = (open) => {
      if (!help) return;
      help.classList.toggle("is-open", open);
      help.setAttribute("aria-hidden", open ? "false" : "true");
    };

    if (helpBtn) {
      helpBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const isOpen = help && help.classList.contains("is-open");
        setHelpOpen(!isOpen);
      }, { passive: false });
    }
    if (helpClose) {
      helpClose.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        setHelpOpen(false);
      }, { passive: false });
    }
    const setStatsOpen = (open) => {
      if (!statsPanel) return;
      statsPanel.classList.toggle("is-open", open);
      statsPanel.setAttribute("aria-hidden", open ? "false" : "true");
    };
    if (hideBtn) {
      hideBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        hud.classList.add("tp-hidden");
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
          hud.classList.remove("tp-hidden");
          hideTimer = null;
        }, 10000);
      }, { passive: false });
    }
    if (statsBtn) {
      statsBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const isOpen = statsPanel && statsPanel.classList.contains("is-open");
        setStatsOpen(!isOpen);
      }, { passive: false });
    }
    if (statsClose) {
      statsClose.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        setStatsOpen(false);
      }, { passive: false });
    }
    if (statsReset) {
      statsReset.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const stats = resetStats();
        updateStatsUi(stats);
      }, { passive: false });
    }
    if (clipBtn) {
      clipBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        copyDomScanToClipboard();
      }, { passive: false });
    }

    return hud;
  }

  function positionHud() {
    const hud = ensureHud();
    hud.style.left = "50%";
    hud.style.transform = "translateX(-50%)";
    hud.style.top = (HUD.topPx + HUD.navSafePx) + "px";
    hud.style.bottom = "auto";
  }

  function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => { });
      return;
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "readonly");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch { }
    document.body.removeChild(ta);
  }

  function collectDomSnapshot() {
    const els = [...document.querySelectorAll("*")];
    const data = {
      ts: new Date().toISOString(),
      url: location.href,
      totalElements: els.length,
      elements: els.map((el, idx) => {
        const text = String(el.textContent || "").replace(/\s+/g, " ").trim();
        const snippet = text.length > 80 ? text.slice(0, 77) + "..." : text;
        const attrs = {};
        if (el.attributes) {
          for (const a of el.attributes) {
            if (a && a.name && a.name.startsWith("data-")) attrs[a.name] = a.value;
          }
        }
        const role = el.getAttribute ? el.getAttribute("role") : "";
        const aria = el.getAttribute ? el.getAttribute("aria-label") : "";
        return {
          i: idx,
          tag: el.tagName ? el.tagName.toLowerCase() : "",
          id: el.id || "",
          cls: typeof el.className === "string" ? el.className : "",
          role: role || "",
          aria: aria || "",
          txt: snippet,
          data: attrs
        };
      })
    };
    return JSON.stringify(data, null, 2);
  }

  function copyDomScanToClipboard() {
    const payload = collectDomSnapshot();
    copyTextToClipboard(payload);
  }

  function updateStatsUi(stats) {
    const hud = document.getElementById("tp_holdem_hud");
    if (!hud || !stats) return;
    const set = (id, val) => {
      const el = hud.querySelector(id);
      if (el) el.textContent = val;
    };
    set("#tp_stat_hands", stats.handsPlayed || 0);
    set("#tp_stat_folds", stats.handsFolded || 0);
    set("#tp_stat_wins", stats.handsWon || 0);
    set("#tp_stat_losses", stats.handsLost || 0);
    set("#tp_stat_vpip", stats.vpip || 0);
    set("#tp_stat_pfr", stats.pfr || 0);
    set("#tp_stat_money_won", fmtMoney(stats.moneyWon || 0));
    set("#tp_stat_money_lost", fmtMoney(stats.moneyLost || 0));
    set("#tp_stat_big_win", fmtMoney(stats.biggestWin || 0));
    set("#tp_stat_big_loss", fmtMoney(stats.biggestLoss || 0));
    const net = (stats.moneyWon || 0) - (stats.moneyLost || 0);
    set("#tp_stat_net", (net >= 0 ? "+" : "-") + fmtMoney(Math.abs(net)));
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
    return "HIGH CARD";
  }

  function boardOnlyHitLabel(pairInfo) {
    const t = (pairInfo?.text || "").toLowerCase();
    if (t.includes("quads")) return "BOARD QUADS";
    if (t.includes("full house")) return "BOARD FULL HOUSE";
    if (t.includes("trips")) return "BOARD TRIPS";
    if (t.includes("two pair")) return "BOARD TWO PAIR";
    if (t.includes("pair")) return "BOARD PAIR";
    return "BOARD PAIR";
  }

  function hitSummary(cat, pairInfo) {
    if (pairInfo?.boardOnly) return boardOnlyHitLabel(pairInfo);
    return excitementLabel(cat);
  }

  function applySubTone(sub, winPct) {
    if (!sub) return;
    sub.classList.remove("tone-mute", "tone-warn", "tone-mid", "tone-good", "rainbow");
    sub.style.color = "";
    sub.style.webkitTextFillColor = "";
    if (typeof winPct !== "number") {
      sub.classList.add("tone-mute");
      return;
    }
    const w = Math.max(0, Math.min(100, winPct));
    if (w >= 80) {
      sub.classList.add("rainbow");
      return;
    }
    const hue = Math.round(120 * (w / 100));
    sub.style.color = `hsl(${hue}, 80%, 65%)`;
    if (w >= 65) sub.classList.add("tone-good");
    else if (w >= 45) sub.classList.add("tone-mid");
    else sub.classList.add("tone-warn");
  }

  function toneByWin(winPct) {
    if (typeof winPct !== "number") return "mute";
    return winPct >= 65 ? "good" : winPct >= 45 ? "info" : "warn";
  }

  function wantsNextCards(dist) {
    if (!dist) return null;
    const top = dist.top?.length ? dist.top.join(" · ") : "";
    const reach = dist.reach?.length ? dist.reach.join(" · ") : "";
    return { top, reach };
  }

  function preflopAdvice(hero, pot, toCall, oppCount, stackInfo) {
    const strength = holeStrength(hero[0], hero[1]);
    const strengthPct = Math.round(strength * 100);
    const shortStack = (stackInfo?.spr || 0) > 0 && (stackInfo?.spr || 0) <= 2;
    const stackAdj = (stackInfo?.callPctStack || 0) >= 0.4 || shortStack ? 0.05 : 0;
    const multiAdj = oppCount >= 6 ? 0.1 : oppCount >= 4 ? 0.06 : oppCount >= 2 ? 0.03 : 0;
    const openThresh = 0.58 + multiAdj + stackAdj;
    const callThresh = 0.42 + multiAdj + stackAdj;
    const shoveThresh = 0.75 + multiAdj;
    const callUnknown = !!stackInfo?.callUnknown;
    const priceNeed = callUnknown ? 50 : potOddsPct(pot, toCall);

    const hi = Math.max(hero[0].rank, hero[1].rank);
    const lo = Math.min(hero[0].rank, hero[1].rank);
    const pair = hero[0].rank === hero[1].rank;
    const premium = (pair && hi >= 11) || (hi >= 13 && lo >= 12);

    const context = `${oppCount || "?"} opp`;
    const baseWhy = `Preflop vs ${context}.`;

    if (!toCall || toCall <= 0) {
      if (strength >= openThresh || premium) {
        return { act: shortStack ? "RAISE (COMMIT)" : "RAISE", why: `${baseWhy} Strong start. Take the lead.`, tone: "info", strengthPct };
      }
      if (strength >= callThresh) {
        return { act: "CHECK (or SMALL OPEN)", why: `${baseWhy} Playable. Keep it small.`, tone: "mute", strengthPct };
      }
      return { act: "CHECK", why: `${baseWhy} Not enough. Easy check.`, tone: "mute", strengthPct };
    }

    if (strength >= shoveThresh && shortStack) {
      return { act: "RAISE (ALL-IN)", why: `${baseWhy} Short stack and strong hand. Put it in.`, tone: "good", strengthPct };
    }
    if (strength >= openThresh || premium) {
      return { act: "RAISE", why: `${baseWhy} Strong enough to push back.`, tone: "info", strengthPct };
    }
    if (strength >= callThresh || strengthPct >= priceNeed) {
      const priceNote = callUnknown ? "Price is a mystery, but this is OK." : "Looks fine to continue.";
      return { act: "CALL", why: `${baseWhy} ${priceNote}`, tone: "info", strengthPct };
    }
    return { act: "FOLD", why: `${baseWhy} Not worth it. Save the chips.`, tone: "warn", strengthPct };
  }

  function preflopHandLabel(hero) {
    if (!hero || hero.length < 2) return "Preflop";
    const a = hero[0];
    const b = hero[1];
    const hi = a.rank >= b.rank ? a : b;
    const lo = a.rank >= b.rank ? b : a;
    if (a.rank === b.rank) return `Pocket ${R_INV[a.rank]}s`;
    return `${R_INV[hi.rank]}${R_INV[lo.rank]} ${a.suit === b.suit ? "suited" : "offsuit"}`;
  }

  function recommendAction(mode, streetName, winPct, risks, dist, pot, toCall, heroCat, pairInfo, stackInfo) {
    const eq = typeof winPct === "number" ? winPct : 0;
    const riskCount = (risks || []).length;
    const boardOnly = !!(pairInfo && pairInfo.boardOnly);
    const adjustedCat = (boardOnly && heroCat <= 3) ? Math.max(0, heroCat - 1) : heroCat;
    const spr = stackInfo?.spr || 0;
    const callPctStack = stackInfo?.callPctStack || 0;
    const oppCount = stackInfo?.opponents || 0;
    const callUnknown = !!stackInfo?.callUnknown;
    const bankroll = BANKROLL_RESERVED || 0;
    const callPctBankroll = bankroll > 0 ? (toCall / bankroll) : 0;

    const improve =
      dist?.reachPct
        ? Math.max(dist.reachPct.strPlus || 0, dist.reachPct.flPlus || 0, dist.reachPct.fhPlus || 0)
        : 0;

    const priceNeed = callUnknown ? null : potOddsPct(pot, toCall);

    let callThresh = Math.max(0, Math.min(100, (priceNeed ?? 50) + Math.round(mode.callEdge * 100)));
    if (oppCount >= 3 && adjustedCat < 4) callThresh += 4;
    if (callPctStack >= 0.5 && adjustedCat < 4) callThresh += 8;
    if (spr > 0 && spr <= 2 && adjustedCat < 3) callThresh += 6;

    const cheapCall = !callUnknown && (callPctStack <= CHEAP_STACK_RATIO || callPctBankroll <= CHEAP_BANKROLL_RATIO);
    if (cheapCall && adjustedCat < 5) callThresh -= 6;

    const canLoosen = !callUnknown && callPctStack < 0.35 && (spr === 0 || spr >= 2);
    if (canLoosen) {
      let loosen = 0;
      if (riskCount === 0) loosen = 4;
      else if (riskCount === 1) loosen = 2;
      if (loosen && oppCount <= 2) callThresh -= loosen;
      else if (loosen && oppCount === 3) callThresh -= Math.max(1, Math.floor(loosen / 2));
    }
    callThresh = clamp(callThresh, 0, 95);
    const bluffBase = priceNeed ?? 50;
    const bluffThresh = Math.max(0, Math.min(100, bluffBase + Math.round(mode.bluffEdge * 100)));

    const isRiver = streetName === "River";
    const hasDrawyBoard = risks && risks.some(r => r.includes("straight") || r.includes("Straight") || r.includes("flush") || r.includes("Flush"));
    const monster = adjustedCat >= 6;
    const strong = adjustedCat >= 4;
    const medium = adjustedCat >= 2;
    const stackNote = callPctStack >= 0.5
      ? "Big chunk of your stack."
      : (spr > 0 && spr <= 2 ? "Short stacks." : "");
    const action = (act, why, tone) => ({ act, why: stackNote ? `${why} ${stackNote}` : why, tone });
    const heroStack = stackInfo?.heroStack || 0;

    const sizeBucket = monster ? 2 : strong ? 1 : 0;
    const betFrac = mode.betPot[sizeBucket];
    const raiseFrac = mode.raisePot[sizeBucket];

    const suggestedBet = pot > 0 ? Math.max(1, Math.round(pot * betFrac)) : 0;
    const suggestedRaise = pot > 0 ? Math.max(1, Math.round(pot * raiseFrac)) : 0;
    const betLabel = wagerLabel(suggestedBet, monster ? "BIG" : strong ? "MED" : "SMALL", heroStack);
    const raiseLabel = wagerLabel(suggestedRaise, "BIG", heroStack);

    const callRequired = callUnknown || (toCall && toCall > 0);
    if (!callRequired) {
      if (boardOnly && adjustedCat <= 1) {
        return action("CHECK", "Board pair only. Keep it small.", "mute");
      }
      if (monster) return action(`BET ${betLabel}`, "You hit huge. Build a pot.", "good");
      if (strong) return action(`BET ${betLabel}`, hasDrawyBoard ? "Don't give free cards." : "You're ahead. Keep the pressure on.", "info");
      if (medium) {
        return action(`BET ${betLabel}`, boardOnly ? "Paired board. Small poke is fine." : "Decent hand. Take a small shot.", "info");
      }
      if (!isRiver && improve >= 28) {
        const semiBet = Math.max(1, Math.round(pot * 0.55));
        const semiLabel = wagerLabel(semiBet, "SMALL", heroStack);
        return action(`BET ${semiLabel}`, "Take a stab; you can still improve.", "info");
      }
      return action("CHECK", "No hand yet. Check if you can.", "mute");
    }

    if (eq >= Math.max(70, callThresh + 15)) {
      return action(`RAISE ${raiseLabel}`, "Crushing it. Get paid.", "good");
    }

    if (eq >= Math.max(callThresh + 6, 55)) {
      return action(`CALL (or RAISE ${raiseLabel})`, hasDrawyBoard ? "Ahead. Make them pay to see more." : "Ahead often. Lean in.", "info");
    }

    if (eq >= callThresh) {
      if (!isRiver && improve >= 24 && eq < 55) {
        return action("CALL", "Close call, but you can still improve.", "info");
      }
      if (priceNeed == null) {
        return action("CALL", "Price is unclear, but it's close enough.", "info");
      }
      return action("CALL", "Call is fine. Don't overthink it.", "info");
    }

    if (!isRiver && cheapCall && eq >= Math.max(30, callThresh - 6)) {
      return action("CALL (SPECULATIVE)", "Cheap peek. Why not.", "info");
    }

    if (!isRiver && improve >= 35 && eq >= bluffThresh) {
      if (priceNeed == null) {
        return action("CALL", "You might improve. Worth a look.", "info");
      }
      return action("CALL", "You might improve. Worth a look.", "info");
    }

    if (priceNeed == null) {
      return action("FOLD", "Price is unclear and this is thin. Easy fold.", "warn");
    }
    return action("FOLD", "Too expensive for what you have. Save the chips.", "warn");
  }

  let _lastRenderedState = null;
  let _stableRec = null;

  function renderHud(state) {
    const hud = ensureHud();
    positionHud();
    const prevState = _lastRenderedState;
    setInsightEl(hud.querySelector("#tp_insight"));
    kickInsightLoop();

    const badge = hud.querySelector("#tp_badge");
    const sub = hud.querySelector("#tp_sub");
    // const streetEl = hud.querySelector("#tp_street");
    const bar = hud.querySelector("#tp_bar");

    const hitEl = hud.querySelector("#tp_hit");
    const youEl = hud.querySelector("#tp_you");

    const winEl = hud.querySelector("#tp_win");
    const confEl = hud.querySelector("#tp_conf");

    const advEl = hud.querySelector("#tp_advice");
    const whyEl = hud.querySelector("#tp_why");
    const metaEl = hud.querySelector("#tp_meta");
    const risksEl = hud.querySelector("#tp_risks");
    const loseToEl = hud.querySelector("#tp_loseTo");

    if (!state) {
      badge.textContent = "PMON v3.9.9";
      sub.textContent = "Waiting…";
      applySubTone(sub, null);
      // streetEl.textContent = "";
      bar.style.width = "0%";

      hitEl.textContent = "->";
      if (youEl) {
        youEl.textContent = "";
        youEl.style.display = "none";
      }

      winEl.textContent = "Win: …";
      confEl.textContent = "Confidence: …";

      advEl.textContent = "…";
      whyEl.textContent = "";
      metaEl.textContent = "";
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

    badge.textContent = "PMON v3.9.9";
    sub.textContent = state.titleLine || "…";
    applySubTone(sub, typeof state.winPct === "number" ? state.winPct : null);
    // streetEl.textContent = state.street || "";

    const w = typeof state.winPct === "number" ? Math.max(0, Math.min(100, state.winPct)) : 0;
    bar.style.width = w + "%";

    hitEl.textContent = state.hitText || state.hitLabel || state.currentHit || "…";

    const setLine = (el, text) => {
      if (!el) return;
      const t = String(text || "");
      el.textContent = t;
      el.style.display = t ? "" : "none";
    };

    setLine(youEl, "");

    const showWin = !!state.showWin || state.boardLen >= 3;
    if (showWin && typeof state.winPct === "number") {
      winEl.textContent = `Win: ${state.winPct}%`;
      setLine(confEl, `Confidence: ${state.eqConf || 0}%`);
    } else {
      winEl.textContent = HUD.showPreflop ? "Win: will start when cards are drawn" : "Win: …";
      setLine(confEl, state.eqConf ? `Confidence: ${state.eqConf}%` : "");
    }

    setLine(metaEl, "");

    const heroTurn = !!state.heroTurn;
    if (heroTurn && state.rec) _stableRec = { ...state.rec };
    const displayRec = (!heroTurn && _stableRec && state.rec) ? _stableRec : state.rec;
    advEl.classList.remove("good", "warn", "mute");
    const tone = displayRec?.tone || toneByWin(state.winPct);
    advEl.classList.add(tone === "good" ? "good" : tone === "warn" ? "warn" : "mute");
    advEl.textContent = displayRec ? displayRec.act : "…";
    setLine(whyEl, displayRec ? displayRec.why : "");

    const risksTxt = (state.risks && state.risks.length) ? `Board: ${state.risks.join(" · ")}` : "";
    setLine(risksEl, risksTxt);

    const loseToTxt = (state.loseTo && state.loseTo.length) ? `Lose to: ${state.loseTo.join(" · ")}` : "";
    setLine(loseToEl, loseToTxt);

    const insight = insightFromState(state, prevState);
    if (insight) queueInsight(insight.text, insight.tone);

    _lastRenderedState = state;
  }

  /* ===================== MAIN LOOP ===================== */
  setInterval(() => {
    const hero = getHeroCards();
    const board = getBoardCards();

    const pot = findPot();
    const callInfo = findToCall();
    const blinds = findBlindsFromFeed();

    const profiles = loadLS(LS_PROFILES, {}) || {};
    const stats = loadStats();
    const heroNameNorm = getHeroNameNorm();
    ingestActionFeed(profiles, heroNameNorm, stats, _handState, blinds);
    scoreProfiles(profiles);
    saveLS(LS_PROFILES, profiles);
    saveStats(stats);
    updateStatsUi(stats);

    positionHud();
    const opponents = getActiveOpponents(profiles);
    const oppCount = opponents.length || OPPONENTS;
    const heroStack = getHeroStack();
    const effStack = effectiveStack(heroStack, opponents);
    let toCall = callInfo.amount || 0;
    let callUnknown = !!callInfo.unknown;
    if (callInfo.sawCheck && callInfo.amount <= 0 && !callInfo.sawCall && !callInfo.sawAllIn) {
      toCall = 0;
      callUnknown = false;
    }
    if (callUnknown && callInfo.sawAllIn) {
      if (effStack > 0) {
        toCall = effStack;
        callUnknown = false;
      } else if (heroStack > 0) {
        toCall = heroStack;
        callUnknown = false;
      }
    }
    const spr = effStack > 0 && pot > 0 ? (effStack / pot) : 0;
    const heroTurn = !!callInfo.heroTurn;
    const callPctStack = heroStack > 0 && toCall > 0 ? (toCall / heroStack) : 0;
    const stackText = heroStack > 0
      ? `${fmtMoney(heroStack)}${effStack > 0 && effStack !== heroStack ? ` (eff ${fmtMoney(effStack)})` : ""}`
      : "$?";
    const stackInfo = { heroStack, effStack, spr, callPctStack, opponents: oppCount, callUnknown };

    if (hero.length !== 2) {
      _stableRec = null;
      if (HUD.showWhenNoHero) {
        renderHud({
          // street: street(board.length),
          heroText: "",
        boardText: board.map(c => c.txt).join(" "),
          boardLen: board.length,
          titleLine: "Waiting for your hole cards…",
          winPct: null,
        heroTurn,
          pot,
          toCall,
          callUnknown,
          sb: blinds.sb,
          bb: blinds.bb,
          stackText,
          spr,
          opponents: oppCount
        });
      } else {
        renderHud(null);
      }
      _lastKey = "";
      return;
    }

    const st = street(board.length);
    const heroKey = hero.map(c => c.txt).join("");
    if (board.length <= 1 && heroKey && heroKey !== _handState.key) {
      _handState = { key: heroKey, vpip: false, pfr: false, folded: false, won: false, lost: false };
      _stableRec = null;
      stats.handsPlayed = (stats.handsPlayed || 0) + 1;
      saveStats(stats);
      updateStatsUi(stats);
    }
    const key = hero.map(c => c.txt).join("") + "|" + board.map(c => c.txt).join("") + "|" + pot + "|" + toCall + "|" + oppCount;

    if (key === _lastKey) return;
    _lastKey = key;

    if (board.length < 3) {
      const preLabel = preflopHandLabel(hero);
      const hitCat = hero[0].rank === hero[1].rank ? 1 : 0;
      const hitLabel = excitementLabel(hitCat);
      const pairInfo = pairContext(hero, board);
      const hitText = hitSummary(hitCat, pairInfo);
      const oppSig = opponentSignature(opponents);
      const preKey = hero.map(c => c.txt).join("") + "|" + oppCount + "|" + oppSig;
      let preEq = _preflopCache.key === preKey ? _preflopCache.eq : null;
      let preIters = _preflopCache.key === preKey ? _preflopCache.iters : 0;
      if (!preEq) {
        preIters = PRE_ITERS + Math.round(oppCount * 12);
        preEq = simulateEquity(hero, [], oppCount, preIters, opponents.length ? opponents : null);
        _preflopCache = { key: preKey, eq: preEq, iters: preIters };
      }
      const eqConf = equityConfidence(preIters);
      const preRec = preflopAdvice(hero, pot, toCall, oppCount, stackInfo);
      renderHud({
        // street: st,
        heroText: hero.map(c => c.txt).join(" "),
        boardText: board.map(c => c.txt).join(" "),
        boardLen: board.length,
        titleLine: `Preflop: ${preLabel}`,
        heroTurn,
        currentHit: preLabel,
        hitCat,
        hitLabel,
        hitText,
        winPct: preEq?.winPct ?? null,
        splitPct: preEq?.splitPct ?? null,
        beats: preEq?.beatsAvg ?? 0,
        eqConf,
        showWin: true,
        pot,
        toCall,
        callUnknown,
        sb: blinds.sb,
        bb: blinds.bb,
        stackText,
        spr,
        opponents: oppCount,
        rec: { act: preRec.act, why: preRec.why, tone: preRec.tone },
        risks: [],
        loseTo: preEq?.loseTo || []
      });
      return;
    }

    const mode = getMode();
    const iters = board.length === 3 ? ITERS : board.length === 4 ? Math.round(ITERS * 1.25) : Math.round(ITERS * 1.5);
    const eq = simulateEquity(hero, board, oppCount, iters, opponents.length ? opponents : null);
    const eqConf = equityConfidence(iters);
    const bestNow = bestHand(hero.concat(board));
    const currentHit = bestNow.name;
    const hitCat = bestNow.cat;
    const hitLabel = excitementLabel(hitCat);

    const risks = boardRisks(board);
    const pairInfo = pairContext(hero, board);
    const hitText = hitSummary(hitCat, pairInfo);

    const dist = (board.length === 3 || board.length === 4) ? finalDistribution(hero, board) : null;
    const want = wantsNextCards(dist);

    const rec = recommendAction(mode, st, eq.winPct, risks, dist, pot, toCall, hitCat, pairInfo, stackInfo);

    const subtitleBits = [];
    subtitleBits.push(pairInfo.text ? `${currentHit} · ${pairInfo.text}` : `${currentHit}`);
    if (board.length >= 3 && typeof eq.winPct === "number") subtitleBits.push(`Win ${eq.winPct}%`);

    let whyExtra = "";
    if (want && (st === "Flop" || st === "Turn")) {
      const improve = dist?.reachPct ? Math.max(dist.reachPct.strPlus || 0, dist.reachPct.flPlus || 0, dist.reachPct.fhPlus || 0) : 0;
      if (improve >= 20) whyExtra = "You can still catch help on later cards.";
    }

    renderHud({
      // street: st,
      heroText: hero.map(c => c.txt).join(" "),
      boardText: board.map(c => c.txt).join(" "),
      boardLen: board.length,
      heroTurn,

      winPct: eq.winPct,
      splitPct: eq.splitPct,
      beats: eq.beatsAvg,
      eqConf,
      opponents: oppCount,

      currentHit,
      hitCat,
      hitLabel,
      hitText,

      risks,
      pairCtx: pairInfo.text,

      pot,
      toCall,
      callUnknown,
      sb: blinds.sb,
      bb: blinds.bb,
      stackText,
      spr,

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
