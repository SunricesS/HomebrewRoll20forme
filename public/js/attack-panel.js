// ============================================================
// WebDND — Saldırı Paneli (Attack Panel) Modülü
// DNDWPSV2 WPF saldırı sistemi web portu
//
// İki seçici:
//   1. SALDIRAN — statları vuruş hesabında kullanılır, slotları düşürülür
//   2. HEDEF    — AC'si vuruş kontrolünde kullanılır, hasarı alır
// ============================================================

(function () {
  'use strict';

  // Panel sadece DM için aktif
  if (typeof role === 'undefined' || role !== 'dm') return;

  // === STATE ===
  let selectedAttacker = null; // { type, id, name, data }
  let selectedTarget = null;   // { type, id, name, data }
  let lastAttackResult = null; // { totalDamage, targetId, targetType, targetName, attackerName }
  let allCharactersCache = [];

  // === DOM REFERANSLARI ===
  const panel = document.getElementById('attack-panel-container');
  if (!panel) return;

  const attackerSelect = document.getElementById('atk-attacker-select');
  const attackerInfo = document.getElementById('atk-attacker-info');
  const targetSelect = document.getElementById('atk-target-select');
  const targetInfo = document.getElementById('atk-target-info');
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
  // SALDIRAN SEÇİMİ — Statlarını ve slotlarını gösterir
  // ============================================================

  function onAttackerChange() {
    selectedAttacker = resolveSelection(attackerSelect?.value);
    if (!selectedAttacker) {
      if (attackerInfo) attackerInfo.innerHTML = '<span class="atk-hint">Saldıran seçilmedi</span>';
      fillSpellSlots(null);
      return;
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

  // ============================================================
  // HEDEF SEÇİMİ — AC'sini yükler
  // ============================================================

  function onTargetChange() {
    selectedTarget = resolveSelection(targetSelect?.value);
    if (!selectedTarget) {
      if (targetInfo) targetInfo.innerHTML = '<span class="atk-hint">Hedef seçilmedi</span>';
      targetACInput.value = '10';
      return;
    }

    const d = selectedTarget.data;

    if (selectedTarget.type === 'character') {
      targetACInput.value = (d.ac || 10) + (d.ac_bonus || 0);
      targetInfo.innerHTML = `
        <div class="atk-target-card atk-card-target">
          <div class="atk-target-name">🎯 ${escapeHtml(d.name)}</div>
          <div class="atk-target-hp">❤️ ${d.hp_current ?? '?'} / ${d.hp_max ?? '?'}</div>
          <div class="atk-target-ac">🛡️ AC: ${(d.ac || 10)} + ${(d.ac_bonus || 0)} = ${(d.ac || 10) + (d.ac_bonus || 0)}</div>
        </div>
      `;
    } else {
      targetACInput.value = d.ac || 10;
      targetInfo.innerHTML = `
        <div class="atk-target-card atk-card-target">
          <div class="atk-target-name">🎯 [İşaret] ${escapeHtml(d.name)}</div>
          <div class="atk-target-hp">❤️ ${d.hp ?? '?'} / ${d.maxHp ?? '?'}</div>
          <div class="atk-target-ac">🛡️ AC: ${d.ac || 10}</div>
        </div>
      `;
    }
  }

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
    if (!selectedTarget) { alert('Lütfen bir HEDEF seçin!'); return; }

    const body = {
      attackerStats: getAttackerStats(),
      targetAC: intVal(targetACInput),
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

    await sendAttack(body);
  }

  async function performSpellAttack() {
    if (!selectedAttacker) { alert('Lütfen bir SALDIRAN seçin!'); return; }
    if (!selectedTarget) { alert('Lütfen bir HEDEF seçin!'); return; }

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

    const body = {
      attackerStats: getAttackerStats(),
      targetAC: intVal(targetACInput),
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

    await sendAttack(body);

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
   * Sunucuya saldırı isteği gönderir ve sonucu loglar
   */
  async function sendAttack(body) {
    try {
      btnPhysicalAttack && (btnPhysicalAttack.disabled = true);
      btnSpellAttack && (btnSpellAttack.disabled = true);

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
      const targetName = escapeHtml(selectedTarget?.name || '?');
      addCombatLog(
        `<span class="atk-log-header">--- ${atkLabel}: ${attackerName} → ${targetName} (${body.attackCount} Vuruş) ---</span>`,
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

      addCombatLog(`<span class="atk-log-total">=== TOPLAM HASAR: ${result.totalDamage} ===</span>`, 'total');

      // Son sonucu sakla (hasarı HEDEFE uygula butonu için)
      lastAttackResult = {
        totalDamage: result.totalDamage,
        targetId: selectedTarget?.id,
        targetType: selectedTarget?.type,
        targetName: selectedTarget?.name,
        attackerName: selectedAttacker?.name
      };

      if (btnApplyDamage && result.totalDamage > 0) {
        btnApplyDamage.classList.remove('hidden');
        btnApplyDamage.textContent = `💀 ${result.totalDamage} Hasar Uygula → ${escapeHtml(selectedTarget?.name || '?')}`;
      }

    } catch (err) {
      console.error('Saldırı hatası:', err);
      addCombatLog(`<span class="atk-log-error">HATA: ${escapeHtml(err.message)}</span>`, 'error');
    } finally {
      btnPhysicalAttack && (btnPhysicalAttack.disabled = false);
      btnSpellAttack && (btnSpellAttack.disabled = false);
    }
  }

  /**
   * Son hesaplanan hasarı HEDEFE uygular
   */
  async function applyDamage() {
    if (!lastAttackResult || lastAttackResult.totalDamage <= 0) {
      alert('Uygulanacak hasar yok!');
      return;
    }

    try {
      btnApplyDamage.disabled = true;
      btnApplyDamage.textContent = 'Uygulanıyor...';

      const res = await fetch('/api/combat/apply-damage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType: lastAttackResult.targetType,
          targetId: lastAttackResult.targetId,
          damage: lastAttackResult.totalDamage
        })
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Bilinmeyen hata');

      addCombatLog(
        `<span class="atk-log-apply">💀 ${lastAttackResult.totalDamage} hasar uygulandı → ${escapeHtml(lastAttackResult.targetName)}. Yeni HP: ${result.newHp}</span>`,
        'apply'
      );

      lastAttackResult = null;
      btnApplyDamage.classList.add('hidden');

      // Seçicileri yenile
      await loadSelectors();
      if (selectedAttacker) { attackerSelect.value = `${selectedAttacker.type}:${selectedAttacker.id}`; onAttackerChange(); }
      if (selectedTarget) { targetSelect.value = `${selectedTarget.type}:${selectedTarget.id}`; onTargetChange(); }
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
      if (selectedTarget) setTimeout(onTargetChange, 300);
    });
  }

  setTimeout(loadSelectors, 1000);

})();
