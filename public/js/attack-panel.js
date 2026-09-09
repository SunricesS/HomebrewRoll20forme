// ============================================================
// WebDND — Saldırı Paneli (Attack Panel) Modülü
// DNDWPSV2 WPF saldırı sistemi web portu
//
// İki seçici:
//   1. SALDIRAN — statları vuruş hesabında kullanılır, slotları düşürülür
//   2. HEDEF(LER) — Ctrl+Click ile çoklu seçim, AC kontrolü + hasar
// ============================================================

(function () {
  'use strict';

  // Panel sadece DM için aktif
  if (typeof role === 'undefined' || role !== 'dm') return;

  // === STATE ===
  let selectedAttacker = null; // { type, id, name, data }
  let selectedTargets = [];    // Array of { type, id, name, data, tokenEl }
  let lastAttackResults = [];  // Array of { totalDamage, targetId, targetType, targetName, attackerName, statusEffectsToApply }
  let pendingAoEExplosions = []; // Array of { cx, cy, radiusPx, damage, affectedTargets }
  let allCharactersCache = [];

  // === HAZIR SALDIRI PRESETLERİ STATE ===
  let attackPresetsCache = [];
  const lastEquippedAttackByToken = new Map(); // tokenKey ('type:id') -> presetId
  let activeEquippedPreset = null;

  // === SALDIRAN FORM CACHE ===
  // Her saldıran için form değerlerini hafızada tutar (type:id → { field: value, ... })
  const attackerFormCache = new Map();

  // DOM REFERANSLARI
  const panel = document.getElementById('attack-panel-container');
  if (!panel) return;

  // Preset Referansları
  const presetSelect = document.getElementById('atk-preset-select');
  const btnOpenPresets = document.getElementById('btn-open-attack-presets');
  const presetInfoBanner = document.getElementById('atk-preset-info-banner');
  const presetBadgeStat = document.getElementById('atk-preset-badge-stat');
  const presetBadgeType = document.getElementById('atk-preset-badge-type');
  const presetBadgeHalfMiss = document.getElementById('atk-preset-badge-halfmiss');
  const presetBadgeStatus = document.getElementById('atk-preset-badge-status');
  const presetBadgeAoe = document.getElementById('atk-preset-badge-aoe');
  const presetDescText = document.getElementById('atk-preset-desc-text');

  const attackerSelect = document.getElementById('atk-attacker-select');
  const attackerInfo = document.getElementById('atk-attacker-info');
  const targetSelect = document.getElementById('atk-target-select');
  const targetInfo = document.getElementById('atk-target-info');
  const selectedTargetsList = document.getElementById('atk-selected-targets-list');
  const modifierSelect = document.getElementById('atk-modifier');
  const targetACInput = document.getElementById('atk-target-ac');
  const extraDmgInput = document.getElementById('atk-extra-damage');
  const attackCountInput = document.getElementById('atk-attack-count');
  const advantageCheck = document.getElementById('atk-advantage');
  const disadvantageCheck = document.getElementById('atk-disadvantage');

  // Büyü slotları (saldıranın slotları)
  const slotDisplays = {
    1: document.getElementById('atk-slot-lvl1'),
    2: document.getElementById('atk-slot-lvl2'),
    3: document.getElementById('atk-slot-lvl3'),
    4: document.getElementById('atk-slot-lvl4')
  };

  // Log
  const combatLog = document.getElementById('atk-combat-log');

  // Butonlar
  const btnAttack = document.getElementById('atk-btn-attack') || document.getElementById('atk-btn-physical');
  const btnPhysicalAttack = btnAttack;
  const btnSpellAttack = null;
  const btnApplyDamage = document.getElementById('atk-btn-apply-damage');
  const btnClearLog = document.getElementById('atk-btn-clear-log');
  const btnClearResist = document.getElementById('atk-btn-clear-resist');
  const btnRefreshTargets = document.getElementById('atk-btn-refresh');

  // Büyü Slotu Kontrol DOM Referansları
  const spellSlotControlGroup = document.getElementById('atk-spell-slot-control-group');
  const spellSlotBadge = document.getElementById('atk-slot-control-badge');
  const slotScalingNote = document.getElementById('atk-slot-scaling-note');

  // === YARDIMCI ===

  function intVal(el) {
    return parseInt(el?.value) || 0;
  }

  function escapeHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function hasAnyDice(pools) {
    if (!pools) return false;
    const checkPool = (p) => {
      if (!p) return false;
      if (p.bonus && p.bonus !== 0) return true;
      const d = p.dice || {};
      return Object.values(d).some(c => parseInt(c) > 0);
    };
    return checkPool(pools.phys || pools.physical) || checkPool(pools.elem1) || checkPool(pools.elem2);
  }

  // ============================================================
  // VURUŞ HİSSİ (WEB AUDIO API SES VE GÖRSEL DARBE MOTORU)
  // ============================================================

  let audioCtx = null;
  function getAudioContext() {
    if (!audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) audioCtx = new AudioCtx();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  /**
   * Tamamen yerel Web Audio API ile güçlü, tok ve organik vuruş sesleri üretir.
   */
  function playHitSound(options = {}) {
    const { isCritical = false, attackType = 'physical', damage = 10 } = options;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      // 1. Düşük Frekanslı Gövde Vuruşu (Deep Punch / Heavy Thud)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      const startFreq = isCritical ? 160 : (attackType === 'spell' ? 240 : 120);
      const endFreq = isCritical ? 24 : 32;
      const duration = isCritical ? 0.38 : 0.24;

      osc.type = isCritical ? 'sawtooth' : (attackType === 'spell' ? 'sine' : 'triangle');
      osc.frequency.setValueAtTime(startFreq, now);
      osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);

      const volume = Math.min(1.0, 0.4 + (damage / 80) * 0.45 + (isCritical ? 0.3 : 0));
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + duration);

      // 2. Kılıç Kesme / Çarpma Şapırtısı (Noise Burst)
      const bufferSize = Math.floor(ctx.sampleRate * (isCritical ? 0.14 : 0.09));
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      const whiteNoise = ctx.createBufferSource();
      whiteNoise.buffer = noiseBuffer;

      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = attackType === 'spell' ? 'bandpass' : 'highpass';
      noiseFilter.frequency.setValueAtTime(attackType === 'spell' ? 1400 : 900, now);

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(volume * 0.55, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + (isCritical ? 0.14 : 0.09));

      whiteNoise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(ctx.destination);

      whiteNoise.start(now);

      // 3. Kritik Vuruş Çınlaması (Resonant High Chime)
      if (isCritical) {
        const chimeOsc = ctx.createOscillator();
        const chimeGain = ctx.createGain();
        chimeOsc.type = 'sine';
        chimeOsc.frequency.setValueAtTime(900, now);
        chimeOsc.frequency.exponentialRampToValueAtTime(1800, now + 0.08);
        chimeOsc.frequency.exponentialRampToValueAtTime(520, now + 0.42);

        chimeGain.gain.setValueAtTime(0.35, now);
        chimeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

        chimeOsc.connect(chimeGain);
        chimeGain.connect(ctx.destination);

        chimeOsc.start(now);
        chimeOsc.stop(now + 0.45);
      }
    } catch (e) {}
  }

  /**
   * Tok, derin bas ve alev rüzgarı içeren Web Audio API patlama sesi sentezler.
   */
  function playExplosionSound() {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      // 1. Derin Bas Patlama Çöküşü (Sub-bass Drop)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(28, now + 0.65);

      gain.gain.setValueAtTime(0.85, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.7);

      // 2. Patlama Alev & Rüzgar Gürültüsü (Lowpass Filtered Noise Burst)
      const bufferSize = Math.floor(ctx.sampleRate * 0.55);
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }
      const noiseSource = ctx.createBufferSource();
      noiseSource.buffer = noiseBuffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(500, now);
      filter.frequency.exponentialRampToValueAtTime(70, now + 0.55);

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.75, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

      noiseSource.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(ctx.destination);

      noiseSource.start(now);
    } catch (e) {}
  }

  function findTokenElement(targetType, targetId) {
    if (!targetId) return null;
    const idStr = String(targetId);
    if (typeof tokens !== 'undefined' && tokens[idStr]) return tokens[idStr];
    if (targetType === 'character' && typeof allPlayers !== 'undefined') {
      const p = Object.values(allPlayers).find(pl => pl.character && String(pl.character.id) === idStr);
      if (p && tokens[p.id]) return tokens[p.id];
    }
    return document.querySelector(`.token[data-id="${idStr}"]`) ||
           document.querySelector(`.token[data-character-id="${idStr}"]`);
  }

  const recentImpacts = new Set();

  /**
   * Hedef token üzerinde sarsıntı, kesme efekti, sıçrayan hasar metni ve ses efektini tetikler.
   */
  function triggerHitImpact(data) {
    const { targetType, targetId, damage, isCritical, attackType } = data || {};
    const key = `${targetType}:${targetId}`;
    recentImpacts.add(key);
    setTimeout(() => recentImpacts.delete(key), 700);

    // 1. Organik Vuruş Sesi Çal
    playHitSound({ isCritical, attackType, damage });

    // 2. Harita Kamerası Sarsıntısı (Screenshake)
    const gameMapEl = document.getElementById('game-map');
    if (gameMapEl) {
      const shakeClass = isCritical ? 'map-screen-shake-crit' : 'map-screen-shake';
      gameMapEl.classList.remove('map-screen-shake', 'map-screen-shake-crit');
      void gameMapEl.offsetWidth;
      gameMapEl.classList.add(shakeClass);
      setTimeout(() => gameMapEl.classList.remove(shakeClass), isCritical ? 360 : 250);
    }

    // 3. Token Görsel Tepkileri
    const mapContent = document.getElementById('map-content');
    const tokenEl = findTokenElement(targetType, targetId);
    if (!tokenEl || !mapContent) return;

    // Token Flinch Shake (Geri tepme & Parlama)
    tokenEl.classList.remove('token-impact-shake');
    void tokenEl.offsetWidth;
    tokenEl.classList.add('token-impact-shake');
    setTimeout(() => tokenEl.classList.remove('token-impact-shake'), 460);

    const tokenLeft = parseFloat(tokenEl.style.left) || tokenEl.offsetLeft || 0;
    const tokenTop = parseFloat(tokenEl.style.top) || tokenEl.offsetTop || 0;
    const tokenSize = tokenEl.offsetWidth || 50;
    const cx = tokenLeft + tokenSize / 2;
    const cy = tokenTop + tokenSize / 2;

    // Kılıç Kesme & Kıvılcım Halka Efekti (Slash Trail & Shockwave)
    const strikeFx = document.createElement('div');
    strikeFx.className = `impact-strike-fx ${isCritical ? 'is-critical' : ''}`;
    strikeFx.style.left = `${cx}px`;
    strikeFx.style.top = `${cy}px`;

    const slash = document.createElement('div');
    slash.className = 'impact-strike-slash';
    strikeFx.appendChild(slash);

    const ring = document.createElement('div');
    ring.className = 'impact-strike-ring';
    strikeFx.appendChild(ring);

    mapContent.appendChild(strikeFx);
    setTimeout(() => strikeFx.remove(), 550);

    // Sıçrayan Hasar Metni (Floating Combat Damage)
    const floatText = document.createElement('div');
    floatText.className = `token-floating-dmg ${isCritical ? 'is-critical' : ''}`;
    floatText.textContent = isCritical ? `💥 KRİTİK! -${damage}` : `-${damage}`;
    floatText.style.left = `${cx}px`;
    floatText.style.top = `${tokenTop}px`;

    mapContent.appendChild(floatText);
    setTimeout(() => floatText.remove(), 1700);
  }

  window.__webdnd_triggerHitImpact = triggerHitImpact;

  // ============================================================
  // GOOGLE DICE ROLLER — ZAR HAVUZU YÖNETİCİSİ (DICE POOL CHANNEL)
  // ============================================================

  class DicePoolChannel {
    constructor(key, label) {
      this.key = key;
      this.label = label;
      this.dice = { 4: 0, 6: 0, 8: 0, 10: 0, 12: 0, 20: 0 };
      this.bonus = 0;

      // DOM Referansları
      this.badgesEl = document.getElementById(`atk-${key}-badges`);
      this.resultEl = document.getElementById(`atk-${key}-result`);
      this.totalValEl = document.getElementById(`atk-${key}-total-val`);
      this.breakdownValEl = document.getElementById(`atk-${key}-breakdown-val`);
      this.bonusInput = document.getElementById(`atk-${key}-bonus`);
      this.weakRadio = document.getElementById(`atk-${key}-weak`);
      this.resRadio = document.getElementById(`atk-${key}-resist`);
      this.rollBtn = document.getElementById(`atk-${key}-roll`);
      this.clearBtn = document.getElementById(`atk-${key}-clear`);
      this.container = document.querySelector(`.atk-damage-channel[data-channel="${key}"]`);

      this.init();
    }

    init() {
      if (!this.container) return;

      // Zar butonları (d4, d6, d8, d10, d12, d20)
      const dieButtons = this.container.querySelectorAll('.atk-die-btn');
      dieButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          const sides = parseInt(btn.getAttribute('data-die'));
          if (sides) this.addDie(sides);
        });
      });

      // Bonus stepper (+ / -)
      const minusBtn = this.container.querySelector('.atk-bonus-minus');
      const plusBtn = this.container.querySelector('.atk-bonus-plus');

      minusBtn?.addEventListener('click', (e) => {
        const step = e.shiftKey ? 5 : 1;
        this.setBonus(this.bonus - step);
      });

      plusBtn?.addEventListener('click', (e) => {
        const step = e.shiftKey ? 5 : 1;
        this.setBonus(this.bonus + step);
      });

      // Bonus input direkt giriş
      this.bonusInput?.addEventListener('input', () => {
        this.bonus = parseInt(this.bonusInput.value) || 0;
        this.renderBadges();
      });

      this.bonusInput?.addEventListener('change', () => {
        this.setBonus(parseInt(this.bonusInput.value) || 0);
      });

      // Zar At (Roll) ve Temizle (Clear) butonları
      this.rollBtn?.addEventListener('click', () => this.rollLocal());
      this.clearBtn?.addEventListener('click', () => this.clear());

      this.renderBadges();
    }

    addDie(sides) {
      if (![4, 6, 8, 10, 12, 20].includes(sides)) return;
      this.dice[sides] = (this.dice[sides] || 0) + 1;
      this.renderBadges();
    }

    removeDie(sides) {
      if (this.dice[sides] > 0) {
        this.dice[sides]--;
        this.renderBadges();
      }
    }

    setBonus(val) {
      this.bonus = parseInt(val) || 0;
      if (this.bonusInput) this.bonusInput.value = this.bonus;
      this.renderBadges();
    }

    hasActiveDice() {
      return Object.values(this.dice).some(c => c > 0) || this.bonus !== 0;
    }

    clear() {
      for (const sides of [4, 6, 8, 10, 12, 20]) {
        this.dice[sides] = 0;
      }
      this.bonus = 0;
      if (this.bonusInput) this.bonusInput.value = '0';
      if (this.weakRadio) this.weakRadio.checked = false;
      if (this.resRadio) this.resRadio.checked = false;
      this.hideResult();
      this.renderBadges();
    }

    hideResult() {
      if (this.resultEl) this.resultEl.classList.add('hidden');
    }

    showResult(total, breakdown) {
      if (this.totalValEl) this.totalValEl.textContent = total;
      if (this.breakdownValEl) this.breakdownValEl.textContent = breakdown;
      if (this.resultEl) this.resultEl.classList.remove('hidden');
    }

    renderBadges() {
      if (!this.badgesEl) return;
      this.badgesEl.innerHTML = '';

      let hasItems = false;
      const sidesList = [4, 6, 8, 10, 12, 20];

      sidesList.forEach(sides => {
        const count = this.dice[sides] || 0;
        if (count > 0) {
          hasItems = true;
          const chip = document.createElement('span');
          chip.className = `atk-die-chip atk-die-chip-${sides}`;
          chip.title = `1 adet d${sides} çıkar (Mevcut: ${count}d${sides})`;
          chip.innerHTML = `<span class="atk-chip-label">${count}d${sides}</span><span class="atk-die-chip-remove" title="Kaldır">✕</span>`;
          chip.addEventListener('click', () => this.removeDie(sides));
          this.badgesEl.appendChild(chip);
        }
      });

      if (this.bonus !== 0) {
        hasItems = true;
        const bonusChip = document.createElement('span');
        bonusChip.className = 'atk-die-chip atk-die-chip-bonus';
        bonusChip.title = 'Bonusu sıfırla';
        const sign = this.bonus > 0 ? `+${this.bonus}` : `${this.bonus}`;
        bonusChip.innerHTML = `<span class="atk-chip-label">Bonus ${sign}</span><span class="atk-die-chip-remove" title="Sıfırla">✕</span>`;
        bonusChip.addEventListener('click', () => this.setBonus(0));
        this.badgesEl.appendChild(bonusChip);
      }

      if (!hasItems) {
        this.badgesEl.innerHTML = '<span class="atk-pool-empty-hint">Zar seçilmedi</span>';
      }
    }

    rollLocal() {
      let rawTotal = 0;
      const breakdownParts = [];
      const sidesList = [4, 6, 8, 10, 12, 20];
      let hasAnyDice = false;

      sidesList.forEach(sides => {
        const count = this.dice[sides] || 0;
        if (count > 0) {
          hasAnyDice = true;
          const rolls = [];
          for (let i = 0; i < count; i++) {
            const r = Math.floor(Math.random() * sides) + 1;
            rolls.push(r);
            rawTotal += r;
          }
          breakdownParts.push(`${count}d${sides} [${rolls.join(' + ')}]`);
        }
      });

      if (this.bonus !== 0) {
        rawTotal += this.bonus;
        breakdownParts.push(this.bonus > 0 ? `+${this.bonus}` : `${this.bonus}`);
      }

      if (!hasAnyDice && this.bonus === 0) {
        this.showResult(0, 'Zar havuzu boş (0)');
        return { total: 0, breakdown: '0' };
      }

      let finalDmg = Math.max(0, rawTotal);
      if (selectedTargets.length === 1) {
        const t = selectedTargets[0];
        const effects = getTargetEffects(t);
        let dt = 'slashing';
        if (this.key === 'phys') {
          dt = document.getElementById('atk-phys-damage-type')?.value || 'slashing';
        } else if (this.key === 'spell') {
          dt = 'magic';
        }
        const hasRes = hasDamageResistance(effects, dt);
        const hasVuln = hasDamageVulnerability(effects, dt);
        if (hasVuln && !hasRes) {
          finalDmg *= 2;
          breakdownParts.push(`(${getDamageTypeTurkish(dt)} Zayıflığı 2x)`);
        } else if (hasRes && !hasVuln) {
          finalDmg = Math.floor(finalDmg / 2);
          breakdownParts.push(`(${getDamageTypeTurkish(dt)} Direnci 0.5x)`);
        }
      } else {
        if (this.weakRadio?.checked) {
          finalDmg *= 2;
          breakdownParts.push('(Zayıf 2x)');
        } else if (this.resRadio?.checked) {
          finalDmg = Math.floor(finalDmg / 2);
          breakdownParts.push('(Dirençli 0.5x)');
        }
      }

      const breakdown = breakdownParts.length > 0 ? breakdownParts.join(' + ') : '0';
      this.showResult(finalDmg, breakdown);

      addCombatLog(
        `🎲 <strong>${this.label} Zarı:</strong> <span class="atk-log-hit">${finalDmg} Hasar</span> <span class="atk-log-roll">(Döküm: ${escapeHtml(breakdown)})</span>`,
        'hit'
      );

      return { total: finalDmg, breakdown };
    }

    getState() {
      return {
        dice: {
          d4: this.dice[4] || 0,
          d6: this.dice[6] || 0,
          d8: this.dice[8] || 0,
          d10: this.dice[10] || 0,
          d12: this.dice[12] || 0,
          d20: this.dice[20] || 0
        },
        bonus: this.bonus,
        weakness: this.weakRadio?.checked || false,
        resistance: this.resRadio?.checked || false
      };
    }

    setState(state) {
      if (!state) {
        this.clear();
        return;
      }

      const d = state.dice || {};
      this.dice = {
        4: parseInt(d.d4 ?? d['4'] ?? 0) || 0,
        6: parseInt(d.d6 ?? d['6'] ?? 0) || 0,
        8: parseInt(d.d8 ?? d['8'] ?? 0) || 0,
        10: parseInt(d.d10 ?? d['10'] ?? 0) || 0,
        12: parseInt(d.d12 ?? d['12'] ?? 0) || 0,
        20: parseInt(d.d20 ?? d['20'] ?? 0) || 0
      };

      this.bonus = parseInt(state.bonus) || 0;
      if (this.bonusInput) this.bonusInput.value = this.bonus;
      if (this.weakRadio) this.weakRadio.checked = !!state.weakness;
      if (this.resRadio) this.resRadio.checked = !!state.resistance;

      this.hideResult();
      this.renderBadges();
    }
  }

  // Havuz Kanallarını Başlat
  const dicePools = {
    phys: new DicePoolChannel('phys', 'Fiziksel'),
    elem1: new DicePoolChannel('elem1', 'Ateş/El.1'),
    elem2: new DicePoolChannel('elem2', 'Buz/El.2'),
    spell: new DicePoolChannel('spell', 'Büyü Hasarı')
  };

  // ============================================================
  // SEÇİCİ DOLDURMA
  // ============================================================

  /**
   * Her iki seçiciyi de (saldıran + hedef) doldurur.
   */
  async function loadSelectors() {
    try {
      const res = await fetch('/api/characters');
      if (res.ok) allCharactersCache = await res.json();
    } catch (e) {
      console.error('Karakter listesi çekilemedi:', e);
    }

    populateSelect(attackerSelect, '— Saldıran Seç —');
    populateSelect(targetSelect, '— Hedef Seç —');
  }

  function populateSelect(selectEl, placeholder) {
    if (!selectEl) return;
    const prevVal = selectEl.value;
    selectEl.innerHTML = `<option value="">${placeholder}</option>`;

    // Grup 1: Bağlı oyuncular
    const playerGroup = document.createElement('optgroup');
    playerGroup.label = '🎭 Bağlı Oyuncular';
    let hasPlayers = false;

    if (typeof allPlayers !== 'undefined') {
      Object.values(allPlayers).forEach(p => {
        if (!p.character || p.role === 'dm') return;
        hasPlayers = true;
        const opt = document.createElement('option');
        opt.value = `character:${p.character.id}`;
        opt.textContent = `${p.character.name} (HP: ${p.character.hp_current}/${p.character.hp_max})`;
        playerGroup.appendChild(opt);
      });
    }
    if (hasPlayers) selectEl.appendChild(playerGroup);

    // Grup 2: DB'deki tüm karakterler (bağlı olmayanlar)
    const connectedIds = new Set();
    if (typeof allPlayers !== 'undefined') {
      Object.values(allPlayers).forEach(p => {
        if (p.character) connectedIds.add(p.character.id);
      });
    }

    const dbGroup = document.createElement('optgroup');
    dbGroup.label = '📋 Tüm Karakterler (DB)';
    let hasDbChars = false;

    allCharactersCache.forEach(c => {
      if (connectedIds.has(c.id)) return;
      hasDbChars = true;
      const opt = document.createElement('option');
      opt.value = `character:${c.id}`;
      opt.textContent = `${c.name} (HP: ${c.hp_current}/${c.hp_max})`;
      dbGroup.appendChild(opt);
    });
    if (hasDbChars) selectEl.appendChild(dbGroup);

    // Grup 3: İşaretler/NPC
    if (window.__webdnd_markers) {
      const markerGroup = document.createElement('optgroup');
      markerGroup.label = '⚔️ İşaretler/NPC';
      let hasMarkers = false;

      Object.values(window.__webdnd_markers).forEach(m => {
        hasMarkers = true;
        const opt = document.createElement('option');
        opt.value = `marker:${m.id}`;
        const hpInfo = m.hp != null ? ` (HP: ${m.hp}/${m.maxHp || '?'})` : '';
        opt.textContent = `[M] ${m.name}${hpInfo}`;
        markerGroup.appendChild(opt);
      });
      if (hasMarkers) selectEl.appendChild(markerGroup);
    }

    // Önceki seçimi koru
    if (prevVal) selectEl.value = prevVal;
  }

  // ============================================================
  // VERİ ÇÖZME
  // ============================================================

  function resolveSelection(val) {
    if (!val) return null;
    const [type, id] = val.split(':');

    if (type === 'character') {
      let charData = null;
      if (typeof allPlayers !== 'undefined') {
        const entry = Object.values(allPlayers).find(p => p.character && p.character.id === id);
        if (entry) charData = entry.character;
      }
      if (!charData) charData = allCharactersCache.find(c => c.id === id);
      if (charData) return { type: 'character', id: charData.id, name: charData.name, data: charData };
    } else if (type === 'marker') {
      const markerData = window.__webdnd_markers?.[id];
      if (markerData) return { type: 'marker', id: markerData.id, name: markerData.name, data: markerData };
    }
    return null;
  }

  // ============================================================
  // HAZIR SALDIRI PRESETLERİ (ATTACK PRESETS) & AKILLI KUŞANMA
  // ============================================================

  /**
   * Preset dropdown'ını günceller.
   */
  function populatePresetSelect() {
    if (!presetSelect) return;
    const currentVal = presetSelect.value;
    presetSelect.innerHTML = '<option value="">— Serbest Saldırı (Özel Zar Havuzu) —</option>';

    attackPresetsCache.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      const typeIcon = p.attackType === 'spell' ? '✨' : '⚔️';
      const halfIcon = p.halfDamageOnMiss ? ' [½]' : '';
      const statusIcon = p.statusEffectsToApply?.length ? ` [${p.statusEffectsToApply[0].icon || '✨'}]` : '';
      const aoeIcon = p.isAoe ? ` [💥 ${p.aoeRadius || 1}m]` : '';
      opt.textContent = `${typeIcon} ${p.name} (${p.stat})${halfIcon}${statusIcon}${aoeIcon}`;
      presetSelect.appendChild(opt);
    });

    if (currentVal && attackPresetsCache.some(p => p.id === currentVal)) {
      presetSelect.value = currentVal;
    }
  }

  /**
   * Paneldeki büyü seviyesini değiştirir ve o seviyeye ait özel zar havuzunu (varsa) uygular.
   */
  function selectActiveSpellLevel(level, preset = activeEquippedPreset) {
    const lvl = Math.max(1, Math.min(4, parseInt(level) || 1));
    const radio = document.getElementById(`atk-active-spell-lvl${lvl}`);
    if (radio) radio.checked = true;

    // Aktif kart & radyo görsel vurgusu
    for (let i = 1; i <= 4; i++) {
      const slotCard = document.querySelector(`.atk-slot[data-slot-level="${i}"]`);
      if (slotCard) {
        if (i === lvl) slotCard.classList.add('is-active-level');
        else slotCard.classList.remove('is-active-level');
      }
      const radioLabel = document.getElementById(`atk-active-spell-lvl${i}`)?.closest('.atk-level-radio-label');
      if (radioLabel) {
        if (i === lvl) radioLabel.classList.add('is-selected');
        else radioLabel.classList.remove('is-selected');
      }
    }

    // Preset büyü slotu harcıyorsa zarları seviyeye göre ölçekle
    if (preset && preset.consumesSpellSlot) {
      const scaling = preset.slotScaling && preset.slotScaling[lvl];
      const hasCustomDice = scaling && hasAnyDice(scaling.dicePools || scaling);

      if (hasCustomDice) {
        const pools = scaling.dicePools || scaling;
        dicePools.phys.setState(pools.phys || pools.physical);
        dicePools.elem1.setState(pools.elem1);
        dicePools.elem2.setState(pools.elem2);
        if (slotScalingNote) {
          slotScalingNote.innerHTML = `✨ <strong style="color:#38bdf8;">Seviye ${lvl} Özel Etkisi Aktif</strong>: Seviyeye özel zar havuzu yüklendi.`;
        }
      } else {
        // Özel zar yok -> Taban zar havuzunu yükle (varsayılan)
        const pools = preset.dicePools || {};
        dicePools.phys.setState(pools.phys || pools.physical);
        dicePools.elem1.setState(pools.elem1);
        dicePools.elem2.setState(pools.elem2);
        if (slotScalingNote) {
          if (lvl === (preset.baseSpellLevel || 1)) {
            slotScalingNote.innerHTML = `📌 <strong>Seviye ${lvl} (Taban Etki)</strong>: Standart büyü hasarı geçerli.`;
          } else {
            slotScalingNote.innerHTML = `ℹ️ <strong>Seviye ${lvl} (Varsayılan Etki)</strong>: Bu seviye için özel zar atanmamış, taban hasar geçerli.`;
          }
        }
      }

      // Slot sayısı kontrolü
      const currentSlots = parseInt(slotDisplays[lvl]?.textContent || '0');
      if (currentSlots <= 0 && slotScalingNote) {
        slotScalingNote.innerHTML += ` <span style="color:#ef4444; font-weight:bold;">⚠️ (0 Slot Kaldı!)</span>`;
      }
    }
  }

  /**
   * Belirli bir preseti kuşanır ve paneldeki havuz/stat alanlarını doldurur.
   */
  function equipPreset(presetOrId, persistForToken = true) {
    let preset = typeof presetOrId === 'string' ? attackPresetsCache.find(p => p.id === presetOrId) : presetOrId;
    if (!preset) return;

    activeEquippedPreset = preset;

    // Dropdown seçimi güncelle
    if (presetSelect) presetSelect.value = preset.id;

    // Stat Modifikatör
    if (modifierSelect && preset.stat) modifierSelect.value = preset.stat;

    // Büyü Slotu Kontrolü
    if (preset.consumesSpellSlot) {
      if (spellSlotControlGroup) {
        spellSlotControlGroup.style.display = 'block';
        if (spellSlotBadge) spellSlotBadge.textContent = `Gerekli: Min Lvl ${preset.baseSpellLevel || 1}`;
      }

      // Uygun ilk seviyeyi seç (min seviyeden başlayarak slotu olanı tercih et)
      const minLvl = preset.baseSpellLevel || 1;
      let chosenLvl = minLvl;
      for (let l = minLvl; l <= 4; l++) {
        const cnt = parseInt(slotDisplays[l]?.textContent || '0');
        if (cnt > 0) {
          chosenLvl = l;
          break;
        }
      }
      selectActiveSpellLevel(chosenLvl, preset);
    } else {
      if (spellSlotControlGroup) spellSlotControlGroup.style.display = 'none';

      // Standart Zar Havuzları
      const pools = preset.dicePools || {};
      dicePools.phys.setState(pools.phys || pools.physical);
      dicePools.elem1.setState(pools.elem1);
      dicePools.elem2.setState(pools.elem2);
    }

    // Ekstra Parametreler (varsa)
    if (preset.extraDamage != null && extraDmgInput) extraDmgInput.value = preset.extraDamage;
    if (preset.attackCount != null && attackCountInput) attackCountInput.value = preset.attackCount;

    // Hasar türü
    if (preset.physicalDamageType) {
      const pTypeSelect = document.getElementById('atk-phys-damage-type');
      if (pTypeSelect) pTypeSelect.value = preset.physicalDamageType;
    }

    // Banner ve Direnç Rozetleri Güncelle
    updatePresetBanner(preset);
    updateTargetResistanceBadges();

    // Saldıran token için kuşanma hafızasını kaydet
    if (persistForToken && selectedAttacker) {
      const key = `${selectedAttacker.type}:${selectedAttacker.id}`;
      lastEquippedAttackByToken.set(key, preset.id);
    }

    // Alt hotbar ile senkronizasyon
    if (typeof window.__webdnd_onPresetEquipped === 'function') {
      window.__webdnd_onPresetEquipped(preset.id);
    }
  }

  /**
   * Kuşanılmış preseti çıkarır (serbest moda geçer).
   */
  function unequipPreset(persistForToken = true) {
    activeEquippedPreset = null;
    if (presetSelect) presetSelect.value = '';
    if (presetInfoBanner) presetInfoBanner.classList.add('hidden');
    if (spellSlotControlGroup) spellSlotControlGroup.style.display = 'none';

    if (persistForToken && selectedAttacker) {
      const key = `${selectedAttacker.type}:${selectedAttacker.id}`;
      lastEquippedAttackByToken.delete(key);
    }

    // Alt hotbar ile senkronizasyon
    if (typeof window.__webdnd_onPresetEquipped === 'function') {
      window.__webdnd_onPresetEquipped(null);
    }
  }

  /**
   * Kuşanılmış preset bilgi banner'ını günceller.
   */
  function updatePresetBanner(preset) {
    if (!presetInfoBanner) return;

    if (!preset) {
      presetInfoBanner.classList.add('hidden');
      return;
    }

    presetInfoBanner.classList.remove('hidden');

    if (presetBadgeStat) presetBadgeStat.textContent = `Stat: ${preset.stat || 'STR'}`;
    if (presetBadgeType) {
      if (preset.consumesSpellSlot) {
        presetBadgeType.textContent = `✨ Büyü Slotu (Min Lvl ${preset.baseSpellLevel || 1})`;
      } else {
        const typeNames = { slashing: '⚔️ Kesme', bludgeoning: '🔨 Ezme', piercing: '🏹 Delme', magic: '✨ Büyü' };
        const pType = typeNames[preset.physicalDamageType] || '⚔️ Fiziksel';
        presetBadgeType.textContent = pType;
      }
    }

    if (presetBadgeHalfMiss) {
      if (preset.halfDamageOnMiss) {
        presetBadgeHalfMiss.classList.remove('hidden');
        presetBadgeHalfMiss.textContent = '🛡️ Iska: ½ Hasar';
      } else {
        presetBadgeHalfMiss.classList.add('hidden');
      }
    }

    if (presetBadgeStatus) {
      if (preset.statusEffectsToApply && preset.statusEffectsToApply.length > 0) {
        presetBadgeStatus.classList.remove('hidden');
        const eff = preset.statusEffectsToApply[0];
        presetBadgeStatus.textContent = `${eff.icon || '✨'} ${eff.name || 'Durum'}`;
      } else {
        presetBadgeStatus.classList.add('hidden');
      }
    }

    if (presetBadgeAoe) {
      if (preset.isAoe) {
        presetBadgeAoe.classList.remove('hidden');
        presetBadgeAoe.textContent = `💥 Alan: ${preset.aoeRadius || 1}m`;
      } else {
        presetBadgeAoe.classList.add('hidden');
      }
    }

    if (presetDescText) {
      presetDescText.textContent = preset.description || '';
      presetDescText.style.display = preset.description ? 'block' : 'none';
    }
  }

  // ============================================================
  // SALDIRAN FORM STATE KAYDET / GERİ YÜKLE
  // ============================================================

  /**
   * Mevcut saldıranın tüm form değerlerini cache'e kaydeder.
   */
  function saveAttackerForm() {
    if (!selectedAttacker) return;
    const key = `${selectedAttacker.type}:${selectedAttacker.id}`;

    const formState = {
      // Modifikatörler
      modifier: modifierSelect?.value || 'STR',
      extraDamage: extraDmgInput?.value || '0',
      attackCount: attackCountInput?.value || '1',
      advantage: advantageCheck?.checked || false,
      disadvantage: disadvantageCheck?.checked || false,

      // Zar Havuzları
      phys: dicePools.phys.getState(),
      elem1: dicePools.elem1.getState(),
      elem2: dicePools.elem2.getState(),
      spell: dicePools.spell.getState(),

      // Büyü seviyesi
      spellLevel: (function () {
        for (let i = 1; i <= 4; i++) {
          const radio = document.getElementById(`atk-spell-lvl${i}`);
          if (radio?.checked) return i;
        }
        return 1;
      })()
    };

    attackerFormCache.set(key, formState);
  }

  /**
   * Verilen anahtar için kaydedilmiş form değerlerini geri yükler.
   */
  function restoreAttackerForm(key) {
    const state = attackerFormCache.get(key);

    if (state) {
      // Modifikatörler
      if (modifierSelect) modifierSelect.value = state.modifier || 'STR';
      if (extraDmgInput) extraDmgInput.value = state.extraDamage || '0';
      if (attackCountInput) attackCountInput.value = state.attackCount || '1';
      if (advantageCheck) advantageCheck.checked = !!state.advantage;
      if (disadvantageCheck) disadvantageCheck.checked = !!state.disadvantage;

      // Zar Havuzları
      dicePools.phys.setState(state.phys);
      dicePools.elem1.setState(state.elem1);
      dicePools.elem2.setState(state.elem2);
      dicePools.spell.setState(state.spell);

      // Büyü seviyesi
      for (let i = 1; i <= 4; i++) {
        const radio = document.getElementById(`atk-spell-lvl${i}`);
        if (radio) radio.checked = (i === (state.spellLevel || 1));
      }
    } else {
      // Kayıt yok — tüm alanları varsayılana sıfırla
      if (modifierSelect) modifierSelect.value = 'STR';
      if (extraDmgInput) extraDmgInput.value = '0';
      if (attackCountInput) attackCountInput.value = '1';
      if (advantageCheck) advantageCheck.checked = false;
      if (disadvantageCheck) disadvantageCheck.checked = false;

      dicePools.phys.clear();
      dicePools.elem1.clear();
      dicePools.elem2.clear();
      dicePools.spell.clear();

      const lvl1Radio = document.getElementById('atk-spell-lvl1');
      if (lvl1Radio) lvl1Radio.checked = true;
      for (let i = 2; i <= 4; i++) {
        const radio = document.getElementById(`atk-spell-lvl${i}`);
        if (radio) radio.checked = false;
      }
    }
  }

  // ============================================================
  // SALDIRAN SEÇİMİ — Statlarını, slotlarını ve presetini gösterir
  // ============================================================

  function onAttackerChange() {
    // Önceki saldıranın form değerlerini kaydet
    saveAttackerForm();

    selectedAttacker = resolveSelection(attackerSelect?.value);
    if (!selectedAttacker) {
      if (attackerInfo) attackerInfo.innerHTML = '<span class="atk-hint">Saldıran seçilmedi</span>';
      fillSpellSlots(null);
      unequipPreset(false);
      return;
    }

    const key = `${selectedAttacker.type}:${selectedAttacker.id}`;

    // Akıllı Kuşanma: Bu token'ın kayıtlı saldırı preseti var mı?
    const savedPresetId = lastEquippedAttackByToken.get(key);
    if (savedPresetId && attackPresetsCache.some(p => p.id === savedPresetId)) {
      equipPreset(savedPresetId, false);
    } else {
      // Yoksa serbest form değerlerini geri yükle
      restoreAttackerForm(key);
      unequipPreset(false);
    }

    const d = selectedAttacker.data;
    const stats = d.stats || {};

    if (selectedAttacker.type === 'character') {
      attackerInfo.innerHTML = `
        <div class="atk-target-card atk-card-attacker">
          <div class="atk-target-name">🗡️ ${escapeHtml(d.name)}</div>
          <div class="atk-target-hp">❤️ ${d.hp_current ?? '?'} / ${d.hp_max ?? '?'}</div>
          <div class="atk-target-stats">
            <span>STR:${stats.str ?? 0}+${stats.str_bonus ?? 0}</span>
            <span>DEX:${stats.dex ?? 0}+${stats.dex_bonus ?? 0}</span>
            <span>INT:${stats.int ?? 0}+${stats.int_bonus ?? 0}</span>
            <span>CON:${stats.con ?? 0}+${stats.con_bonus ?? 0}</span>
            <span>WIS:${stats.wis ?? 0}+${stats.wis_bonus ?? 0}</span>
            <span>CHR:${stats.chr ?? 0}+${stats.chr_bonus ?? 0}</span>
          </div>
        </div>
      `;
      fillSpellSlots(d.spell_slots);
    } else {
      // marker
      attackerInfo.innerHTML = `
        <div class="atk-target-card atk-card-attacker">
          <div class="atk-target-name">🗡️ [İşaret] ${escapeHtml(d.name)}</div>
          <div class="atk-target-hp">❤️ ${d.hp ?? '?'} / ${d.maxHp ?? '?'}</div>
          ${d.stats ? `<div class="atk-target-stats">
            <span>STR:${stats.str ?? 0}+${stats.str_bonus ?? 0}</span>
            <span>DEX:${stats.dex ?? 0}+${stats.dex_bonus ?? 0}</span>
            <span>INT:${stats.int ?? 0}+${stats.int_bonus ?? 0}</span>
            <span>CON:${stats.con ?? 0}+${stats.con_bonus ?? 0}</span>
            <span>WIS:${stats.wis ?? 0}+${stats.wis_bonus ?? 0}</span>
            <span>CHR:${stats.chr ?? 0}+${stats.chr_bonus ?? 0}</span>
          </div>` : ''}
        </div>
      `;
      fillSpellSlots(null);
    }
  }

  /**
   * Dışarıdan (örn. BG3 Combat Tracker'dan) saldıran seçmek için global API
   */
  window.__webdnd_selectAttacker = function (selectionKey) {
    if (!attackerSelect) return;
    if (!selectionKey) {
      attackerSelect.value = '';
      onAttackerChange();
      return;
    }

    // Seçenek henüz select listesinde yoksa güncelle
    let option = attackerSelect.querySelector(`option[value="${selectionKey}"]`);
    if (!option) {
      populateSelect(attackerSelect, '— Saldıran Seç —');
      option = attackerSelect.querySelector(`option[value="${selectionKey}"]`);
    }

    attackerSelect.value = selectionKey;
    onAttackerChange();
  };

  // ============================================================
  // HEDEF SEÇİMİ — Çoklu hedef desteği
  // ============================================================

  /**
   * Tüm seçili hedefleri ve haritadaki seçim halkalarını sıfırlar.
   */
  function clearAllTargets() {
    clearAllTargetHighlights();
    selectedTargets = [];
    lastAttackResults = [];
    if (targetSelect) targetSelect.value = '';
    renderSelectedTargets();
    if (typeof window.__webdnd_refreshStatusToolbox === 'function') {
      window.__webdnd_refreshStatusToolbox();
    }
  }

  /**
   * Combobox'tan hedef seçildiğinde: Eski hedefleri temizler, seçileni ekler.
   */
  function onTargetChange() {
    if (!targetSelect?.value) {
      clearAllTargets();
      return;
    }
    const resolved = resolveSelection(targetSelect?.value);
    if (!resolved) return;

    // Önceki hedeflerin token çerçevesini kaldır
    clearAllTargetHighlights();
    selectedTargets = [];

    // Yeni hedefi ekle
    addTargetToList(resolved, null);
  }

  /**
   * Hedefe karşılık gelen DOM token elemanını bulur.
   */
  function findTokenElForTarget(targetInfo) {
    if (!targetInfo) return null;
    const targetIdStr = String(targetInfo.id);

    if (typeof tokens !== 'undefined') {
      if (tokens[targetInfo.id]) return tokens[targetInfo.id];
      if (tokens[targetIdStr]) return tokens[targetIdStr];
      if (typeof allPlayers !== 'undefined') {
        const p = Object.values(allPlayers).find(p => {
          if (p.character && String(p.character.id) === targetIdStr) return true;
          if (String(p.id) === targetIdStr) return true;
          return false;
        });
        if (p && tokens[p.id]) return tokens[p.id];
      }
    }

    const byDataId = document.querySelector(`.token[data-id="${targetIdStr}"]`) ||
                     document.querySelector(`.token[data-character-id="${targetIdStr}"]`);
    if (byDataId) return byDataId;

    return null;
  }

  /**
   * Ctrl+Click ile haritadan hedef eklenir/kaldırılır (toggle).
   */
  function onCtrlClickTarget(targetInfo, tokenEl) {
    if (!targetInfo) return;
    const targetIdStr = String(targetInfo.id);

    // Zaten seçili mi kontrol et (tip ve string ID bazlı)
    const existingIdx = selectedTargets.findIndex(t => t.type === targetInfo.type && String(t.id) === targetIdStr);

    if (existingIdx >= 0) {
      // Kaldır (toggle off)
      const removed = selectedTargets.splice(existingIdx, 1)[0];
      const el = tokenEl || removed.tokenEl || findTokenElForTarget(removed);
      if (el) el.classList.remove('token-target-selected');
      const freshEl = findTokenElForTarget(removed);
      if (freshEl) freshEl.classList.remove('token-target-selected');
    } else {
      // Ekle
      addTargetToList(targetInfo, tokenEl);
    }

    renderSelectedTargets();
    // Combobox'u temizle (çoklu seçim Ctrl+Click üzerinden yönetiliyor)
    if (targetSelect) targetSelect.value = '';
    if (typeof window.__webdnd_refreshStatusToolbox === 'function') {
      window.__webdnd_refreshStatusToolbox();
    }
  }

  /**
   * Hedef listesine yeni bir hedef ekler.
   */
  function addTargetToList(targetInfo, tokenEl) {
    if (!targetInfo) return;
    const targetIdStr = String(targetInfo.id);

    // Duplicate kontrolü
    const exists = selectedTargets.some(t => t.type === targetInfo.type && String(t.id) === targetIdStr);
    if (exists) return;

    const resolvedTokenEl = tokenEl || findTokenElForTarget(targetInfo);

    selectedTargets.push({
      type: targetInfo.type,
      id: targetInfo.id,
      name: targetInfo.name,
      data: targetInfo.data,
      tokenEl: resolvedTokenEl || null
    });

    // Token'a hedef çerçevesi ekle
    if (resolvedTokenEl) resolvedTokenEl.classList.add('token-target-selected');

    renderSelectedTargets();
    if (typeof window.__webdnd_refreshStatusToolbox === 'function') {
      window.__webdnd_refreshStatusToolbox();
    }
  }

  /**
   * Hedef listesinden belirli bir hedefi kaldırır.
   */
  function removeTargetById(type, id) {
    if (id == null) return;
    const idStr = String(id);
    const idx = selectedTargets.findIndex(t => t.type === type && String(t.id) === idStr);
    if (idx >= 0) {
      const removed = selectedTargets.splice(idx, 1)[0];
      const el = removed.tokenEl || findTokenElForTarget(removed);
      if (el) el.classList.remove('token-target-selected');
      const freshEl = findTokenElForTarget(removed);
      if (freshEl) freshEl.classList.remove('token-target-selected');
      renderSelectedTargets();
      if (typeof window.__webdnd_refreshStatusToolbox === 'function') {
        window.__webdnd_refreshStatusToolbox();
      }
    }
  }

  /**
   * Tüm hedeflerin token çerçevesini kaldırır.
   */
  function clearAllTargetHighlights() {
    selectedTargets.forEach(t => {
      const el = t.tokenEl || findTokenElForTarget(t);
      if (el) el.classList.remove('token-target-selected');
    });
    document.querySelectorAll('.token.token-target-selected, .token-target-selected').forEach(el => {
      el.classList.remove('token-target-selected');
    });
  }

  /**
   * Belirli bir hedefin seçili olup olmadığını kontrol eder.
   */
  function isTargetSelected(type, id) {
    if (id == null) return false;
    const idStr = String(id);
    return selectedTargets.some(t => t.type === type && String(t.id) === idStr);
  }

  /**
   * Bir hedefin AC değerini döndürür.
   */
  function getTargetAC(target) {
    const d = target.data;
    if (target.type === 'character') {
      return (d.ac || 10) + (d.ac_bonus || 0);
    } else {
      return (d.ac || 10) + (d.ac_bonus || 0);
    }
  }

  /**
   * Seçili hedefler listesini DOM'a render eder.
   */
  function renderSelectedTargets() {
    if (!selectedTargetsList) return;
    selectedTargetsList.innerHTML = '';

    if (selectedTargets.length === 0) {
      if (targetInfo) targetInfo.innerHTML = '<span class="atk-hint">Hedef seçilmedi</span>';
      // AC inputu sıfırla
      if (targetACInput) targetACInput.value = 10;
      return;
    }

    // Tekil hedefte AC inputunu doldur
    if (selectedTargets.length === 1) {
      const ac = getTargetAC(selectedTargets[0]);
      if (targetACInput) targetACInput.value = ac;
    }

    // Bilgi alanını güncelle
    if (targetInfo) {
      if (selectedTargets.length === 1) {
        const t = selectedTargets[0];
        const d = t.data;
        const ac = getTargetAC(t);
        const isMarker = t.type === 'marker';
        const hp = isMarker ? (d.hp ?? '?') : (d.hp_current ?? '?');
        const maxHp = isMarker ? (d.maxHp ?? '?') : (d.hp_max ?? '?');
        targetInfo.innerHTML = `
          <div class="atk-target-card atk-card-target">
            <div class="atk-target-name">${isMarker ? '[İşaret] ' : ''}${escapeHtml(d.name)}</div>
            <div class="atk-target-hp">HP: ${hp} / ${maxHp}</div>
            <div class="atk-target-ac">AC: ${ac}</div>
          </div>
        `;
      } else {
        targetInfo.innerHTML = `<span class="atk-hint">${selectedTargets.length} hedef seçili — her hedefe ayrı saldırı atılacak</span>`;
      }
    }

    // Target Item Kartlarını oluştur
    selectedTargets.forEach(t => {
      const d = t.data;
      const ac = getTargetAC(t);
      const isMarker = t.type === 'marker';
      const hp = isMarker ? (d.hp ?? '?') : (d.hp_current ?? '?');
      const maxHp = isMarker ? (d.maxHp ?? '?') : (d.hp_max ?? '?');

      const card = document.createElement('div');
      card.className = 'atk-target-item-card';
      card.innerHTML = `
        <div class="atk-target-item-left">
          <span class="atk-target-item-name">${isMarker ? '[M] ' : ''}${escapeHtml(d.name)}</span>
          <div class="atk-target-item-badges">
            <span class="atk-target-badge-hp">HP: ${hp}/${maxHp}</span>
            <span class="atk-target-badge-ac">AC: ${ac}</span>
          </div>
        </div>
        <button type="button" class="atk-target-item-remove" title="Hedefi kaldır">✕</button>
      `;

      card.querySelector('.atk-target-item-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        removeTargetById(t.type, t.id);
      });

      selectedTargetsList.appendChild(card);
    });

    updateTargetResistanceBadges();
  }

  // Ctrl+Click callback'ini kaydet
  window.__webdnd_ctrlClickTarget = onCtrlClickTarget;

  // ============================================================
  // HASAR TÜRLERİ & HEDEF DİRENÇ/ZAYIFLIK KONTROLLERİ
  // ============================================================

  function normalizeDamageType(type) {
    if (!type) return 'slashing';
    const t = String(type).toLowerCase().trim();
    if (t === 'ezme' || t === 'bludgeoning') return 'bludgeoning';
    if (t === 'delme' || t === 'piercing') return 'piercing';
    if (t === 'kesme' || t === 'slashing') return 'slashing';
    if (t === 'büyü' || t === 'buyu' || t === 'magic' || t === 'spell') return 'magic';
    return t;
  }

  function getDamageTypeTurkish(type) {
    const norm = normalizeDamageType(type);
    if (norm === 'bludgeoning') return 'Ezme';
    if (norm === 'piercing') return 'Delme';
    if (norm === 'slashing') return 'Kesme';
    if (norm === 'magic') return 'Büyü';
    return type || 'Fiziksel';
  }

  function hasDamageResistance(effects, damageType) {
    if (!Array.isArray(effects) || !damageType) return false;
    const dt = normalizeDamageType(damageType);
    return effects.some(e => {
      if (!e) return false;
      const eff = e.effects || {};
      if (eff[`res_${dt}`] || eff[`resistance_${dt}`]) return true;
      if (typeof eff.resistance === 'string' && normalizeDamageType(eff.resistance) === dt) return true;
      if (Array.isArray(eff.resistance) && eff.resistance.some(r => normalizeDamageType(r) === dt)) return true;
      if (typeof eff.resistance === 'object' && eff.resistance && eff.resistance[dt]) return true;
      const name = (e.name || '').toLowerCase();
      if (dt === 'bludgeoning' && (/ezme.*diren/i.test(name) || /bludgeon.*resist/i.test(name))) return true;
      if (dt === 'slashing' && (/kesme.*diren/i.test(name) || /slash.*resist/i.test(name))) return true;
      if (dt === 'piercing' && (/delme.*diren/i.test(name) || /pierc.*resist/i.test(name))) return true;
      if (dt === 'magic' && (/b[üy]y[üu].*diren/i.test(name) || /magic.*resist/i.test(name))) return true;
      return false;
    });
  }

  function hasDamageVulnerability(effects, damageType) {
    if (!Array.isArray(effects) || !damageType) return false;
    const dt = normalizeDamageType(damageType);
    return effects.some(e => {
      if (!e) return false;
      const eff = e.effects || {};
      if (eff[`vuln_${dt}`] || eff[`vulnerability_${dt}`]) return true;
      if (typeof eff.vulnerability === 'string' && normalizeDamageType(eff.vulnerability) === dt) return true;
      if (Array.isArray(eff.vulnerability) && eff.vulnerability.some(r => normalizeDamageType(r) === dt)) return true;
      if (typeof eff.vulnerability === 'object' && eff.vulnerability && eff.vulnerability[dt]) return true;
      const name = (e.name || '').toLowerCase();
      if (dt === 'bludgeoning' && (/ezme.*zay/i.test(name) || /bludgeon.*vuln/i.test(name))) return true;
      if (dt === 'slashing' && (/kesme.*zay/i.test(name) || /slash.*vuln/i.test(name))) return true;
      if (dt === 'piercing' && (/delme.*zay/i.test(name) || /pierc.*vuln/i.test(name))) return true;
      if (dt === 'magic' && (/b[üy]y[üu].*zay/i.test(name) || /magic.*vuln/i.test(name))) return true;
      return false;
    });
  }

  function getTargetEffects(target) {
    if (!target) return [];
    if (target.type === 'marker') {
      return (window.__webdnd_markers && window.__webdnd_markers[target.id]?.activeEffects) || target.data?.activeEffects || [];
    } else {
      const p = (typeof allPlayers !== 'undefined' && allPlayers[target.id]) || null;
      return (p && (p.activeEffects || p.character?.activeEffects)) || target.data?.activeEffects || [];
    }
  }

  function updateTargetResistanceBadges() {
    const physBadgeEl = document.getElementById('atk-phys-target-status');
    const spellBadgeEl = document.getElementById('atk-spell-target-status');
    if (!physBadgeEl && !spellBadgeEl) return;

    if (selectedTargets.length === 0) {
      if (physBadgeEl) physBadgeEl.innerHTML = '';
      if (spellBadgeEl) spellBadgeEl.innerHTML = '';
      return;
    }

    if (selectedTargets.length > 1) {
      const multiHtml = `<span class="atk-target-res-chip is-multi">👥 ${selectedTargets.length} Hedef</span>`;
      if (physBadgeEl) physBadgeEl.innerHTML = multiHtml;
      if (spellBadgeEl) spellBadgeEl.innerHTML = multiHtml;
      return;
    }

    const target = selectedTargets[0];
    const effects = getTargetEffects(target);
    const physType = document.getElementById('atk-phys-damage-type')?.value || 'slashing';
    const typeLabel = getDamageTypeTurkish(physType);

    // Fiziksel Hasar Direnç / Zayıflık Kontrolü
    const hasPhysRes = hasDamageResistance(effects, physType);
    const hasPhysVuln = hasDamageVulnerability(effects, physType);

    if (physBadgeEl) {
      if (hasPhysRes && !hasPhysVuln) {
        physBadgeEl.innerHTML = `<span class="atk-target-res-chip is-resist" title="${typeLabel} Direnci: Alınan hasar yarıya (0.5x) düşer">🛡️ ${typeLabel} Direnci (0.5x)</span>`;
      } else if (hasPhysVuln && !hasPhysRes) {
        physBadgeEl.innerHTML = `<span class="atk-target-res-chip is-vuln" title="${typeLabel} Zayıflığı: Alınan hasar iki katına (2x) çıkar">💥 ${typeLabel} Zayıflığı (2x)</span>`;
      } else if (hasPhysRes && hasPhysVuln) {
        physBadgeEl.innerHTML = `<span class="atk-target-res-chip is-neutral" title="Direnç ve Zayıflık birbirini nötrler">⚖️ Nötr (1x)</span>`;
      } else {
        physBadgeEl.innerHTML = `<span class="atk-target-res-chip is-normal" title="Normal hasar">Normal (1x)</span>`;
      }
    }

    // Büyü Hasarı Direnç / Zayıflık Kontrolü
    const hasMagicRes = hasDamageResistance(effects, 'magic');
    const hasMagicVuln = hasDamageVulnerability(effects, 'magic');

    if (spellBadgeEl) {
      if (hasMagicRes && !hasMagicVuln) {
        spellBadgeEl.innerHTML = `<span class="atk-target-res-chip is-resist" title="Büyü Direnci: Alınan büyü hasarı yarıya (0.5x) düşer">🛡️ Büyü Direnci (0.5x)</span>`;
      } else if (hasMagicVuln && !hasMagicRes) {
        spellBadgeEl.innerHTML = `<span class="atk-target-res-chip is-vuln" title="Büyü Zayıflığı: Alınan büyü hasarı iki katına (2x) çıkar">💥 Büyü Zayıflığı (2x)</span>`;
      } else if (hasMagicRes && hasMagicVuln) {
        spellBadgeEl.innerHTML = `<span class="atk-target-res-chip is-neutral" title="Direnç ve Zayıflık birbirini nötrler">⚖️ Nötr (1x)</span>`;
      } else {
        spellBadgeEl.innerHTML = `<span class="atk-target-res-chip is-normal" title="Normal büyü hasarı">Normal (1x)</span>`;
      }
    }
  }

  // ============================================================
  // YARDIMCILAR
  // ============================================================

  function fillSpellSlots(slots) {
    if (!slots) slots = { lvl1: 0, lvl2: 0, lvl3: 0, lvl4: 0 };
    for (let i = 1; i <= 4; i++) {
      const cnt = slots[`lvl${i}`] ?? 0;
      if (slotDisplays[i]) slotDisplays[i].textContent = cnt;
      const slotCard = document.querySelector(`.atk-slot[data-slot-level="${i}"]`);
      if (slotCard) {
        if (cnt <= 0) slotCard.classList.add('is-out-of-slots');
        else slotCard.classList.remove('is-out-of-slots');
      }
    }
  }

  /**
   * SALDIRAN'ın seçilen modifier'a karşılık gelen stat + bonusunu döndürür
   */
  function getAttackerStats() {
    if (!selectedAttacker || !selectedAttacker.data) return { stat: 0, bonus: 0 };
    const mod = modifierSelect.value;
    const stats = selectedAttacker.data.stats || {};
    const keyMap = {
      'STR': { stat: 'str', bonus: 'str_bonus' },
      'DEX': { stat: 'dex', bonus: 'dex_bonus' },
      'INT': { stat: 'int', bonus: 'int_bonus' },
      'CON': { stat: 'con', bonus: 'con_bonus' },
      'WIS': { stat: 'wis', bonus: 'wis_bonus' },
      'CHR': { stat: 'chr', bonus: 'chr_bonus' },
    };
    const keys = keyMap[mod] || keyMap['STR'];
    return {
      stat: stats[keys.stat] ?? 0,
      bonus: stats[keys.bonus] ?? 0
    };
  }

  function addCombatLog(html, type = 'info') {
    if (!combatLog) return;
    const entry = document.createElement('div');
    entry.className = `atk-log-entry atk-log-${type}`;
    entry.innerHTML = html;
    combatLog.appendChild(entry);
    combatLog.scrollTop = combatLog.scrollHeight;
  }

  // ============================================================
  // SALDIRI İŞLEMLERİ (TEKİL SALDIR BUTONU)
  // ============================================================

  async function performAttack() {
    if (!selectedAttacker) { alert('Lütfen bir SALDIRAN seçin!'); return; }
    if (selectedTargets.length === 0) { alert('Lütfen en az bir HEDEF seçin!'); return; }

    const consumesSlot = Boolean(activeEquippedPreset?.consumesSpellSlot);
    let chosenSpellLevel = 1;

    if (consumesSlot) {
      // Aktif radyo butonundan seçilen seviyeyi al
      for (let i = 1; i <= 4; i++) {
        const radio = document.getElementById(`atk-active-spell-lvl${i}`);
        if (radio?.checked) { chosenSpellLevel = i; break; }
      }

      const minLevel = activeEquippedPreset.baseSpellLevel || 1;
      if (chosenSpellLevel < minLevel) {
        alert(`Bu saldırı en az Seviye ${minLevel} büyü slotu gerektirir!`);
        return;
      }

      const currentSlots = parseInt(slotDisplays[chosenSpellLevel]?.textContent || '0');
      if (currentSlots <= 0) {
        alert(`${escapeHtml(selectedAttacker.name)} — Seviye ${chosenSpellLevel} büyü slotu kalmadı! Lütfen başka bir seviye seçin veya dinlenin.`);
        return;
      }
    }

    const halfDamageOnMiss = Boolean(activeEquippedPreset?.halfDamageOnMiss);
    const statusEffectsToApply = activeEquippedPreset?.statusEffectsToApply || [];

    // Her hedef için ayrı saldırı
    lastAttackResults = [];
    pendingAoEExplosions = [];
    if (btnAttack) btnAttack.disabled = true;

    for (const target of selectedTargets) {
      const targetAC = selectedTargets.length === 1 ? intVal(targetACInput) : getTargetAC(target);

      const body = {
        attacker: { type: selectedAttacker.type, id: selectedAttacker.id },
        attackerStats: getAttackerStats(),
        target: { type: target.type, id: target.id },
        targetAC: targetAC,
        attackType: 'physical',
        advantage: advantageCheck?.checked || false,
        disadvantage: disadvantageCheck?.checked || false,
        attackCount: intVal(attackCountInput) || 1,
        extraDamage: intVal(extraDmgInput),
        halfDamageOnMiss: halfDamageOnMiss,
        statusEffectsToApply: statusEffectsToApply,
        physicalDamageType: document.getElementById('atk-phys-damage-type')?.value || 'slashing',
        physical: dicePools.phys.getState(),
        element1: dicePools.elem1.getState(),
        element2: dicePools.elem2.getState()
      };

      await sendAttackForTarget(body, target, consumesSlot ? chosenSpellLevel : null);
    }

    // Çoklu sonuçlar varsa toplam hasar uygulama butonu
    showMultiApplyButton();

    if (btnAttack) btnAttack.disabled = false;

    // Slotu düşür (saldırandan)
    if (consumesSlot) {
      const currentSlots = parseInt(slotDisplays[chosenSpellLevel]?.textContent || '0');
      const newSlotCount = Math.max(0, currentSlots - 1);
      if (slotDisplays[chosenSpellLevel]) {
        slotDisplays[chosenSpellLevel].textContent = newSlotCount;
        const slotCard = document.querySelector(`.atk-slot[data-slot-level="${chosenSpellLevel}"]`);
        if (slotCard) {
          if (newSlotCount <= 0) slotCard.classList.add('is-out-of-slots');
          else slotCard.classList.remove('is-out-of-slots');
        }
      }

      // DB güncelle (saldıran karakter ise)
      if (selectedAttacker.type === 'character' && selectedAttacker.id) {
        const updatedSlots = {};
        for (let i = 1; i <= 4; i++) {
          updatedSlots[`lvl${i}`] = parseInt(slotDisplays[i]?.textContent || '0');
        }
        try {
          await fetch(`/api/characters/${selectedAttacker.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ spell_slots: updatedSlots })
          });
        } catch (e) {
          console.error('Slot güncelleme hatası:', e);
        }
      } else if (selectedAttacker.type === 'marker' && selectedAttacker.id) {
        // Marker slot güncelle
        const updatedSlots = {};
        for (let i = 1; i <= 4; i++) {
          updatedSlots[`lvl${i}`] = parseInt(slotDisplays[i]?.textContent || '0');
        }
        if (typeof socket !== 'undefined') {
          socket.emit('editMarker', { id: selectedAttacker.id, spell_slots: updatedSlots });
        }
      }

      selectActiveSpellLevel(chosenSpellLevel);
    }
  }

  /**
   * Tek bir hedefe saldırı isteği gönderir ve sonucu loglar.
   */
  async function sendAttackForTarget(body, target, usedSpellLevel = null) {
    try {
      const res = await fetch('/api/combat/attack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Bilinmeyen hata');

      // Durum efektleri bildirim etiketleri
      const notes = [];
      if (result.statusNotes?.attackerBlind) notes.push('👁️ Körlük (Dezavantaj)');
      if (result.statusNotes?.targetPrepared) notes.push('🎯 Hedef Hazır (Dezavantaj)');
      if (result.statusNotes?.targetParalyzed) notes.push('⚡ Hedef Felçli (Kesin Kritik 2x)');
      if (result.statusNotes?.halfDamageOnMiss) notes.push('🛡️ Iska: ½ Hasar');
      if (result.statusNotes?.targetResistant) notes.push(`🛡️ ${result.statusNotes.damageType} Direnci (0.5x)`);
      if (result.statusNotes?.targetVulnerable) notes.push(`💥 ${result.statusNotes.damageType} Zayıflığı (2x)`);
      const notesLabel = notes.length > 0 ? ` [${notes.join(', ')}]` : '';

      // Log başlığı: Saldıran → Hedef
      const atkLabel = usedSpellLevel ? `✨ BÜYÜ (Lvl ${usedSpellLevel})` : '⚔️ SALDIRI';
      const attackerName = escapeHtml(selectedAttacker?.name || '?');
      const targetName = escapeHtml(target.name || '?');
      addCombatLog(
        `<span class="atk-log-header">--- ${atkLabel}: ${attackerName} → ${targetName} (${body.attackCount} Vuruş, AC:${body.targetAC})${notesLabel} ---</span>`,
        'header'
      );

      result.attacks.forEach(atk => {
        if (atk.hit) {
          const critTag = atk.isCritical ? ' <span class="atk-crit">KRİTİK!</span>' : '';
          const typeLabel = usedSpellLevel ? `Büyü (Lvl ${usedSpellLevel})` : 'Saldırı';
          const breakdownHtml = atk.breakdown ? `<div class="atk-result-breakdown" style="margin-top:2px;">🎲 ${escapeHtml(atk.breakdown)}</div>` : '';
          let statusAppliedTag = '';
          if (result.statusEffectsToApply && result.statusEffectsToApply.length > 0) {
            statusAppliedTag = ` <span class="atk-log-status" style="color:#f1c40f; font-weight:bold;">[✨ ${result.statusEffectsToApply.map(e => e.name).join(', ')} uygulandı]</span>`;
          }
          addCombatLog(
            `<span class="atk-log-hit">${atk.index}. ${typeLabel}: <strong>${atk.damage}</strong> Hasar${critTag}${statusAppliedTag}</span> <span class="atk-log-roll">(Zar: ${atk.hitRoll} | Toplam: ${atk.modifiedRoll})</span>${breakdownHtml}`,
            atk.isCritical ? 'crit' : 'hit'
          );
        } else if (atk.halfDamageMiss) {
          const breakdownHtml = atk.breakdown ? `<div class="atk-result-breakdown" style="margin-top:2px;">🎲 ${escapeHtml(atk.breakdown)}</div>` : '';
          addCombatLog(
            `<span class="atk-log-miss" style="color:#e67e22;">🛡️ ${atk.index}. ISKA (Yarım Hasar): <strong>${atk.damage}</strong> Hasar</span> <span class="atk-log-roll">(Zar: ${atk.hitRoll} | Toplam: ${atk.modifiedRoll})</span>${breakdownHtml}`,
            'miss'
          );
        } else {
          const failTag = atk.isCritFail ? ' <span class="atk-critfail">KRİTİK BAŞARISIZLIK!</span>' : '';
          addCombatLog(
            `<span class="atk-log-miss">${atk.index}. Saldırı: ISKA${failTag}</span> <span class="atk-log-roll">(Zar: ${atk.hitRoll} | Toplam: ${atk.modifiedRoll})</span>`,
            atk.isCritFail ? 'critfail' : 'miss'
          );
        }
      });

      addCombatLog(`<span class="atk-log-total">=== ${escapeHtml(target.name)}: TOPLAM HASAR: ${result.totalDamage} ===</span>`, 'total');

      // Sonucu sakla (çoklu hasar uygulama için)
      const hasCritical = result.attacks ? result.attacks.some(a => a.isCritical) : false;
      const isSuccessfulHit = result.attacks ? result.attacks.some(a => a.hit) : false;
      const isEffective = result.totalDamage > 0 || (result.statusEffectsToApply && result.statusEffectsToApply.length > 0);

      if (isEffective) {
        lastAttackResults.push({
          totalDamage: result.totalDamage,
          targetId: target.id,
          targetType: target.type,
          targetName: target.name,
          attackerName: selectedAttacker?.name,
          statusEffectsToApply: result.statusEffectsToApply || [],
          isCritical: hasCritical,
          attackType: body.attackType || 'physical',
          physicalDamageType: body.physicalDamageType || 'slashing'
        });

        // Alan Hasarı (AoE) kontrolü ve çevre hedeflere yayılım
        if (activeEquippedPreset && activeEquippedPreset.isAoe && (isSuccessfulHit || (body.halfDamageOnMiss && result.totalDamage > 0))) {
          triggerAoEForTarget(target, result.totalDamage, body);
        }
      }

    } catch (err) {
      console.error('Saldırı hatası:', err);
      addCombatLog(`<span class="atk-log-error">HATA (${escapeHtml(target.name)}): ${escapeHtml(err.message)}</span>`, 'error');
    }
  }

  /**
   * Alan hasarlı bir saldırı başarılı olduğunda çevre tokenları tespit eder,
   * patlama görseli ve sesini tetikler, hasar listesine ekler.
   */
  function triggerAoEForTarget(target, damage, body) {
    if (!activeEquippedPreset || !activeEquippedPreset.isAoe || damage <= 0) return;

    const tokenEl = findTokenElement(target.type, target.id);
    if (!tokenEl) {
      addCombatLog(
        `<span class="atk-log-aoe" style="color:#f59e0b; font-size:11px;">⚠️ "${escapeHtml(target.name)}" tokenı haritada tespit edilemediği için alan hasarı uygulanamadı.</span>`,
        'error'
      );
      return;
    }

    const tLeft = parseFloat(tokenEl.style.left) || tokenEl.offsetLeft || 0;
    const tTop = parseFloat(tokenEl.style.top) || tokenEl.offsetTop || 0;
    const tSize = tokenEl.offsetWidth || 50;
    const cx = Math.round(tLeft + tSize / 2);
    const cy = Math.round(tTop + tSize / 2);

    const aoeRadiusMeters = Math.max(0.5, parseFloat(activeEquippedPreset.aoeRadius) || 1);
    const aoeRadiusPx = Math.round(aoeRadiusMeters * 50); // 1m = 50px

    // Çevredeki tokenları tespit et
    let nearbyTokens = [];
    if (typeof window.__webdnd_detectTokensInAoe === 'function') {
      nearbyTokens = window.__webdnd_detectTokensInAoe(cx, cy, aoeRadiusPx, false);
    } else {
      const allMapTokens = document.querySelectorAll('#map-content .token');
      allMapTokens.forEach(el => {
        const tid = el.dataset.id;
        if (!tid) return;
        const l = parseFloat(el.style.left) || el.offsetLeft || 0;
        const t = parseFloat(el.style.top) || el.offsetTop || 0;
        const sz = el.offsetWidth || 50;
        const ex = l + sz / 2;
        const ey = t + sz / 2;
        const dist = Math.hypot(ex - cx, ey - cy);
        if (dist <= aoeRadiusPx + (sz / 2) * 0.7) {
          if (window.__webdnd_markers && window.__webdnd_markers[tid]) {
            const m = window.__webdnd_markers[tid];
            nearbyTokens.push({ type: 'marker', id: m.id, name: m.name || 'İşaret' });
          } else if (typeof allPlayers !== 'undefined' && allPlayers[tid]?.character) {
            const p = allPlayers[tid];
            nearbyTokens.push({ type: 'character', id: p.character.id, name: p.character.name || 'Oyuncu' });
          }
        }
      });
    }

    // Ana hedefi, saldıranı ve zaten listelenmiş hedefleri filtrele
    const splashTargets = nearbyTokens.filter(t => {
      if (!t || !t.id) return false;
      // 1. Ana hedefin kendisi hariç
      if (String(t.id) === String(target.id) && t.type === target.type) return false;
      // 2. Saldıranın kendisi hariç (kendi kendini vurmasın)
      if (selectedAttacker && String(t.id) === String(selectedAttacker.id) && t.type === selectedAttacker.type) return false;
      // 3. Bu turda zaten hasar listesinde olanlar hariç
      if (lastAttackResults.some(r => String(r.targetId) === String(t.id) && r.targetType === t.type)) return false;
      return true;
    });

    // Çevre hedefleri hasar kuyruğuna ekle
    splashTargets.forEach(st => {
      lastAttackResults.push({
        totalDamage: damage,
        targetId: st.id,
        targetType: st.type,
        targetName: st.name,
        attackerName: selectedAttacker?.name,
        statusEffectsToApply: body.statusEffectsToApply || [],
        isCritical: false,
        attackType: body.attackType || 'spell',
        physicalDamageType: body.physicalDamageType || 'slashing',
        isAoESplash: true,
        splashCenterTargetName: target.name
      });
    });

    // Savaş günlüğüne alan hasarı dökümünü yazdır
    if (splashTargets.length > 0) {
      addCombatLog(
        `<span class="atk-log-aoe" style="color:#f87171; font-weight:bold;">💥 [ALAN HASARI (${aoeRadiusMeters}m)]: "${escapeHtml(activeEquippedPreset.name)}" patladı! ${escapeHtml(target.name)} çevresindeki ${splashTargets.length} hedef etkilendi:</span>`,
        'header'
      );
      splashTargets.forEach(st => {
        const effLabel = (body.statusEffectsToApply?.length) ? ` <span style="color:#f1c40f;">[✨ ${body.statusEffectsToApply.map(e => e.name).join(', ')}]</span>` : '';
        addCombatLog(
          `<span class="atk-log-hit" style="color:#fca5a5; padding-left:14px;">↳ 💥 <strong>${escapeHtml(st.name)}</strong>: ${damage} Hasar${effLabel}</span>`,
          'hit'
        );
      });
    } else {
      addCombatLog(
        `<span class="atk-log-aoe" style="color:#94a3b8; font-size:11px; padding-left:8px;">💥 [ALAN HASARI (${aoeRadiusMeters}m)]: ${escapeHtml(target.name)} çevresinde başka hedef bulunamadı.</span>`,
        'aoe'
      );
    }

    // Patlama ve görsel efektleri "Hasarı Uygula" anında oynatılmak üzere kaydet
    const allAffectedForVisual = [
      { type: target.type, id: target.id, damage: damage },
      ...splashTargets.map(st => ({ type: st.type, id: st.id, damage: damage }))
    ];

    pendingAoEExplosions.push({
      cx,
      cy,
      radiusPx: aoeRadiusPx,
      damage,
      affectedTargets: allAffectedForVisual
    });
  }

  /**
   * Çoklu hedef sonuçları için "Hasarı Uygula" butonunu gösterir.
   */
  function showMultiApplyButton() {
    if (lastAttackResults.length === 0) {
      if (btnApplyDamage) btnApplyDamage.classList.add('hidden');
      return;
    }

    if (btnApplyDamage) {
      btnApplyDamage.classList.remove('hidden');
      const splashCount = lastAttackResults.filter(r => r.isAoESplash).length;
      if (lastAttackResults.length === 1) {
        const r = lastAttackResults[0];
        btnApplyDamage.textContent = `💀 ${r.totalDamage} Hasar Uygula → ${escapeHtml(r.targetName)}`;
      } else {
        const totalAll = lastAttackResults.reduce((sum, r) => sum + r.totalDamage, 0);
        const splashNote = splashCount > 0 ? ` (${splashCount} alan)` : '';
        btnApplyDamage.textContent = `💀 Tüm Hasarları Uygula (${lastAttackResults.length} hedef${splashNote}, toplam ${totalAll})`;
      }
    }
  }

  /**
   * Son hesaplanan hasarları ve bağlı durum efektlerini tüm hedeflere uygular.
   */
  async function applyDamage() {
    if (lastAttackResults.length === 0) {
      alert('Uygulanacak hasar yok!');
      return;
    }

    try {
      btnApplyDamage.disabled = true;
      btnApplyDamage.textContent = 'Uygulanıyor...';

      if (btnApplyDamage) {
        btnApplyDamage.classList.add('btn-apply-damage-hit');
        setTimeout(() => btnApplyDamage.classList.remove('btn-apply-damage-hit'), 350);
      }

      // 1. Bekleyen AoE patlama ve sarsıntı efektlerini "Hasarı Uygula" anında tetikle
      if (pendingAoEExplosions.length > 0) {
        pendingAoEExplosions.forEach(exp => {
          // A. Haritada patlama dalgası (aoe-explosion-burst)
          if (typeof window.__webdnd_showAoeVisualEffects === 'function') {
            window.__webdnd_showAoeVisualEffects(
              { x: exp.cx, y: exp.cy, radius: exp.radiusPx },
              exp.damage,
              exp.affectedTargets
            );
          }

          // B. Harita ekran sarsıntısı (Screenshake)
          const gameMapEl = document.getElementById('game-map');
          if (gameMapEl) {
            gameMapEl.classList.remove('map-screen-shake', 'map-screen-shake-crit');
            void gameMapEl.offsetWidth;
            gameMapEl.classList.add('map-screen-shake');
            setTimeout(() => gameMapEl.classList.remove('map-screen-shake'), 280);
          }

          // C. Tüm oyuncuların ekranlarına patlamayı yayınla
          if (typeof socket !== 'undefined') {
            socket.emit('triggerAoeExplosion', {
              aoeInfo: { x: exp.cx, y: exp.cy, radius: exp.radiusPx },
              damage: exp.damage,
              affectedTargets: exp.affectedTargets
            });
          }
        });

        // D. Tok patlama sesi sentezi (Web Audio API)
        playExplosionSound();

        pendingAoEExplosions = [];
      }

      for (const attackResult of lastAttackResults) {
        try {
          // Yerel olarak anında vuruş hissi oynat (sıfır gecikme)
          triggerHitImpact({
            targetType: attackResult.targetType,
            targetId: attackResult.targetId,
            damage: attackResult.totalDamage,
            isCritical: attackResult.isCritical,
            attackType: attackResult.attackType
          });

          const res = await fetch('/api/combat/apply-damage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              targetType: attackResult.targetType,
              targetId: attackResult.targetId,
              damage: attackResult.totalDamage,
              statusEffectsToApply: attackResult.statusEffectsToApply,
              isCritical: attackResult.isCritical,
              attackType: attackResult.attackType,
              damageType: attackResult.physicalDamageType
            })
          });

          const result = await res.json();
          if (!res.ok) throw new Error(result.error || 'Bilinmeyen hata');

          addCombatLog(
            `<span class="atk-log-apply">💀 ${attackResult.totalDamage} hasar uygulandı → ${escapeHtml(attackResult.targetName)}. Yeni HP: ${result.newHp}</span>`,
            'apply'
          );
        } catch (err) {
          addCombatLog(
            `<span class="atk-log-error">HATA (${escapeHtml(attackResult.targetName)}): ${escapeHtml(err.message)}</span>`,
            'error'
          );
        }
      }

      lastAttackResults = [];
      pendingAoEExplosions = [];
      btnApplyDamage.classList.add('hidden');

      // Seçicileri yenile
      await loadSelectors();
      if (selectedAttacker) { attackerSelect.value = `${selectedAttacker.type}:${selectedAttacker.id}`; onAttackerChange(); }
      // Hedef listesini güncelle
      renderSelectedTargets();
    } catch (err) {
      console.error('Hasar uygulama hatası:', err);
      addCombatLog(`<span class="atk-log-error">HATA: ${escapeHtml(err.message)}</span>`, 'error');
    } finally {
      btnApplyDamage.disabled = false;
    }
  }

  function clearResistances() {
    ['phys', 'elem1', 'elem2'].forEach(key => {
      const p = dicePools[key];
      if (p) {
        if (p.weakRadio) p.weakRadio.checked = false;
        if (p.resRadio) p.resRadio.checked = false;
      }
    });
  }

  // ============================================================
  // HAZIR SALDIRI PRESETLERİ MODAL CONTROLLER
  // ============================================================

  let builderActiveLvl = 1;
  let builderSlotScaling = { 1: null, 2: null, 3: null, 4: null };

  function readCurrentBuilderPools() {
    const readSteppers = (prefix) => {
      const dice = {};
      [4, 6, 8, 10, 12, 20].forEach(sides => {
        const val = parseInt(document.getElementById(`atk-bpool-${prefix}-d${sides}`)?.value) || 0;
        if (val > 0) dice[sides] = val;
      });
      const bonus = parseInt(document.getElementById(`atk-bpool-${prefix}-bonus`)?.value) || 0;
      return { dice, bonus, weakness: false, resistance: false };
    };

    return {
      phys: readSteppers('phys'),
      elem1: readSteppers('elem1'),
      elem2: readSteppers('elem2')
    };
  }

  function writeBuilderPools(pools) {
    const writeSteppers = (prefix, p) => {
      const d = (p && p.dice) || {};
      [4, 6, 8, 10, 12, 20].forEach(sides => {
        const el = document.getElementById(`atk-bpool-${prefix}-d${sides}`);
        if (el) el.value = d[sides] || d[`d${sides}`] || 0;
      });
      const bonusEl = document.getElementById(`atk-bpool-${prefix}-bonus`);
      if (bonusEl) bonusEl.value = (p && p.bonus) || 0;
    };

    writeSteppers('phys', pools ? (pools.phys || pools.physical) : null);
    writeSteppers('elem1', pools ? pools.elem1 : null);
    writeSteppers('elem2', pools ? pools.elem2 : null);
  }

  function updateBuilderLvlTabsUI(lvl) {
    document.querySelectorAll('.atk-lvl-tab-btn').forEach(btn => {
      const btnLvl = parseInt(btn.dataset.lvl);
      if (btnLvl === lvl) btn.classList.add('active');
      else btn.classList.remove('active');
    });

    const tagEl = document.getElementById('atk-builder-pools-lvl-tag');
    if (tagEl) {
      if (lvl === 1) tagEl.textContent = '[Seviye 1 - Taban]';
      else tagEl.textContent = `[Seviye ${lvl} Özel Zar]`;
    }

    const hintEl = document.getElementById('atk-lvl-tab-hint');
    const copyBtn = document.getElementById('btn-copy-base-to-lvl');
    const clearBtn = document.getElementById('btn-clear-curr-lvl');

    if (lvl === 1) {
      if (hintEl) hintEl.innerHTML = `📌 <strong>Seviye 1 (Taban Zar Havuzu)</strong>: Bu seviyedeki zarlar varsayılan hasar olarak kullanılır.`;
      if (copyBtn) copyBtn.style.display = 'none';
      if (clearBtn) clearBtn.style.display = 'none';
    } else {
      const hasCustom = builderSlotScaling[lvl] && hasAnyDice(builderSlotScaling[lvl]);
      if (hintEl) {
        if (hasCustom) {
          hintEl.innerHTML = `✨ <strong>Seviye ${lvl} Özel Etkisi</strong>: Bu seviyeye özel hasar zarları tanımlandı.`;
        } else {
          hintEl.innerHTML = `ℹ️ <strong>Seviye ${lvl} (Boş)</strong>: Özel zar tanımlanmadı, kullanılırsa <strong>Taban (Lvl 1)</strong> hasarı geçerli olur.`;
        }
      }
      if (copyBtn) copyBtn.style.display = 'inline-block';
      if (clearBtn) clearBtn.style.display = 'inline-block';
    }
  }

  function switchBuilderLevel(targetLvl, saveCurrent = true) {
    const lvl = Math.max(1, Math.min(4, parseInt(targetLvl) || 1));
    if (saveCurrent) {
      const current = readCurrentBuilderPools();
      if (builderActiveLvl === 1 || hasAnyDice(current)) {
        builderSlotScaling[builderActiveLvl] = current;
      } else {
        builderSlotScaling[builderActiveLvl] = null;
      }
    }

    builderActiveLvl = lvl;
    updateBuilderLvlTabsUI(lvl);

    const poolToLoad = builderSlotScaling[lvl];
    writeBuilderPools(poolToLoad || null);
  }

  function formatPoolSummary(pools) {
    if (!pools) return 'Havuz boş';
    const parts = [];
    const formatPool = (p, label) => {
      if (!p) return;
      const diceParts = [];
      const d = p.dice || {};
      [4, 6, 8, 10, 12, 20].forEach(sides => {
        const count = d[sides] || d[`d${sides}`] || 0;
        if (count > 0) diceParts.push(`${count}d${sides}`);
      });
      if (p.bonus) diceParts.push(p.bonus > 0 ? `+${p.bonus}` : `${p.bonus}`);
      if (diceParts.length > 0) parts.push(`${label}: ${diceParts.join('+')}`);
    };

    formatPool(pools.phys || pools.physical, 'Ana');
    formatPool(pools.elem1, 'Ateş');
    formatPool(pools.elem2, 'Buz');

    return parts.join(' | ') || 'Havuz boş';
  }

  let catalogSearchTerm = '';

  function updateBuilderModeBanner(preset = null) {
    const banner = document.getElementById('atk-builder-mode-banner');
    const text = document.getElementById('atk-builder-mode-text');
    const resetBtn = document.getElementById('btn-builder-reset');
    const saveBtn = document.getElementById('btn-save-atk-preset');

    if (preset && preset.id) {
      if (banner) banner.className = 'atk-builder-mode-banner is-editing';
      if (text) text.innerHTML = `✏️ <strong>Preset Düzenleniyor:</strong> "${escapeHtml(preset.name)}"`;
      if (resetBtn) resetBtn.style.display = 'inline-block';
      if (saveBtn) saveBtn.textContent = '💾 Değişiklikleri Güncelle';
    } else {
      if (banner) banner.className = 'atk-builder-mode-banner';
      if (text) text.innerHTML = `✨ <strong>Yeni Saldırı Preseti Yarat</strong> <span style="font-size:11px; opacity:0.8;">(Sınırsız)</span>`;
      if (resetBtn) resetBtn.style.display = 'none';
      if (saveBtn) saveBtn.textContent = '💾 Preseti Kaydet';
    }
  }

  function resetPresetBuilder() {
    const idInput = document.getElementById('atk-builder-id');
    if (idInput) idInput.value = '';

    const nameInput = document.getElementById('atk-builder-name');
    if (nameInput) nameInput.value = '';

    const statSelect = document.getElementById('atk-builder-stat');
    if (statSelect) statSelect.value = 'STR';

    const physTypeSelect = document.getElementById('atk-builder-phys-type');
    if (physTypeSelect) physTypeSelect.value = 'slashing';

    const countInput = document.getElementById('atk-builder-count');
    if (countInput) countInput.value = '1';

    const consumesSlotCheck = document.getElementById('atk-builder-consumes-slot');
    if (consumesSlotCheck) consumesSlotCheck.checked = false;

    const spellSlotSection = document.getElementById('atk-builder-spell-slot-section');
    if (spellSlotSection) spellSlotSection.style.display = 'none';

    const baseSpellLvlSelect = document.getElementById('atk-builder-base-spell-level');
    if (baseSpellLvlSelect) baseSpellLvlSelect.value = '1';

    const halfMissCheck = document.getElementById('atk-builder-half-miss');
    if (halfMissCheck) halfMissCheck.checked = false;

    const aoeCheck = document.getElementById('atk-builder-is-aoe');
    if (aoeCheck) aoeCheck.checked = false;

    const aoeRadiusInput = document.getElementById('atk-builder-aoe-radius');
    if (aoeRadiusInput) aoeRadiusInput.value = '1';

    const aoeRadiusGroup = document.getElementById('atk-builder-aoe-radius-group');
    if (aoeRadiusGroup) aoeRadiusGroup.style.display = 'none';

    const descInput = document.getElementById('atk-builder-desc');
    if (descInput) descInput.value = '';

    builderSlotScaling = { 1: null, 2: null, 3: null, 4: null };
    builderActiveLvl = 1;
    writeBuilderPools(null);
    updateBuilderLvlTabsUI(1);

    populateStatusEffectsSelect();
    const statusSelect = document.getElementById('atk-builder-status-effect');
    if (statusSelect) statusSelect.value = '';

    updateBuilderModeBanner(null);
  }

  function openNewPresetBuilder() {
    resetPresetBuilder();
    const builderTabBtn = document.querySelector('.atk-tab-btn[data-tab="builder"]');
    if (builderTabBtn) builderTabBtn.click();
  }

  function renderAttackPresetsCatalog() {
    const grid = document.getElementById('atk-presets-grid');
    if (!grid) return;

    grid.innerHTML = '';

    const countBadge = document.getElementById('atk-catalog-count-badge');
    if (countBadge) {
      countBadge.textContent = `${attackPresetsCache.length} Preset`;
    }

    const term = (catalogSearchTerm || '').toLowerCase().trim();
    const filtered = attackPresetsCache.filter(preset => {
      if (!term) return true;
      const matchName = (preset.name || '').toLowerCase().includes(term);
      const matchStat = (preset.stat || '').toLowerCase().includes(term);
      const matchType = (preset.attackType || '').toLowerCase().includes(term);
      const matchDesc = (preset.description || '').toLowerCase().includes(term);
      return matchName || matchStat || matchType || matchDesc;
    });

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 28px 10px; color: #888;">
          <p style="margin: 0 0 10px 0; font-size: 13px;">${term ? `"${escapeHtml(term)}" ile eşleşen saldırı preseti bulunamadı.` : 'Henüz kayıtlı saldırı preseti yok.'}</p>
          <button type="button" class="btn primary action-btn" id="btn-empty-create-preset">+ Yeni Preset Yarat</button>
        </div>
      `;
      const emptyBtn = grid.querySelector('#btn-empty-create-preset');
      if (emptyBtn) emptyBtn.addEventListener('click', openNewPresetBuilder);
      return;
    }

    filtered.forEach(preset => {
      const card = document.createElement('div');
      card.className = 'atk-preset-card';
      if (activeEquippedPreset && activeEquippedPreset.id === preset.id) {
        card.classList.add('equipped-active');
      }

      const typeLabel = preset.consumesSpellSlot
        ? `✨ Büyü (Min Lvl ${preset.baseSpellLevel || 1})`
        : (preset.attackType === 'spell' ? '✨ Büyü' : '⚔️ Fiziksel');
      const halfBadge = preset.halfDamageOnMiss ? `<span class="atk-preset-chip" style="background:rgba(230,126,34,0.2); border-color:#e67e22;">🛡️ Iska: ½ Hasar</span>` : '';
      const aoeBadge = preset.isAoe ? `<span class="atk-preset-chip" style="background:rgba(239,68,68,0.25); border-color:#ef4444; color:#fca5a5;">💥 Alan: ${preset.aoeRadius || 1}m</span>` : '';
      const statusBadge = preset.statusEffectsToApply?.length
        ? `<span class="atk-preset-chip" style="background:rgba(241,196,15,0.2); border-color:#f1c40f;">${preset.statusEffectsToApply[0].icon || '✨'} ${preset.statusEffectsToApply[0].name}</span>`
        : '';

      let scalingBadge = '';
      if (preset.consumesSpellSlot && preset.slotScaling) {
        const scaledLvls = Object.keys(preset.slotScaling).filter(l => parseInt(l) > 1 && preset.slotScaling[l] && hasAnyDice(preset.slotScaling[l].dicePools || preset.slotScaling[l]));
        if (scaledLvls.length > 0) {
          scalingBadge = `<span class="atk-preset-chip" style="background:rgba(56,189,248,0.2); border-color:#38bdf8; color:#7dd3fc;">⚡ Lvl ${scaledLvls.join(', ')} Özel</span>`;
        }
      }

      card.innerHTML = `
        <div>
          <div class="atk-preset-card-header">
            <span class="atk-preset-card-title">${escapeHtml(preset.name)}</span>
            <span class="atk-preset-chip">${preset.stat}</span>
          </div>
          <div class="atk-preset-badge-row" style="margin: 4px 0;">
            <span class="atk-preset-chip">${typeLabel}</span>
            ${scalingBadge}
            ${halfBadge}
            ${aoeBadge}
            ${statusBadge}
          </div>
          <div class="atk-preset-card-pools">${formatPoolSummary(preset.dicePools)}</div>
          ${preset.description ? `<div class="atk-preset-card-desc" style="margin-top:4px;">${escapeHtml(preset.description)}</div>` : ''}
        </div>
        <div class="atk-preset-card-actions">
          <button type="button" class="btn-equip-preset" title="Bu Saldırıyı Kuşan">⚡ Kuşan</button>
          <button type="button" class="btn-edit-preset" title="Düzenle">✏️</button>
          <button type="button" class="btn-duplicate-preset" title="Kopyala / Çoğalt">📋</button>
          <button type="button" class="btn-delete-atk-preset" title="Sil">🗑️</button>
        </div>
      `;

      // Kuşan butonu
      card.querySelector('.btn-equip-preset').addEventListener('click', () => {
        equipPreset(preset.id, true);
        closeAttackPresetsModal();
      });

      // Düzenle butonu
      card.querySelector('.btn-edit-preset').addEventListener('click', () => {
        editPresetInBuilder(preset);
      });

      // Çoğalt (Duplicate) butonu
      card.querySelector('.btn-duplicate-preset').addEventListener('click', () => {
        duplicatePresetInBuilder(preset);
      });

      // Sil butonu
      card.querySelector('.btn-delete-atk-preset').addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`"${preset.name}" presetini silmek istediğinize emin misiniz?`)) {
          if (typeof socket !== 'undefined') {
            socket.emit('deleteAttackPreset', preset.id);
          }
        }
      });

      grid.appendChild(card);
    });
  }

  function populateStatusEffectsSelect() {
    const select = document.getElementById('atk-builder-status-effect');
    if (!select) return;

    const currentVal = select.value;
    select.innerHTML = '<option value="">— Durum Etkisi Yok —</option>';

    // Custom status presets listesinden al
    const statusPresets = (typeof currentStatusPresets !== 'undefined' ? currentStatusPresets : []) || [];
    statusPresets.forEach(eff => {
      const opt = document.createElement('option');
      opt.value = eff.id;
      opt.textContent = `${eff.icon || '✨'} ${eff.name} (${eff.duration ? eff.duration + ' Tur' : 'Kalıcı'})`;
      select.appendChild(opt);
    });

    if (currentVal) select.value = currentVal;
  }

  function openAttackPresetsModal() {
    populateStatusEffectsSelect();
    renderAttackPresetsCatalog();
    const modal = document.getElementById('dm-attack-presets-modal');
    if (modal) modal.classList.remove('hidden');
  }

  function closeAttackPresetsModal() {
    const modal = document.getElementById('dm-attack-presets-modal');
    if (modal) modal.classList.add('hidden');
  }

  function editPresetInBuilder(preset) {
    if (!preset) return;

    // Builder alanlarını doldur
    document.getElementById('atk-builder-id').value = preset.id || '';
    document.getElementById('atk-builder-name').value = preset.name || '';
    document.getElementById('atk-builder-stat').value = preset.stat || 'STR';
    document.getElementById('atk-builder-count').value = preset.attackCount || 1;
    const physTypeSelect = document.getElementById('atk-builder-phys-type');
    if (physTypeSelect) physTypeSelect.value = preset.physicalDamageType || (preset.attackType === 'spell' ? 'magic' : 'slashing');
    document.getElementById('atk-builder-half-miss').checked = Boolean(preset.halfDamageOnMiss);

    const aoeCheck = document.getElementById('atk-builder-is-aoe');
    if (aoeCheck) aoeCheck.checked = Boolean(preset.isAoe);

    const aoeRadiusInput = document.getElementById('atk-builder-aoe-radius');
    if (aoeRadiusInput) aoeRadiusInput.value = preset.aoeRadius || 1;

    const aoeRadiusGroup = document.getElementById('atk-builder-aoe-radius-group');
    if (aoeRadiusGroup) aoeRadiusGroup.style.display = preset.isAoe ? 'flex' : 'none';

    document.getElementById('atk-builder-desc').value = preset.description || '';

    // Büyü Slotu Yapılandırması
    const consumesCheck = document.getElementById('atk-builder-consumes-slot');
    if (consumesCheck) consumesCheck.checked = Boolean(preset.consumesSpellSlot);

    const spellSection = document.getElementById('atk-builder-spell-slot-section');
    if (spellSection) spellSection.style.display = preset.consumesSpellSlot ? 'block' : 'none';

    const baseLvlSelect = document.getElementById('atk-builder-base-spell-level');
    if (baseLvlSelect) baseLvlSelect.value = preset.baseSpellLevel || preset.spellLevel || 1;

    // Seviye zarlarını builder state'e yükle
    builderSlotScaling = { 1: null, 2: null, 3: null, 4: null };
    builderSlotScaling[1] = preset.dicePools || null;

    if (preset.slotScaling) {
      for (let l = 2; l <= 4; l++) {
        const s = preset.slotScaling[l];
        if (s) {
          builderSlotScaling[l] = s.dicePools || s;
        }
      }
    }

    switchBuilderLevel(1, false);

    // Status Effect
    populateStatusEffectsSelect();
    const statusSelect = document.getElementById('atk-builder-status-effect');
    if (statusSelect) {
      if (preset.statusEffectsToApply && preset.statusEffectsToApply.length > 0) {
        statusSelect.value = preset.statusEffectsToApply[0].id || '';
      } else {
        statusSelect.value = '';
      }
    }

    updateBuilderModeBanner(preset);

    // Builder Sekmesini Aktif Et
    const builderTabBtn = document.querySelector('.atk-tab-btn[data-tab="builder"]');
    if (builderTabBtn) {
      document.querySelectorAll('.atk-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.atk-tab-pane').forEach(p => p.classList.remove('active'));
      builderTabBtn.classList.add('active');
      const pane = document.getElementById('atk-tab-builder');
      if (pane) pane.classList.add('active');
    }
  }

  function duplicatePresetInBuilder(preset) {
    if (!preset) return;
    editPresetInBuilder(preset);
    // Yeni bağımsız kopya oluşturmak için ID'yi boşalt ve isme (Kopya) ekle
    const idInput = document.getElementById('atk-builder-id');
    if (idInput) idInput.value = '';
    const nameInput = document.getElementById('atk-builder-name');
    if (nameInput) nameInput.value = `${preset.name} (Kopya)`;
    updateBuilderModeBanner(null);
  }

  function readPresetFromBuilder() {
    const id = document.getElementById('atk-builder-id')?.value.trim();
    const name = document.getElementById('atk-builder-name')?.value.trim();
    if (!name) {
      alert('Lütfen saldırı preseti için bir İsim girin!');
      return null;
    }

    // Aktif seviyedeki son değişiklikleri kaydet
    const currPools = readCurrentBuilderPools();
    if (builderActiveLvl === 1 || hasAnyDice(currPools)) {
      builderSlotScaling[builderActiveLvl] = currPools;
    } else {
      builderSlotScaling[builderActiveLvl] = null;
    }

    const consumesSpellSlot = Boolean(document.getElementById('atk-builder-consumes-slot')?.checked);
    const baseSpellLevel = parseInt(document.getElementById('atk-builder-base-spell-level')?.value) || 1;
    const physicalDamageType = document.getElementById('atk-builder-phys-type')?.value || 'slashing';
    const stat = document.getElementById('atk-builder-stat')?.value || 'STR';
    const attackCount = parseInt(document.getElementById('atk-builder-count')?.value) || 1;
    const halfDamageOnMiss = document.getElementById('atk-builder-half-miss')?.checked || false;
    const isAoe = Boolean(document.getElementById('atk-builder-is-aoe')?.checked);
    const aoeRadius = Math.max(0.5, parseFloat(document.getElementById('atk-builder-aoe-radius')?.value) || 1);
    const description = document.getElementById('atk-builder-desc')?.value.trim() || '';

    // Taban zar havuzu (Seviye 1)
    const basePools = builderSlotScaling[1] || currPools;

    // Seviye ölçeklemeleri
    const slotScaling = {};
    if (consumesSpellSlot) {
      for (let lvl = 1; lvl <= 4; lvl++) {
        if (lvl === 1) {
          slotScaling[1] = { dicePools: basePools };
        } else if (builderSlotScaling[lvl] && hasAnyDice(builderSlotScaling[lvl])) {
          slotScaling[lvl] = { dicePools: builderSlotScaling[lvl] };
        } else {
          // Boş bırakılmış seviye -> varsayılan taban kullanılacak
          slotScaling[lvl] = null;
        }
      }
    }

    // Status effect
    const statusEffectsToApply = [];
    const statusId = document.getElementById('atk-builder-status-effect')?.value;
    if (statusId) {
      const statusPresets = (typeof currentStatusPresets !== 'undefined' ? currentStatusPresets : []) || [];
      const foundEff = statusPresets.find(e => e.id === statusId);
      if (foundEff) statusEffectsToApply.push(foundEff);
    }

    return {
      id: id || ('atk_custom_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7)),
      name,
      stat,
      attackType: consumesSpellSlot ? 'spell' : 'physical',
      physicalDamageType,
      consumesSpellSlot,
      baseSpellLevel,
      spellLevel: baseSpellLevel,
      slotScaling,
      attackCount,
      dicePools: basePools,
      statusEffectsToApply,
      halfDamageOnMiss,
      isAoe,
      aoeRadius,
      extraDamage: 0,
      description
    };
  }

  function savePresetFromBuilder(equipAfter = false) {
    const preset = readPresetFromBuilder();
    if (!preset) return;

    if (typeof socket !== 'undefined') {
      socket.emit('saveAttackPreset', preset);
    }

    // Yerel önbelleğe de ekle/güncelle
    const idx = attackPresetsCache.findIndex(p => p.id === preset.id);
    if (idx >= 0) attackPresetsCache[idx] = preset;
    else attackPresetsCache.push(preset);

    populatePresetSelect();

    // Formu sıfırla ki sonraki kayıtlar bunun ID'si üzerine yazmasın!
    resetPresetBuilder();

    if (equipAfter) {
      equipPreset(preset, true);
      closeAttackPresetsModal();
    } else {
      alert(`"${preset.name}" saldırı preseti kaydedildi!`);
      // Katalog sekmesine geç
      const listTabBtn = document.querySelector('.atk-tab-btn[data-tab="list"]');
      if (listTabBtn) listTabBtn.click();
    }
  }

  // === EVENT LISTENERS ===
  attackerSelect?.addEventListener('change', onAttackerChange);
  targetSelect?.addEventListener('change', onTargetChange);

  // Preset seçimi değiştiğinde
  presetSelect?.addEventListener('change', () => {
    const val = presetSelect.value;
    if (val) {
      equipPreset(val, true);
    } else {
      unequipPreset(true);
    }
  });

  // Preset modal açma
  btnOpenPresets?.addEventListener('click', openAttackPresetsModal);
  document.getElementById('btn-close-attack-presets')?.addEventListener('click', closeAttackPresetsModal);
  document.getElementById('btn-cancel-attack-presets')?.addEventListener('click', closeAttackPresetsModal);

  // Katalog arama & Yeni preset butonları
  document.getElementById('atk-catalog-search')?.addEventListener('input', (e) => {
    catalogSearchTerm = e.target.value;
    renderAttackPresetsCatalog();
  });
  document.getElementById('btn-catalog-new-preset')?.addEventListener('click', openNewPresetBuilder);
  document.getElementById('btn-builder-reset')?.addEventListener('click', resetPresetBuilder);

  // AoE Checkbox değişiminde yarıçap grubunu göster/gizle
  document.getElementById('atk-builder-is-aoe')?.addEventListener('change', (e) => {
    const radiusGroup = document.getElementById('atk-builder-aoe-radius-group');
    if (radiusGroup) {
      radiusGroup.style.display = e.target.checked ? 'flex' : 'none';
    }
  });

  // Büyü Slotu Harcar Checkbox değişiminde slot bölümünü göster/gizle
  document.getElementById('atk-builder-consumes-slot')?.addEventListener('change', (e) => {
    const spellSection = document.getElementById('atk-builder-spell-slot-section');
    if (spellSection) {
      spellSection.style.display = e.target.checked ? 'block' : 'none';
    }
  });

  // Builder Seviye Sekmeleri Tıklama
  document.querySelectorAll('.atk-lvl-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const lvl = parseInt(btn.dataset.lvl);
      if (lvl) switchBuilderLevel(lvl, true);
    });
  });

  // Builder Tabanı Kopyala & Seviyeyi Sıfırla Butonları
  document.getElementById('btn-copy-base-to-lvl')?.addEventListener('click', () => {
    if (builderActiveLvl <= 1) return;
    const base = builderSlotScaling[1] || readCurrentBuilderPools();
    if (base) {
      builderSlotScaling[builderActiveLvl] = JSON.parse(JSON.stringify(base));
      writeBuilderPools(builderSlotScaling[builderActiveLvl]);
      updateBuilderLvlTabsUI(builderActiveLvl);
    }
  });

  document.getElementById('btn-clear-curr-lvl')?.addEventListener('click', () => {
    if (builderActiveLvl <= 1) return;
    builderSlotScaling[builderActiveLvl] = null;
    writeBuilderPools(null);
    updateBuilderLvlTabsUI(builderActiveLvl);
  });

  // Saldırı Panelindeki Büyü Slotu Radyo Butonları
  document.querySelectorAll('input[name="atk-active-spell-level"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      if (e.target.checked) {
        selectActiveSpellLevel(e.target.value);
      }
    });
  });

  // Modal Sekmeleri
  document.querySelectorAll('.atk-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;

      // Eğer kullanıcı doğrudan Builder tabına tıkladıysa ve şu an bir düzenleme ID'si varsa,
      // düzenlemeyi sıfırla ki yanlışlıkla eski presetin üzerine yazmasın
      if (tabName === 'builder' && btn.id === 'btn-tab-atk-builder') {
        const idVal = document.getElementById('atk-builder-id')?.value;
        if (idVal) {
          resetPresetBuilder();
        }
      }

      document.querySelectorAll('.atk-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.atk-tab-pane').forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const pane = document.getElementById(`atk-tab-${tabName}`);
      if (pane) pane.classList.add('active');

      if (tabName === 'list') renderAttackPresetsCatalog();
    });
  });

  // Modal builder kaydet butonları
  document.getElementById('btn-save-atk-preset')?.addEventListener('click', () => savePresetFromBuilder(false));
  document.getElementById('btn-equip-and-save-preset')?.addEventListener('click', () => savePresetFromBuilder(true));

  // Tekil Saldır butonu
  btnAttack?.addEventListener('click', performAttack);
  btnApplyDamage?.addEventListener('click', applyDamage);
  btnClearLog?.addEventListener('click', () => { if (combatLog) combatLog.innerHTML = ''; });
  btnClearResist?.addEventListener('click', clearResistances);
  btnRefreshTargets?.addEventListener('click', loadSelectors);

  advantageCheck?.addEventListener('change', () => {
    if (advantageCheck.checked && disadvantageCheck) disadvantageCheck.checked = false;
  });
  disadvantageCheck?.addEventListener('change', () => {
    if (disadvantageCheck.checked && advantageCheck) advantageCheck.checked = false;
  });

  panel?.addEventListener('toggle', () => {
    if (panel.open) {
      const currentAttackerVal = attackerSelect ? attackerSelect.value : null;
      loadSelectors().then(() => {
        if (currentAttackerVal && attackerSelect) {
          attackerSelect.value = currentAttackerVal;
          onAttackerChange();
        }
      });
    }
  });

  // Clear Targets Butonu
  document.getElementById('atk-btn-clear-targets')?.addEventListener('click', clearAllTargets);

  // Dışa açılan API'ler
  window.__webdnd_clearTargets = clearAllTargets;
  window.__webdnd_removeTarget = removeTargetById;
  window.__webdnd_isTargetSelected = isTargetSelected;
  window.__webdnd_equipAttackPreset = equipPreset;
  window.__webdnd_unequipAttackPreset = unequipPreset;
  window.__webdnd_getAttackPresets = () => attackPresetsCache;
  window.__webdnd_getActiveEquippedPreset = () => activeEquippedPreset;

  window.__webdnd_onCombatTurnActive = function (combatant) {
    if (!combatant) return;
    // Tur değiştiğinde / geçtiğinde önceki hedefleri ve seçim halkalarını temizle
    clearAllTargets();

    const targetKey = combatant.isMarker ? `marker:${combatant.id}` : `character:${combatant.characterId || combatant.id}`;
    if (typeof window.__webdnd_selectAttacker === 'function') {
      window.__webdnd_selectAttacker(targetKey);
    }

    // Atanmış saldırılardan hafızada olanı veya ilkini kuşan
    if (combatant.assignedAttacks && combatant.assignedAttacks.length > 0) {
      const rememberedId = lastEquippedAttackByToken.get(targetKey);
      const targetPresetId = (rememberedId && combatant.assignedAttacks.includes(rememberedId))
        ? rememberedId
        : combatant.assignedAttacks[0];
      if (targetPresetId) {
        equipPreset(targetPresetId);
      }
    }
  };

  window.__webdnd_openAttackPresetsModal = openAttackPresetsModal;
  window.__webdnd_openNewPresetBuilder = openNewPresetBuilder;
  window.__webdnd_resetPresetBuilder = resetPresetBuilder;

  // === SOCKET SENKRONİZASYON ===
  if (typeof socket !== 'undefined') {
    socket.on('attackPresetsUpdated', (presets) => {
      if (Array.isArray(presets)) {
        attackPresetsCache = presets;
        populatePresetSelect();
        renderAttackPresetsCatalog();
      }
    });

    socket.on('combatStarted', () => {
      clearAllTargets();
    });

    socket.on('combatEnded', () => {
      clearAllTargets();
    });

    socket.on('currentPlayers', () => setTimeout(loadSelectors, 500));
    socket.on('newPlayer', () => loadSelectors());
    socket.on('playerDisconnected', (id) => {
      if (typeof allPlayers !== 'undefined' && allPlayers[id]) {
        const p = allPlayers[id];
        const charId = p?.character?.id;
        if (charId) {
          removeTargetById('character', charId);
          if (selectedAttacker && selectedAttacker.type === 'character' && String(selectedAttacker.id) === String(charId)) {
            selectedAttacker = null;
            if (attackerSelect) attackerSelect.value = '';
            onAttackerChange();
          }
        }
      }
      loadSelectors();
    });
    socket.on('newMarker', () => loadSelectors());
    socket.on('removeMarker', (markerId) => {
      if (markerId) {
        removeTargetById('marker', markerId);
        if (selectedAttacker && selectedAttacker.type === 'marker' && String(selectedAttacker.id) === String(markerId)) {
          selectedAttacker = null;
          if (attackerSelect) attackerSelect.value = '';
          onAttackerChange();
        }
      }
      loadSelectors();
    });
    socket.on('updateMarkerData', () => {
      loadSelectors();
      updateTargetResistanceBadges();
    });
    socket.on('tokenEffectsUpdated', () => updateTargetResistanceBadges());
    socket.on('characterUpdated', () => {
      if (selectedAttacker) setTimeout(onAttackerChange, 300);
      if (selectedTargets.length > 0) {
        setTimeout(() => {
          renderSelectedTargets();
          updateTargetResistanceBadges();
        }, 300);
      }
    });

    // Sunucudan gelen vuruş hissi olayı (diğer oyuncuların ekranlarında da görünür)
    socket.on('attackHitImpact', (data) => {
      const key = `${data.targetType}:${data.targetId}`;
      if (recentImpacts.has(key)) return;
      triggerHitImpact(data);
    });

    // Hasar türü dropdown değişikliği
    document.getElementById('atk-phys-damage-type')?.addEventListener('change', updateTargetResistanceBadges);

    // İlk yüklemede ve yeniden bağlanmada presetleri sorgula
    socket.on('connect', () => {
      socket.emit('getAttackPresets');
    });
    socket.emit('getAttackPresets');
  }

  setTimeout(loadSelectors, 1000);

})();
