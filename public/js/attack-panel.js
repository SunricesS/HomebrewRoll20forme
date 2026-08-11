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
  let lastAttackResults = [];  // Array of { totalDamage, targetId, targetType, targetName, attackerName }
  let allCharactersCache = [];

  // === SALDIRAN FORM CACHE ===
  // Her saldıran için form değerlerini hafızada tutar (type:id → { field: value, ... })
  const attackerFormCache = new Map();

  // === DOM REFERANSLARI ===
  const panel = document.getElementById('attack-panel-container');
  if (!panel) return;

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

  // Fiziksel hasar alanları
  const physMinInput = document.getElementById('atk-phys-min');
  const physMaxInput = document.getElementById('atk-phys-max');
  const physExMinInput = document.getElementById('atk-phys-extra-min');
  const physExMaxInput = document.getElementById('atk-phys-extra-max');
  const physWeakRadio = document.getElementById('atk-phys-weak');
  const physResRadio = document.getElementById('atk-phys-resist');

  const elem1MinInput = document.getElementById('atk-elem1-min');
  const elem1MaxInput = document.getElementById('atk-elem1-max');
  const elem1ExMinInput = document.getElementById('atk-elem1-extra-min');
  const elem1ExMaxInput = document.getElementById('atk-elem1-extra-max');
  const elem1WeakRadio = document.getElementById('atk-elem1-weak');
  const elem1ResRadio = document.getElementById('atk-elem1-resist');

  const elem2MinInput = document.getElementById('atk-elem2-min');
  const elem2MaxInput = document.getElementById('atk-elem2-max');
  const elem2ExMinInput = document.getElementById('atk-elem2-extra-min');
  const elem2ExMaxInput = document.getElementById('atk-elem2-extra-max');
  const elem2WeakRadio = document.getElementById('atk-elem2-weak');
  const elem2ResRadio = document.getElementById('atk-elem2-resist');

  // Büyü hasar alanları
  const spellMinInput = document.getElementById('atk-spell-min');
  const spellMaxInput = document.getElementById('atk-spell-max');
  const spellExMinInput = document.getElementById('atk-spell-extra-min');
  const spellExMaxInput = document.getElementById('atk-spell-extra-max');

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

    // Grup 3: İşaretler/NPC (HP'li marker'lar)
    if (window.__webdnd_markers) {
      const markerGroup = document.createElement('optgroup');
      markerGroup.label = '⚔️ İşaretler/NPC';
      let hasMarkers = false;

      Object.values(window.__webdnd_markers).forEach(m => {
        if (m.hp == null) return;
        hasMarkers = true;
        const opt = document.createElement('option');
        opt.value = `marker:${m.id}`;
        opt.textContent = `[M] ${m.name} (HP: ${m.hp}/${m.maxHp || '?'})`;
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

      // Fiziksel hasar
      physMin: physMinInput?.value || '0',
      physMax: physMaxInput?.value || '0',
      physExMin: physExMinInput?.value || '0',
      physExMax: physExMaxInput?.value || '0',
      physWeak: physWeakRadio?.checked || false,
      physResist: physResRadio?.checked || false,

      // Element 1
      elem1Min: elem1MinInput?.value || '0',
      elem1Max: elem1MaxInput?.value || '0',
      elem1ExMin: elem1ExMinInput?.value || '0',
      elem1ExMax: elem1ExMaxInput?.value || '0',
      elem1Weak: elem1WeakRadio?.checked || false,
      elem1Resist: elem1ResRadio?.checked || false,

      // Element 2
      elem2Min: elem2MinInput?.value || '0',
      elem2Max: elem2MaxInput?.value || '0',
      elem2ExMin: elem2ExMinInput?.value || '0',
      elem2ExMax: elem2ExMaxInput?.value || '0',
      elem2Weak: elem2WeakRadio?.checked || false,
      elem2Resist: elem2ResRadio?.checked || false,

      // Büyü hasar
      spellMin: spellMinInput?.value || '0',
      spellMax: spellMaxInput?.value || '0',
      spellExMin: spellExMinInput?.value || '0',
      spellExMax: spellExMaxInput?.value || '0',

      // Büyü seviyesi (hangi radio seçili)
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
   * Kayıt yoksa tüm alanları varsayılana (boş/sıfır) döndürür.
   */
  function restoreAttackerForm(key) {
    const state = attackerFormCache.get(key);

    if (state) {
      // Modifikatörler
      if (modifierSelect) modifierSelect.value = state.modifier;
      if (extraDmgInput) extraDmgInput.value = state.extraDamage;
      if (attackCountInput) attackCountInput.value = state.attackCount;
      if (advantageCheck) advantageCheck.checked = state.advantage;
      if (disadvantageCheck) disadvantageCheck.checked = state.disadvantage;

      // Fiziksel hasar
      if (physMinInput) physMinInput.value = state.physMin;
      if (physMaxInput) physMaxInput.value = state.physMax;
      if (physExMinInput) physExMinInput.value = state.physExMin;
      if (physExMaxInput) physExMaxInput.value = state.physExMax;
      if (physWeakRadio) physWeakRadio.checked = state.physWeak;
      if (physResRadio) physResRadio.checked = state.physResist;

      // Element 1
      if (elem1MinInput) elem1MinInput.value = state.elem1Min;
      if (elem1MaxInput) elem1MaxInput.value = state.elem1Max;
      if (elem1ExMinInput) elem1ExMinInput.value = state.elem1ExMin;
      if (elem1ExMaxInput) elem1ExMaxInput.value = state.elem1ExMax;
      if (elem1WeakRadio) elem1WeakRadio.checked = state.elem1Weak;
      if (elem1ResRadio) elem1ResRadio.checked = state.elem1Resist;

      // Element 2
      if (elem2MinInput) elem2MinInput.value = state.elem2Min;
      if (elem2MaxInput) elem2MaxInput.value = state.elem2Max;
      if (elem2ExMinInput) elem2ExMinInput.value = state.elem2ExMin;
      if (elem2ExMaxInput) elem2ExMaxInput.value = state.elem2ExMax;
      if (elem2WeakRadio) elem2WeakRadio.checked = state.elem2Weak;
      if (elem2ResRadio) elem2ResRadio.checked = state.elem2Resist;

      // Büyü hasar
      if (spellMinInput) spellMinInput.value = state.spellMin;
      if (spellMaxInput) spellMaxInput.value = state.spellMax;
      if (spellExMinInput) spellExMinInput.value = state.spellExMin;
      if (spellExMaxInput) spellExMaxInput.value = state.spellExMax;

      // Büyü seviyesi
      for (let i = 1; i <= 4; i++) {
        const radio = document.getElementById(`atk-spell-lvl${i}`);
        if (radio) radio.checked = (i === state.spellLevel);
      }
    } else {
      // Kayıt yok — tüm alanları varsayılana sıfırla
      if (modifierSelect) modifierSelect.value = 'STR';
      if (extraDmgInput) extraDmgInput.value = '0';
      if (attackCountInput) attackCountInput.value = '1';
      if (advantageCheck) advantageCheck.checked = false;
      if (disadvantageCheck) disadvantageCheck.checked = false;

      if (physMinInput) physMinInput.value = '0';
      if (physMaxInput) physMaxInput.value = '0';
      if (physExMinInput) physExMinInput.value = '0';
      if (physExMaxInput) physExMaxInput.value = '0';
      if (physWeakRadio) physWeakRadio.checked = false;
      if (physResRadio) physResRadio.checked = false;

      if (elem1MinInput) elem1MinInput.value = '0';
      if (elem1MaxInput) elem1MaxInput.value = '0';
      if (elem1ExMinInput) elem1ExMinInput.value = '0';
      if (elem1ExMaxInput) elem1ExMaxInput.value = '0';
      if (elem1WeakRadio) elem1WeakRadio.checked = false;
      if (elem1ResRadio) elem1ResRadio.checked = false;

      if (elem2MinInput) elem2MinInput.value = '0';
      if (elem2MaxInput) elem2MaxInput.value = '0';
      if (elem2ExMinInput) elem2ExMinInput.value = '0';
      if (elem2ExMaxInput) elem2ExMaxInput.value = '0';
      if (elem2WeakRadio) elem2WeakRadio.checked = false;
      if (elem2ResRadio) elem2ResRadio.checked = false;

      if (spellMinInput) spellMinInput.value = '0';
      if (spellMaxInput) spellMaxInput.value = '0';
      if (spellExMinInput) spellExMinInput.value = '0';
      if (spellExMaxInput) spellExMaxInput.value = '0';

      const lvl1Radio = document.getElementById('atk-spell-lvl1');
      if (lvl1Radio) lvl1Radio.checked = true;
      for (let i = 2; i <= 4; i++) {
        const radio = document.getElementById(`atk-spell-lvl${i}`);
        if (radio) radio.checked = false;
      }
    }
  }

  // ============================================================
  // SALDIRAN SEÇİMİ — Statlarını ve slotlarını gösterir
  // ============================================================

  function onAttackerChange() {
    // Önceki saldıranın form değerlerini kaydet
    saveAttackerForm();

    selectedAttacker = resolveSelection(attackerSelect?.value);
    if (!selectedAttacker) {
      if (attackerInfo) attackerInfo.innerHTML = '<span class="atk-hint">Saldıran seçilmedi</span>';
      fillSpellSlots(null);
      return;
    }

    // Yeni saldıranın form değerlerini geri yükle
    const key = `${selectedAttacker.type}:${selectedAttacker.id}`;
    restoreAttackerForm(key);

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
   * Ctrl+Click ile haritadan hedef eklenir/kaldırılır (toggle).
   */
  function onCtrlClickTarget(targetInfo, tokenEl) {
    // Zaten seçili mi kontrol et
    const existingIdx = selectedTargets.findIndex(t => t.type === targetInfo.type && t.id === targetInfo.id);

    if (existingIdx >= 0) {
      // Kaldır (toggle off)
      const removed = selectedTargets.splice(existingIdx, 1)[0];
      if (removed.tokenEl) removed.tokenEl.classList.remove('token-target-selected');
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

    selectedTargets.push({
      type: targetInfo.type,
      id: targetInfo.id,
      name: targetInfo.name,
      data: targetInfo.data,
      tokenEl: tokenEl || null
    });

    // Token'a hedef çerçevesi ekle
    if (tokenEl) tokenEl.classList.add('token-target-selected');

    renderSelectedTargets();
  }

  /**
   * Hedef listesinden belirli bir hedefi kaldırır.
   */
  function removeTargetById(type, id) {
    const idx = selectedTargets.findIndex(t => t.type === type && t.id === id);
    if (idx >= 0) {
      const removed = selectedTargets.splice(idx, 1)[0];
      if (removed.tokenEl) removed.tokenEl.classList.remove('token-target-selected');
      renderSelectedTargets();
    }
  }

  /**
   * Tüm hedeflerin token çerçevesini kaldırır.
   */
  function clearAllTargetHighlights() {
    selectedTargets.forEach(t => {
      if (t.tokenEl) t.tokenEl.classList.remove('token-target-selected');
    });
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
            <div class="atk-target-name">🎯 ${isMarker ? '[İşaret] ' : ''}${escapeHtml(d.name)}</div>
            <div class="atk-target-hp">❤️ ${hp} / ${maxHp}</div>
            <div class="atk-target-ac">🛡️ AC: ${ac}</div>
          </div>
        `;
      } else {
        targetInfo.innerHTML = `<span class="atk-hint">🎯 ${selectedTargets.length} hedef seçili — her hedefe ayrı saldırı atılacak</span>`;
      }
    }

    // Chip'leri oluştur
    selectedTargets.forEach(t => {
      const d = t.data;
      const ac = getTargetAC(t);
      const isMarker = t.type === 'marker';
      const hp = isMarker ? (d.hp ?? '?') : (d.hp_current ?? '?');
      const maxHp = isMarker ? (d.maxHp ?? '?') : (d.hp_max ?? '?');

      const chip = document.createElement('div');
      chip.className = 'atk-target-chip';
      chip.innerHTML = `
        <div class="atk-chip-info">
          <span class="atk-chip-name">🎯 ${isMarker ? '[M] ' : ''}${escapeHtml(d.name)}</span>
          <span class="atk-chip-hp">❤️${hp}/${maxHp}</span>
          <span class="atk-chip-ac">🛡️${ac}</span>
        </div>
      `;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'atk-chip-remove';
      removeBtn.textContent = '×';
      removeBtn.title = 'Hedefi kaldır';
      removeBtn.addEventListener('click', () => removeTargetById(t.type, t.id));
      chip.appendChild(removeBtn);

      selectedTargetsList.appendChild(chip);
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

    // Her hedef için ayrı saldırı
    lastAttackResults = [];
    btnPhysicalAttack && (btnPhysicalAttack.disabled = true);
    btnSpellAttack && (btnSpellAttack.disabled = true);

    for (const target of selectedTargets) {
      const targetAC = selectedTargets.length === 1 ? intVal(targetACInput) : getTargetAC(target);

      const body = {
        attackerStats: getAttackerStats(),
        targetAC: targetAC,
        attackType: 'physical',
        advantage: advantageCheck?.checked || false,
        disadvantage: disadvantageCheck?.checked || false,
        attackCount: intVal(attackCountInput) || 1,
        extraDamage: intVal(extraDmgInput),
        physical: {
          min: intVal(physMinInput), max: intVal(physMaxInput),
          extraMin: intVal(physExMinInput), extraMax: intVal(physExMaxInput),
          weakness: physWeakRadio?.checked || false,
          resistance: physResRadio?.checked || false
        },
        element1: {
          min: intVal(elem1MinInput), max: intVal(elem1MaxInput),
          extraMin: intVal(elem1ExMinInput), extraMax: intVal(elem1ExMaxInput),
          weakness: elem1WeakRadio?.checked || false,
          resistance: elem1ResRadio?.checked || false
        },
        element2: {
          min: intVal(elem2MinInput), max: intVal(elem2MaxInput),
          extraMin: intVal(elem2ExMinInput), extraMax: intVal(elem2ExMaxInput),
          weakness: elem2WeakRadio?.checked || false,
          resistance: elem2ResRadio?.checked || false
        }
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

    // Her hedef için ayrı saldırı
    lastAttackResults = [];
    btnPhysicalAttack && (btnPhysicalAttack.disabled = true);
    btnSpellAttack && (btnSpellAttack.disabled = true);

    for (const target of selectedTargets) {
      const targetAC = selectedTargets.length === 1 ? intVal(targetACInput) : getTargetAC(target);

      const body = {
        attackerStats: getAttackerStats(),
        targetAC: targetAC,
        attackType: 'spell',
        advantage: advantageCheck?.checked || false,
        disadvantage: disadvantageCheck?.checked || false,
        attackCount: intVal(attackCountInput) || 1,
        extraDamage: intVal(extraDmgInput),
        spell: {
          min: intVal(spellMinInput), max: intVal(spellMaxInput),
          extraMin: intVal(spellExMinInput), extraMax: intVal(spellExMaxInput),
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

      // Log başlığı: Saldıran → Hedef
      const atkLabel = body.attackType === 'physical' ? '⚔️ FİZİKSEL' : '✨ BÜYÜ';
      const attackerName = escapeHtml(selectedAttacker?.name || '?');
      const targetName = escapeHtml(target.name || '?');
      addCombatLog(
        `<span class="atk-log-header">--- ${atkLabel}: ${attackerName} → ${targetName} (${body.attackCount} Vuruş, AC:${body.targetAC}) ---</span>`,
        'header'
      );

      result.attacks.forEach(atk => {
        if (atk.hit) {
          const critTag = atk.isCritical ? ' <span class="atk-crit">KRİTİK!</span>' : '';
          const typeLabel = body.attackType === 'physical' ? 'Saldırı' : 'Büyü Saldırısı';
          addCombatLog(
            `<span class="atk-log-hit">${atk.index}. ${typeLabel}: <strong>${atk.damage}</strong> Hasar${critTag}</span> <span class="atk-log-roll">(Zar: ${atk.hitRoll} | Toplam: ${atk.modifiedRoll})</span>`,
            atk.isCritical ? 'crit' : 'hit'
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
      if (result.totalDamage > 0) {
        lastAttackResults.push({
          totalDamage: result.totalDamage,
          targetId: target.id,
          targetType: target.type,
          targetName: target.name,
          attackerName: selectedAttacker?.name
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
        const names = lastAttackResults.map(r => escapeHtml(r.targetName)).join(', ');
        btnApplyDamage.textContent = `💀 Tüm Hasarları Uygula (${lastAttackResults.length} hedef, toplam ${totalAll})`;
      }
    }
  }

  /**
   * Son hesaplanan hasarları tüm hedeflere uygular.
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
              damage: attackResult.totalDamage
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
      // Hedef listesini güncelle (HP değişmiş olabilir)
      renderSelectedTargets();
    } catch (err) {
      console.error('Hasar uygulama hatası:', err);
      addCombatLog(`<span class="atk-log-error">HATA: ${escapeHtml(err.message)}</span>`, 'error');
    } finally {
      btnApplyDamage.disabled = false;
    }
  }

  function clearResistances() {
    [physWeakRadio, physResRadio, elem1WeakRadio, elem1ResRadio, elem2WeakRadio, elem2ResRadio].forEach(r => {
      if (r) r.checked = false;
    });
  }

  // === EVENT LISTENERS ===
  attackerSelect?.addEventListener('change', onAttackerChange);
  targetSelect?.addEventListener('change', onTargetChange);
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

  // === SOCKET SENKRONİZASYON ===
  if (typeof socket !== 'undefined') {
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
  }

  setTimeout(loadSelectors, 1000);

})();
