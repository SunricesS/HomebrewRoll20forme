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
  const btnPhysicalAttack = document.getElementById('atk-btn-physical');
  const btnSpellAttack = document.getElementById('atk-btn-spell');
  const btnApplyDamage = document.getElementById('atk-btn-apply-damage');
  const btnClearLog = document.getElementById('atk-btn-clear-log');
  const btnClearResist = document.getElementById('atk-btn-clear-resist');
  const btnRefreshTargets = document.getElementById('atk-btn-refresh');

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
      if (this.weakRadio?.checked) {
        finalDmg *= 2;
        breakdownParts.push('(Zayıf 2x)');
      } else if (this.resRadio?.checked) {
        finalDmg = Math.floor(finalDmg / 2);
        breakdownParts.push('(Dirençli 0.5x)');
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
      opt.textContent = `${typeIcon} ${p.name} (${p.stat})${halfIcon}${statusIcon}`;
      presetSelect.appendChild(opt);
    });

    if (currentVal && attackPresetsCache.some(p => p.id === currentVal)) {
      presetSelect.value = currentVal;
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

    // Büyü Seviyesi
    if (preset.attackType === 'spell') {
      const lvl = preset.spellLevel || 1;
      const radio = document.getElementById(`atk-spell-lvl${lvl}`);
      if (radio) radio.checked = true;
    }

    // Zar Havuzları
    const pools = preset.dicePools || {};
    dicePools.phys.setState(pools.phys || pools.physical);
    dicePools.elem1.setState(pools.elem1);
    dicePools.elem2.setState(pools.elem2);
    dicePools.spell.setState(pools.spell);

    // Ekstra Parametreler (varsa)
    if (preset.extraDamage != null && extraDmgInput) extraDmgInput.value = preset.extraDamage;
    if (preset.attackCount != null && attackCountInput) attackCountInput.value = preset.attackCount;

    // Banner Güncelle
    updatePresetBanner(preset);

    // Saldıran token için kuşanma hafızasını kaydet
    if (persistForToken && selectedAttacker) {
      const key = `${selectedAttacker.type}:${selectedAttacker.id}`;
      lastEquippedAttackByToken.set(key, preset.id);
    }
  }

  /**
   * Kuşanılmış preseti çıkarır (serbest moda geçer).
   */
  function unequipPreset(persistForToken = true) {
    activeEquippedPreset = null;
    if (presetSelect) presetSelect.value = '';
    if (presetInfoBanner) presetInfoBanner.classList.add('hidden');

    if (persistForToken && selectedAttacker) {
      const key = `${selectedAttacker.type}:${selectedAttacker.id}`;
      lastEquippedAttackByToken.delete(key);
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
      presetBadgeType.textContent = preset.attackType === 'spell' ? `✨ Büyü (Lvl ${preset.spellLevel || 1})` : '⚔️ Fiziksel';
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
   * Combobox'tan hedef seçildiğinde: Eski hedefleri temizler, tek hedef ekler.
   */
  function onTargetChange() {
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
    if (typeof tokens !== 'undefined') {
      if (tokens[targetInfo.id]) return tokens[targetInfo.id];
      if (typeof allPlayers !== 'undefined') {
        const p = Object.values(allPlayers).find(p => p.character && p.character.id === targetInfo.id);
        if (p && tokens[p.id]) return tokens[p.id];
      }
    }
    return null;
  }

  /**
   * Ctrl+Click ile haritadan hedef eklenir/kaldırılır (toggle).
   */
  function onCtrlClickTarget(targetInfo, tokenEl) {
    // Zaten seçili mi kontrol et
    const existingIdx = selectedTargets.findIndex(t => t.type === targetInfo.type && t.id === targetInfo.id);

    if (existingIdx >= 0) {
      // Kaldır (toggle off)
      const removed = selectedTargets.splice(existingIdx, 1)[0];
      const el = removed.tokenEl || findTokenElForTarget(removed);
      if (el) el.classList.remove('token-target-selected');
    } else {
      // Ekle
      addTargetToList(targetInfo, tokenEl);
    }

    renderSelectedTargets();
    // Combobox'u temizle (çoklu seçim Ctrl+Click üzerinden yönetiliyor)
    if (targetSelect) targetSelect.value = '';
  }

  /**
   * Hedef listesine yeni bir hedef ekler.
   */
  function addTargetToList(targetInfo, tokenEl) {
    // Duplicate kontrolü
    const exists = selectedTargets.some(t => t.type === targetInfo.type && t.id === targetInfo.id);
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
  }

  /**
   * Hedef listesinden belirli bir hedefi kaldırır.
   */
  function removeTargetById(type, id) {
    const idx = selectedTargets.findIndex(t => t.type === type && t.id === id);
    if (idx >= 0) {
      const removed = selectedTargets.splice(idx, 1)[0];
      const el = removed.tokenEl || findTokenElForTarget(removed);
      if (el) el.classList.remove('token-target-selected');
      renderSelectedTargets();
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
    document.querySelectorAll('.token-target-selected').forEach(el => el.classList.remove('token-target-selected'));
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
  }

  // Ctrl+Click callback'ini kaydet
  window.__webdnd_ctrlClickTarget = onCtrlClickTarget;

  // ============================================================
  // YARDIMCILAR
  // ============================================================

  function fillSpellSlots(slots) {
    if (!slots) slots = { lvl1: 0, lvl2: 0, lvl3: 0, lvl4: 0 };
    if (slotDisplays[1]) slotDisplays[1].textContent = slots.lvl1 ?? 0;
    if (slotDisplays[2]) slotDisplays[2].textContent = slots.lvl2 ?? 0;
    if (slotDisplays[3]) slotDisplays[3].textContent = slots.lvl3 ?? 0;
    if (slotDisplays[4]) slotDisplays[4].textContent = slots.lvl4 ?? 0;
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
  // SALDIRI İŞLEMLERİ
  // ============================================================

  async function performPhysicalAttack() {
    if (!selectedAttacker) { alert('Lütfen bir SALDIRAN seçin!'); return; }
    if (selectedTargets.length === 0) { alert('Lütfen en az bir HEDEF seçin!'); return; }

    const halfDamageOnMiss = Boolean(activeEquippedPreset?.halfDamageOnMiss);
    const statusEffectsToApply = activeEquippedPreset?.statusEffectsToApply || [];

    // Her hedef için ayrı saldırı
    lastAttackResults = [];
    btnPhysicalAttack && (btnPhysicalAttack.disabled = true);
    btnSpellAttack && (btnSpellAttack.disabled = true);

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
        physical: dicePools.phys.getState(),
        element1: dicePools.elem1.getState(),
        element2: dicePools.elem2.getState()
      };

      await sendAttackForTarget(body, target);
    }

    // Çoklu sonuçlar varsa toplam hasar uygulama butonu
    showMultiApplyButton();

    btnPhysicalAttack && (btnPhysicalAttack.disabled = false);
    btnSpellAttack && (btnSpellAttack.disabled = false);
  }

  async function performSpellAttack() {
    if (!selectedAttacker) { alert('Lütfen bir SALDIRAN seçin!'); return; }
    if (selectedTargets.length === 0) { alert('Lütfen en az bir HEDEF seçin!'); return; }

    // Spell seviyesini belirle
    let spellLevel = 1;
    for (let i = 1; i <= 4; i++) {
      const radio = document.getElementById(`atk-spell-lvl${i}`);
      if (radio?.checked) { spellLevel = i; break; }
    }

    // Slot kontrolü (saldıranın slotları)
    const currentSlots = parseInt(slotDisplays[spellLevel]?.textContent || '0');
    if (currentSlots <= 0) {
      alert(`${escapeHtml(selectedAttacker.name)} — Seviye ${spellLevel} büyü slotu kalmadı!`);
      return;
    }

    const halfDamageOnMiss = Boolean(activeEquippedPreset?.halfDamageOnMiss);
    const statusEffectsToApply = activeEquippedPreset?.statusEffectsToApply || [];

    // Her hedef için ayrı saldırı
    lastAttackResults = [];
    btnPhysicalAttack && (btnPhysicalAttack.disabled = true);
    btnSpellAttack && (btnSpellAttack.disabled = true);

    for (const target of selectedTargets) {
      const targetAC = selectedTargets.length === 1 ? intVal(targetACInput) : getTargetAC(target);

      const body = {
        attacker: { type: selectedAttacker.type, id: selectedAttacker.id },
        attackerStats: getAttackerStats(),
        target: { type: target.type, id: target.id },
        targetAC: targetAC,
        attackType: 'spell',
        advantage: advantageCheck?.checked || false,
        disadvantage: disadvantageCheck?.checked || false,
        attackCount: intVal(attackCountInput) || 1,
        extraDamage: intVal(extraDmgInput),
        halfDamageOnMiss: halfDamageOnMiss,
        statusEffectsToApply: statusEffectsToApply,
        spell: {
          ...dicePools.spell.getState(),
          level: spellLevel
        }
      };

      await sendAttackForTarget(body, target);
    }

    // Çoklu sonuçlar varsa toplam hasar uygulama butonu
    showMultiApplyButton();

    btnPhysicalAttack && (btnPhysicalAttack.disabled = false);
    btnSpellAttack && (btnSpellAttack.disabled = false);

    // Slotu düşür (saldırandan)
    const newSlotCount = currentSlots - 1;
    if (slotDisplays[spellLevel]) slotDisplays[spellLevel].textContent = newSlotCount;

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
    }
  }

  /**
   * Tek bir hedefe saldırı isteği gönderir ve sonucu loglar.
   */
  async function sendAttackForTarget(body, target) {
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
      if (result.statusNotes?.targetParalyzed) notes.push('⚡ Hedef Felçli (Kesin Kritik)');
      if (result.statusNotes?.halfDamageOnMiss) notes.push('🛡️ Iska: ½ Hasar');
      const notesLabel = notes.length > 0 ? ` [${notes.join(', ')}]` : '';

      // Log başlığı: Saldıran → Hedef
      const atkLabel = body.attackType === 'physical' ? '⚔️ FİZİKSEL' : '✨ BÜYÜ';
      const attackerName = escapeHtml(selectedAttacker?.name || '?');
      const targetName = escapeHtml(target.name || '?');
      addCombatLog(
        `<span class="atk-log-header">--- ${atkLabel}: ${attackerName} → ${targetName} (${body.attackCount} Vuruş, AC:${body.targetAC})${notesLabel} ---</span>`,
        'header'
      );

      result.attacks.forEach(atk => {
        if (atk.hit) {
          const critTag = atk.isCritical ? ' <span class="atk-crit">KRİTİK!</span>' : '';
          const typeLabel = body.attackType === 'physical' ? 'Saldırı' : 'Büyü Saldırısı';
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
      if (result.totalDamage > 0 || (result.statusEffectsToApply && result.statusEffectsToApply.length > 0)) {
        lastAttackResults.push({
          totalDamage: result.totalDamage,
          targetId: target.id,
          targetType: target.type,
          targetName: target.name,
          attackerName: selectedAttacker?.name,
          statusEffectsToApply: result.statusEffectsToApply || []
        });
      }

    } catch (err) {
      console.error('Saldırı hatası:', err);
      addCombatLog(`<span class="atk-log-error">HATA (${escapeHtml(target.name)}): ${escapeHtml(err.message)}</span>`, 'error');
    }
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
      if (lastAttackResults.length === 1) {
        const r = lastAttackResults[0];
        btnApplyDamage.textContent = `💀 ${r.totalDamage} Hasar Uygula → ${escapeHtml(r.targetName)}`;
      } else {
        const totalAll = lastAttackResults.reduce((sum, r) => sum + r.totalDamage, 0);
        btnApplyDamage.textContent = `💀 Tüm Hasarları Uygula (${lastAttackResults.length} hedef, toplam ${totalAll})`;
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

      for (const attackResult of lastAttackResults) {
        try {
          const res = await fetch('/api/combat/apply-damage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              targetType: attackResult.targetType,
              targetId: attackResult.targetId,
              damage: attackResult.totalDamage,
              statusEffectsToApply: attackResult.statusEffectsToApply
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

    formatPool(pools.phys || pools.physical, 'Fiz');
    formatPool(pools.elem1, 'Ateş');
    formatPool(pools.elem2, 'Buz');
    formatPool(pools.spell, 'Büyü');

    return parts.join(' | ') || 'Havuz boş';
  }

  function renderAttackPresetsCatalog() {
    const grid = document.getElementById('atk-presets-grid');
    if (!grid) return;

    grid.innerHTML = '';

    attackPresetsCache.forEach(preset => {
      const card = document.createElement('div');
      card.className = 'atk-preset-card';
      if (activeEquippedPreset && activeEquippedPreset.id === preset.id) {
        card.classList.add('equipped-active');
      }

      const typeLabel = preset.attackType === 'spell' ? `✨ Büyü (Lvl ${preset.spellLevel || 1})` : '⚔️ Fiziksel';
      const halfBadge = preset.halfDamageOnMiss ? `<span class="atk-preset-chip" style="background:rgba(230,126,34,0.2); border-color:#e67e22;">🛡️ Iska: ½ Hasar</span>` : '';
      const statusBadge = preset.statusEffectsToApply?.length
        ? `<span class="atk-preset-chip" style="background:rgba(241,196,15,0.2); border-color:#f1c40f;">${preset.statusEffectsToApply[0].icon || '✨'} ${preset.statusEffectsToApply[0].name}</span>`
        : '';

      card.innerHTML = `
        <div>
          <div class="atk-preset-card-header">
            <span class="atk-preset-card-title">${escapeHtml(preset.name)}</span>
            <span class="atk-preset-chip">${preset.stat}</span>
          </div>
          <div class="atk-preset-badge-row" style="margin: 4px 0;">
            <span class="atk-preset-chip">${typeLabel}</span>
            ${halfBadge}
            ${statusBadge}
          </div>
          <div class="atk-preset-card-pools">${formatPoolSummary(preset.dicePools)}</div>
          ${preset.description ? `<div class="atk-preset-card-desc" style="margin-top:4px;">${escapeHtml(preset.description)}</div>` : ''}
        </div>
        <div class="atk-preset-card-actions">
          <button type="button" class="btn-equip-preset" title="Bu Saldırıyı Kuşan">⚡ Kuşan</button>
          <button type="button" class="btn-edit-preset" title="Düzenle">✏️</button>
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
    document.getElementById('atk-builder-type').value = preset.attackType || 'physical';
    document.getElementById('atk-builder-stat').value = preset.stat || 'STR';
    document.getElementById('atk-builder-spell-level').value = preset.spellLevel || 1;
    document.getElementById('atk-builder-count').value = preset.attackCount || 1;
    document.getElementById('atk-builder-half-miss').checked = Boolean(preset.halfDamageOnMiss);
    document.getElementById('atk-builder-desc').value = preset.description || '';

    // Zar steppers
    const setSteppers = (channel, prefix) => {
      const p = (preset.dicePools && (preset.dicePools[channel] || preset.dicePools[channel === 'phys' ? 'physical' : channel])) || {};
      const d = p.dice || {};
      [4, 6, 8, 10, 12, 20].forEach(sides => {
        const el = document.getElementById(`atk-bpool-${prefix}-d${sides}`);
        if (el) el.value = d[sides] || d[`d${sides}`] || 0;
      });
      const bonusEl = document.getElementById(`atk-bpool-${prefix}-bonus`);
      if (bonusEl) bonusEl.value = p.bonus || 0;
    };

    setSteppers('phys', 'phys');
    setSteppers('elem1', 'elem1');
    setSteppers('elem2', 'elem2');
    setSteppers('spell', 'spell');

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

    // Builder Sekmesini Aktif Et
    const builderTabBtn = document.querySelector('.atk-tab-btn[data-tab="builder"]');
    if (builderTabBtn) builderTabBtn.click();
  }

  function readPresetFromBuilder() {
    const id = document.getElementById('atk-builder-id')?.value.trim();
    const name = document.getElementById('atk-builder-name')?.value.trim();
    if (!name) {
      alert('Lütfen saldırı preseti için bir İsim girin!');
      return null;
    }

    const attackType = document.getElementById('atk-builder-type')?.value || 'physical';
    const stat = document.getElementById('atk-builder-stat')?.value || 'STR';
    const spellLevel = parseInt(document.getElementById('atk-builder-spell-level')?.value) || 1;
    const attackCount = parseInt(document.getElementById('atk-builder-count')?.value) || 1;
    const halfDamageOnMiss = document.getElementById('atk-builder-half-miss')?.checked || false;
    const description = document.getElementById('atk-builder-desc')?.value.trim() || '';

    const readSteppers = (prefix) => {
      const dice = {};
      [4, 6, 8, 10, 12, 20].forEach(sides => {
        const val = parseInt(document.getElementById(`atk-bpool-${prefix}-d${sides}`)?.value) || 0;
        if (val > 0) dice[sides] = val;
      });
      const bonus = parseInt(document.getElementById(`atk-bpool-${prefix}-bonus`)?.value) || 0;
      return { dice, bonus, weakness: false, resistance: false };
    };

    const dicePools = {
      phys: readSteppers('phys'),
      elem1: readSteppers('elem1'),
      elem2: readSteppers('elem2'),
      spell: readSteppers('spell')
    };

    // Status effect
    const statusEffectsToApply = [];
    const statusId = document.getElementById('atk-builder-status-effect')?.value;
    if (statusId) {
      const statusPresets = (typeof currentStatusPresets !== 'undefined' ? currentStatusPresets : []) || [];
      const foundEff = statusPresets.find(e => e.id === statusId);
      if (foundEff) statusEffectsToApply.push(foundEff);
    }

    return {
      id: id || ('atk_custom_' + Date.now()),
      name,
      stat,
      attackType,
      spellLevel,
      attackCount,
      dicePools,
      statusEffectsToApply,
      halfDamageOnMiss,
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

  // Modal Sekmeleri
  document.querySelectorAll('.atk-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.atk-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.atk-tab-pane').forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const tabName = btn.dataset.tab;
      const pane = document.getElementById(`atk-tab-${tabName}`);
      if (pane) pane.classList.add('active');

      if (tabName === 'list') renderAttackPresetsCatalog();
    });
  });

  // Modal builder kaydet butonları
  document.getElementById('btn-save-atk-preset')?.addEventListener('click', () => savePresetFromBuilder(false));
  document.getElementById('btn-equip-and-save-preset')?.addEventListener('click', () => savePresetFromBuilder(true));

  // Saldırı butonları
  btnPhysicalAttack?.addEventListener('click', performPhysicalAttack);
  btnSpellAttack?.addEventListener('click', performSpellAttack);
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

  // Dışa açılan API'ler
  window.__webdnd_onCombatTurnActive = function (combatant) {
    if (!combatant) return;
    const targetKey = combatant.isMarker ? `marker:${combatant.id}` : `character:${combatant.characterId || combatant.id}`;
    if (typeof window.__webdnd_selectAttacker === 'function') {
      window.__webdnd_selectAttacker(targetKey);
    }
  };

  window.__webdnd_openAttackPresetsModal = openAttackPresetsModal;

  // === SOCKET SENKRONİZASYON ===
  if (typeof socket !== 'undefined') {
    socket.on('attackPresetsUpdated', (presets) => {
      if (Array.isArray(presets)) {
        attackPresetsCache = presets;
        populatePresetSelect();
        renderAttackPresetsCatalog();
      }
    });

    socket.on('currentPlayers', () => setTimeout(loadSelectors, 500));
    socket.on('newPlayer', () => loadSelectors());
    socket.on('playerDisconnected', () => loadSelectors());
    socket.on('newMarker', () => loadSelectors());
    socket.on('removeMarker', () => loadSelectors());
    socket.on('updateMarkerData', () => loadSelectors());
    socket.on('characterUpdated', () => {
      if (selectedAttacker) setTimeout(onAttackerChange, 300);
      if (selectedTargets.length > 0) setTimeout(renderSelectedTargets, 300);
    });

    // İlk yüklemede presetleri sorgula
    socket.emit('getAttackPresets');
  }

  setTimeout(loadSelectors, 1000);

})();
