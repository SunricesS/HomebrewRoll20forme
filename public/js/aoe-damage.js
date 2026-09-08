// ============================================================
// WebDND — DM Daire Alan Hasarı (AoE Damage) Modülü
// ============================================================

(function () {
  'use strict';

  // === STATE ===
  let isAoeModeActive = false;
  let isDraggingCircle = false;
  let aoeCenter = { x: 0, y: 0 };
  let aoeRadius = 0;
  let detectedTargets = []; // [{ type: 'character'|'marker', id, name, hp, maxHp, imgUrl, color, excluded: false }]
  let currentCombatActive = false;

  // === DOM ELEMENTLERİ ===
  const dmAoeBtn = document.getElementById('dm-aoe-damage-btn');
  const targetingLayer = document.getElementById('aoe-targeting-layer');
  const svgCircle = document.getElementById('aoe-svg-circle');
  const svgCenterDot = document.getElementById('aoe-svg-center-dot');
  const svgRadiusLine = document.getElementById('aoe-svg-radius-line');
  const radiusBadge = document.getElementById('aoe-radius-badge');

  const aoeModal = document.getElementById('dm-aoe-modal');
  const btnCloseModal = document.getElementById('btn-close-aoe-modal');
  const btnCancelAoe = document.getElementById('btn-cancel-aoe');
  const btnReselectAoe = document.getElementById('btn-aoe-reselect');
  const btnSubmitAoe = document.getElementById('btn-submit-aoe-damage');
  const damageInput = document.getElementById('aoe-damage-amount');
  const targetsListContainer = document.getElementById('aoe-modal-targets-list');
  const radiusInfoSpan = document.getElementById('aoe-modal-radius-info');
  const targetsCountSpan = document.getElementById('aoe-modal-targets-count');

  const gameMap = document.getElementById('map-content');
  const gameMapContainer = document.getElementById('game-map');

  // === YARDIMCI FONKSİYONLAR ===

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Fare pozisyonunu map-content koordinat sistemine dönüştürür.
   */
  function getMapCoordinates(e) {
    if (!gameMap) return { x: 0, y: 0 };
    const rect = gameMap.getBoundingClientRect();
    return {
      x: Math.round(e.clientX - rect.left),
      y: Math.round(e.clientY - rect.top)
    };
  }

  /**
   * Combat durumu ve DM rolüne göre sol alt buton görünürlüğünü günceller.
   */
  function updateAoeBtnVisibility(combatActive) {
    currentCombatActive = Boolean(combatActive);
    if (!dmAoeBtn) return;

    if (currentCombatActive && typeof role !== 'undefined' && role === 'dm') {
      dmAoeBtn.classList.remove('hidden');
    } else {
      dmAoeBtn.classList.add('hidden');
      if (isAoeModeActive) {
        cancelAoeMode();
      }
    }
  }

  /**
   * Haritadaki tüm tokenların AoE çemberi içinde kalıp kalmadığını kontrol eder.
   */
  function detectTokensInAoe(cx, cy, r) {
    const inside = [];
    if (!gameMap) return inside;

    // Haritadaki tüm .token DOM elemanlarını tara
    const tokenElements = gameMap.querySelectorAll('.token');

    tokenElements.forEach(tokenEl => {
      const tokenId = tokenEl.dataset.id;
      if (!tokenId) return;

      const tokenLeft = parseFloat(tokenEl.style.left) || tokenEl.offsetLeft || 0;
      const tokenTop = parseFloat(tokenEl.style.top) || tokenEl.offsetTop || 0;
      const tokenSize = tokenEl.offsetWidth || 50;

      // Token merkez noktası
      const tokenCx = tokenLeft + tokenSize / 2;
      const tokenCy = tokenTop + tokenSize / 2;

      // Merkezler arası mesafe
      const dist = Math.hypot(tokenCx - cx, tokenCy - cy);
      const tokenRadius = tokenSize / 2;

      // Token çemberle kesişiyor veya içinde mi?
      const isInside = dist <= (r + tokenRadius * 0.7);

      if (isInside) {
        tokenEl.classList.add('token-aoe-targeted');

        // Token verisini çöz
        let targetData = null;

        // 1. Marker mı?
        if (window.__webdnd_markers && window.__webdnd_markers[tokenId]) {
          const m = window.__webdnd_markers[tokenId];
          targetData = {
            type: 'marker',
            id: m.id,
            name: m.name || 'İşaret',
            hp: m.hp,
            maxHp: m.maxHp,
            imgUrl: m.imgUrl || null,
            color: m.color || '#e74c3c'
          };
        }
        // 2. Oyuncu karakteri mi?
        else if (typeof allPlayers !== 'undefined' && allPlayers[tokenId]) {
          const p = allPlayers[tokenId];
          if (p.character) {
            targetData = {
              type: 'character',
              id: p.character.id,
              playerId: p.id,
              name: p.character.name || 'Oyuncu',
              hp: p.character.hp_current,
              maxHp: p.character.hp_max,
              imgUrl: p.character.avatar_url || p.imgUrl || null,
              color: p.color || '#3498db'
            };
          }
        }

        if (targetData) {
          inside.push(targetData);
        }
      } else {
        tokenEl.classList.remove('token-aoe-targeted');
      }
    });

    return inside;
  }

  /**
   * Tüm tokenlardan hedefleme vurgusunu temizler.
   */
  function clearTargetHighlights() {
    if (!gameMap) return;
    gameMap.querySelectorAll('.token-aoe-targeted').forEach(el => {
      el.classList.remove('token-aoe-targeted');
    });
  }

  // === ALAN SEÇİM MODU (TARGETING MODE) ===

  function startAoeSelection() {
    if (typeof role === 'undefined' || role !== 'dm') return;
    if (!currentCombatActive) {
      if (typeof addLog === 'function') {
        addLog('⚠️ Alan hasarı sadece Savaş (Combat) Modu aktifken kullanılabilir.', '#e5c158');
      }
      return;
    }

    isAoeModeActive = true;
    isDraggingCircle = false;
    aoeRadius = 0;
    detectedTargets = [];

    if (dmAoeBtn) {
      dmAoeBtn.classList.add('active');
    }

    if (targetingLayer) {
      targetingLayer.classList.remove('hidden');
      targetingLayer.classList.add('active');
    }

    // SVG elementlerini sıfırla
    if (svgCircle) svgCircle.classList.add('hidden');
    if (svgCenterDot) svgCenterDot.classList.add('hidden');
    if (svgRadiusLine) svgRadiusLine.classList.add('hidden');
    if (radiusBadge) radiusBadge.classList.add('hidden');

    clearTargetHighlights();

    if (typeof addLog === 'function') {
      addLog('🎯 Alan Hasarı Modu: Haritada merkeze tıklayıp sürükleyerek yarıçapı belirleyin. [İptal: ESC]', '#f59e0b');
    }
  }

  function cancelAoeMode() {
    isAoeModeActive = false;
    isDraggingCircle = false;
    aoeRadius = 0;
    detectedTargets = [];

    if (dmAoeBtn) {
      dmAoeBtn.classList.remove('active');
    }

    if (targetingLayer) {
      targetingLayer.classList.remove('active');
      targetingLayer.classList.add('hidden');
    }

    if (svgCircle) svgCircle.classList.add('hidden');
    if (svgCenterDot) svgCenterDot.classList.add('hidden');
    if (svgRadiusLine) svgRadiusLine.classList.add('hidden');
    if (radiusBadge) radiusBadge.classList.add('hidden');

    clearTargetHighlights();
    closeAoeModal();
  }

  // === MOUSE ETKİLEŞİMLERİ ===

  if (targetingLayer) {
    targetingLayer.addEventListener('mousedown', (e) => {
      if (!isAoeModeActive || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      isDraggingCircle = true;
      aoeCenter = getMapCoordinates(e);
      aoeRadius = 0;

      // SVG Çemberini başlat
      if (svgCenterDot) {
        svgCenterDot.setAttribute('cx', aoeCenter.x);
        svgCenterDot.setAttribute('cy', aoeCenter.y);
        svgCenterDot.classList.remove('hidden');
      }

      if (svgCircle) {
        svgCircle.setAttribute('cx', aoeCenter.x);
        svgCircle.setAttribute('cy', aoeCenter.y);
        svgCircle.setAttribute('r', '0');
        svgCircle.classList.remove('hidden');
      }

      if (svgRadiusLine) {
        svgRadiusLine.setAttribute('x1', aoeCenter.x);
        svgRadiusLine.setAttribute('y1', aoeCenter.y);
        svgRadiusLine.setAttribute('x2', aoeCenter.x);
        svgRadiusLine.setAttribute('y2', aoeCenter.y);
        svgRadiusLine.classList.remove('hidden');
      }

      if (radiusBadge) {
        radiusBadge.style.left = aoeCenter.x + 'px';
        radiusBadge.style.top = aoeCenter.y + 'px';
        radiusBadge.textContent = '0 px';
        radiusBadge.classList.remove('hidden');
      }
    });

    targetingLayer.addEventListener('mousemove', (e) => {
      if (!isAoeModeActive || !isDraggingCircle) return;
      e.preventDefault();

      const currentPos = getMapCoordinates(e);
      const dist = Math.round(Math.hypot(currentPos.x - aoeCenter.x, currentPos.y - aoeCenter.y));
      aoeRadius = Math.max(15, dist);

      // SVG Güncelle
      if (svgCircle) {
        svgCircle.setAttribute('r', aoeRadius);
      }

      if (svgRadiusLine) {
        svgRadiusLine.setAttribute('x2', currentPos.x);
        svgRadiusLine.setAttribute('y2', currentPos.y);
      }

      if (radiusBadge) {
        radiusBadge.style.left = currentPos.x + 'px';
        radiusBadge.style.top = currentPos.y + 'px';
        const feet = Math.round((aoeRadius / 50) * 5);
        radiusBadge.textContent = `${aoeRadius} px (~${feet} ft)`;
      }

      // Alandaki hedefleri anlık tespit et ve parlat
      detectedTargets = detectTokensInAoe(aoeCenter.x, aoeCenter.y, aoeRadius);
    });

    targetingLayer.addEventListener('mouseup', (e) => {
      if (!isAoeModeActive || !isDraggingCircle) return;
      e.preventDefault();
      e.stopPropagation();

      isDraggingCircle = false;

      // Eğer çok küçük bir tıklama yapıldıysa varsayılan 90px (~10ft) yarıçap ver
      if (aoeRadius < 25) {
        aoeRadius = 90;
        if (svgCircle) svgCircle.setAttribute('r', aoeRadius);
        if (svgRadiusLine) {
          svgRadiusLine.setAttribute('x2', aoeCenter.x + aoeRadius);
          svgRadiusLine.setAttribute('y2', aoeCenter.y);
        }
        if (radiusBadge) {
          radiusBadge.style.left = (aoeCenter.x + aoeRadius) + 'px';
          radiusBadge.style.top = aoeCenter.y + 'px';
          radiusBadge.textContent = `${aoeRadius} px (~10 ft)`;
        }
      }

      // Nihai hedef tespiti
      detectedTargets = detectTokensInAoe(aoeCenter.x, aoeCenter.y, aoeRadius);

      // Hedefleme katmanının tıklamalarını kapat ve hasar modalını aç
      targetingLayer.classList.remove('active');
      openAoeModal();
    });
  }

  // === HASAR MODALI YÖNETİMİ ===

  function openAoeModal() {
    if (!aoeModal) return;

    // Yarıçap ve hedef sayısı bilgileri
    const feet = Math.round((aoeRadius / 50) * 5);
    if (radiusInfoSpan) {
      radiusInfoSpan.textContent = `Seçilen Alan: Yarıçap ${aoeRadius} px (~${feet} ft)`;
    }
    if (targetsCountSpan) {
      targetsCountSpan.textContent = `${detectedTargets.length} Hedef Kapsandı`;
    }

    // Hedef listesini çiz
    renderAoeTargetsList();

    // Hasar kutusunu sıfırla ve odakla
    if (damageInput) {
      damageInput.value = '';
    }

    aoeModal.classList.remove('hidden');

    setTimeout(() => {
      if (damageInput) damageInput.focus();
    }, 100);
  }

  function closeAoeModal() {
    if (aoeModal) {
      aoeModal.classList.add('hidden');
    }
  }

  function renderAoeTargetsList() {
    if (!targetsListContainer) return;
    targetsListContainer.innerHTML = '';

    if (!detectedTargets || detectedTargets.length === 0) {
      targetsListContainer.innerHTML = `
        <div style="padding: 12px; text-align: center; color: #94a3b8; font-size: 12px;">
          ⚠️ Seçilen alanda hiçbir token veya hedef bulunamadı.
        </div>
      `;
      return;
    }

    detectedTargets.forEach((target, index) => {
      const item = document.createElement('label');
      item.className = 'aoe-target-item';
      if (target.excluded) item.classList.add('excluded');

      // Checkbox
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !target.excluded;
      checkbox.style.accentColor = '#ef4444';
      checkbox.style.cursor = 'pointer';

      checkbox.addEventListener('change', () => {
        target.excluded = !checkbox.checked;
        if (target.excluded) {
          item.classList.add('excluded');
        } else {
          item.classList.remove('excluded');
        }
      });

      // Görsel / Avatar
      let avatarEl;
      if (target.imgUrl) {
        avatarEl = document.createElement('img');
        avatarEl.className = 'aoe-target-avatar';
        avatarEl.src = target.imgUrl;
        avatarEl.alt = target.name;
        avatarEl.onerror = () => {
          avatarEl.style.display = 'none';
          const fallback = document.createElement('div');
          fallback.className = 'aoe-target-initial';
          fallback.style.backgroundColor = target.color || '#e74c3c';
          fallback.textContent = (target.name || '?').charAt(0).toUpperCase();
          item.insertBefore(fallback, item.children[1]);
        };
      } else {
        avatarEl = document.createElement('div');
        avatarEl.className = 'aoe-target-initial';
        avatarEl.style.backgroundColor = target.color || '#e74c3c';
        avatarEl.textContent = (target.name || '?').charAt(0).toUpperCase();
      }

      // Bilgi
      const infoDiv = document.createElement('div');
      infoDiv.className = 'aoe-target-info';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'aoe-target-name';
      nameSpan.textContent = target.name;
      nameSpan.title = target.name;

      const hpSpan = document.createElement('span');
      hpSpan.className = 'aoe-target-hp';
      if (target.hp != null && target.maxHp != null) {
        hpSpan.textContent = `HP: ${target.hp}/${target.maxHp}`;
      } else if (target.hp != null) {
        hpSpan.textContent = `HP: ${target.hp}`;
      } else {
        hpSpan.textContent = 'HP: --';
      }

      infoDiv.appendChild(nameSpan);
      infoDiv.appendChild(hpSpan);

      item.appendChild(checkbox);
      item.appendChild(avatarEl);
      item.appendChild(infoDiv);

      targetsListContainer.appendChild(item);
    });
  }

  // === HASARI UYGULA & SUNUCUYA İLET ===

  async function submitAoeDamage() {
    if (!damageInput) return;

    const rawDmg = parseInt(damageInput.value, 10);
    if (isNaN(rawDmg) || rawDmg <= 0) {
      damageInput.focus();
      damageInput.style.borderColor = '#ff0000';
      setTimeout(() => { damageInput.style.borderColor = ''; }, 1500);
      return;
    }

    // Hariç tutulmamış hedefleri filtrele
    const validTargets = detectedTargets.filter(t => !t.excluded);
    if (validTargets.length === 0) {
      alert('Seçilen alanda hasar uygulanacak en az bir hedef seçili olmalıdır.');
      return;
    }

    if (btnSubmitAoe) {
      btnSubmitAoe.disabled = true;
      btnSubmitAoe.textContent = 'Patlatılıyor...';
    }

    try {
      if (typeof socket !== 'undefined') {
        socket.emit('applyAoEDamage', {
          damage: rawDmg,
          targets: validTargets.map(t => ({
            type: t.type,
            id: t.id,
            name: t.name
          })),
          aoeInfo: {
            x: aoeCenter.x,
            y: aoeCenter.y,
            radius: aoeRadius
          }
        });
      }

      // Modalı kapat ve seçimi temizle
      cancelAoeMode();
    } catch (err) {
      console.error('AoE hasar gönderim hatası:', err);
    } finally {
      if (btnSubmitAoe) {
        btnSubmitAoe.disabled = false;
        btnSubmitAoe.textContent = '🔥 Hasarı Uygula';
      }
    }
  }

  // === GÖRSEL PATLAMA VE FLOATING HASAR EFEKTLERİ ===

  function showAoeVisualEffects(aoeInfo, damage, affectedTargets) {
    if (!gameMap) return;

    // 1. Daire Alan Patlama Dalgası
    if (aoeInfo && aoeInfo.x != null && aoeInfo.y != null && aoeInfo.radius) {
      const burst = document.createElement('div');
      burst.className = 'aoe-explosion-burst';
      const diameter = aoeInfo.radius * 2;
      burst.style.left = `${aoeInfo.x - aoeInfo.radius}px`;
      burst.style.top = `${aoeInfo.y - aoeInfo.radius}px`;
      burst.style.width = `${diameter}px`;
      burst.style.height = `${diameter}px`;

      gameMap.appendChild(burst);
      setTimeout(() => burst.remove(), 1300);
    }

    // 2. Etkilenen her token üzerinde uçuşan kırmızı hasar metni (-Hasar)
    if (Array.isArray(affectedTargets)) {
      affectedTargets.forEach(at => {
        let tokenEl = null;

        if (typeof tokens !== 'undefined') {
          if (tokens[at.id]) tokenEl = tokens[at.id];
          else if (at.type === 'character' && typeof allPlayers !== 'undefined') {
            const p = Object.values(allPlayers).find(pl => pl.character && String(pl.character.id) === String(at.id));
            if (p && tokens[p.id]) tokenEl = tokens[p.id];
          }
        }

        if (!tokenEl) {
          tokenEl = document.querySelector(`.token[data-id="${at.id}"]`) ||
                    document.querySelector(`.token[data-character-id="${at.id}"]`);
        }

        if (tokenEl) {
          // Token koordinatları
          const tLeft = parseFloat(tokenEl.style.left) || tokenEl.offsetLeft || 0;
          const tTop = parseFloat(tokenEl.style.top) || tokenEl.offsetTop || 0;
          const tSize = tokenEl.offsetWidth || 50;

          // Floating damage sayısı
          const floatText = document.createElement('div');
          floatText.className = 'aoe-floating-damage';
          floatText.textContent = `-${at.damage || damage}`;
          floatText.style.left = `${tLeft + tSize / 2}px`;
          floatText.style.top = `${tTop}px`;

          gameMap.appendChild(floatText);
          setTimeout(() => floatText.remove(), 1700);

          // Token titreme efekti
          tokenEl.style.transition = 'transform 0.1s ease';
          tokenEl.style.transform = 'translate(-4px, -2px) scale(0.95)';
          setTimeout(() => {
            tokenEl.style.transform = 'translate(4px, 2px) scale(1.05)';
            setTimeout(() => {
              tokenEl.style.transform = '';
            }, 120);
          }, 100);
        }
      });
    }
  }

  // === EVENT DİNLEYİCİLERİ ===

  // 1. Sol Alt Buton Tıklaması
  if (dmAoeBtn) {
    dmAoeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isAoeModeActive) {
        cancelAoeMode();
      } else {
        startAoeSelection();
      }
    });
  }

  // 2. Modal Butonları
  if (btnCloseModal) {
    btnCloseModal.addEventListener('click', cancelAoeMode);
  }
  if (btnCancelAoe) {
    btnCancelAoe.addEventListener('click', cancelAoeMode);
  }
  if (btnReselectAoe) {
    btnReselectAoe.addEventListener('click', () => {
      closeAoeModal();
      clearTargetHighlights();
      // Hedefleme katmanını yeniden aktif et
      if (targetingLayer) {
        targetingLayer.classList.remove('hidden');
        targetingLayer.classList.add('active');
      }
      isAoeModeActive = true;
    });
  }
  if (btnSubmitAoe) {
    btnSubmitAoe.addEventListener('click', submitAoeDamage);
  }

  // Hasar kutusunda Enter tuşu ile gönderme
  if (damageInput) {
    damageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitAoeDamage();
      }
    });
  }

  // Hızlı hasar ekleme butonları (+10, +20 vb.)
  document.querySelectorAll('.aoe-pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const addVal = parseInt(btn.dataset.val, 10) || 0;
      const currentVal = parseInt(damageInput.value, 10) || 0;
      damageInput.value = currentVal + addVal;
      damageInput.focus();
    });
  });

  // ESC Tuşu ile iptal
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (isAoeModeActive || (aoeModal && !aoeModal.classList.contains('hidden'))) {
        cancelAoeMode();
      }
    }
  });

  // === SOCKET İŞLEMLERİ ===

  if (typeof socket !== 'undefined') {
    // Combat durumu takibi
    socket.on('combatStateUpdated', (state) => {
      if (!state) return;
      updateAoeBtnVisibility(Boolean(state.active));
    });

    socket.on('combatStarted', () => {
      updateAoeBtnVisibility(true);
    });

    socket.on('combatEnded', () => {
      updateAoeBtnVisibility(false);
    });

    // AoE Hasar Uygulandığında (Tüm oyuncular ve DM için görsel patlama)
    socket.on('aoeDamageApplied', (data) => {
      if (!data) return;
      showAoeVisualEffects(data.aoeInfo, data.damage, data.affectedTargets);
    });

    // İlk yüklemede durum sorgula
    socket.emit('getCombatState');
  }

  console.log('WebDND AoE Damage modülü yüklendi.');
})();
