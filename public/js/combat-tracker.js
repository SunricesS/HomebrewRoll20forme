// ============================================================
// WebDND — Baldur's Gate 3 Tarzı Combat & İnisiyatif Takip Modülü
// ============================================================

(function () {
  'use strict';

  // === STATE ===
  let combatState = {
    active: false,
    round: 1,
    currentTurnIndex: 0,
    combatants: []
  };

  // === DOM ELEMENTLERİ ===
  const container = document.getElementById('bg3-combat-bar-container');
  const cardsTrack = document.getElementById('bg3-cards-track');
  const cardsWrapper = document.getElementById('bg3-cards-wrapper');
  const roundDisplay = document.getElementById('bg3-round-display');
  const btnPrev = document.getElementById('bg3-btn-prev');
  const btnNext = document.getElementById('bg3-btn-next');
  const btnReroll = document.getElementById('bg3-btn-reroll');
  const btnClose = document.getElementById('bg3-btn-close');

  const floatingBtn = document.getElementById('combat-mode-toggle-btn');
  const floatingBtnBadge = document.getElementById('combat-btn-status-badge');
  const dmCombatBtn = document.getElementById('btn-dm-toggle-combat');
  const gameMap = document.getElementById('game-map');

  if (!container || !cardsTrack) {
    console.warn('BG3 Combat Bar elementleri bulunamadı.');
    return;
  }

  // === YARDIMCI FONKSİYONLAR ===

  function escapeHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatEffectDescription(effRules) {
    if (!effRules) return '';
    const parts = [];
    if (effRules.dotDamage) {
      parts.push(`Tur sonu ${effRules.dotDamage.min}-${effRules.dotDamage.max} hasar`);
    }
    if (effRules.blind) {
      parts.push('Kendi saldırıları dezavantajlı');
    }
    if (effRules.paralyzed) {
      parts.push('Gelen saldırılar kesin vuruş & kritik');
    }
    if (effRules.shelter) {
      parts.push('Hasar almaz (Dokunulmaz)');
    }
    if (effRules.prepared) {
      parts.push('Gelen saldırılar dezavantajlı');
    }
    if (effRules.unstoppable) {
      parts.push('Felç bağışıklığı');
    }
    return parts.join(', ') || 'Özel Efekt';
  }

  /**
   * Haritadaki belirli bir token'a yumuşakça odaklanır ve vurgu efekti uygular.
   */
  function focusTokenOnMap(tokenId) {
    if (typeof tokens === 'undefined') return;
    const tokenEl = tokens[tokenId];
    if (!tokenEl || !gameMap) return;

    // Token pozisyonu
    const tokenLeft = parseFloat(tokenEl.style.left) || tokenEl.offsetLeft || 0;
    const tokenTop = parseFloat(tokenEl.style.top) || tokenEl.offsetTop || 0;
    const mapWidth = gameMap.clientWidth;
    const mapHeight = gameMap.clientHeight;

    // Haritayı token ortalayacak şekilde scroll et
    gameMap.scrollTo({
      left: Math.max(0, tokenLeft - mapWidth / 2 + 30),
      top: Math.max(0, tokenTop - mapHeight / 2 + 30),
      behavior: 'smooth'
    });

    // Ping animasyonu
    tokenEl.classList.remove('combat-ping-pulse');
    void tokenEl.offsetWidth; // Reflow
    tokenEl.classList.add('combat-ping-pulse');
    setTimeout(() => {
      tokenEl.classList.remove('combat-ping-pulse');
    }, 1800);
  }

  /**
   * Haritadaki tüm tokenlar arasından sadece aktif sıradakine tur vurgusu halkası ekler.
   */
  function updateMapActiveTokenHighlight(activeCombatantId) {
    // Önceki tüm aktif halkaları temizle
    document.querySelectorAll('.combat-active-token').forEach(el => {
      el.classList.remove('combat-active-token');
    });

    if (!combatState.active || !activeCombatantId) return;

    const idStr = String(activeCombatantId);
    let activeEl = null;

    if (typeof tokens !== 'undefined') {
      if (tokens[activeCombatantId]) activeEl = tokens[activeCombatantId];
      else if (tokens[idStr]) activeEl = tokens[idStr];
      else if (typeof allPlayers !== 'undefined') {
        const p = Object.values(allPlayers).find(p => {
          if (p.character && String(p.character.id) === idStr) return true;
          if (String(p.id) === idStr) return true;
          return false;
        });
        if (p && tokens[p.id]) activeEl = tokens[p.id];
      }
    }

    if (!activeEl) {
      activeEl = document.querySelector(`.token[data-id="${idStr}"]`) ||
                 document.querySelector(`.token[data-character-id="${idStr}"]`);
    }

    if (activeEl) {
      activeEl.classList.add('combat-active-token');
    }
  }

  // === RENDER İŞLEMLERİ ===

  let lastSyncedAttackerTurnKey = null;

  /**
   * BG3 İnisiyatif Barını ve Kartlarını Çizer
   */
  function renderCombatBar() {
    if (!combatState.active || !combatState.combatants || combatState.combatants.length === 0) {
      container.classList.add('hidden');
      if (floatingBtn) floatingBtn.classList.remove('active');
      if (floatingBtnBadge) floatingBtnBadge.classList.add('hidden');
      if (dmCombatBtn) dmCombatBtn.classList.remove('active');
      updateMapActiveTokenHighlight(null);
      lastSyncedAttackerTurnKey = null;
      return;
    }

    // Barı göster
    container.classList.remove('hidden');
    if (floatingBtn) floatingBtn.classList.add('active');
    if (floatingBtnBadge) {
      floatingBtnBadge.classList.remove('hidden');
      floatingBtnBadge.textContent = `Tur ${combatState.round}`;
    }
    if (dmCombatBtn) dmCombatBtn.classList.add('active');

    // Tur sayacı
    if (roundDisplay) {
      roundDisplay.textContent = `Tur ${combatState.round}`;
    }

    // Kartları temizle
    cardsTrack.innerHTML = '';

    const activeIdx = combatState.currentTurnIndex;
    const activeCombatant = combatState.combatants[activeIdx] || null;

    if (activeCombatant) {
      updateMapActiveTokenHighlight(activeCombatant.id);

      // Turu olan tokeni otomatik olarak DM saldırı panelinde "Saldıran" olarak seç ve önceki hedefleri temizle
      const currentTurnKey = `${combatState.round}:${activeIdx}:${activeCombatant.id}`;
      if (lastSyncedAttackerTurnKey !== currentTurnKey) {
        lastSyncedAttackerTurnKey = currentTurnKey;
        if (typeof role !== 'undefined' && role === 'dm' && typeof window.__webdnd_onCombatTurnActive === 'function') {
          window.__webdnd_onCombatTurnActive(activeCombatant);
        }
      }
    } else {
      lastSyncedAttackerTurnKey = null;
    }

    combatState.combatants.forEach((c, idx) => {
      const isActive = idx === activeIdx;
      const isDead = Boolean(c.isDead || (c.hpCurrent !== null && c.hpCurrent <= 0));

      const card = document.createElement('div');
      card.className = 'bg3-combat-card';
      card.dataset.id = c.id;
      card.dataset.index = idx;

      if (isActive) {
        card.classList.add('active-turn');
      }
      if (isDead) {
        card.classList.add('is-dead');
      }

      // Tip / Rol Sınıfları
      if (c.isMarker) {
        card.classList.add('card-enemy');
      } else if (c.role === 'dm') {
        card.classList.add('card-dm');
      } else {
        card.classList.add('card-player');
      }

      // Border rengini token rengine uyarla
      if (c.color) {
        card.style.setProperty('--token-theme-color', c.color);
      }

      // 1. Portre / Görsel Alanı
      const portraitWrap = document.createElement('div');
      portraitWrap.className = 'bg3-card-portrait-wrap';

      if (c.imgUrl) {
        const img = document.createElement('img');
        img.className = 'bg3-card-avatar';
        img.src = c.imgUrl;
        img.alt = c.name;
        img.loading = 'lazy';
        img.onerror = () => {
          img.style.display = 'none';
          const initSpan = document.createElement('span');
          initSpan.className = 'bg3-card-initial-fallback';
          initSpan.textContent = (c.name || '?').charAt(0).toUpperCase();
          portraitWrap.appendChild(initSpan);
        };
        portraitWrap.appendChild(img);
      } else {
        const initial = document.createElement('div');
        initial.className = 'bg3-card-initial';
        initial.style.backgroundColor = c.color || '#3498db';
        initial.textContent = (c.name || '?').charAt(0).toUpperCase();
        portraitWrap.appendChild(initial);
      }

      // 2. Ölüm Katmanı (Dead overlay)
      if (isDead) {
        const deathOverlay = document.createElement('div');
        deathOverlay.className = 'bg3-card-death-overlay';
        deathOverlay.innerHTML = '<span class="bg3-death-skull">💀</span>';
        portraitWrap.appendChild(deathOverlay);
      }

      // 3. İnisiyatif Rozeti (Zar sonucu - Mouse hover ile gözükür)
      const initBadge = document.createElement('div');
      initBadge.className = 'bg3-card-init-badge';
      const modSign = c.chrMod >= 0 ? `+${c.chrMod}` : `${c.chrMod}`;
      initBadge.title = `İnisiyatif: 1d20(${c.roll || 0}) + CHR Mod(${modSign}) = ${c.total || 0}\nCHR Stat: ${c.chrStat || 10} (+${c.chrBonus || 0})`;
      initBadge.innerHTML = `<span class="bg3-badge-val">${c.total || 0}</span>`;
      portraitWrap.appendChild(initBadge);

      // 4. Mini HP Barı
      if (c.hpCurrent != null && c.hpMax != null && c.hpMax > 0) {
        const hpBarContainer = document.createElement('div');
        hpBarContainer.className = 'bg3-card-hp-track';
        const hpPercent = Math.min(100, Math.max(0, (c.hpCurrent / c.hpMax) * 100));
        
        let hpColor = '#22c55e'; // Yeşil
        if (hpPercent <= 25) hpColor = '#ef4444'; // Kırmızı
        else if (hpPercent <= 50) hpColor = '#f59e0b'; // Sarı

        hpBarContainer.innerHTML = `
          <div class="bg3-card-hp-fill" style="width: ${hpPercent}%; background-color: ${hpColor};"></div>
          <span class="bg3-card-hp-text">${c.hpCurrent}/${c.hpMax}</span>
        `;
        portraitWrap.appendChild(hpBarContainer);
      }

      // 4.5. Aktif Durum Efektleri Şeridi (Status Strip)
      if (c.activeEffects && c.activeEffects.length > 0) {
        const statusStrip = document.createElement('div');
        statusStrip.className = 'bg3-card-status-strip';
        c.activeEffects.forEach(eff => {
          const chip = document.createElement('span');
          chip.className = 'bg3-status-chip';
          const durText = eff.duration != null ? `${eff.duration}T` : '∞';
          const desc = formatEffectDescription(eff.effects);
          chip.title = `${eff.icon || '✨'} ${eff.name} (${durText}): ${desc}\n(DM: Sağ tık ile kaldır)`;
          chip.innerHTML = `
            <span class="status-chip-icon">${eff.icon || '✨'}</span>
            <span class="status-chip-dur">${durText}</span>
          `;

          // DM sağ tık ile efekti silebilir
          chip.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (typeof role !== 'undefined' && role === 'dm' && typeof socket !== 'undefined') {
              const targetType = c.isMarker ? 'marker' : 'character';
              const targetId = c.isMarker ? c.id : (c.characterId || c.id);
              socket.emit('removeStatusEffect', { targetType, targetId, effectId: eff.id });
            }
          });

          statusStrip.appendChild(chip);
        });
        portraitWrap.appendChild(statusStrip);
      }

      card.appendChild(portraitWrap);

      // 5. Karakter Adı Etiketi
      const nameLabel = document.createElement('div');
      nameLabel.className = 'bg3-card-name-label';
      nameLabel.textContent = c.name || 'Bilinmiyor';
      nameLabel.title = c.name || 'Bilinmiyor';
      card.appendChild(nameLabel);

      // 6. Aktif Sıra Banner'ı (Görseldeki "Za'krug" gibi alt banner)
      if (isActive) {
        const activeBanner = document.createElement('div');
        activeBanner.className = 'bg3-active-name-banner';
        activeBanner.innerHTML = `<span class="bg3-active-name-text">${escapeHtml(c.name)}</span>`;
        card.appendChild(activeBanner);
      }

      // Tıklama Olayı: Haritada tokene git / DM ise sırayı geçir
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        focusTokenOnMap(c.id);

        if (typeof role !== 'undefined' && role === 'dm') {
          if (typeof window.__webdnd_onCombatTurnActive === 'function') {
            window.__webdnd_onCombatTurnActive(c);
          }
          if (idx !== combatState.currentTurnIndex && typeof socket !== 'undefined') {
            socket.emit('setCombatTurn', idx);
          }
        }
      });

      cardsTrack.appendChild(card);
    });

    // Kartların çizimi tamamlandı
  }

  // === SOCKET DINLEYICILERI ===

  if (typeof socket !== 'undefined') {
    socket.on('combatStateUpdated', (state) => {
      if (!state) return;
      combatState = state;
      renderCombatBar();
    });

    socket.on('combatStarted', (data) => {
      if (typeof addLogHtml === 'function') {
        addLogHtml('<span style="color:var(--gold, #fbbf24); font-weight:700;">⚔️ Savaş Modu Başladı! İnisiyatif zarları atıldı.</span>');
      }
    });

    socket.on('combatEnded', () => {
      updateMapActiveTokenHighlight(null);
      if (typeof window.__webdnd_clearTargets === 'function') {
        window.__webdnd_clearTargets();
      }
      if (typeof addLogHtml === 'function') {
        addLogHtml('<span style="color:var(--text-muted, #94a3b8);">🏳️ Savaş Modu Sonlandırıldı.</span>');
      }
    });
  }

  // === BUTON ETKİLEŞİMLERİ ===

  // 1. Sol Alt Floating Buton
  if (floatingBtn) {
    floatingBtn.addEventListener('click', () => {
      if (typeof socket !== 'undefined') {
        socket.emit('toggleCombat');
      }
    });
  }

  // 2. DM Tools Butonu
  if (dmCombatBtn) {
    dmCombatBtn.addEventListener('click', () => {
      if (typeof socket !== 'undefined') {
        socket.emit('toggleCombat');
      }
    });
  }

  // 3. Sonraki Tur (Next Turn)
  if (btnNext) {
    btnNext.addEventListener('click', () => {
      if (typeof socket !== 'undefined') {
        socket.emit('nextCombatTurn');
      }
    });
  }

  // 4. Önceki Tur (Prev Turn)
  if (btnPrev) {
    btnPrev.addEventListener('click', () => {
      if (typeof socket !== 'undefined') {
        socket.emit('prevCombatTurn');
      }
    });
  }

  // 5. Zarları Yeniden At (Reroll)
  if (btnReroll) {
    btnReroll.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof socket !== 'undefined') {
        socket.emit('rerollCombatInitiative');
      }
    });
  }

  // 6. Savaştan Çık / Kapat (Close)
  if (btnClose) {
    btnClose.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof socket !== 'undefined') {
        socket.emit('endCombat');
      }
    });
  }

  // 7. Status Efektleri Butonu
  const btnStatus = document.getElementById('bg3-btn-status');
  if (btnStatus) {
    btnStatus.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof window.__webdnd_openStatusToolbox === 'function') {
        window.__webdnd_openStatusToolbox();
      }
    });
  }

  // === KLAVYE KISAYOLLARI ===
  window.addEventListener('keydown', (e) => {
    // Input, textarea veya contenteditable içindeyken kısayolları devre dışı bırak
    const activeTag = document.activeElement?.tagName?.toLowerCase();
    if (activeTag === 'input' || activeTag === 'textarea' || document.activeElement?.isContentEditable) {
      return;
    }

    // 'C' veya 'c' -> Combat Modu Aç / Kapat
    if (e.key === 'c' || e.key === 'C') {
      if (typeof socket !== 'undefined') {
        socket.emit('toggleCombat');
      }
    }

    // 'Space' veya 'N' veya 'n' -> Savaş aktifse Sonraki Tur
    if (combatState.active && (e.key === 'n' || e.key === 'N' || e.key === ' ')) {
      e.preventDefault();
      if (typeof socket !== 'undefined') {
        socket.emit('nextCombatTurn');
      }
    }
  });

  // İlk yüklemede durum sorgula
  if (typeof socket !== 'undefined') {
    socket.emit('getCombatState');
  }

  console.log('BG3 Combat Tracker modülü yüklendi.');
})();
