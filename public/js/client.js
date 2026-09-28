// ============================================================
// WebDND Client — v3 (Refactored)
// ============================================================

// === Giriş Kontrolü ===
const role = sessionStorage.getItem('dnd_role');
if (!role) {
  window.location.href = '/index.html';
}

const profileData = JSON.parse(sessionStorage.getItem('dnd_profile') || 'null');
const characterData = JSON.parse(sessionStorage.getItem('dnd_character') || 'null');

const socket = io();

let sessionId = sessionStorage.getItem('dnd_session_id');
if (!sessionId) {
  sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  sessionStorage.setItem('dnd_session_id', sessionId);
}

// === State ===
let myId = null;
const tokens = {};
const allPlayers = {};
const gameMapContainer = document.getElementById('game-map');
const gameMap = document.getElementById('map-content');

// === Oyun Modu & Savaş State ===
let currentGameMode = 'gunes';
window.__webdnd_gameMode = currentGameMode;
window.__webdnd_combatActive = false;
window.__webdnd_currentActiveCombatant = null;

// Marker verilerini attack-panel.js için global olarak expose et
window.__webdnd_markers = {};

let isDragging = false;
let draggedToken = null;
let offsetX = 0;
let offsetY = 0;

// ============================================================
// YARDIMCI FONKSİYONLAR (DRY)
// ============================================================

/**
 * XSS koruması — kullanıcı girdilerini güvenli hale getirir.
 */
function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

/**
 * Log paneline yeni bir mesaj ekler, maksimum 7 satır tutar.
 */
function addLog(message, color) {
  const logs = document.getElementById('logs');
  if (!logs) return;
  const li = document.createElement('li');
  if (color) li.style.color = color;
  li.textContent = message;
  logs.appendChild(li);
  if (logs.children.length > 7) logs.removeChild(logs.firstElementChild);
}

/**
 * Log paneline HTML içerikli mesaj ekler (zar sonuçları için).
 */
function addLogHtml(html) {
  const logs = document.getElementById('logs');
  if (!logs) return;
  const li = document.createElement('li');
  li.innerHTML = html;
  logs.appendChild(li);
  if (logs.children.length > 7) logs.removeChild(logs.firstElementChild);
}

/**
 * HP oranına göre badge rengi döndürür.
 */
function getHpColor(current, max) {
  const ratio = max > 0 ? current / max : 0;
  if (ratio <= 0.25) return '#c0392b';
  if (ratio <= 0.5) return '#d35400';
  return '#27ae60';
}

/**
 * Token üzerindeki HP barını / badge'ini oluşturur veya günceller.
 */
function updateHpBadge(tokenEl, hpCurrent, hpMax) {
  if (hpCurrent == null || hpMax == null || isNaN(hpCurrent)) return;

  let hpBadge = tokenEl.querySelector('.token-hp-badge');
  if (!hpBadge) {
    hpBadge = document.createElement('div');
    hpBadge.className = 'token-hp-badge';
    hpBadge.innerHTML = `
      <div class="token-hp-bar-track">
        <div class="token-hp-bar-fill"></div>
      </div>
      <span class="token-hp-text"></span>
    `;
    tokenEl.appendChild(hpBadge);
  }

  let fillEl = hpBadge.querySelector('.token-hp-bar-fill');
  let textEl = hpBadge.querySelector('.token-hp-text');
  if (!fillEl || !textEl) {
    hpBadge.innerHTML = `
      <div class="token-hp-bar-track">
        <div class="token-hp-bar-fill"></div>
      </div>
      <span class="token-hp-text"></span>
    `;
    fillEl = hpBadge.querySelector('.token-hp-bar-fill');
    textEl = hpBadge.querySelector('.token-hp-text');
  }

  const pct = hpMax > 0 ? Math.min(100, Math.max(0, (hpCurrent / hpMax) * 100)) : 0;
  const color = getHpColor(hpCurrent, hpMax);

  if (fillEl) {
    fillEl.style.width = pct + '%';
    fillEl.style.background = color;
  }
  if (textEl) {
    textEl.textContent = `${hpCurrent} / ${hpMax}`;
  }
}

/**
 * Token üzerindeki Karanlık (Darkness) barını oluşturur veya günceller.
 * Sadece Kenan oyun modunda VE savaş modu aktifken görünür.
 */
function updateTokenDarknessBar(tokenEl, playerData) {
  if (!tokenEl) return;
  let darknessBar = tokenEl.querySelector('.token-darkness-bar');

  const isCombatActive = window.__webdnd_combatActive === true;
  if (currentGameMode !== 'kenan' || !isCombatActive) {
    if (darknessBar) darknessBar.remove();
    return;
  }

  // Eğer bir NPC / Marker ise ve karanlığa sahip değilse bar olmasın
  if (playerData.isMarker && !playerData.hasDarkness) {
    if (darknessBar) darknessBar.remove();
    return;
  }

  let curDarkness = 0;
  let maxDarkness = 100;
  if (playerData.isMarker) {
    curDarkness = playerData.darkness != null ? playerData.darkness : 0;
    maxDarkness = playerData.maxDarkness != null ? playerData.maxDarkness : 100;
  } else if (playerData.character) {
    curDarkness = playerData.character.darkness != null ? playerData.character.darkness : 0;
    maxDarkness = playerData.character.max_darkness != null ? playerData.character.max_darkness : 100;
  }

  if (!darknessBar) {
    darknessBar = document.createElement('div');
    darknessBar.className = 'token-darkness-bar';
    darknessBar.innerHTML = `
      <div class="token-darkness-bar-fill"></div>
      <span class="token-darkness-bar-text"></span>
    `;
    tokenEl.appendChild(darknessBar);
  }

  const fillEl = darknessBar.querySelector('.token-darkness-bar-fill');
  const textEl = darknessBar.querySelector('.token-darkness-bar-text');
  const pct = maxDarkness > 0 ? Math.min(100, Math.max(0, (curDarkness / maxDarkness) * 100)) : 0;
  if (fillEl) fillEl.style.width = pct + '%';
  if (textEl) textEl.textContent = `🌑 ${curDarkness}/${maxDarkness}`;
}

/**
 * Haritadaki tüm tokenların karanlık barlarını yeniden kontrol edip çizer.
 */
function refreshAllDarknessBars() {
  Object.keys(tokens).forEach(id => {
    const el = tokens[id];
    const pData = allPlayers[id] || (window.__webdnd_markers && window.__webdnd_markers[id]);
    if (el && pData) {
      updateTokenDarknessBar(el, pData);
    }
  });
}
window.__webdnd_refreshDarknessBars = refreshAllDarknessBars;

/**
 * Oyun modunu uygular ('gunes' veya 'kenan')
 */
function applyGameMode(mode) {
  currentGameMode = mode || 'gunes';
  window.__webdnd_gameMode = currentGameMode;
  document.body.dataset.gameMode = currentGameMode;

  const btnGunes = document.getElementById('btn-mode-gunes');
  const btnKenan = document.getElementById('btn-mode-kenan');
  if (btnGunes) btnGunes.classList.toggle('active', currentGameMode === 'gunes');
  if (btnKenan) btnKenan.classList.toggle('active', currentGameMode === 'kenan');

  refreshAllDarknessBars();
  renderKenanTurnInfo(window.__webdnd_currentActiveCombatant);
}

/**
 * Kontrol Paneli Aktif Tur Kartını çizer (Kenan Modu)
 */
function renderKenanTurnInfo(combatant) {
  const container = document.getElementById('kenan-turn-info-card');
  if (!container) return;

  if (currentGameMode !== 'kenan' || !combatant || !window.__webdnd_combatActive) {
    container.innerHTML = `
      <div class="kenan-turn-idle-state">
        <span class="idle-icon">⚔️</span>
        <span class="idle-text">Savaş modu başladığında sıradaki savaşçının detayları burada görüntülenir.</span>
      </div>
    `;
    return;
  }

  const isEnemy = Boolean(combatant.isMarker);
  const name = combatant.name || (isEnemy ? 'NPC' : 'Oyuncu');
  const roleBadge = isEnemy ? '👹 Canavar / NPC' : '🛡️ Oyuncu';
  const hpCur = combatant.hpCurrent != null ? combatant.hpCurrent : (combatant.hp != null ? combatant.hp : 0);
  const hpMax = combatant.hpMax != null ? combatant.hpMax : (combatant.maxHp != null ? combatant.maxHp : 100);
  const hpPct = hpMax > 0 ? Math.min(100, Math.max(0, (hpCur / hpMax) * 100)) : 0;

  const hasDarkness = isEnemy ? Boolean(combatant.hasDarkness) : true;
  const darkCur = combatant.darkness != null ? combatant.darkness : 0;
  const darkMax = combatant.maxDarkness != null ? combatant.maxDarkness : 100;
  const darkPct = darkMax > 0 ? Math.min(100, Math.max(0, (darkCur / darkMax) * 100)) : 0;

  const ac = combatant.ac != null ? combatant.ac : 10;
  const acBonus = combatant.ac_bonus != null ? combatant.ac_bonus : 0;
  const acTotal = ac + acBonus;

  const stats = combatant.stats || {};
  const str = stats.str ?? 10;
  const dex = stats.dex ?? 10;
  const con = stats.con ?? 10;
  const chr = combatant.chrStat ?? stats.chr ?? 10;

  let avatarHtml = '';
  if (combatant.imgUrl) {
    avatarHtml = `<img src="${escapeHtml(combatant.imgUrl)}" class="kenan-turn-card-avatar" alt="Avatar" />`;
  } else {
    const initial = (name.charAt(0) || '?').toUpperCase();
    const bgCol = combatant.color || '#4c1d95';
    avatarHtml = `<div class="kenan-turn-card-avatar" style="background:${bgCol};">${escapeHtml(initial)}</div>`;
  }

  let darknessBarHtml = '';
  if (hasDarkness) {
    darknessBarHtml = `
      <div class="kenan-turn-bar-item">
        <div class="kenan-turn-bar-header">
          <span style="color:#c084fc;">🌑 Karanlık</span>
          <span style="color:#e9d5ff;">${darkCur} / ${darkMax}</span>
        </div>
        <div class="kenan-turn-bar-track">
          <div class="kenan-turn-bar-fill-darkness" style="width: ${darkPct}%;"></div>
        </div>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="kenan-turn-card-header">
      ${avatarHtml}
      <div class="kenan-turn-card-title-wrap">
        <div class="kenan-turn-card-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
        <span class="kenan-turn-card-role-badge ${isEnemy ? 'is-enemy' : ''}">${roleBadge}</span>
      </div>
    </div>

    <div class="kenan-turn-card-bars">
      <div class="kenan-turn-bar-item">
        <div class="kenan-turn-bar-header">
          <span style="color:#4ade80;">❤️ Can (HP)</span>
          <span style="color:#bbf7d0;">${hpCur} / ${hpMax}</span>
        </div>
        <div class="kenan-turn-bar-track">
          <div class="kenan-turn-bar-fill-hp" style="width: ${hpPct}%;"></div>
        </div>
      </div>
      ${darknessBarHtml}
    </div>

    <div class="kenan-turn-stats-row">
      <div class="kenan-turn-stat-box">
        <span class="kenan-turn-stat-label">🛡️ AC</span>
        <span class="kenan-turn-stat-value">${acTotal}</span>
      </div>
      <div class="kenan-turn-stat-box">
        <span class="kenan-turn-stat-label">STR</span>
        <span class="kenan-turn-stat-value">${str}</span>
      </div>
      <div class="kenan-turn-stat-box">
        <span class="kenan-turn-stat-label">DEX</span>
        <span class="kenan-turn-stat-value">${dex}</span>
      </div>
      <div class="kenan-turn-stat-box">
        <span class="kenan-turn-stat-label">CHR</span>
        <span class="kenan-turn-stat-value">${chr}</span>
      </div>
    </div>
  `;
}
window.__webdnd_updateTurnInfo = (combatant) => {
  window.__webdnd_currentActiveCombatant = combatant;
  renderKenanTurnInfo(combatant);
};

/**
 * Bir fonksiyonu belirli bir aralıkla sınırlar (throttle).
 */
function throttle(fn, delay) {
  let lastCall = 0;
  let pending = null;
  return function (...args) {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      fn.apply(this, args);
    } else {
      // Son hareketi kaçırmamak için pending olarak kaydet
      clearTimeout(pending);
      pending = setTimeout(() => {
        lastCall = Date.now();
        fn.apply(this, args);
      }, delay - (now - lastCall));
    }
  };
}

/**
 * Oyuncu adını güvenli şekilde döndürür.
 */
function getPlayerDisplayName(playerData) {
  if (playerData.role === 'dm') return 'DM';
  if (playerData.character && playerData.character.name) return playerData.character.name;
  return 'Bir Oyuncu';
}

/**
 * Token üzerindeki baş harfi döndürür.
 */
function getTokenInitial(playerData) {
  if (playerData.isMarker) {
    if (!playerData.name) return '?';
    return playerData.name.length <= 2 ? playerData.name : playerData.name.substring(0, 2).toUpperCase();
  }
  if (playerData.role === 'dm') return 'DM';
  if (playerData.character && playerData.character.name) return playerData.character.name.charAt(0).toUpperCase();
  return '?';
}

// ============================================================
// SOCKET BAĞLANTI YÖNETİMİ
// ============================================================

socket.on('connect', () => {
  console.log("Sunucuya bağlandım!");
  myId = socket.id;
  document.getElementById('status').innerText = "Bağlandı!";

  // Bağlantı koptuğunda haritada kalan eski klonları temizle
  Object.values(tokens).forEach(t => t.remove());
  for (let key in tokens) delete tokens[key];
  for (let key in allPlayers) delete allPlayers[key];

  // Sunucuya giriş bilgisini ilet
  socket.emit('playerJoin', { role, profile: profileData, character: characterData, sessionId });

  // Log
  const logName = role === 'dm' ? "DM Olarak giriş yaptınız." : `${characterData?.name || 'Oyuncu'} olarak giriş yaptınız.`;
  addLog(logName);

  // Supabase'deki güncel şablonları sunucudan talep et
  socket.emit('getCustomEffects');
  socket.emit('getAttackPresets');
  socket.emit('getTokenPresets');

  if (role === 'dm') {
    document.getElementById('dm-tools').classList.remove('hidden');
    setupTokenPresetControls();
  } else {
    document.getElementById('player-info-panel').classList.remove('hidden');
  }
});

// Oyun Modu Değiştirme Butonları Dinleyicileri
const btnModeGunes = document.getElementById('btn-mode-gunes');
const btnModeKenan = document.getElementById('btn-mode-kenan');
if (btnModeGunes) {
  btnModeGunes.addEventListener('click', () => {
    socket.emit('setGameMode', 'gunes');
    applyGameMode('gunes');
  });
}
if (btnModeKenan) {
  btnModeKenan.addEventListener('click', () => {
    socket.emit('setGameMode', 'kenan');
    applyGameMode('kenan');
  });
}

// ============================================================
// SOCKET EVENT HANDLER'LARI
// ============================================================

socket.on('gameModeUpdated', (mode) => {
  applyGameMode(mode);
});

socket.on('currentPlayers', (players) => {
  Object.assign(allPlayers, players);
  Object.values(players).forEach(player => addToken(player));
  renderPlayerInfo();
});

socket.on('newPlayer', (playerData) => {
  allPlayers[playerData.id] = playerData;
  addToken(playerData);
  addLog(`${getPlayerDisplayName(playerData)} katıldı.`);
  renderPlayerInfo();
});

socket.on('currentMarkers', (markers) => {
  Object.assign(window.__webdnd_markers, markers);
  Object.values(markers).forEach(marker => addToken(marker));
});

socket.on('newMarker', (markerData) => {
  window.__webdnd_markers[markerData.id] = markerData;
  addToken(markerData);
});

socket.on('removeMarker', (markerId) => {
  delete window.__webdnd_markers[markerId];
  if (tokens[markerId]) {
    tokens[markerId].remove();
    delete tokens[markerId];
  }
  removeObjectMapRings(markerId);
  if (typeof window.__webdnd_removeTarget === 'function') {
    window.__webdnd_removeTarget('marker', markerId);
  }
});

socket.on('updateMarkerData', (markerData) => {
  const existingMarker = window.__webdnd_markers[markerData.id];
  const t = tokens[markerData.id];
  if (t && t.style.left && (markerData.x == null || isNaN(markerData.x))) {
    markerData.x = parseFloat(t.style.left);
    markerData.y = parseFloat(t.style.top);
  } else if (existingMarker && (markerData.x == null || isNaN(markerData.x))) {
    markerData.x = existingMarker.x;
    markerData.y = existingMarker.y;
  }
  window.__webdnd_markers[markerData.id] = markerData;
  updateToken(markerData);
  if (editingMarkerId === markerData.id) {
    renderMarkerEditorActiveEffects(markerData);
    renderMarkerAssignedAttacks(markerData);
  }
  if (typeof refreshBatchAssignModalIfOpen === 'function') {
    refreshBatchAssignModalIfOpen();
  }
  // Kenan Modu: Aktif tur kartı bu marker ise güncelle
  if (window.__webdnd_currentActiveCombatant && window.__webdnd_currentActiveCombatant.id === markerData.id) {
    Object.assign(window.__webdnd_currentActiveCombatant, {
      name: markerData.name,
      imgUrl: markerData.imgUrl,
      color: markerData.color,
      hpCurrent: markerData.hp,
      hpMax: markerData.maxHp,
      darkness: markerData.darkness,
      maxDarkness: markerData.maxDarkness,
      hasDarkness: markerData.hasDarkness,
      ac: markerData.ac,
      ac_bonus: markerData.ac_bonus,
      stats: markerData.stats
    });
    renderKenanTurnInfo(window.__webdnd_currentActiveCombatant);
  }
});

socket.on('attackPresetsUpdated', () => {
  if (typeof populateCreateTokenAttacksList === 'function') {
    populateCreateTokenAttacksList();
  }
  if (typeof editingPlayerId !== 'undefined' && editingPlayerId && allPlayers && allPlayers[editingPlayerId]) {
    renderPlayerAssignedAttacks(allPlayers[editingPlayerId]);
  }
  if (typeof editingMarkerId !== 'undefined' && editingMarkerId && window.__webdnd_markers && window.__webdnd_markers[editingMarkerId]) {
    renderMarkerAssignedAttacks(window.__webdnd_markers[editingMarkerId]);
  }
  if (typeof refreshBatchAssignModalIfOpen === 'function') {
    refreshBatchAssignModalIfOpen();
  }
});

socket.on('updateBg', (url) => {
  if (url) {
    const img = new Image();
    img.onload = () => {
      gameMap.style.backgroundImage = `url('${encodeURI(url)}')`;
      gameMap.style.backgroundSize = '100% 100%';
      gameMap.style.backgroundPosition = 'top left';
      gameMap.style.width = Math.max(img.width, 800) + 'px';
      gameMap.style.height = Math.max(img.height, 600) + 'px';
      if (typeof resizeCanvas === 'function') resizeCanvas();
    };
    img.onerror = () => {
      console.error('Arka plan resmi yüklenemedi:', url);
    };
    img.src = url;
  } else {
    gameMap.style.backgroundImage = 'none';
    gameMap.style.width = '2000px';
    gameMap.style.height = '1500px';
    if (typeof resizeCanvas === 'function') resizeCanvas();
  }
});

socket.on('playerDisconnected', (id) => {
  if (tokens[id]) {
    tokens[id].remove();
    delete tokens[id];
  }
  if (allPlayers[id]) {
    const charId = allPlayers[id]?.character?.id;
    if (charId && typeof window.__webdnd_removeTarget === 'function') {
      window.__webdnd_removeTarget('character', charId);
    }
    delete allPlayers[id];
    renderPlayerInfo();
    if (editingPlayerId === id) {
      document.getElementById('dm-player-editor').classList.add('hidden');
    }
  }
});

socket.on('tokenAppearanceUpdated', (data) => {
  if (!allPlayers[data.id]) return;

  allPlayers[data.id].imgUrl = data.imgUrl;
  allPlayers[data.id].color = data.color;

  const t = tokens[data.id];
  if (!t) return;

  t.style.borderColor = data.color;
  if (data.imgUrl) {
    t.style.backgroundImage = `url('${encodeURI(data.imgUrl)}')`;
    t.style.backgroundSize = 'cover';
    t.style.backgroundPosition = 'center';
    t.style.backgroundColor = 'transparent';
    // Text child'ını temizle
    Array.from(t.childNodes).forEach(n => {
      if (n.nodeType === Node.TEXT_NODE) n.remove();
    });
  } else {
    t.style.backgroundImage = 'none';
    t.style.backgroundColor = data.color;
    // Text yoksa ekle
    const hasText = Array.from(t.childNodes).some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
    if (!hasText) {
      const initial = getTokenInitial(allPlayers[data.id]);
      t.insertBefore(document.createTextNode(initial), t.firstChild);
    }
  }
});

socket.on('characterUpdated', (data) => {
  if (!allPlayers[data.id] || !allPlayers[data.id].character) return;

  Object.assign(allPlayers[data.id].character, data.updates);

  // Token boyutu güncellemesi varsa
  if (data.updates.size !== undefined || data.updates.token_size !== undefined) {
    const newSize = data.updates.size || data.updates.token_size;
    allPlayers[data.id].size = newSize;
    if (allPlayers[data.id].character) {
      allPlayers[data.id].character.token_size = newSize;
      allPlayers[data.id].character.size = newSize;
    }
    const t = tokens[data.id];
    if (t) {
      applyTokenStyles(t, allPlayers[data.id], false);
    }
    if (typeof editingPlayerId !== 'undefined' && editingPlayerId === data.id) {
      const sizeInput = document.getElementById('dm-edit-size');
      if (sizeInput && document.activeElement !== sizeInput) sizeInput.value = newSize;
      if (typeof updateDmSizePillActive === 'function') updateDmSizePillActive(newSize);
    }
  }

  renderPlayerInfo();

  // HP Badge güncelle
  const t = tokens[data.id];
  if (t) {
    updateHpBadge(t, allPlayers[data.id].character.hp_current, allPlayers[data.id].character.hp_max);
    updateTokenDarknessBar(t, allPlayers[data.id]);
  }

  // Kenan Modu: Aktif turdaki savaşçı bu oyuncuysa tur kartını güncelle
  if (window.__webdnd_currentActiveCombatant && 
      (window.__webdnd_currentActiveCombatant.id === data.id || 
       window.__webdnd_currentActiveCombatant.characterId === allPlayers[data.id].character.id)) {
    Object.assign(window.__webdnd_currentActiveCombatant, {
      hpCurrent: allPlayers[data.id].character.hp_current,
      hpMax: allPlayers[data.id].character.hp_max,
      darkness: allPlayers[data.id].character.darkness,
      maxDarkness: allPlayers[data.id].character.max_darkness,
      ac: allPlayers[data.id].character.ac,
      ac_bonus: allPlayers[data.id].character.ac_bonus,
      stats: allPlayers[data.id].character.stats
    });
    renderKenanTurnInfo(window.__webdnd_currentActiveCombatant);
  }

  // DM editör kayıt butonu güncelle
  const btn = document.getElementById('dm-edit-save-btn');
  if (btn && !dmEditTimeout) {
    btn.innerText = "Kayıtlı";
    btn.style.backgroundColor = '#27ae60';
  }

  if (editingPlayerId === data.id) {
    renderPlayerAssignedAttacks(allPlayers[data.id]);
  }

  // Kendi hesabıysa SessionStorage da güncelleyelim.
  if (data.id === myId) {
    sessionStorage.setItem('dnd_character', JSON.stringify(allPlayers[myId].character));
  }
});

// DM Oyuncu Token Boyutu Anlık Soket Güncellemesi
socket.on('tokenSizeUpdated', ({ id, size }) => {
  if (allPlayers[id]) {
    allPlayers[id].size = size;
    if (allPlayers[id].character) {
      allPlayers[id].character.token_size = size;
      allPlayers[id].character.size = size;
    }
  }
  const t = tokens[id];
  if (t) {
    applyTokenStyles(t, allPlayers[id] || { size }, false);
    const hpData = extractHp(allPlayers[id] || {});
    if (hpData.hpCurrent != null) updateHpBadge(t, hpData.hpCurrent, hpData.hpMax);
    if (allPlayers[id]) updateTokenDarknessBar(t, allPlayers[id]);
  }
  renderPlayerInfo();
  if (typeof editingPlayerId !== 'undefined' && editingPlayerId === id) {
    const sizeInput = document.getElementById('dm-edit-size');
    if (sizeInput && document.activeElement !== sizeInput) sizeInput.value = size;
    if (typeof updateDmSizePillActive === 'function') updateDmSizePillActive(size);
  }
});

socket.on('updateTokenPosition', (position) => {
  if (tokens[position.id]) {
    tokens[position.id].style.left = position.x + 'px';
    tokens[position.id].style.top = position.y + 'px';
  }
  if (allPlayers[position.id]) {
    allPlayers[position.id].x = position.x;
    allPlayers[position.id].y = position.y;
  }
  if (window.__webdnd_markers && window.__webdnd_markers[position.id]) {
    const m = window.__webdnd_markers[position.id];
    m.x = position.x;
    m.y = position.y;
    if (m.objectType === 'explosive' || m.objectType === 'aura' || m.objectType === 'spawner') {
      updateObjectMapRings(position.id, position.x, position.y, m.size || 50, m.objectType, m.objectConfig);
    }
  }
});

// ============================================================
// TOKEN YÖNETİMİ
// ============================================================

/**
 * Yeni bir token DOM elemanı oluşturur ve haritaya ekler.
 */
function addToken(playerData) {
  // Eğer zaten varsa var olanı temizle (klon engelleme) ve eski pozisyonu koru
  if (tokens[playerData.id]) {
    const existing = tokens[playerData.id];
    const prevX = parseFloat(existing.style.left);
    const prevY = parseFloat(existing.style.top);
    if (!isNaN(prevX) && (playerData.x == null || isNaN(playerData.x))) playerData.x = prevX;
    if (!isNaN(prevY) && (playerData.y == null || isNaN(playerData.y))) playerData.y = prevY;
    existing.remove();
    delete tokens[playerData.id];
  }

  const t = document.createElement('div');
  t.className = 'token';
  t.dataset.id = playerData.id;
  if (playerData.character?.id) {
    t.dataset.characterId = playerData.character.id;
  }

  // Eğer bu token hedef olarak seçiliyse hedef çerçevesini koru
  if (typeof window.__webdnd_isTargetSelected === 'function') {
    const isMarker = Boolean(playerData.isMarker);
    const targetId = isMarker ? playerData.id : (playerData.character?.id || playerData.id);
    const targetType = isMarker ? 'marker' : 'character';
    if (window.__webdnd_isTargetSelected(targetType, targetId)) {
      t.classList.add('token-target-selected');
      if (typeof window.__webdnd_syncAllTargetBeacons === 'function') {
        setTimeout(window.__webdnd_syncAllTargetBeacons, 20);
      }
    }
  }

  // Eğer bu token bize aitse
  if (playerData.id === myId) {
    t.classList.add('my-token');
  }

  // Koordinat yoksa varsayılan 50 ata
  if (playerData.x == null || isNaN(playerData.x)) playerData.x = 50;
  if (playerData.y == null || isNaN(playerData.y)) playerData.y = 50;

  // Pozisyon, Renk, Boyut (yeni eklenirken pozisyonu uygula)
  applyTokenStyles(t, playerData, true);

  // İçine baş harf koyalım
  const initial = getTokenInitial(playerData);

  if (playerData.isMarker) {
    t.classList.add('token-marker');
    const objPrefix = playerData.objectType === 'explosive' ? '💣 Patlayıcı: ' : (playerData.objectType === 'aura' ? '🔮 Totem: ' : (playerData.objectType === 'spawner' ? '🌀 Yuva: ' : 'İşaret: '));
    t.title = objPrefix + escapeHtml(playerData.name);
    if (!playerData.objectType || playerData.objectType === 'creature') {
      t.classList.add('token-creature');
      t.style.borderRadius = '10%';
    }

    // DM eklediği işareti sağ tık ile silebilir
    if (role === 'dm') {
      t.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        socket.emit('deleteMarker', playerData.id);
      });
    }
  } else {
    t.title = escapeHtml(getPlayerDisplayName(playerData));
    if (role === 'dm') {
      t.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openPlayerTokenContextMenu(e.clientX, e.clientY, playerData.id);
      });
    }
  }

  // Cansız Obje Görsellerini ve Rozetlerini Güncelle
  updateTokenObjectVisuals(t, playerData);

  if (!playerData.imgUrl) {
    t.textContent = initial;
  }

  // Sürükleme yetkisi: Kendi token'ı VEYA kişi DM ise herhangi bir token.
  if (playerData.id === myId || role === 'dm') {
    t.classList.add('my-token');
    setupDragHandlers(t, playerData.id);
  }

  // Çift tıklama — DM için marker veya oyuncu düzenleme penceresini aç
  if (role === 'dm') {
    if (playerData.isMarker) {
      t.addEventListener('dblclick', () => openMarkerEditor(playerData.id));
    } else if (playerData.character) {
      t.addEventListener('dblclick', () => showDmEditor(playerData.id));
    }
  }

  // Ctrl+Click ile hedef seçimi (Haritadan çoklu hedef işaretleme)
  t.addEventListener('click', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();

    // Hedef bilgilerini çöz
    let targetInfo = null;
    if (playerData.isMarker) {
      const currentMarker = (window.__webdnd_markers && window.__webdnd_markers[playerData.id]) || playerData;
      if (currentMarker) {
        targetInfo = { type: 'marker', id: currentMarker.id, name: currentMarker.name, data: currentMarker };
      }
    } else if (playerData.character) {
      const currentPlayer = (typeof allPlayers !== 'undefined') ? allPlayers[playerData.id] : null;
      const char = (currentPlayer && currentPlayer.character) || playerData.character;
      if (char) {
        targetInfo = { type: 'character', id: char.id, name: char.name, data: char };
      }
    }

    if (targetInfo && typeof window.__webdnd_ctrlClickTarget === 'function') {
      window.__webdnd_ctrlClickTarget(targetInfo, t);
    }
  });

  // HP Badge
  const { hpCurrent, hpMax } = extractHp(playerData);
  if (hpCurrent !== null && hpMax !== null) {
    updateHpBadge(t, hpCurrent, hpMax);
  }

  // Kenan Modu: Karanlık Barı
  updateTokenDarknessBar(t, playerData);

  // Durum Efekt Rozetleri
  updateTokenStatusBadges(t, playerData);

  gameMap.appendChild(t);
  tokens[playerData.id] = t;

  // Eğer bu token şu anda aktif turdaysa tur vurgusunu ve beacon'ı hemen ekle
  if (typeof window.__webdnd_combatActive !== 'undefined' && window.__webdnd_combatActive && window.__webdnd_currentActiveCombatant) {
    const activeId = String(window.__webdnd_currentActiveCombatant.id);
    const charId = window.__webdnd_currentActiveCombatant.characterId ? String(window.__webdnd_currentActiveCombatant.characterId) : null;
    const myIdStr = String(playerData.id);
    const myCharIdStr = playerData.character ? String(playerData.character.id) : null;
    if (myIdStr === activeId || (myCharIdStr && myCharIdStr === activeId) || (charId && (myIdStr === charId || myCharIdStr === charId))) {
      if (typeof window.__webdnd_updateActiveTokenHighlight === 'function') {
        setTimeout(() => window.__webdnd_updateActiveTokenHighlight(window.__webdnd_currentActiveCombatant.id), 20);
      }
    }
  }
}

/**
 * Mevcut token'ı DOM'dan kaldırmadan günceller (performans için).
 */
function updateToken(playerData) {
  const t = tokens[playerData.id];
  if (!t) {
    // Token yoksa yeni oluştur
    addToken(playerData);
    return;
  }

  // Mevcut DOM koordinatlarını playerData ile senkronize tut
  const curLeft = parseFloat(t.style.left);
  const curTop = parseFloat(t.style.top);
  if (!isNaN(curLeft)) playerData.x = curLeft;
  if (!isNaN(curTop)) playerData.y = curTop;

  if (playerData.character?.id) {
    t.dataset.characterId = playerData.character.id;
  }

  // Hedef seçim durumunu güncelle
  if (typeof window.__webdnd_isTargetSelected === 'function') {
    const isMarker = Boolean(playerData.isMarker);
    const targetId = isMarker ? playerData.id : (playerData.character?.id || playerData.id);
    const targetType = isMarker ? 'marker' : 'character';
    if (window.__webdnd_isTargetSelected(targetType, targetId)) {
      t.classList.add('token-target-selected');
    } else {
      t.classList.remove('token-target-selected');
      const b = t.querySelector('.token-target-beacon');
      if (b) b.remove();
    }
    if (typeof window.__webdnd_syncAllTargetBeacons === 'function') {
      window.__webdnd_syncAllTargetBeacons();
    }
  }

  // Stil güncelle (POZİSYONU SIFIRLAMADAN: updatePosition = false)
  applyTokenStyles(t, playerData, false);
  updateTokenObjectVisuals(t, playerData);

  // Başlık / İsim güncelle
  if (playerData.isMarker) {
    const objPrefix = playerData.objectType === 'explosive' ? '💣 Patlayıcı: ' : (playerData.objectType === 'aura' ? '🔮 Totem: ' : (playerData.objectType === 'spawner' ? '🌀 Yuva: ' : 'İşaret: '));
    t.title = objPrefix + escapeHtml(playerData.name || '');
  } else {
    t.title = escapeHtml(getPlayerDisplayName(playerData));
  }

  // Text Node / İsim harfini güvenle güncelle (HP badge'i bozmadan)
  if (!playerData.imgUrl) {
    let hasText = false;
    t.childNodes.forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) {
        node.nodeValue = getTokenInitial(playerData);
        hasText = true;
      }
    });
    if (!hasText) {
      t.insertBefore(document.createTextNode(getTokenInitial(playerData)), t.firstChild);
    }
  } else {
    t.childNodes.forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) node.remove();
    });
  }

  // HP Badge güncelle
  const { hpCurrent, hpMax } = extractHp(playerData);
  if (hpCurrent !== null && hpMax !== null) {
    updateHpBadge(t, hpCurrent, hpMax);
  } else {
    const badge = t.querySelector('.token-hp-badge');
    if (badge) badge.remove();
  }

  // Kenan Modu: Karanlık Barı güncelle
  updateTokenDarknessBar(t, playerData);

  // Durum Efekt Rozetleri güncelle
  updateTokenStatusBadges(t, playerData);

  // Eğer bu token aktif turdaysa vurgu sınıfını ve beacon'ı koru
  if (typeof window.__webdnd_combatActive !== 'undefined' && window.__webdnd_combatActive && window.__webdnd_currentActiveCombatant) {
    const activeId = String(window.__webdnd_currentActiveCombatant.id);
    const charId = window.__webdnd_currentActiveCombatant.characterId ? String(window.__webdnd_currentActiveCombatant.characterId) : null;
    const myIdStr = String(playerData.id);
    const myCharIdStr = playerData.character ? String(playerData.character.id) : null;
    if (myIdStr === activeId || (myCharIdStr && myCharIdStr === activeId) || (charId && (myIdStr === charId || myCharIdStr === charId))) {
      t.classList.add('combat-active-token');
      if (!t.querySelector('.token-combat-turn-beacon') && typeof window.__webdnd_updateActiveTokenHighlight === 'function') {
        window.__webdnd_updateActiveTokenHighlight(window.__webdnd_currentActiveCombatant.id);
      }
    }
  }
}

/**
 * Token üzerindeki aktif durum efekt rozetlerini günceller.
 */
function updateTokenStatusBadges(tokenEl, playerData) {
  let badgeWrap = tokenEl.querySelector('.token-status-badges');
  const activeEffects = playerData.activeEffects || (playerData.character && playerData.character.activeEffects) || [];

  // Görsel efekt sınıflarını hesapla ve tokene uygula (Felçli: Mor parıltı, Yanan: Alev dalgası, Durdurulamaz: Altın kalkan)
  const hasParalyzed = activeEffects.some(e => {
    const n = (e.name || '').toLowerCase();
    return Boolean(e.effects?.paralyzed || e.id === 'preset_paralyzed' || n.includes('felç') || n.includes('paralyz') || e.icon === '⚡');
  });

  const hasBurning = activeEffects.some(e => {
    const n = (e.name || '').toLowerCase();
    return Boolean(e.id === 'preset_burn' || e.icon === '🔥' || n.includes('yan') || n.includes('burn') || n.includes('ateş') || n.includes('alev') || (e.effects?.dotDamage && !n.includes('zehir') && !n.includes('kan')));
  });

  const hasUnstoppable = activeEffects.some(e => {
    const n = (e.name || '').toLowerCase();
    return Boolean(e.effects?.unstoppable || e.id === 'preset_unstoppable' || n.includes('durdurulamaz') || n.includes('unstoppable'));
  });

  const hasShelter = activeEffects.some(e => {
    const n = (e.name || '').toLowerCase();
    return Boolean(e.effects?.shelter || e.id === 'preset_shelter' || n.includes('barınak') || n.includes('shelter') || e.icon === '🛡️');
  });

  tokenEl.classList.toggle('token-status-paralyzed', hasParalyzed);
  tokenEl.classList.toggle('token-status-burning', hasBurning);
  tokenEl.classList.toggle('token-status-unstoppable', hasUnstoppable);
  tokenEl.classList.toggle('token-status-shelter', hasShelter);

  if (!activeEffects || activeEffects.length === 0) {
    if (badgeWrap) badgeWrap.remove();
    return;
  }

  if (!badgeWrap) {
    badgeWrap = document.createElement('div');
    badgeWrap.className = 'token-status-badges';
    tokenEl.appendChild(badgeWrap);
  }

  badgeWrap.innerHTML = '';
  activeEffects.forEach(eff => {
    const badge = document.createElement('span');
    badge.className = 'token-status-badge';
    const durText = eff.duration != null ? `${eff.duration}T` : '∞';
    const ruleDesc = typeof describeStatusRules === 'function' ? describeStatusRules(eff.effects) : '';
    badge.title = `${eff.icon || '✨'} ${eff.name || 'Efekt'} (${durText})${ruleDesc ? ': ' + ruleDesc : ''}${role === 'dm' ? ' (Sağ tık: Kaldır)' : ''}`;
    badge.innerHTML = `<span class="eff-icon">${eff.icon || '✨'}</span><span class="eff-dur">${durText}</span>`;

    if (role === 'dm') {
      badge.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const targetType = playerData.isMarker ? 'marker' : 'character';
        const targetId = playerData.isMarker ? playerData.id : (playerData.character?.id || playerData.id);
        socket.emit('removeStatusEffect', { targetType, targetId, effectId: eff.id });
      });
    }

    badgeWrap.appendChild(badge);
  });
}

/**
 * Token DOM elemanına pozisyon, renk ve boyut stillerini uygular.
 */
function applyTokenStyles(t, data, updatePosition = true) {
  if (updatePosition) {
    if (data.x !== undefined && data.x !== null && !isNaN(data.x)) {
      t.style.left = data.x + 'px';
    }
    if (data.y !== undefined && data.y !== null && !isNaN(data.y)) {
      t.style.top = data.y + 'px';
    }
  }
  t.style.borderColor = data.color || '#e74c3c';

  const size = data.size || (data.character && (data.character.token_size || data.character.size)) || 50;
  data.size = size;
  t.style.width = size + 'px';
  t.style.height = size + 'px';
  t.dataset.size = size;

  // Token büyüklüğüne göre barların ve rozetlerin dinamik ölçek faktörü
  const tokenScale = Math.max(0.8, Math.min(2.8, Math.sqrt(size / 50)));
  t.style.setProperty('--token-scale', tokenScale.toFixed(3));
  t.style.setProperty('--token-size-px', size + 'px');

  if (data.objectType === 'explosive') {
    t.style.borderRadius = '8px';
  } else if (data.objectType === 'aura') {
    t.style.borderRadius = '50%';
  } else if (data.isMarker) {
    t.style.borderRadius = '10%';
  } else {
    t.style.borderRadius = '50%';
  }

  if (data.imgUrl) {
    t.style.backgroundImage = `url('${encodeURI(data.imgUrl)}')`;
    t.style.backgroundSize = 'cover';
    t.style.backgroundPosition = 'center';
    t.style.backgroundColor = 'transparent';
  } else {
    t.style.backgroundImage = 'none';
    t.style.backgroundColor = data.color || '#e74c3c';
  }
}

/**
 * Bir playerData'dan HP bilgisini çıkartır.
 */
function extractHp(playerData) {
  let hpCurrent = null;
  let hpMax = null;

  if (playerData.isMarker && playerData.hp != null && !isNaN(playerData.hp)) {
    hpCurrent = playerData.hp;
    hpMax = playerData.maxHp;
  } else if (!playerData.isMarker && playerData.character && playerData.character.hp_current !== undefined) {
    hpCurrent = playerData.character.hp_current;
    hpMax = playerData.character.hp_max;
  }

  return { hpCurrent, hpMax };
}

/**
 * Token'a sürükleme (drag) event handler'larını ekler.
 */
function setupDragHandlers(tokenEl, tokenId) {
  tokenEl.addEventListener('mousedown', (e) => {
    // Ctrl+Click hedef seçimi sırasında sürüklemeyi engelle
    if (e.ctrlKey || e.metaKey || e.button !== 0) return;
    e.stopPropagation();
    isDragging = true;
    draggedToken = tokenEl;
    draggedToken.dataset.id = tokenId;
    const rect = tokenEl.getBoundingClientRect();
    const currentZoom = window.__webdnd_zoom || 1;
    offsetX = (e.clientX - rect.left) / currentZoom;
    offsetY = (e.clientY - rect.top) / currentZoom;
  });

  tokenEl.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1) return;
    e.stopPropagation();
    isDragging = true;
    draggedToken = tokenEl;
    draggedToken.dataset.id = tokenId;
    const rect = tokenEl.getBoundingClientRect();
    const touch = e.touches[0];
    const currentZoom = window.__webdnd_zoom || 1;
    offsetX = (touch.clientX - rect.left) / currentZoom;
    offsetY = (touch.clientY - rect.top) / currentZoom;
  }, { passive: true });
}

// === Throttled Hareket Emit ===
const throttledMovementEmit = throttle((id, x, y) => {
  socket.emit('playerMovement', { id, x, y });
}, 16); // ~60fps

document.addEventListener('mousemove', (e) => {
  if (!isDragging || !draggedToken) return;

  const mapRect = gameMap.getBoundingClientRect();
  const currentZoom = window.__webdnd_zoom || 1;
  const newX = (e.clientX - mapRect.left) / currentZoom - offsetX;
  const newY = (e.clientY - mapRect.top) / currentZoom - offsetY;

  draggedToken.style.left = newX + 'px';
  draggedToken.style.top = newY + 'px';

  const id = draggedToken.dataset.id;
  if (id) {
    if (allPlayers[id]) {
      allPlayers[id].x = newX;
      allPlayers[id].y = newY;
    }
    if (window.__webdnd_markers && window.__webdnd_markers[id]) {
      const m = window.__webdnd_markers[id];
      m.x = newX;
      m.y = newY;
      if (m.objectType === 'explosive' || m.objectType === 'aura' || m.objectType === 'spawner') {
        updateObjectMapRings(id, newX, newY, m.size || 50, m.objectType, m.objectConfig);
      }
    }
    throttledMovementEmit(id, newX, newY);
  }
});

document.addEventListener('touchmove', (e) => {
  if (!isDragging || !draggedToken || e.touches.length > 1) return;
  e.preventDefault();

  const touch = e.touches[0];
  const mapRect = gameMap.getBoundingClientRect();
  const currentZoom = window.__webdnd_zoom || 1;
  const newX = (touch.clientX - mapRect.left) / currentZoom - offsetX;
  const newY = (touch.clientY - mapRect.top) / currentZoom - offsetY;

  draggedToken.style.left = newX + 'px';
  draggedToken.style.top = newY + 'px';

  const id = draggedToken.dataset.id;
  if (id) {
    if (allPlayers[id]) {
      allPlayers[id].x = newX;
      allPlayers[id].y = newY;
    }
    if (window.__webdnd_markers && window.__webdnd_markers[id]) {
      const m = window.__webdnd_markers[id];
      m.x = newX;
      m.y = newY;
      if (m.objectType === 'explosive' || m.objectType === 'aura' || m.objectType === 'spawner') {
        updateObjectMapRings(id, newX, newY, m.size || 50, m.objectType, m.objectConfig);
      }
    }
    throttledMovementEmit(id, newX, newY);
  }
}, { passive: false });

document.addEventListener('mouseup', () => {
  if (isDragging && draggedToken) {
    const id = draggedToken.dataset.id;
    const finalX = parseFloat(draggedToken.style.left);
    const finalY = parseFloat(draggedToken.style.top);
    if (id && !isNaN(finalX) && !isNaN(finalY)) {
      if (allPlayers[id]) {
        allPlayers[id].x = finalX;
        allPlayers[id].y = finalY;
      }
      if (window.__webdnd_markers && window.__webdnd_markers[id]) {
        window.__webdnd_markers[id].x = finalX;
        window.__webdnd_markers[id].y = finalY;
      }
      socket.emit('playerMovement', { id, x: finalX, y: finalY });
    }
  }
  isDragging = false;
  draggedToken = null;
});

document.addEventListener('touchend', () => {
  if (isDragging && draggedToken) {
    const id = draggedToken.dataset.id;
    const finalX = parseFloat(draggedToken.style.left);
    const finalY = parseFloat(draggedToken.style.top);
    if (id && !isNaN(finalX) && !isNaN(finalY)) {
      if (allPlayers[id]) {
        allPlayers[id].x = finalX;
        allPlayers[id].y = finalY;
      }
      if (window.__webdnd_markers && window.__webdnd_markers[id]) {
        window.__webdnd_markers[id].x = finalX;
        window.__webdnd_markers[id].y = finalY;
      }
      socket.emit('playerMovement', { id, x: finalX, y: finalY });
    }
  }
  isDragging = false;
  draggedToken = null;
});

document.addEventListener('touchcancel', () => {
  isDragging = false;
  draggedToken = null;
});

// ============================================================
// DM ARAÇLARI
// ============================================================

// ---- Marker Ekleme ----
const btnAddMarker = document.getElementById('btn-add-marker');
if (btnAddMarker) {
  btnAddMarker.addEventListener('click', () => {
    const nameEl    = document.getElementById('dm-marker-name');
    const colorEl   = document.getElementById('dm-marker-color');
    const imgEl     = document.getElementById('dm-marker-img');
    const hpEl      = document.getElementById('dm-marker-hp');
    const maxHpEl   = document.getElementById('dm-marker-max-hp');
    const sizeEl    = document.getElementById('dm-marker-size');
    const acEl      = document.getElementById('dm-marker-ac');
    const acBonusEl = document.getElementById('dm-marker-ac-bonus');

    const name   = (nameEl.value || 'X').trim();
    const color  = colorEl.value || '#f1c40f';
    const imgUrl = imgEl ? imgEl.value.trim() : '';
    const hp     = hpEl    && hpEl.value    !== '' ? parseInt(hpEl.value)    : null;
    const maxHp  = maxHpEl && maxHpEl.value !== '' ? parseInt(maxHpEl.value) : null;
    const size   = sizeEl  && sizeEl.value  !== '' ? parseInt(sizeEl.value)  : 50;
    const ac     = acEl    && acEl.value    !== '' ? parseInt(acEl.value)    : 10;
    const acBonus = acBonusEl && acBonusEl.value !== '' ? parseInt(acBonusEl.value) : 0;

    // Stat değerleri
    const getNum = (id) => { const el = document.getElementById(id); return el && el.value !== '' ? parseInt(el.value) : 0; };
    const stats = {
      str:       getNum('dm-marker-str'),
      str_bonus: getNum('dm-marker-str-bonus'),
      dex:       getNum('dm-marker-dex'),
      dex_bonus: getNum('dm-marker-dex-bonus'),
      int:       getNum('dm-marker-int'),
      int_bonus: getNum('dm-marker-int-bonus'),
      con:       getNum('dm-marker-con'),
      con_bonus: getNum('dm-marker-con-bonus'),
      wis:       getNum('dm-marker-wis'),
      wis_bonus: getNum('dm-marker-wis-bonus'),
      chr:       getNum('dm-marker-chr'),
      chr_bonus: getNum('dm-marker-chr-bonus'),
    };

    // Kenan Modu: Karanlık Değerleri
    const hasDarknessCb = document.getElementById('dm-marker-has-darkness');
    const hasDarkness = Boolean(hasDarknessCb && hasDarknessCb.checked);
    const darknessEl = document.getElementById('dm-marker-darkness');
    const maxDarknessEl = document.getElementById('dm-marker-max-darkness');
    const darkness = darknessEl && darknessEl.value !== '' ? parseInt(darknessEl.value) : 0;
    const maxDarkness = maxDarknessEl && maxDarknessEl.value !== '' ? parseInt(maxDarknessEl.value) : 100;

    // Seçili saldırı presetlerini al (Opsiyonel)
    const createAttacksCbs = document.querySelectorAll('#dm-create-token-attacks-list input[type="checkbox"]:checked');
    const assignedAttacks = Array.from(createAttacksCbs).map(cb => cb.value);

    // Cansız Obje Ayarlarını Al (Opsiyonel)
    const objectType = document.getElementById('dm-marker-type')?.value || 'creature';
    let objectConfig = null;
    if (objectType !== 'creature') {
      const getObjNum = (id, def) => { const el = document.getElementById(id); return el && el.value !== '' ? parseInt(el.value) : def; };
      if (objectType === 'spawner') {
        objectConfig = {
          spawnPresetId: document.getElementById('dm-marker-obj-spawner-preset')?.value || '',
          spawnCount: Math.max(1, Math.min(10, getObjNum('dm-marker-obj-spawner-count', 1))),
          spawnRadius: Math.max(40, Math.min(500, getObjNum('dm-marker-obj-spawner-radius', 85))),
          spawnTiming: document.getElementById('dm-marker-obj-spawner-timing')?.value || 'turn',
          destroyOnBreak: Boolean(document.getElementById('dm-marker-obj-spawner-destroy')?.checked),
          totalSpawnedSoFar: 0
        };
      } else {
        objectConfig = {
          radius: getObjNum('dm-marker-obj-radius', objectType === 'explosive' ? 120 : 150),
          damage: getObjNum('dm-marker-obj-damage', 0),
          damageType: document.getElementById('dm-marker-obj-damage-type')?.value || (objectType === 'explosive' ? 'fire' : 'necrotic'),
          targetFilter: document.getElementById('dm-marker-obj-target-filter')?.value || 'all',
          destroyOnExplode: Boolean(document.getElementById('dm-marker-obj-destroy')?.checked),
          triggerTiming: document.getElementById('dm-marker-obj-timing')?.value || 'turn',
          statusEffects: Array.isArray(createObjSelectedEffects) ? [...createObjSelectedEffects] : []
        };
      }
    }

    socket.emit('createMarker', {
      name, color, x: 200, y: 200, imgUrl, hp, maxHp, size, ac, acBonus, stats, assignedAttacks, hasDarkness, darkness, maxDarkness,
      objectType, objectConfig
    });

    // Spawn bildirim tostu göster
    const mapContainer = document.getElementById('game-map');
    if (mapContainer) {
      const toast = document.createElement('div');
      toast.className = 'dice-toast';
      toast.innerHTML = `🚀 <strong>"${escapeHtml(name)}"</strong> haritaya spawn edildi!`;
      mapContainer.appendChild(toast);
      setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 2500);
    }
  });

  // Kenan Modu: Token oluşturma formunda checkbox değişim dinleyicisi
  const createHasDarknessCheckbox = document.getElementById('dm-marker-has-darkness');
  const createDarknessInputsWrap = document.getElementById('dm-marker-darkness-inputs');
  if (createHasDarknessCheckbox && createDarknessInputsWrap) {
    createHasDarknessCheckbox.addEventListener('change', () => {
      createDarknessInputsWrap.classList.toggle('hidden', !createHasDarknessCheckbox.checked);
    });
  }
}

// ============================================================
// TOKEN HAZIR ŞEMALARI (TOKEN PRESETS / SCHEMAS) İSTEMCİ YÖNETİMİ
// ============================================================
let currentTokenPresets = [];

function renderTokenPresetsDropdown(presets) {
  if (Array.isArray(presets)) {
    currentTokenPresets = presets;
  }
  const select = document.getElementById('dm-token-preset-select');
  const badge = document.getElementById('dm-token-preset-badge');
  const delBtn = document.getElementById('btn-delete-token-preset');
  if (!select) return;

  const currentVal = select.value;
  if (badge) {
    badge.textContent = `${currentTokenPresets.length} Şema`;
  }

  select.innerHTML = '<option value="">— Hazır Şema Seç (Değerleri Doldur) —</option>';
  currentTokenPresets.forEach(preset => {
    const opt = document.createElement('option');
    opt.value = preset.id;
    const hpStr = preset.hp != null ? `HP: ${preset.hp}` : '';
    const acStr = preset.ac != null ? `AC: ${preset.ac}` : '';
    const meta = [hpStr, acStr].filter(Boolean).join(', ');
    opt.textContent = `${preset.name}${meta ? ` [${meta}]` : ''}`;
    select.appendChild(opt);
  });

  // Çağırıcı / Yuva için düşman şablonu dropdownlarını doldur
  const populateSpawnerDropdown = (elId) => {
    const spSelect = document.getElementById(elId);
    if (!spSelect) return;
    const oldVal = spSelect.value;
    spSelect.innerHTML = '<option value="">— Doğurulacak Düşman Seçin —</option>';
    currentTokenPresets
      .filter(p => p.objectType === 'creature' || !p.objectType)
      .forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        const hpStr = p.hp != null ? `HP: ${p.hp}` : '';
        const acStr = p.ac != null ? `AC: ${p.ac}` : '';
        const meta = [hpStr, acStr].filter(Boolean).join(', ');
        opt.textContent = `👾 ${p.name}${meta ? ` [${meta}]` : ''}`;
        spSelect.appendChild(opt);
      });
    if (oldVal && currentTokenPresets.some(p => p.id === oldVal)) {
      spSelect.value = oldVal;
    }
  };
  populateSpawnerDropdown('dm-marker-obj-spawner-preset');
  populateSpawnerDropdown('dm-marker-edit-obj-spawner-preset');

  if (currentVal && currentTokenPresets.some(p => p.id === currentVal)) {
    select.value = currentVal;
    if (delBtn) delBtn.style.display = 'inline-flex';
  } else {
    if (delBtn) delBtn.style.display = 'none';
  }
}

function applyTokenPresetToForm(preset) {
  if (!preset) return;

  const nameEl = document.getElementById('dm-marker-name');
  if (nameEl) nameEl.value = preset.name || '';

  const imgEl = document.getElementById('dm-marker-img');
  if (imgEl) imgEl.value = preset.imgUrl || '';

  const colorEl = document.getElementById('dm-marker-color');
  if (colorEl) colorEl.value = preset.color || '#f1c40f';

  const hpEl = document.getElementById('dm-marker-hp');
  if (hpEl) hpEl.value = preset.hp != null ? preset.hp : '';

  const maxHpEl = document.getElementById('dm-marker-max-hp');
  if (maxHpEl) maxHpEl.value = preset.maxHp != null ? preset.maxHp : '';

  const sizeEl = document.getElementById('dm-marker-size');
  if (sizeEl) sizeEl.value = preset.size || 50;

  const acEl = document.getElementById('dm-marker-ac');
  if (acEl) acEl.value = preset.ac != null ? preset.ac : 10;

  const acBonusEl = document.getElementById('dm-marker-ac-bonus');
  if (acBonusEl) acBonusEl.value = (preset.acBonus != null ? preset.acBonus : (preset.ac_bonus != null ? preset.ac_bonus : 0));

  // Statlar
  const setNum = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val != null ? val : 0;
  };
  const stats = preset.stats || {};
  setNum('dm-marker-str', stats.str != null ? stats.str : 10);
  setNum('dm-marker-str-bonus', stats.str_bonus != null ? stats.str_bonus : 0);
  setNum('dm-marker-dex', stats.dex != null ? stats.dex : 10);
  setNum('dm-marker-dex-bonus', stats.dex_bonus != null ? stats.dex_bonus : 0);
  setNum('dm-marker-int', stats.int != null ? stats.int : 10);
  setNum('dm-marker-int-bonus', stats.int_bonus != null ? stats.int_bonus : 0);
  setNum('dm-marker-con', stats.con != null ? stats.con : 10);
  setNum('dm-marker-con-bonus', stats.con_bonus != null ? stats.con_bonus : 0);
  setNum('dm-marker-wis', stats.wis != null ? stats.wis : 10);
  setNum('dm-marker-wis-bonus', stats.wis_bonus != null ? stats.wis_bonus : 0);
  setNum('dm-marker-chr', stats.chr != null ? stats.chr : 10);
  setNum('dm-marker-chr-bonus', stats.chr_bonus != null ? stats.chr_bonus : 0);

  // Kenan Modu Karanlık
  const hasDarknessCb = document.getElementById('dm-marker-has-darkness');
  const darknessInputsWrap = document.getElementById('dm-marker-darkness-inputs');
  if (hasDarknessCb) {
    hasDarknessCb.checked = Boolean(preset.hasDarkness);
    if (darknessInputsWrap) {
      darknessInputsWrap.classList.toggle('hidden', !preset.hasDarkness);
    }
  }
  const darknessEl = document.getElementById('dm-marker-darkness');
  if (darknessEl) darknessEl.value = preset.darkness != null ? preset.darkness : 0;
  const maxDarknessEl = document.getElementById('dm-marker-max-darkness');
  if (maxDarknessEl) maxDarknessEl.value = preset.maxDarkness != null ? preset.maxDarkness : 100;

  // Cansız Obje Ayarları
  const typeSelect = document.getElementById('dm-marker-type');
  if (typeSelect) {
    typeSelect.value = preset.objectType || 'creature';
    typeSelect.dispatchEvent(new Event('change'));
  }
  if (preset.objectConfig) {
    const cfg = preset.objectConfig;
    const rEl = document.getElementById('dm-marker-obj-radius');
    if (rEl && cfg.radius != null) rEl.value = cfg.radius;
    const dEl = document.getElementById('dm-marker-obj-damage');
    if (dEl && cfg.damage != null) dEl.value = cfg.damage;
    const dtEl = document.getElementById('dm-marker-obj-damage-type');
    if (dtEl && cfg.damageType) dtEl.value = cfg.damageType;
    const fEl = document.getElementById('dm-marker-obj-target-filter');
    if (fEl && cfg.targetFilter) fEl.value = cfg.targetFilter;
    const desEl = document.getElementById('dm-marker-obj-destroy');
    if (desEl) desEl.checked = cfg.destroyOnExplode !== false;
    const tmEl = document.getElementById('dm-marker-obj-timing');
    if (tmEl && cfg.triggerTiming) tmEl.value = cfg.triggerTiming;

    // Spawner alanları
    const spPreset = document.getElementById('dm-marker-obj-spawner-preset');
    if (spPreset && cfg.spawnPresetId) spPreset.value = cfg.spawnPresetId;
    const spCount = document.getElementById('dm-marker-obj-spawner-count');
    if (spCount && cfg.spawnCount != null) spCount.value = cfg.spawnCount;
    const spRadius = document.getElementById('dm-marker-obj-spawner-radius');
    if (spRadius && cfg.spawnRadius != null) spRadius.value = cfg.spawnRadius;
    const spTiming = document.getElementById('dm-marker-obj-spawner-timing');
    if (spTiming && cfg.spawnTiming) spTiming.value = cfg.spawnTiming;
    const spDes = document.getElementById('dm-marker-obj-spawner-destroy');
    if (spDes) spDes.checked = cfg.destroyOnBreak !== false;

    if (Array.isArray(cfg.statusEffects) && typeof createObjSelectedEffects !== 'undefined') {
      createObjSelectedEffects = [...cfg.statusEffects];
      if (typeof renderCreateObjSelectedEffects === 'function') {
        renderCreateObjSelectedEffects();
      }
    }
  }

  // Atanmış Saldırılar
  const assignedList = Array.isArray(preset.assignedAttacks) ? preset.assignedAttacks : [];
  const assignedSet = new Set(assignedList);
  const attackCbs = document.querySelectorAll('#dm-create-token-attacks-list input[type="checkbox"]');
  attackCbs.forEach(cb => {
    cb.checked = assignedSet.has(cb.value);
  });
}

function setupTokenPresetControls() {
  const select = document.getElementById('dm-token-preset-select');
  const delBtn = document.getElementById('btn-delete-token-preset');
  const saveBtn = document.getElementById('btn-save-token-preset');

  if (select && !select._bound) {
    select._bound = true;
    select.addEventListener('change', () => {
      const presetId = select.value;
      if (!presetId) {
        if (delBtn) delBtn.style.display = 'none';
        return;
      }
      const preset = currentTokenPresets.find(p => p.id === presetId);
      if (preset) {
        applyTokenPresetToForm(preset);
        if (delBtn) delBtn.style.display = 'inline-flex';
      }
    });
  }

  if (delBtn && !delBtn._bound) {
    delBtn._bound = true;
    delBtn.addEventListener('click', () => {
      const presetId = select ? select.value : '';
      if (!presetId) return;
      const preset = currentTokenPresets.find(p => p.id === presetId);
      const name = preset ? preset.name : 'Bu şemayı';
      if (confirm(`"${name}" şablonunu kalıcı olarak silmek istediğinize emin misiniz?`)) {
        socket.emit('deleteTokenPreset', presetId);
        if (select) select.value = '';
        delBtn.style.display = 'none';
      }
    });
  }

  if (saveBtn && !saveBtn._bound) {
    saveBtn._bound = true;
    saveBtn.addEventListener('click', () => {
      const nameEl = document.getElementById('dm-marker-name');
      let name = (nameEl ? nameEl.value : '').trim();

      if (!name) {
        name = prompt('Lütfen bu şema için bir isim girin (Örn: Goblin Okçu):', 'Yeni Şema');
        if (!name || !name.trim()) return;
        name = name.trim();
        if (nameEl) nameEl.value = name;
      }

      // Mevcut seçili şema var mı?
      const selectedId = select ? select.value : '';
      const existingPreset = currentTokenPresets.find(p => p.id === selectedId);
      let presetId = null;

      if (existingPreset && existingPreset.name === name) {
        presetId = existingPreset.id;
      } else {
        presetId = 'tp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      }

      const colorEl = document.getElementById('dm-marker-color');
      const imgEl = document.getElementById('dm-marker-img');
      const hpEl = document.getElementById('dm-marker-hp');
      const maxHpEl = document.getElementById('dm-marker-max-hp');
      const sizeEl = document.getElementById('dm-marker-size');
      const acEl = document.getElementById('dm-marker-ac');
      const acBonusEl = document.getElementById('dm-marker-ac-bonus');

      const color = colorEl ? colorEl.value : '#f1c40f';
      const imgUrl = imgEl ? imgEl.value.trim() : '';
      const hp = hpEl && hpEl.value !== '' ? parseInt(hpEl.value) : null;
      const maxHp = maxHpEl && maxHpEl.value !== '' ? parseInt(maxHpEl.value) : null;
      const size = sizeEl && sizeEl.value !== '' ? parseInt(sizeEl.value) : 50;
      const ac = acEl && acEl.value !== '' ? parseInt(acEl.value) : 10;
      const acBonus = acBonusEl && acBonusEl.value !== '' ? parseInt(acBonusEl.value) : 0;

      const getNum = (id) => { const el = document.getElementById(id); return el && el.value !== '' ? parseInt(el.value) : 0; };
      const stats = {
        str:       getNum('dm-marker-str'),
        str_bonus: getNum('dm-marker-str-bonus'),
        dex:       getNum('dm-marker-dex'),
        dex_bonus: getNum('dm-marker-dex-bonus'),
        int:       getNum('dm-marker-int'),
        int_bonus: getNum('dm-marker-int-bonus'),
        con:       getNum('dm-marker-con'),
        con_bonus: getNum('dm-marker-con-bonus'),
        wis:       getNum('dm-marker-wis'),
        wis_bonus: getNum('dm-marker-wis-bonus'),
        chr:       getNum('dm-marker-chr'),
        chr_bonus: getNum('dm-marker-chr-bonus'),
      };

      const hasDarknessCb = document.getElementById('dm-marker-has-darkness');
      const hasDarkness = Boolean(hasDarknessCb && hasDarknessCb.checked);
      const darknessEl = document.getElementById('dm-marker-darkness');
      const maxDarknessEl = document.getElementById('dm-marker-max-darkness');
      const darkness = darknessEl && darknessEl.value !== '' ? parseInt(darknessEl.value) : 0;
      const maxDarkness = maxDarknessEl && maxDarknessEl.value !== '' ? parseInt(maxDarknessEl.value) : 100;

      const createAttacksCbs = document.querySelectorAll('#dm-create-token-attacks-list input[type="checkbox"]:checked');
      const assignedAttacks = Array.from(createAttacksCbs).map(cb => cb.value);

      const objectType = document.getElementById('dm-marker-type')?.value || 'creature';
      let objectConfig = null;
      if (objectType !== 'creature') {
        const getObjNum = (id, def) => { const el = document.getElementById(id); return el && el.value !== '' ? parseInt(el.value) : def; };
        if (objectType === 'spawner') {
          objectConfig = {
            spawnPresetId: document.getElementById('dm-marker-obj-spawner-preset')?.value || '',
            spawnCount: Math.max(1, Math.min(10, getObjNum('dm-marker-obj-spawner-count', 1))),
            spawnRadius: Math.max(40, Math.min(500, getObjNum('dm-marker-obj-spawner-radius', 85))),
            spawnTiming: document.getElementById('dm-marker-obj-spawner-timing')?.value || 'turn',
            destroyOnBreak: Boolean(document.getElementById('dm-marker-obj-spawner-destroy')?.checked),
            totalSpawnedSoFar: 0
          };
        } else {
          objectConfig = {
            radius: getObjNum('dm-marker-obj-radius', objectType === 'explosive' ? 120 : 150),
            damage: getObjNum('dm-marker-obj-damage', 0),
            damageType: document.getElementById('dm-marker-obj-damage-type')?.value || (objectType === 'explosive' ? 'fire' : 'necrotic'),
            targetFilter: document.getElementById('dm-marker-obj-target-filter')?.value || 'all',
            destroyOnExplode: Boolean(document.getElementById('dm-marker-obj-destroy')?.checked),
            triggerTiming: document.getElementById('dm-marker-obj-timing')?.value || 'turn',
            statusEffects: Array.isArray(createObjSelectedEffects) ? [...createObjSelectedEffects] : []
          };
        }
      }

      const presetData = {
        id: presetId,
        name,
        imgUrl,
        color,
        hp,
        maxHp,
        size,
        ac,
        acBonus,
        stats,
        hasDarkness,
        darkness,
        maxDarkness,
        assignedAttacks,
        objectType,
        objectConfig
      };

      socket.emit('saveTokenPreset', presetData);

      // Toast bildirim göster
      const mapContainer = document.getElementById('game-map');
      if (mapContainer) {
        const toast = document.createElement('div');
        toast.className = 'dice-toast';
        toast.innerHTML = `💾 <strong>"${escapeHtml(name)}"</strong> şeması başarıyla kaydedildi!`;
        mapContainer.appendChild(toast);
        setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 3000);
      }
    });
  }
}

// Socket senkronizasyonu: Token Şemaları
socket.on('tokenPresetsUpdated', (presets) => {
  if (Array.isArray(presets)) {
    renderTokenPresetsDropdown(presets);
  }
});

// Sayfa ilk yüklendiğinde kontrolleri bağla
setupTokenPresetControls();

// ---- Marker Düzenleme Modalı ----
let editingMarkerId = null;

function openMarkerEditor(markerInput) {
  const markerId = typeof markerInput === 'string' ? markerInput : (markerInput ? markerInput.id : null);
  if (!markerId) return;

  // Her zaman window.__webdnd_markers içerisindeki en güncel (o anki) veriyi al
  const markerData = (window.__webdnd_markers && window.__webdnd_markers[markerId]) 
    || (typeof markerInput === 'object' ? markerInput : null);
  if (!markerData) return;

  editingMarkerId = markerData.id;

  const titleEl = document.getElementById('dm-marker-edit-title');
  if (titleEl) titleEl.textContent = `"${markerData.name || 'Token'}" Düzenle`;

  const nameEl = document.getElementById('dm-marker-edit-name');
  if (nameEl) nameEl.value = markerData.name || '';

  const imgEl = document.getElementById('dm-marker-edit-img');
  if (imgEl) imgEl.value = markerData.imgUrl || '';

  const colorEl = document.getElementById('dm-marker-edit-color');
  if (colorEl) colorEl.value = markerData.color || '#f1c40f';

  const hpEl = document.getElementById('dm-marker-edit-hp');
  if (hpEl) hpEl.value = markerData.hp != null ? markerData.hp : '';

  const maxHpEl = document.getElementById('dm-marker-edit-max-hp');
  if (maxHpEl) maxHpEl.value = markerData.maxHp != null ? markerData.maxHp : '';

  const sizeEl = document.getElementById('dm-marker-edit-size');
  if (sizeEl) sizeEl.value = markerData.size || 50;

  const acEl = document.getElementById('dm-marker-edit-ac');
  if (acEl) acEl.value = markerData.ac != null ? markerData.ac : 10;

  const acBonusEl = document.getElementById('dm-marker-edit-ac-bonus');
  if (acBonusEl) acBonusEl.value = markerData.ac_bonus != null ? markerData.ac_bonus : (markerData.acBonus != null ? markerData.acBonus : 0);

  // Kenan Modu: Marker Karanlık Alanları
  const editHasDarknessCb = document.getElementById('dm-marker-edit-has-darkness');
  const editDarknessInputsWrap = document.getElementById('dm-marker-edit-darkness-inputs');
  const editDarknessInput = document.getElementById('dm-marker-edit-darkness');
  const editMaxDarknessInput = document.getElementById('dm-marker-edit-max-darkness');

  const hasDarkness = Boolean(markerData.hasDarkness);
  if (editHasDarknessCb) editHasDarknessCb.checked = hasDarkness;
  if (editDarknessInputsWrap) editDarknessInputsWrap.classList.toggle('hidden', !hasDarkness);
  if (editDarknessInput) editDarknessInput.value = markerData.darkness != null ? markerData.darkness : 0;
  if (editMaxDarknessInput) editMaxDarknessInput.value = markerData.maxDarkness != null ? markerData.maxDarkness : 100;

  // Stat değerleri
  const stats = markerData.stats || {};
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = (val !== undefined && val !== null) ? val : 0;
  };

  setVal('dm-marker-edit-str', stats.str);
  setVal('dm-marker-edit-str-bonus', stats.str_bonus);
  setVal('dm-marker-edit-dex', stats.dex);
  setVal('dm-marker-edit-dex-bonus', stats.dex_bonus);
  setVal('dm-marker-edit-int', stats.int);
  setVal('dm-marker-edit-int-bonus', stats.int_bonus);
  setVal('dm-marker-edit-con', stats.con);
  setVal('dm-marker-edit-con-bonus', stats.con_bonus);
  setVal('dm-marker-edit-wis', stats.wis);
  setVal('dm-marker-edit-wis-bonus', stats.wis_bonus);
  setVal('dm-marker-edit-chr', stats.chr);
  setVal('dm-marker-edit-chr-bonus', stats.chr_bonus);

  // Cansız Obje Ayarlarını Doldur
  const markerTypeSelect = document.getElementById('dm-marker-edit-type');
  const objType = markerData.objectType || 'creature';
  if (markerTypeSelect) markerTypeSelect.value = objType;

  const cfg = markerData.objectConfig || {};
  const setElVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  setElVal('dm-marker-edit-obj-radius', cfg.radius || (objType === 'explosive' ? 120 : 150));
  setElVal('dm-marker-edit-obj-damage', cfg.damage != null ? cfg.damage : (objType === 'explosive' ? 20 : 0));
  setElVal('dm-marker-edit-obj-damage-type', cfg.damageType || (objType === 'explosive' ? 'fire' : 'necrotic'));
  setElVal('dm-marker-edit-obj-target-filter', cfg.targetFilter || 'all');
  setElVal('dm-marker-edit-obj-timing', cfg.triggerTiming || 'turn');

  // Spawner alanları
  setElVal('dm-marker-edit-obj-spawner-preset', cfg.spawnPresetId || '');
  setElVal('dm-marker-edit-obj-spawner-count', cfg.spawnCount != null ? cfg.spawnCount : 1);
  setElVal('dm-marker-edit-obj-spawner-radius', cfg.spawnRadius != null ? cfg.spawnRadius : 85);
  setElVal('dm-marker-edit-obj-spawner-timing', cfg.spawnTiming || 'turn');
  const editSpawnerDestroyCb = document.getElementById('dm-marker-edit-obj-spawner-destroy');
  if (editSpawnerDestroyCb) editSpawnerDestroyCb.checked = cfg.destroyOnBreak !== false;

  const destroyCb = document.getElementById('dm-marker-edit-obj-destroy');
  if (destroyCb) destroyCb.checked = cfg.destroyOnExplode !== false;

  editObjSelectedEffects = Array.isArray(cfg.statusEffects) ? JSON.parse(JSON.stringify(cfg.statusEffects)) : [];
  renderObjSelectedEffects(document.getElementById('dm-marker-edit-obj-selected-effects'), editObjSelectedEffects);

  if (markerTypeSelect) {
    markerTypeSelect.dispatchEvent(new Event('change'));
  }

  renderMarkerEditorActiveEffects(markerData);
  renderMarkerAssignedAttacks(markerData);
  populateTokenEditorEffectSelect(document.getElementById('dm-marker-add-effect-select'));
  populateTokenEditorEffectSelect(document.getElementById('dm-marker-edit-obj-effect-select'));

  document.getElementById('dm-marker-editor-modal').classList.remove('hidden');
}

let markerAssignedSearchTerm = '';

function updateMarkerAssignedCountBadge(count, total) {
  const badge = document.getElementById('dm-marker-assigned-count');
  if (badge) {
    badge.textContent = `(${count} / ${total} Seçili)`;
    badge.classList.toggle('has-selected', count > 0);
  }
}

/**
 * Marker düzenleme modalındaki atanmış saldırı presetlerini listeler ve seçim sunar (Sınırsız).
 */
function renderMarkerAssignedAttacks(markerData) {
  const container = document.getElementById('dm-marker-assigned-attacks');
  if (!container) return;

  container.innerHTML = '';
  const allPresets = typeof window.__webdnd_getAttackPresets === 'function' ? window.__webdnd_getAttackPresets() : [];
  if (!markerData) return;
  const currentMarker = (window.__webdnd_markers && window.__webdnd_markers[markerData.id]) || markerData;
  const assigned = currentMarker.assignedAttacks || [];

  updateMarkerAssignedCountBadge(assigned.length, allPresets.length);

  // Arama ve aksiyon butonlarını bağla
  const searchInput = document.getElementById('dm-marker-assigned-search');
  if (searchInput && !searchInput._bound) {
    searchInput._bound = true;
    searchInput.addEventListener('input', (e) => {
      markerAssignedSearchTerm = e.target.value.toLowerCase().trim();
      if (editingMarkerId && window.__webdnd_markers && window.__webdnd_markers[editingMarkerId]) {
        renderMarkerAssignedAttacks(window.__webdnd_markers[editingMarkerId]);
      }
    });
  }

  const selectAllBtn = document.getElementById('dm-marker-assigned-select-all');
  if (selectAllBtn && !selectAllBtn._bound) {
    selectAllBtn._bound = true;
    selectAllBtn.addEventListener('click', () => {
      const cbs = container.querySelectorAll('input[type="checkbox"]');
      cbs.forEach(cb => {
        cb.checked = true;
        cb.closest('.assigned-attack-item')?.classList.add('is-selected');
      });
      const selected = Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(c => c.value);
      updateMarkerAssignedCountBadge(selected.length, allPresets.length);
    });
  }

  const clearAllBtn = document.getElementById('dm-marker-assigned-clear-all');
  if (clearAllBtn && !clearAllBtn._bound) {
    clearAllBtn._bound = true;
    clearAllBtn.addEventListener('click', () => {
      const cbs = container.querySelectorAll('input[type="checkbox"]');
      cbs.forEach(cb => {
        cb.checked = false;
        cb.closest('.assigned-attack-item')?.classList.remove('is-selected');
      });
      updateMarkerAssignedCountBadge(0, allPresets.length);
    });
  }

  if (allPresets.length === 0) {
    container.innerHTML = '<span style="font-size:11px; color:#7f8c8d; font-style:italic;">Kayıtlı saldırı preseti bulunamadı.</span>';
    return;
  }

  const filteredPresets = allPresets.filter(preset => {
    if (!markerAssignedSearchTerm) return true;
    const name = (preset.name || '').toLowerCase();
    const stat = (preset.stat || '').toLowerCase();
    const type = (preset.attackType || '').toLowerCase();
    return name.includes(markerAssignedSearchTerm) || stat.includes(markerAssignedSearchTerm) || type.includes(markerAssignedSearchTerm);
  });

  if (filteredPresets.length === 0) {
    container.innerHTML = `<span style="font-size:11px; color:#7f8c8d; font-style:italic; grid-column: 1 / -1;">"${escapeHtml(markerAssignedSearchTerm)}" ile eşleşen saldırı bulunamadı.</span>`;
    return;
  }

  filteredPresets.forEach(preset => {
    const isSelected = assigned.includes(preset.id);
    const item = document.createElement('label');
    item.className = 'assigned-attack-item' + (isSelected ? ' is-selected' : '');
    
    const typeIcon = preset.attackType === 'spell' ? '✨' : '⚔️';
    item.innerHTML = `
      <input type="checkbox" value="${preset.id}" ${isSelected ? 'checked' : ''}>
      <span>${typeIcon}</span>
      <span class="assigned-attack-name" title="${escapeHtml(preset.name)}">${escapeHtml(preset.name)}</span>
      <span class="assigned-attack-stat">${preset.stat || 'STR'}</span>
    `;

    const checkbox = item.querySelector('input[type="checkbox"]');
    checkbox.addEventListener('change', () => {
      item.classList.toggle('is-selected', checkbox.checked);
      const totalChecked = container.querySelectorAll('input[type="checkbox"]:checked').length;
      updateMarkerAssignedCountBadge(totalChecked, allPresets.length);
    });

    container.appendChild(item);
  });
}

/**
 * Marker düzenleme modalındaki aktif durum efektlerini listeler ve silme seçeneği sunar.
 */
function renderMarkerEditorActiveEffects(markerData) {
  const container = document.getElementById('dm-marker-active-effects');
  const clearAllBtn = document.getElementById('dm-marker-clear-all-effects');
  if (!container) return;

  container.innerHTML = '';
  const currentMarker = (window.__webdnd_markers && window.__webdnd_markers[markerData.id]) || markerData;
  const activeEffects = currentMarker.activeEffects || [];

  if (clearAllBtn) {
    clearAllBtn.style.display = activeEffects.length > 0 ? 'inline-block' : 'none';
    clearAllBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      socket.emit('removeStatusEffect', {
        targetType: 'marker',
        targetId: currentMarker.id,
        effectId: 'all'
      });
      currentMarker.activeEffects = [];
      renderMarkerEditorActiveEffects(currentMarker);
    };
  }

  if (activeEffects.length === 0) {
    container.innerHTML = '<span style="font-size:11px; color:#7f8c8d; font-style:italic;">Aktif durum efekti yok.</span>';
    return;
  }

  activeEffects.forEach(eff => {
    const chip = document.createElement('span');
    chip.className = 'status-target-chip';
    const durText = eff.duration != null ? `${eff.duration}T` : '∞';
    const ruleDesc = typeof describeStatusRules === 'function' ? describeStatusRules(eff.effects) : '';
    chip.title = `${eff.icon || '✨'} ${eff.name || 'Efekt'} (${durText})${ruleDesc ? ': ' + ruleDesc : ''}`;
    chip.innerHTML = `
      <span>${eff.icon || '✨'}</span>
      <strong>${escapeHtml(eff.name || 'Efekt')}</strong>
      <span style="font-size:10px; opacity:0.8;">(${durText})</span>
      <span class="chip-del-btn" title="Efekti Kaldır">✕</span>
    `;

    const delBtn = chip.querySelector('.chip-del-btn');
    if (delBtn) {
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        socket.emit('removeStatusEffect', {
          targetType: 'marker',
          targetId: currentMarker.id,
          effectId: eff.id
        });
        currentMarker.activeEffects = currentMarker.activeEffects.filter(item => item.id !== eff.id);
        renderMarkerEditorActiveEffects(currentMarker);
      });
    }

    container.appendChild(chip);
  });
}

// Marker Düzenleme Modalında Durum Efekti Ekleme Butonu
const btnMarkerAddEffect = document.getElementById('dm-marker-btn-add-effect');
if (btnMarkerAddEffect && !btnMarkerAddEffect._bound) {
  btnMarkerAddEffect._bound = true;
  btnMarkerAddEffect.addEventListener('click', () => {
    if (!editingMarkerId || !window.__webdnd_markers || !window.__webdnd_markers[editingMarkerId]) {
      alert('Düzenlenen token bulunamadı!');
      return;
    }
    const select = document.getElementById('dm-marker-add-effect-select');
    const durInput = document.getElementById('dm-marker-add-effect-duration');
    const presetId = select?.value;
    if (!presetId) {
      alert('Lütfen eklenecek durum efektini seçin!');
      return;
    }
    const preset = currentStatusPresets.find(p => p.id === presetId);
    if (!preset) return;

    const effectToApply = JSON.parse(JSON.stringify(preset));
    effectToApply.id = 'eff_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    const customDur = durInput && durInput.value.trim() !== '' ? parseInt(durInput.value) : null;
    if (customDur !== null && !isNaN(customDur)) {
      effectToApply.duration = Math.max(1, customDur);
    }

    socket.emit('applyStatusEffect', {
      targetType: 'marker',
      targetId: editingMarkerId,
      effect: effectToApply
    });

    // Anında yerel olarak da ekle ve listeyi tazele
    const m = window.__webdnd_markers[editingMarkerId];
    if (!m.activeEffects) m.activeEffects = [];
    const idx = m.activeEffects.findIndex(e => e.id === effectToApply.id || e.name === effectToApply.name);
    if (idx >= 0) m.activeEffects[idx] = effectToApply;
    else m.activeEffects.push(effectToApply);
    renderMarkerEditorActiveEffects(m);

    if (select) select.value = '';
    if (durInput) durInput.value = '';
  });
}

const btnCancelMarkerEdit = document.getElementById('btn-cancel-marker-edit');
if (btnCancelMarkerEdit) {
  btnCancelMarkerEdit.addEventListener('click', () => {
    document.getElementById('dm-marker-editor-modal').classList.add('hidden');
    editingMarkerId = null;
  });
}

const btnSaveMarkerEdit = document.getElementById('btn-save-marker-edit');
if (btnSaveMarkerEdit) {
  btnSaveMarkerEdit.addEventListener('click', () => {
    if (!editingMarkerId) return;

    const nameEl = document.getElementById('dm-marker-edit-name');
    const imgEl = document.getElementById('dm-marker-edit-img');
    const colorEl = document.getElementById('dm-marker-edit-color');
    const hpEl = document.getElementById('dm-marker-edit-hp');
    const maxHpEl = document.getElementById('dm-marker-edit-max-hp');
    const sizeEl = document.getElementById('dm-marker-edit-size');
    const acEl = document.getElementById('dm-marker-edit-ac');
    const acBonusEl = document.getElementById('dm-marker-edit-ac-bonus');

    const name = nameEl ? (nameEl.value || 'X').substring(0, 2) : 'X';
    const imgUrl = imgEl ? imgEl.value : '';
    const color = colorEl ? colorEl.value : '#f1c40f';
    const hp = hpEl && hpEl.value !== '' ? parseInt(hpEl.value) : null;
    const maxHp = maxHpEl && maxHpEl.value !== '' ? parseInt(maxHpEl.value) : null;
    const size = sizeEl && sizeEl.value !== '' ? parseInt(sizeEl.value) : 50;
    const ac = acEl && acEl.value !== '' ? parseInt(acEl.value) : 10;
    const ac_bonus = acBonusEl && acBonusEl.value !== '' ? parseInt(acBonusEl.value) : 0;

    const getNum = (id) => { const el = document.getElementById(id); return el && el.value !== '' ? parseInt(el.value) : 0; };
    const stats = {
      str: getNum('dm-marker-edit-str'),
      str_bonus: getNum('dm-marker-edit-str-bonus'),
      dex: getNum('dm-marker-edit-dex'),
      dex_bonus: getNum('dm-marker-edit-dex-bonus'),
      int: getNum('dm-marker-edit-int'),
      int_bonus: getNum('dm-marker-edit-int-bonus'),
      con: getNum('dm-marker-edit-con'),
      con_bonus: getNum('dm-marker-edit-con-bonus'),
      wis: getNum('dm-marker-edit-wis'),
      wis_bonus: getNum('dm-marker-edit-wis-bonus'),
      chr: getNum('dm-marker-edit-chr'),
      chr_bonus: getNum('dm-marker-edit-chr-bonus'),
    };

    const assignedCheckboxes = document.querySelectorAll('#dm-marker-assigned-attacks input[type="checkbox"]:checked');
    const assignedAttacks = Array.from(assignedCheckboxes).map(cb => cb.value);

    // Kenan Modu: Marker Karanlık Değerleri
    const editHasDarknessCb = document.getElementById('dm-marker-edit-has-darkness');
    const hasDarkness = Boolean(editHasDarknessCb && editHasDarknessCb.checked);
    const editDarknessEl = document.getElementById('dm-marker-edit-darkness');
    const editMaxDarknessEl = document.getElementById('dm-marker-edit-max-darkness');
    const darkness = editDarknessEl && editDarknessEl.value !== '' ? parseInt(editDarknessEl.value) : 0;
    const maxDarkness = editMaxDarknessEl && editMaxDarknessEl.value !== '' ? parseInt(editMaxDarknessEl.value) : 100;

    // Cansız Obje Ayarlarını Al
    const objectType = document.getElementById('dm-marker-edit-type')?.value || 'creature';
    let objectConfig = null;
    if (objectType !== 'creature') {
      const getObjNum = (id, def) => { const el = document.getElementById(id); return el && el.value !== '' ? parseInt(el.value) : def; };
      objectConfig = {
        radius: getObjNum('dm-marker-edit-obj-radius', objectType === 'explosive' ? 120 : 150),
        damage: getObjNum('dm-marker-edit-obj-damage', 0),
        damageType: document.getElementById('dm-marker-edit-obj-damage-type')?.value || (objectType === 'explosive' ? 'fire' : 'necrotic'),
        targetFilter: document.getElementById('dm-marker-edit-obj-target-filter')?.value || 'all',
        destroyOnExplode: Boolean(document.getElementById('dm-marker-edit-obj-destroy')?.checked),
        triggerTiming: document.getElementById('dm-marker-edit-obj-timing')?.value || 'turn',
        statusEffects: Array.isArray(editObjSelectedEffects) ? [...editObjSelectedEffects] : []
      };
    }

    socket.emit('editMarker', {
      id: editingMarkerId,
      name,
      imgUrl,
      color,
      hp,
      maxHp,
      size,
      ac,
      ac_bonus,
      stats,
      assignedAttacks,
      hasDarkness,
      darkness,
      maxDarkness,
      objectType,
      objectConfig
    });

    document.getElementById('dm-marker-editor-modal').classList.add('hidden');
    editingMarkerId = null;
  });

  // Modal içindeki checkbox dinleyicisi
  const editHasDarknessCb = document.getElementById('dm-marker-edit-has-darkness');
  const editDarknessInputsWrap = document.getElementById('dm-marker-edit-darkness-inputs');
  if (editHasDarknessCb && editDarknessInputsWrap) {
    editHasDarknessCb.addEventListener('change', () => {
      editDarknessInputsWrap.classList.toggle('hidden', !editHasDarknessCb.checked);
    });
  }

  // Cansız Obje UI Dinleyicilerini Kur
  setupObjectTypeControls();
}

// ============================================================
// CANSIZ OBJELER (INANIMATE OBJECTS) İSTEMCİ YÖNETİMİ
// ============================================================

const objectMapRings = {}; // markerId -> { auraRingEl, hazardRingEl }
let createObjSelectedEffects = [];
let editObjSelectedEffects = [];

/**
 * Cansız nesnelerin durum efekti çiplerini render eder.
 */
function renderObjSelectedEffects(containerEl, effectsArray) {
  if (!containerEl) return;
  containerEl.innerHTML = '';
  if (!effectsArray || effectsArray.length === 0) {
    containerEl.innerHTML = '<span style="font-size:10px; color:#64748b; font-style:italic;">Seçili durum efekti yok.</span>';
    return;
  }
  effectsArray.forEach((eff, idx) => {
    const chip = document.createElement('span');
    chip.className = 'status-target-chip';
    const durText = eff.duration != null ? `${eff.duration}T` : '∞';
    chip.innerHTML = `
      <span>${eff.icon || '✨'}</span>
      <strong>${escapeHtml(eff.name || 'Efekt')}</strong>
      <span style="font-size:10px; opacity:0.8;">(${durText})</span>
      <span class="chip-del-btn" title="Kaldır">✕</span>
    `;
    chip.querySelector('.chip-del-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      effectsArray.splice(idx, 1);
      renderObjSelectedEffects(containerEl, effectsArray);
    });
    containerEl.appendChild(chip);
  });
}

/**
 * Harita üzerindeki menzil halkalarını (Aura ve Patlama Tehlike Halkaları) günceller.
 */
function updateObjectMapRings(tokenId, x, y, size, objectType, objectConfig) {
  if (!gameMap) return;

  const currentCenter = {
    x: (x || 0) + (size || 50) / 2,
    y: (y || 0) + (size || 50) / 2
  };

  let ringData = objectMapRings[tokenId];
  if (!ringData) {
    ringData = { auraRingEl: null, hazardRingEl: null, spawnerRingEl: null };
    objectMapRings[tokenId] = ringData;
  }

  const radius = objectConfig?.radius || (objectType === 'explosive' ? 120 : (objectType === 'spawner' ? (objectConfig?.spawnRadius || 85) : 150));
  const diameter = radius * 2;

  // 1. Aura Totem Halkası (Sürekli görünür, mistik dönen daire)
  if (objectType === 'aura') {
    if (!ringData.auraRingEl) {
      ringData.auraRingEl = document.createElement('div');
      ringData.auraRingEl.className = 'token-aura-ring';
      ringData.auraRingEl.dataset.forToken = tokenId;
      gameMap.appendChild(ringData.auraRingEl);
    }
    ringData.auraRingEl.style.width = diameter + 'px';
    ringData.auraRingEl.style.height = diameter + 'px';
    ringData.auraRingEl.style.left = currentCenter.x + 'px';
    ringData.auraRingEl.style.top = currentCenter.y + 'px';
  } else if (ringData.auraRingEl) {
    ringData.auraRingEl.remove();
    ringData.auraRingEl = null;
  }

  // 2. Patlayıcı Tehlike Halkası (Hover ve hedef seçiminde görünür)
  if (objectType === 'explosive') {
    if (!ringData.hazardRingEl) {
      ringData.hazardRingEl = document.createElement('div');
      ringData.hazardRingEl.className = 'token-hazard-ring';
      ringData.hazardRingEl.dataset.forToken = tokenId;
      gameMap.appendChild(ringData.hazardRingEl);
    }
    ringData.hazardRingEl.style.width = diameter + 'px';
    ringData.hazardRingEl.style.height = diameter + 'px';
    ringData.hazardRingEl.style.left = currentCenter.x + 'px';
    ringData.hazardRingEl.style.top = currentCenter.y + 'px';
  } else if (ringData.hazardRingEl) {
    ringData.hazardRingEl.remove();
    ringData.hazardRingEl = null;
  }

  // 3. Spawner Çağırıcı Halkası (Sürekli görünür, zümrüt mistik rünik daire)
  if (objectType === 'spawner') {
    if (!ringData.spawnerRingEl) {
      ringData.spawnerRingEl = document.createElement('div');
      ringData.spawnerRingEl.className = 'token-spawner-ring';
      ringData.spawnerRingEl.dataset.forToken = tokenId;
      gameMap.appendChild(ringData.spawnerRingEl);
    }
    ringData.spawnerRingEl.style.width = diameter + 'px';
    ringData.spawnerRingEl.style.height = diameter + 'px';
    ringData.spawnerRingEl.style.left = currentCenter.x + 'px';
    ringData.spawnerRingEl.style.top = currentCenter.y + 'px';
  } else if (ringData.spawnerRingEl) {
    ringData.spawnerRingEl.remove();
    ringData.spawnerRingEl = null;
  }
}

/**
 * Haritadaki halkaları temizler.
 */
function removeObjectMapRings(tokenId) {
  if (objectMapRings[tokenId]) {
    if (objectMapRings[tokenId].auraRingEl) {
      objectMapRings[tokenId].auraRingEl.remove();
    }
    if (objectMapRings[tokenId].hazardRingEl) {
      objectMapRings[tokenId].hazardRingEl.remove();
    }
    if (objectMapRings[tokenId].spawnerRingEl) {
      objectMapRings[tokenId].spawnerRingEl.remove();
    }
    delete objectMapRings[tokenId];
  }
}

/**
 * Token DOM elemanına nesneye özgü sınıfları, rozetleri ve harita halkalarını uygular.
 */
function updateTokenObjectVisuals(t, data) {
  if (!t || !data) return;

  let badgeEl = t.querySelector('.token-object-badge');

  if (data.isMarker && data.objectType === 'explosive') {
    t.classList.add('token-object', 'token-object-explosive');
    t.classList.remove('token-object-aura', 'token-object-spawner');
    if (!badgeEl) {
      badgeEl = document.createElement('span');
      badgeEl.className = 'token-object-badge badge-explosive';
      t.appendChild(badgeEl);
    }
    badgeEl.className = 'token-object-badge badge-explosive';
    badgeEl.textContent = '💣';
    badgeEl.title = 'Patlayıcı Nesne';
  } else if (data.isMarker && data.objectType === 'aura') {
    t.classList.add('token-object', 'token-object-aura');
    t.classList.remove('token-object-explosive', 'token-object-spawner');
    if (!badgeEl) {
      badgeEl = document.createElement('span');
      badgeEl.className = 'token-object-badge badge-aura';
      t.appendChild(badgeEl);
    }
    badgeEl.className = 'token-object-badge badge-aura';
    badgeEl.textContent = '🔮';
    badgeEl.title = 'Aura / Totem Nesnesi';
  } else if (data.isMarker && data.objectType === 'spawner') {
    t.classList.add('token-object', 'token-object-spawner');
    t.classList.remove('token-object-explosive', 'token-object-aura');
    if (!badgeEl) {
      badgeEl = document.createElement('span');
      badgeEl.className = 'token-object-badge badge-spawner';
      t.appendChild(badgeEl);
    }
    badgeEl.className = 'token-object-badge badge-spawner';
    badgeEl.textContent = '🌀';
    badgeEl.title = 'Çağırıcı / Yuva';
  } else {
    t.classList.remove('token-object', 'token-object-explosive', 'token-object-aura', 'token-object-spawner');
    if (badgeEl) badgeEl.remove();
  }

  // Harita menzil halkalarını güncelle
  const x = parseFloat(t.style.left) || data.x || 0;
  const y = parseFloat(t.style.top) || data.y || 0;
  const size = data.size || 50;
  if (data.isMarker && (data.objectType === 'explosive' || data.objectType === 'aura' || data.objectType === 'spawner')) {
    updateObjectMapRings(data.id, x, y, size, data.objectType, data.objectConfig);
  } else {
    removeObjectMapRings(data.id);
  }
}

/**
 * Cansız nesne form kontrollerini ve etkileşim dinleyicilerini bağlar.
 */
function setupObjectTypeControls() {
  const createTypeSelect = document.getElementById('dm-marker-type');
  const createObjConfigWrap = document.getElementById('dm-marker-object-config-wrap');
  const createDestroyRow = document.getElementById('dm-marker-obj-destroy-row');
  const createTimingRow = document.getElementById('dm-marker-obj-timing-row');
  const createBadgeTitle = document.getElementById('dm-marker-object-badge-title');
  const createSpawnerSection = document.getElementById('dm-marker-obj-spawner-section');

  const updateCreateUI = (val) => {
    if (!createObjConfigWrap) return;
    const regularGrids = createObjConfigWrap.querySelectorAll('.stats-grid-2col, #dm-marker-obj-destroy-row, #dm-marker-obj-timing-row, .form-group:not(#dm-marker-obj-spawner-section *)');
    if (val === 'explosive') {
      createObjConfigWrap.classList.remove('hidden');
      if (createDestroyRow) createDestroyRow.classList.remove('hidden');
      if (createTimingRow) createTimingRow.classList.add('hidden');
      if (createSpawnerSection) createSpawnerSection.classList.add('hidden');
      if (createBadgeTitle) createBadgeTitle.textContent = '💣 Patlayıcı Nesne Ayarları';
      const dmgType = document.getElementById('dm-marker-obj-damage-type');
      if (dmgType && (!dmgType.value || dmgType.value === 'necrotic')) dmgType.value = 'fire';
      createObjConfigWrap.querySelectorAll('.stats-grid-2col').forEach(el => el.classList.remove('hidden'));
    } else if (val === 'aura') {
      createObjConfigWrap.classList.remove('hidden');
      if (createDestroyRow) createDestroyRow.classList.add('hidden');
      if (createTimingRow) createTimingRow.classList.remove('hidden');
      if (createSpawnerSection) createSpawnerSection.classList.add('hidden');
      if (createBadgeTitle) createBadgeTitle.textContent = '🔮 Aura / Totem Ayarları';
      const dmgType = document.getElementById('dm-marker-obj-damage-type');
      if (dmgType && (!dmgType.value || dmgType.value === 'fire')) dmgType.value = 'necrotic';
      createObjConfigWrap.querySelectorAll('.stats-grid-2col').forEach(el => el.classList.remove('hidden'));
    } else if (val === 'spawner') {
      createObjConfigWrap.classList.remove('hidden');
      if (createDestroyRow) createDestroyRow.classList.add('hidden');
      if (createTimingRow) createTimingRow.classList.add('hidden');
      if (createSpawnerSection) createSpawnerSection.classList.remove('hidden');
      if (createBadgeTitle) createBadgeTitle.textContent = '🌀 Çağırıcı / Yuva Ayarları';
      createObjConfigWrap.querySelectorAll('.stats-grid-2col').forEach(el => el.classList.add('hidden'));
    } else {
      createObjConfigWrap.classList.add('hidden');
    }
  };

  if (createTypeSelect && createObjConfigWrap && !createTypeSelect._bound) {
    createTypeSelect._bound = true;
    createTypeSelect.addEventListener('change', () => updateCreateUI(createTypeSelect.value));
  }

  const editTypeSelect = document.getElementById('dm-marker-edit-type');
  const editObjConfigWrap = document.getElementById('dm-marker-edit-object-config-wrap');
  const editDestroyRow = document.getElementById('dm-marker-edit-obj-destroy-row');
  const editTimingRow = document.getElementById('dm-marker-edit-obj-timing-row');
  const editBadgeTitle = document.getElementById('dm-marker-edit-object-badge-title');
  const editSpawnerSection = document.getElementById('dm-marker-edit-obj-spawner-section');
  const btnDetonate = document.getElementById('dm-marker-btn-test-detonate');
  const btnAura = document.getElementById('dm-marker-btn-test-aura');
  const btnTestSpawn = document.getElementById('dm-marker-btn-test-spawn');

  const updateEditUI = (val) => {
    if (!editObjConfigWrap) return;
    if (val === 'explosive') {
      editObjConfigWrap.classList.remove('hidden');
      if (editDestroyRow) editDestroyRow.classList.remove('hidden');
      if (editTimingRow) editTimingRow.classList.add('hidden');
      if (editSpawnerSection) editSpawnerSection.classList.add('hidden');
      if (btnDetonate) btnDetonate.style.display = 'inline-block';
      if (btnAura) btnAura.style.display = 'none';
      if (btnTestSpawn) btnTestSpawn.style.display = 'none';
      if (editBadgeTitle) editBadgeTitle.textContent = '💣 Patlayıcı Nesne Ayarları';
      editObjConfigWrap.querySelectorAll('.stats-grid-2col').forEach(el => el.classList.remove('hidden'));
    } else if (val === 'aura') {
      editObjConfigWrap.classList.remove('hidden');
      if (editDestroyRow) editDestroyRow.classList.add('hidden');
      if (editTimingRow) editTimingRow.classList.remove('hidden');
      if (editSpawnerSection) editSpawnerSection.classList.add('hidden');
      if (btnDetonate) btnDetonate.style.display = 'none';
      if (btnAura) btnAura.style.display = 'inline-block';
      if (btnTestSpawn) btnTestSpawn.style.display = 'none';
      if (editBadgeTitle) editBadgeTitle.textContent = '🔮 Aura / Totem Ayarları';
      editObjConfigWrap.querySelectorAll('.stats-grid-2col').forEach(el => el.classList.remove('hidden'));
    } else if (val === 'spawner') {
      editObjConfigWrap.classList.remove('hidden');
      if (editDestroyRow) editDestroyRow.classList.add('hidden');
      if (editTimingRow) editTimingRow.classList.add('hidden');
      if (editSpawnerSection) editSpawnerSection.classList.remove('hidden');
      if (btnDetonate) btnDetonate.style.display = 'none';
      if (btnAura) btnAura.style.display = 'none';
      if (btnTestSpawn) btnTestSpawn.style.display = 'inline-block';
      if (editBadgeTitle) editBadgeTitle.textContent = '🌀 Çağırıcı / Yuva Ayarları';
      editObjConfigWrap.querySelectorAll('.stats-grid-2col').forEach(el => el.classList.add('hidden'));
    } else {
      editObjConfigWrap.classList.add('hidden');
      if (btnDetonate) btnDetonate.style.display = 'none';
      if (btnAura) btnAura.style.display = 'none';
      if (btnTestSpawn) btnTestSpawn.style.display = 'none';
    }
  };

  if (editTypeSelect && editObjConfigWrap && !editTypeSelect._bound) {
    editTypeSelect._bound = true;
    editTypeSelect.addEventListener('change', () => updateEditUI(editTypeSelect.value));
  }

  if (btnTestSpawn && !btnTestSpawn._bound) {
    btnTestSpawn._bound = true;
    btnTestSpawn.addEventListener('click', () => {
      if (!editingMarkerId) return;
      socket.emit('triggerObjectSpawner', { spawnerId: editingMarkerId });
      btnTestSpawn.textContent = '✨ Doğuruldu!';
      setTimeout(() => { if (btnTestSpawn) btnTestSpawn.textContent = '🌀 Doğur (Test)'; }, 1400);
    });
  }

  // Create form durum efekti ekleme butonu
  const btnCreateAddObjEff = document.getElementById('dm-marker-obj-btn-add-effect');
  if (btnCreateAddObjEff && !btnCreateAddObjEff._bound) {
    btnCreateAddObjEff._bound = true;
    btnCreateAddObjEff.addEventListener('click', () => {
      const select = document.getElementById('dm-marker-obj-effect-select');
      const durInput = document.getElementById('dm-marker-obj-effect-duration');
      const presetId = select?.value;
      if (!presetId) return;
      const preset = currentStatusPresets.find(p => p.id === presetId);
      if (!preset) return;
      const eff = JSON.parse(JSON.stringify(preset));
      eff.id = 'eff_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
      const customDur = durInput && durInput.value.trim() !== '' ? parseInt(durInput.value) : null;
      if (customDur !== null && !isNaN(customDur)) eff.duration = Math.max(1, customDur);
      createObjSelectedEffects.push(eff);
      renderObjSelectedEffects(document.getElementById('dm-marker-obj-selected-effects'), createObjSelectedEffects);
      if (select) select.value = '';
      if (durInput) durInput.value = '';
    });
  }

  // Edit modal durum efekti ekleme butonu
  const btnEditAddObjEff = document.getElementById('dm-marker-edit-obj-btn-add-effect');
  if (btnEditAddObjEff && !btnEditAddObjEff._bound) {
    btnEditAddObjEff._bound = true;
    btnEditAddObjEff.addEventListener('click', () => {
      const select = document.getElementById('dm-marker-edit-obj-effect-select');
      const durInput = document.getElementById('dm-marker-edit-obj-effect-duration');
      const presetId = select?.value;
      if (!presetId) return;
      const preset = currentStatusPresets.find(p => p.id === presetId);
      if (!preset) return;
      const eff = JSON.parse(JSON.stringify(preset));
      eff.id = 'eff_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
      const customDur = durInput && durInput.value.trim() !== '' ? parseInt(durInput.value) : null;
      if (customDur !== null && !isNaN(customDur)) eff.duration = Math.max(1, customDur);
      editObjSelectedEffects.push(eff);
      renderObjSelectedEffects(document.getElementById('dm-marker-edit-obj-selected-effects'), editObjSelectedEffects);
      if (select) select.value = '';
      if (durInput) durInput.value = '';
    });
  }

  // Test butonları: Şimdi Patlat (İki tıkla güvenli tetikleme)
  const btnTestDetonate = document.getElementById('dm-marker-btn-test-detonate');
  if (btnTestDetonate && !btnTestDetonate._bound) {
    btnTestDetonate._bound = true;
    let detonateConfirmPending = false;
    btnTestDetonate.addEventListener('click', () => {
      if (!editingMarkerId) return;
      if (!detonateConfirmPending) {
        detonateConfirmPending = true;
        btnTestDetonate.textContent = 'Emin misin? 💥';
        btnTestDetonate.style.background = '#b91c1c';
        setTimeout(() => {
          detonateConfirmPending = false;
          if (btnTestDetonate) {
            btnTestDetonate.textContent = '💥 Patlat';
            btnTestDetonate.style.background = '#dc2626';
          }
        }, 3000);
        return;
      }
      detonateConfirmPending = false;
      socket.emit('detonateObject', editingMarkerId);
      document.getElementById('dm-marker-editor-modal').classList.add('hidden');
      editingMarkerId = null;
    });
  }

  // Test butonları: Nabız Ver
  const btnTestAura = document.getElementById('dm-marker-btn-test-aura');
  if (btnTestAura && !btnTestAura._bound) {
    btnTestAura._bound = true;
    btnTestAura.addEventListener('click', () => {
      if (!editingMarkerId) return;
      socket.emit('triggerObjectAura', editingMarkerId);
    });
  }
}

// Sayfa yüklendiğinde kontrolleri hazırla
setupObjectTypeControls();

// Socket Dinleyicisi: Aura Dalgası Tetiklendiğinde
socket.on('objectAuraPulseApplied', (data) => {
  const { markerId, cx, cy, radius, damage, damageType, affectedTargets } = data || {};
  if (!gameMap) return;

  // Harita üzerinde genişleyen mistik dalga oluştur
  const wave = document.createElement('div');
  wave.className = 'aura-pulse-wave';
  wave.style.setProperty('--wave-diameter', `${(radius || 150) * 2}px`);
  wave.style.left = `${cx}px`;
  wave.style.top = `${cy}px`;
  gameMap.appendChild(wave);
  setTimeout(() => wave.remove(), 800);

  // Etkilenen hedefler üzerinde floating hasar/aura yazısı göster
  if (Array.isArray(affectedTargets)) {
    affectedTargets.forEach(at => {
      let tokenEl = tokens[at.id];
      if (!tokenEl && at.type === 'character' && typeof allPlayers !== 'undefined') {
        const p = Object.values(allPlayers).find(pl => pl.character && String(pl.character.id) === String(at.id));
        if (p && tokens[p.id]) tokenEl = tokens[p.id];
      }
      if (!tokenEl) {
        tokenEl = document.querySelector(`.token[data-id="${at.id}"]`) ||
                  document.querySelector(`.token[data-character-id="${at.id}"]`);
      }
      if (tokenEl) {
        const tLeft = parseFloat(tokenEl.style.left) || tokenEl.offsetLeft || 0;
        const tTop = parseFloat(tokenEl.style.top) || tokenEl.offsetTop || 0;
        const tSize = tokenEl.offsetWidth || 50;

        const floatText = document.createElement('div');
        floatText.className = 'aoe-floating-damage';
        floatText.style.color = '#c084fc';
        floatText.style.textShadow = '0 0 8px rgba(168, 85, 247, 0.8)';
        floatText.textContent = damage > 0 ? `-${damage}` : '✨ AURA';
        floatText.style.left = `${tLeft + tSize / 2}px`;
        floatText.style.top = `${tTop}px`;

        gameMap.appendChild(floatText);
        setTimeout(() => floatText.remove(), 1700);
      }
    });
  }
});


// ---- DM Kalem Rengi ----
const btnUpdateDmPen = document.getElementById('btn-update-dm-pen');
if (btnUpdateDmPen) {
  btnUpdateDmPen.addEventListener('click', () => {
    const color = document.getElementById('dm-pen-color').value;
    socket.emit('updateTokenAppearance', { color });
    if (allPlayers[myId]) allPlayers[myId].color = color;
  });
}

// ---- Arka Plan ----
const btnSetBg = document.getElementById('btn-set-bg');
if (btnSetBg) {
  btnSetBg.addEventListener('click', () => {
    const url = document.getElementById('dm-bg-url').value;
    socket.emit('updateBg', url);
    document.getElementById('dm-bg-url').value = '';
  });
}

// ---- Manuel Kaydet ----
const btnForceSave = document.getElementById('btn-force-save');
if (btnForceSave) {
  btnForceSave.addEventListener('click', () => {
    socket.emit('forceSave');
    btnForceSave.innerText = 'Bekleniyor...';
    btnForceSave.style.backgroundColor = '#f39c12';
  });
}

socket.on('saveComplete', () => {
  const btn = document.getElementById('btn-force-save');
  if (btn) {
    btn.innerText = 'Harita Kaydet';
    btn.style.backgroundColor = '#e67e22';
  }
  addLog('Harita manuel olarak kaydedildi.', '#27ae60');
});

// ---- Token Görünüm (Oyuncu) ----
const btnUpdateToken = document.getElementById('btn-update-token');
if (btnUpdateToken) {
  btnUpdateToken.addEventListener('click', () => {
    const imgUrl = document.getElementById('player-token-img').value;
    const color = document.getElementById('player-token-color').value;
    socket.emit('updateTokenAppearance', { imgUrl, color });
    if (allPlayers[myId]) {
      allPlayers[myId].imgUrl = imgUrl;
      allPlayers[myId].color = color;
    }
  });
}

// ============================================================
// OYUNCU BİLGİ PANELİ RENDER
// ============================================================

function renderPlayerInfo() {
  const othersList = document.getElementById('other-players-list');
  const dmPlayerList = document.getElementById('dm-player-list');

  if (othersList) othersList.innerHTML = '';
  if (dmPlayerList) dmPlayerList.innerHTML = '';

  let hasOthers = false;

  Object.values(allPlayers).forEach(p => {
    if (p.role === 'dm' || !p.character) return;

    const c = p.character;

    // DM Görünümündeki Editör Listesi
    if (role === 'dm' && p.id !== myId) {
      hasOthers = true;
      const listBtn = document.createElement('div');
      listBtn.className = 'list-item';

      const nameSpan = document.createElement('span');
      const strong = document.createElement('strong');
      strong.textContent = c.name;
      nameSpan.appendChild(strong);

      const curSize = p.size || c.token_size || c.size || 50;
      const sizeSpan = document.createElement('span');
      sizeSpan.className = 'dm-player-size-tag';
      sizeSpan.textContent = `${curSize}px`;
      sizeSpan.title = 'Token Boyutu';
      nameSpan.appendChild(sizeSpan);

      const hpSpan = document.createElement('span');
      hpSpan.className = 'dm-player-hp-tag';
      hpSpan.textContent = `HP: ${c.hp_current}/${c.hp_max}`;

      listBtn.appendChild(nameSpan);
      listBtn.appendChild(hpSpan);
      listBtn.addEventListener('click', () => showDmEditor(p));
      dmPlayerList.appendChild(listBtn);
    }

    // Oyuncu Görünümündeki "Diğer Oyuncular"
    if (role !== 'dm' && p.id !== myId) {
      hasOthers = true;
      const div = document.createElement('div');
      div.className = 'other-player-item';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'other-player-name';
      nameSpan.textContent = c.name;

      const hpSpan = document.createElement('span');
      hpSpan.className = 'char-hp';
      hpSpan.textContent = `${c.hp_current} / ${c.hp_max}`;

      div.appendChild(nameSpan);
      div.appendChild(hpSpan);
      othersList.appendChild(div);
    }
  });

  if (!hasOthers) {
    if (role === 'dm' && dmPlayerList) {
      dmPlayerList.innerHTML = '<p class="empty-state-text">Bağlı oyuncu yok.</p>';
    } else if (othersList) {
      othersList.innerHTML = '<p class="empty-state-text">Odada başka oyuncu yok.</p>';
    }
  }

  // Oyuncunun kendi kartını render et
  if (role !== 'dm') {
    renderMyCharacterCard();
  }
}

function renderMyCharacterCard() {
  const myCard = document.getElementById('my-character-card');
  if (!myCard) return;
  myCard.innerHTML = '';

  const me = allPlayers[myId];
  if (!me || !me.character) {
    myCard.innerHTML = '<p>Karakter bilgisi yüklenemedi.</p>';
    return;
  }

  const c = me.character;

  // Avatar
  const header = document.createElement('div');
  header.className = 'char-header';

  if (c.avatar_url) {
    const avatarImg = document.createElement('img');
    avatarImg.src = c.avatar_url;
    avatarImg.className = 'char-avatar';
    avatarImg.alt = 'Avatar';
    header.appendChild(avatarImg);
  } else {
    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'char-avatar';
    avatarDiv.textContent = c.name.charAt(0).toUpperCase();
    header.appendChild(avatarDiv);
  }

  const infoDiv = document.createElement('div');
  const nameH3 = document.createElement('h3');
  nameH3.className = 'char-name';
  nameH3.textContent = c.name;
  infoDiv.appendChild(nameH3);

  const hpDiv = document.createElement('div');
  hpDiv.className = 'char-hp';
  hpDiv.textContent = `HP: ${c.hp_current} / ${c.hp_max}`;
  infoDiv.appendChild(hpDiv);
  header.appendChild(infoDiv);
  myCard.appendChild(header);

  // Stats Grid
  const statsGrid = document.createElement('div');
  statsGrid.className = 'char-stats-grid';

  const statNames = ['STR', 'DEX', 'INT', 'CON', 'WIS', 'CHR'];
  const statKeys = ['str', 'dex', 'int', 'con', 'wis', 'chr'];

  statNames.forEach((label, i) => {
    const box = document.createElement('div');
    box.className = 'stat-box';

    const labelSpan = document.createElement('span');
    labelSpan.className = 'stat-label';
    labelSpan.textContent = label;

    const valueSpan = document.createElement('span');
    valueSpan.className = 'stat-value';
    valueSpan.textContent = c.stats[statKeys[i]] ?? 10;

    box.appendChild(labelSpan);
    box.appendChild(valueSpan);
    statsGrid.appendChild(box);
  });

  myCard.appendChild(statsGrid);
}

// ============================================================
// DM OYUNCU EDİTÖRÜ
// ============================================================

let editingPlayerId = null;
let dmEditTimeout = null;

function showDmEditor(playerInput) {
  if (typeof flushDmEdit === 'function') flushDmEdit();

  const playerId = typeof playerInput === 'string' ? playerInput : (playerInput ? playerInput.id : null);
  if (!playerId) return;

  const playerData = (allPlayers && allPlayers[playerId]) || (typeof playerInput === 'object' ? playerInput : null);
  if (!playerData || !playerData.character) return;

  editingPlayerId = playerData.id;
  const c = playerData.character;

  document.getElementById('dm-edit-name').textContent = c.name + " Düzenleniyor";
  document.getElementById('dm-edit-hp').value = c.hp_current;
  document.getElementById('dm-edit-max-hp').value = c.hp_max;

  // Token Boyutu (px)
  const sizeEl = document.getElementById('dm-edit-size');
  const playerSize = playerData.size || c.token_size || c.size || 50;
  if (sizeEl) sizeEl.value = playerSize;
  updateDmSizePillActive(playerSize);

  // AC & Corruption
  const acEl = document.getElementById('dm-edit-ac');
  const acBonusEl = document.getElementById('dm-edit-ac-bonus');
  const corruptionEl = document.getElementById('dm-edit-corruption');
  if (acEl) acEl.value = c.ac ?? 10;
  if (acBonusEl) acBonusEl.value = c.ac_bonus ?? 0;
  if (corruptionEl) corruptionEl.value = c.corruption ?? 0;

  // Kenan Modu: Darkness
  const darknessEl = document.getElementById('dm-edit-darkness');
  const maxDarknessEl = document.getElementById('dm-edit-max-darkness');
  if (darknessEl) darknessEl.value = c.darkness != null ? c.darkness : 0;
  if (maxDarknessEl) maxDarknessEl.value = c.max_darkness != null ? c.max_darkness : 100;

  // Stats & Bonuslar
  document.getElementById('dm-edit-str').value = c.stats?.str ?? 10;
  document.getElementById('dm-edit-dex').value = c.stats?.dex ?? 10;
  document.getElementById('dm-edit-int').value = c.stats?.int ?? 10;
  document.getElementById('dm-edit-con').value = c.stats?.con ?? 10;
  document.getElementById('dm-edit-wis').value = c.stats?.wis ?? 10;
  document.getElementById('dm-edit-chr').value = c.stats?.chr ?? 10;

  const strBonusEl = document.getElementById('dm-edit-str-bonus');
  const dexBonusEl = document.getElementById('dm-edit-dex-bonus');
  const intBonusEl = document.getElementById('dm-edit-int-bonus');
  const conBonusEl = document.getElementById('dm-edit-con-bonus');
  const wisBonusEl = document.getElementById('dm-edit-wis-bonus');
  const chrBonusEl = document.getElementById('dm-edit-chr-bonus');
  if (strBonusEl) strBonusEl.value = c.stats?.str_bonus ?? 0;
  if (dexBonusEl) dexBonusEl.value = c.stats?.dex_bonus ?? 0;
  if (intBonusEl) intBonusEl.value = c.stats?.int_bonus ?? 0;
  if (conBonusEl) conBonusEl.value = c.stats?.con_bonus ?? 0;
  if (wisBonusEl) wisBonusEl.value = c.stats?.wis_bonus ?? 0;
  if (chrBonusEl) chrBonusEl.value = c.stats?.chr_bonus ?? 0;

  // Spell Slots
  const slots = c.spell_slots || { lvl1: 0, lvl2: 0, lvl3: 0, lvl4: 0 };
  const sl1 = document.getElementById('dm-edit-spell-lvl1');
  const sl2 = document.getElementById('dm-edit-spell-lvl2');
  const sl3 = document.getElementById('dm-edit-spell-lvl3');
  const sl4 = document.getElementById('dm-edit-spell-lvl4');
  if (sl1) sl1.value = slots.lvl1 ?? 0;
  if (sl2) sl2.value = slots.lvl2 ?? 0;
  if (sl3) sl3.value = slots.lvl3 ?? 0;
  if (sl4) sl4.value = slots.lvl4 ?? 0;

  renderPlayerEditorActiveEffects(playerData);
  renderPlayerAssignedAttacks(playerData);
  populateTokenEditorEffectSelect(document.getElementById('dm-player-add-effect-select'));

  document.getElementById('dm-player-editor').classList.remove('hidden');
}

let playerAssignedSearchTerm = '';

function updatePlayerAssignedCountBadge(count, total) {
  const badge = document.getElementById('dm-player-assigned-count');
  if (badge) {
    badge.textContent = `(${count} / ${total} Seçili)`;
    badge.classList.toggle('has-selected', count > 0);
  }
}

/**
 * Oyuncu düzenleme modalındaki atanmış saldırı presetlerini listeler ve seçim sunar (Sınırsız).
 */
function renderPlayerAssignedAttacks(playerData) {
  const container = document.getElementById('dm-player-assigned-attacks');
  if (!container) return;

  container.innerHTML = '';
  const allPresets = typeof window.__webdnd_getAttackPresets === 'function' ? window.__webdnd_getAttackPresets() : [];
  if (!playerData) return;
  const current = (allPlayers && allPlayers[playerData.id]) || playerData;
  const assigned = current.assignedAttacks || (current.character && current.character.assignedAttacks) || [];

  updatePlayerAssignedCountBadge(assigned.length, allPresets.length);

  // Arama ve aksiyon butonlarını bağla
  const searchInput = document.getElementById('dm-player-assigned-search');
  if (searchInput && !searchInput._bound) {
    searchInput._bound = true;
    searchInput.addEventListener('input', (e) => {
      playerAssignedSearchTerm = e.target.value.toLowerCase().trim();
      if (editingPlayerId && allPlayers && allPlayers[editingPlayerId]) {
        renderPlayerAssignedAttacks(allPlayers[editingPlayerId]);
      }
    });
  }

  const selectAllBtn = document.getElementById('dm-player-assigned-select-all');
  if (selectAllBtn && !selectAllBtn._bound) {
    selectAllBtn._bound = true;
    selectAllBtn.addEventListener('click', () => {
      const cbs = container.querySelectorAll('input[type="checkbox"]');
      cbs.forEach(cb => {
        cb.checked = true;
        cb.closest('.assigned-attack-item')?.classList.add('is-selected');
      });
      const selected = Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(c => c.value);
      updatePlayerAssignedCountBadge(selected.length, allPresets.length);
      if (typeof flushDmEdit === 'function') {
        saveDmEditorState(editingPlayerId);
      }
    });
  }

  const clearAllBtn = document.getElementById('dm-player-assigned-clear-all');
  if (clearAllBtn && !clearAllBtn._bound) {
    clearAllBtn._bound = true;
    clearAllBtn.addEventListener('click', () => {
      const cbs = container.querySelectorAll('input[type="checkbox"]');
      cbs.forEach(cb => {
        cb.checked = false;
        cb.closest('.assigned-attack-item')?.classList.remove('is-selected');
      });
      updatePlayerAssignedCountBadge(0, allPresets.length);
      if (typeof flushDmEdit === 'function') {
        saveDmEditorState(editingPlayerId);
      }
    });
  }

  if (allPresets.length === 0) {
    container.innerHTML = '<span style="font-size:11px; color:#7f8c8d; font-style:italic;">Kayıtlı saldırı preseti bulunamadı.</span>';
    return;
  }

  const filteredPresets = allPresets.filter(preset => {
    if (!playerAssignedSearchTerm) return true;
    const name = (preset.name || '').toLowerCase();
    const stat = (preset.stat || '').toLowerCase();
    const type = (preset.attackType || '').toLowerCase();
    return name.includes(playerAssignedSearchTerm) || stat.includes(playerAssignedSearchTerm) || type.includes(playerAssignedSearchTerm);
  });

  if (filteredPresets.length === 0) {
    container.innerHTML = `<span style="font-size:11px; color:#7f8c8d; font-style:italic; grid-column: 1 / -1;">"${escapeHtml(playerAssignedSearchTerm)}" ile eşleşen saldırı bulunamadı.</span>`;
    return;
  }

  filteredPresets.forEach(preset => {
    const isSelected = assigned.includes(preset.id);
    const item = document.createElement('label');
    item.className = 'assigned-attack-item' + (isSelected ? ' is-selected' : '');
    
    const typeIcon = preset.attackType === 'spell' ? '✨' : '⚔️';
    item.innerHTML = `
      <input type="checkbox" value="${preset.id}" ${isSelected ? 'checked' : ''}>
      <span>${typeIcon}</span>
      <span class="assigned-attack-name" title="${escapeHtml(preset.name)}">${escapeHtml(preset.name)}</span>
      <span class="assigned-attack-stat">${preset.stat || 'STR'}</span>
    `;

    const checkbox = item.querySelector('input[type="checkbox"]');
    checkbox.addEventListener('change', () => {
      item.classList.toggle('is-selected', checkbox.checked);
      const totalChecked = container.querySelectorAll('input[type="checkbox"]:checked').length;
      updatePlayerAssignedCountBadge(totalChecked, allPresets.length);
      if (typeof flushDmEdit === 'function') {
        saveDmEditorState(editingPlayerId);
      }
    });

    container.appendChild(item);
  });
}

/**
 * DM Oyuncu düzenleme panelindeki aktif durum efektlerini listeler ve silme seçeneği sunar.
 */
function renderPlayerEditorActiveEffects(playerData) {
  const container = document.getElementById('dm-player-active-effects');
  const clearAllBtn = document.getElementById('dm-player-clear-all-effects');
  if (!container) return;

  container.innerHTML = '';
  const current = (allPlayers && allPlayers[playerData.id]) || playerData;
  const activeEffects = current.activeEffects || (current.character && current.character.activeEffects) || [];

  if (clearAllBtn) {
    clearAllBtn.style.display = activeEffects.length > 0 ? 'inline-block' : 'none';
    clearAllBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      socket.emit('removeStatusEffect', {
        targetType: 'player',
        targetId: current.id,
        effectId: 'all'
      });
      current.activeEffects = [];
      if (current.character) current.character.activeEffects = [];
      renderPlayerEditorActiveEffects(current);
    };
  }

  if (activeEffects.length === 0) {
    container.innerHTML = '<span style="font-size:11px; color:#7f8c8d; font-style:italic;">Aktif durum efekti yok.</span>';
    return;
  }

  activeEffects.forEach(eff => {
    const chip = document.createElement('span');
    chip.className = 'status-target-chip';
    const durText = eff.duration != null ? `${eff.duration}T` : '∞';
    const ruleDesc = typeof describeStatusRules === 'function' ? describeStatusRules(eff.effects) : '';
    chip.title = `${eff.icon || '✨'} ${eff.name || 'Efekt'} (${durText})${ruleDesc ? ': ' + ruleDesc : ''}`;
    chip.innerHTML = `
      <span>${eff.icon || '✨'}</span>
      <strong>${escapeHtml(eff.name || 'Efekt')}</strong>
      <span style="font-size:10px; opacity:0.8;">(${durText})</span>
      <span class="chip-del-btn" title="Efekti Kaldır">✕</span>
    `;

    const delBtn = chip.querySelector('.chip-del-btn');
    if (delBtn) {
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        socket.emit('removeStatusEffect', {
          targetType: 'player',
          targetId: current.id,
          effectId: eff.id
        });
        current.activeEffects = activeEffects.filter(item => item.id !== eff.id);
        if (current.character) current.character.activeEffects = current.activeEffects;
        renderPlayerEditorActiveEffects(current);
      });
    }

    container.appendChild(chip);
  });
}

// Oyuncu Düzenleme Modalında Durum Efekti Ekleme Butonu
const btnPlayerAddEffect = document.getElementById('dm-player-btn-add-effect');
if (btnPlayerAddEffect && !btnPlayerAddEffect._bound) {
  btnPlayerAddEffect._bound = true;
  btnPlayerAddEffect.addEventListener('click', () => {
    if (!editingPlayerId || !allPlayers || !allPlayers[editingPlayerId]) {
      alert('Düzenlenen oyuncu bulunamadı!');
      return;
    }
    const select = document.getElementById('dm-player-add-effect-select');
    const durInput = document.getElementById('dm-player-add-effect-duration');
    const presetId = select?.value;
    if (!presetId) {
      alert('Lütfen eklenecek durum efektini seçin!');
      return;
    }
    const preset = currentStatusPresets.find(p => p.id === presetId);
    if (!preset) return;

    const effectToApply = JSON.parse(JSON.stringify(preset));
    effectToApply.id = 'eff_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    const customDur = durInput && durInput.value.trim() !== '' ? parseInt(durInput.value) : null;
    if (customDur !== null && !isNaN(customDur)) {
      effectToApply.duration = Math.max(1, customDur);
    }

    socket.emit('applyStatusEffect', {
      targetType: 'player',
      targetId: editingPlayerId,
      effect: effectToApply
    });

    const p = allPlayers[editingPlayerId];
    if (!p.activeEffects) p.activeEffects = [];
    if (p.character && !p.character.activeEffects) p.character.activeEffects = [];
    const idx = p.activeEffects.findIndex(e => e.id === effectToApply.id || e.name === effectToApply.name);
    if (idx >= 0) {
      p.activeEffects[idx] = effectToApply;
      if (p.character) p.character.activeEffects[idx] = effectToApply;
    } else {
      p.activeEffects.push(effectToApply);
      if (p.character) p.character.activeEffects.push(effectToApply);
    }
    renderPlayerEditorActiveEffects(p);

    if (select) select.value = '';
    if (durInput) durInput.value = '';
  });
}

function saveDmEditorState(playerId) {
  if (!playerId || !allPlayers[playerId] || !allPlayers[playerId].character) return;

  const assignedCheckboxes = document.querySelectorAll('#dm-player-assigned-attacks input[type="checkbox"]:checked');
  const assignedAttacks = Array.from(assignedCheckboxes).map(cb => cb.value);

  const updatedData = {
    id: playerId,
    characterId: allPlayers[playerId].character.id,
    hp_current: parseInt(document.getElementById('dm-edit-hp').value),
    hp_max: parseInt(document.getElementById('dm-edit-max-hp').value),
    size: parseInt(document.getElementById('dm-edit-size')?.value) || 50,
    token_size: parseInt(document.getElementById('dm-edit-size')?.value) || 50,
    stats: {
      str: parseInt(document.getElementById('dm-edit-str').value),
      str_bonus: parseInt(document.getElementById('dm-edit-str-bonus')?.value) || 0,
      dex: parseInt(document.getElementById('dm-edit-dex').value),
      dex_bonus: parseInt(document.getElementById('dm-edit-dex-bonus')?.value) || 0,
      int: parseInt(document.getElementById('dm-edit-int').value),
      int_bonus: parseInt(document.getElementById('dm-edit-int-bonus')?.value) || 0,
      con: parseInt(document.getElementById('dm-edit-con').value),
      con_bonus: parseInt(document.getElementById('dm-edit-con-bonus')?.value) || 0,
      wis: parseInt(document.getElementById('dm-edit-wis').value),
      wis_bonus: parseInt(document.getElementById('dm-edit-wis-bonus')?.value) || 0,
      chr: parseInt(document.getElementById('dm-edit-chr').value),
      chr_bonus: parseInt(document.getElementById('dm-edit-chr-bonus')?.value) || 0
    },
    ac: parseInt(document.getElementById('dm-edit-ac')?.value) || 10,
    ac_bonus: parseInt(document.getElementById('dm-edit-ac-bonus')?.value) || 0,
    corruption: parseInt(document.getElementById('dm-edit-corruption')?.value) || 0,
    darkness: parseInt(document.getElementById('dm-edit-darkness')?.value) || 0,
    max_darkness: parseInt(document.getElementById('dm-edit-max-darkness')?.value) || 100,
    assignedAttacks: assignedAttacks
  };

  // Spell slots
  const sl1 = document.getElementById('dm-edit-spell-lvl1');
  const sl2 = document.getElementById('dm-edit-spell-lvl2');
  const sl3 = document.getElementById('dm-edit-spell-lvl3');
  const sl4 = document.getElementById('dm-edit-spell-lvl4');
  if (sl1 || sl2 || sl3 || sl4) {
    updatedData.spell_slots = {
      lvl1: parseInt(sl1?.value) || 0,
      lvl2: parseInt(sl2?.value) || 0,
      lvl3: parseInt(sl3?.value) || 0,
      lvl4: parseInt(sl4?.value) || 0,
    };
  }

  const btn = document.getElementById('dm-edit-save-btn');
  if (btn) {
    btn.innerText = "Kaydediliyor...";
    btn.style.backgroundColor = '#3498db';
  }

  socket.emit('updateCharacter', updatedData);
}

function flushDmEdit() {
  if (dmEditTimeout) {
    clearTimeout(dmEditTimeout);
    dmEditTimeout = null;
    saveDmEditorState(editingPlayerId);
  }
}

const formDmEdit = document.getElementById('dm-edit-form');
if (formDmEdit) {
  formDmEdit.addEventListener('submit', (e) => e.preventDefault());

  const inputs = formDmEdit.querySelectorAll('input[type="number"]');
  inputs.forEach(input => {
    input.addEventListener('input', () => {
      const btn = document.getElementById('dm-edit-save-btn');
      if (btn) {
        btn.innerText = "Bekleniyor...";
        btn.style.backgroundColor = '#f39c12';
      }

      if (dmEditTimeout) clearTimeout(dmEditTimeout);

      const currentEditId = editingPlayerId;
      dmEditTimeout = setTimeout(() => {
        dmEditTimeout = null;
        saveDmEditorState(currentEditId);
      }, 3000);
    });
  });
}

// ============================================================
// DM OYUNCU TOKEN BOYUTU AYARLARI & SAĞ TIK HIZLI MENÜSÜ
// ============================================================

function updateDmSizePillActive(val) {
  const pills = document.querySelectorAll('#dm-player-size-presets .dm-size-pill');
  pills.forEach(p => {
    p.classList.toggle('active', parseInt(p.dataset.size) === parseInt(val));
  });
}

function setPlayerTokenSize(playerId, newSize) {
  if (!playerId || !allPlayers[playerId]) return;
  const safeSize = Math.max(20, Math.min(500, parseInt(newSize) || 50));

  allPlayers[playerId].size = safeSize;
  if (allPlayers[playerId].character) {
    allPlayers[playerId].character.token_size = safeSize;
    allPlayers[playerId].character.size = safeSize;
  }

  // Editör açıksa input ve pill güncelle
  if (editingPlayerId === playerId) {
    const sizeInput = document.getElementById('dm-edit-size');
    if (sizeInput && document.activeElement !== sizeInput) {
      sizeInput.value = safeSize;
    }
    updateDmSizePillActive(safeSize);
  }

  // Token DOM güncelle
  const t = tokens[playerId];
  if (t) {
    applyTokenStyles(t, allPlayers[playerId], false);
    const hpData = extractHp(allPlayers[playerId]);
    if (hpData.hpCurrent != null) updateHpBadge(t, hpData.hpCurrent, hpData.hpMax);
    updateTokenDarknessBar(t, allPlayers[playerId]);
  }

  // Sunucuya bildir
  socket.emit('updatePlayerTokenSize', { playerId, size: safeSize });
  renderPlayerInfo();
}

// Editördeki hızlı boyut hapları (Presets)
document.querySelectorAll('#dm-player-size-presets .dm-size-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    if (!editingPlayerId) return;
    const targetSize = parseInt(pill.dataset.size);
    setPlayerTokenSize(editingPlayerId, targetSize);
  });
});

// Editördeki boyut inputu
const dmEditSizeInput = document.getElementById('dm-edit-size');
if (dmEditSizeInput) {
  dmEditSizeInput.addEventListener('input', (e) => {
    if (!editingPlayerId) return;
    const targetSize = parseInt(e.target.value);
    if (!isNaN(targetSize) && targetSize >= 20) {
      setPlayerTokenSize(editingPlayerId, targetSize);
    }
  });
}

// ---- DM Oyuncu Token Sağ Tık Hızlı Menüsü ----
let activeContextMenuPlayerId = null;
const playerContextMenu = document.getElementById('player-token-context-menu');

function openPlayerTokenContextMenu(clientX, clientY, playerId) {
  if (!playerContextMenu || !allPlayers[playerId]) return;
  activeContextMenuPlayerId = playerId;

  const player = allPlayers[playerId];
  const charName = player.character?.name || 'Oyuncu';
  const currentSize = player.size || player.character?.token_size || player.character?.size || 50;

  const titleEl = document.getElementById('token-context-player-name');
  const badgeEl = document.getElementById('token-context-size-badge');
  const customInput = document.getElementById('token-context-custom-size-input');

  if (titleEl) titleEl.textContent = charName;
  if (badgeEl) badgeEl.textContent = `${currentSize}px`;
  if (customInput) customInput.value = currentSize;

  const sizeBtns = playerContextMenu.querySelectorAll('.token-context-size-btn');
  sizeBtns.forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.size) === parseInt(currentSize));
  });

  // Harita koordinatlarına göre menüyü konumlandır
  const mapRect = gameMapContainer ? gameMapContainer.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  let posX = clientX - mapRect.left;
  let posY = clientY - mapRect.top;

  if (posX + 210 > mapRect.width) posX = mapRect.width - 215;
  if (posY + 260 > mapRect.height) posY = mapRect.height - 265;
  if (posX < 10) posX = 10;
  if (posY < 10) posY = 10;

  playerContextMenu.style.left = `${posX}px`;
  playerContextMenu.style.top = `${posY}px`;
  playerContextMenu.classList.remove('hidden');
}

function closePlayerTokenContextMenu() {
  if (playerContextMenu) {
    playerContextMenu.classList.add('hidden');
  }
  activeContextMenuPlayerId = null;
}

if (playerContextMenu) {
  // Hızlı boyut butonları
  playerContextMenu.querySelectorAll('.token-context-size-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!activeContextMenuPlayerId) return;
      const targetSize = parseInt(btn.dataset.size);
      setPlayerTokenSize(activeContextMenuPlayerId, targetSize);
      closePlayerTokenContextMenu();
    });
  });

  // Özel boyut uygula butonu
  const customSizeBtn = document.getElementById('token-context-custom-size-btn');
  const customSizeInput = document.getElementById('token-context-custom-size-input');
  if (customSizeBtn && customSizeInput) {
    customSizeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!activeContextMenuPlayerId) return;
      const val = parseInt(customSizeInput.value);
      if (!isNaN(val) && val >= 20) {
        setPlayerTokenSize(activeContextMenuPlayerId, val);
      }
      closePlayerTokenContextMenu();
    });
  }

  // Karakteri Düzenle butonu
  const openEditorBtn = document.getElementById('token-context-open-editor-btn');
  if (openEditorBtn) {
    openEditorBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pId = activeContextMenuPlayerId;
      closePlayerTokenContextMenu();
      if (pId) showDmEditor(pId);
    });
  }

  // Menü içine tıklamaların haritaya taşmasını engelle
  playerContextMenu.addEventListener('mousedown', (e) => e.stopPropagation());
  playerContextMenu.addEventListener('click', (e) => e.stopPropagation());
}

// Dışarı tıklandığında menüyü kapat
document.addEventListener('mousedown', (e) => {
  if (playerContextMenu && !playerContextMenu.classList.contains('hidden')) {
    if (!e.target.closest('#player-token-context-menu')) {
      closePlayerTokenContextMenu();
    }
  }
});

// ============================================================
// ÇİZİM KATMANI (DRAWING LAYER)
// ============================================================

const canvas = document.getElementById('drawing-layer');
const ctx = canvas ? canvas.getContext('2d') : null;
let localDrawHistory = [];

// Çizim Araçları State
let currentDrawTool = 'pan'; // 'pan', 'pen', 'straightLine', 'arrow', 'rect', 'circle', 'eraser'
let currentDrawColor = '#e74c3c';
let currentDrawWidth = 6;
let currentEraserWidth = 20;
let currentFillEnabled = false;

let isDrawing = false;
let isDrawingShape = false;
let shapeStartX = 0;
let shapeStartY = 0;
let lastX = 0;
let lastY = 0;

if (canvas && ctx) {
  function resizeCanvas() {
    canvas.width = gameMap.clientWidth || 2000;
    canvas.height = gameMap.clientHeight || 1500;
    redrawHistory();
  }

  window.addEventListener('resize', resizeCanvas);
  setTimeout(resizeCanvas, 100);

  // Hex to RGBA yardımcı fonksiyonu
  function hexToRgba(hex, alpha = 0.25) {
    if (!hex || typeof hex !== 'string') return `rgba(231, 76, 60, ${alpha})`;
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16);
    if (isNaN(num)) return `rgba(231, 76, 60, ${alpha})`;
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // Bireysel Çizim Nesnesini Çizme (Çizgi, Şekil veya Silgi)
  function renderDrawItem(item) {
    if (!item) return;
    const type = item.type || 'line';
    const color = item.color || '#e74c3c';
    const width = item.width || 3;
    const x0 = item.x0;
    const y0 = item.y0;
    const x1 = item.x1;
    const y1 = item.y1;

    ctx.save();

    if (type === 'erase') {
      // Piksel / Fırça Silgisi: İstenilen kısmı saydamlaştırır
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.closePath();
    } else if (type === 'rect') {
      const rx = Math.min(x0, x1);
      const ry = Math.min(y0, y1);
      const rw = Math.abs(x1 - x0);
      const rh = Math.abs(y1 - y0);
      if (item.fill) {
        ctx.fillStyle = hexToRgba(color, 0.28);
        ctx.fillRect(rx, ry, rw, rh);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.strokeRect(rx, ry, rw, rh);
    } else if (type === 'circle') {
      const radius = Math.hypot(x1 - x0, y1 - y0);
      ctx.beginPath();
      ctx.arc(x0, y0, radius, 0, Math.PI * 2);
      if (item.fill) {
        ctx.fillStyle = hexToRgba(color, 0.28);
        ctx.fill();
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
      ctx.closePath();
    } else if (type === 'arrow') {
      const headLen = Math.max(14, width * 3);
      const angle = Math.atan2(y1 - y0, x1 - x0);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';

      // Gövde çizgisi
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();

      // Ok ucu üçgeni
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - headLen * Math.cos(angle - Math.PI / 6), y1 - headLen * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(x1 - headLen * Math.cos(angle + Math.PI / 6), y1 - headLen * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
    } else if (type === 'straightLine') {
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.closePath();
    } else {
      // Serbest çizim parçası ('line')
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.closePath();
    }

    ctx.restore();
  }

  function redrawHistory() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    localDrawHistory.forEach(item => {
      renderDrawItem(item);
    });
  }

  // Throttled çizim emit
  const throttledDrawEmit = throttle((drawItem) => {
    socket.emit('drawLine', drawItem);
  }, 16);

  // Silgi İmleç Göstergesi
  const eraserCursor = document.getElementById('eraser-cursor');
  function updateEraserCursorPos(clientX, clientY) {
    if (!eraserCursor) return;
    if (currentDrawTool !== 'eraser') {
      eraserCursor.classList.add('hidden');
      return;
    }
    const containerRect = gameMapContainer.getBoundingClientRect();
    const x = clientX - containerRect.left;
    const y = clientY - containerRect.top;
    const currentZoom = window.__webdnd_zoom || 1;
    const visualSize = Math.max(12, currentEraserWidth * currentZoom);

    eraserCursor.style.left = `${x}px`;
    eraserCursor.style.top = `${y}px`;
    eraserCursor.style.width = `${visualSize}px`;
    eraserCursor.style.height = `${visualSize}px`;
    eraserCursor.classList.remove('hidden');
  }

  if (gameMapContainer) {
    gameMapContainer.addEventListener('mousemove', (e) => {
      if (currentDrawTool === 'eraser') {
        updateEraserCursorPos(e.clientX, e.clientY);
      }
    });
    gameMapContainer.addEventListener('mouseleave', () => {
      if (eraserCursor) eraserCursor.classList.add('hidden');
    });
  }

  // Mousedown
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || window.__webdnd_isPanning || window.__webdnd_isSpacePressed || currentDrawTool === 'pan') return;

    const rect = canvas.getBoundingClientRect();
    const currentZoom = window.__webdnd_zoom || 1;
    const clickX = (e.clientX - rect.left) / currentZoom;
    const clickY = (e.clientY - rect.top) / currentZoom;

    if (currentDrawTool === 'rect' || currentDrawTool === 'circle' || currentDrawTool === 'straightLine' || currentDrawTool === 'arrow') {
      isDrawingShape = true;
      shapeStartX = clickX;
      shapeStartY = clickY;
    } else {
      isDrawing = true;
      lastX = clickX;
      lastY = clickY;

      // Silgi veya serbest çizim başlangıç noktası
      const activeWidth = currentDrawTool === 'eraser' ? currentEraserWidth : currentDrawWidth;
      const initialItem = {
        playerId: myId,
        type: currentDrawTool === 'eraser' ? 'erase' : 'line',
        x0: lastX,
        y0: lastY,
        x1: lastX + 0.1,
        y1: lastY + 0.1,
        color: currentDrawColor,
        width: activeWidth
      };
      renderDrawItem(initialItem);
      localDrawHistory.push(initialItem);
      throttledDrawEmit(initialItem);
    }
  });

  // Touchstart
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1 || currentDrawTool === 'pan') { isDrawing = false; isDrawingShape = false; return; }
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches[0];
    const currentZoom = window.__webdnd_zoom || 1;
    const touchX = (touch.clientX - rect.left) / currentZoom;
    const touchY = (touch.clientY - rect.top) / currentZoom;

    if (currentDrawTool === 'rect' || currentDrawTool === 'circle' || currentDrawTool === 'straightLine' || currentDrawTool === 'arrow') {
      isDrawingShape = true;
      shapeStartX = touchX;
      shapeStartY = touchY;
    } else {
      isDrawing = true;
      lastX = touchX;
      lastY = touchY;
      const activeWidth = currentDrawTool === 'eraser' ? currentEraserWidth : currentDrawWidth;
      const initialItem = {
        playerId: myId,
        type: currentDrawTool === 'eraser' ? 'erase' : 'line',
        x0: lastX,
        y0: lastY,
        x1: lastX + 0.1,
        y1: lastY + 0.1,
        color: currentDrawColor,
        width: activeWidth
      };
      renderDrawItem(initialItem);
      localDrawHistory.push(initialItem);
      throttledDrawEmit(initialItem);
    }
  }, { passive: true });

  // Mousemove
  canvas.addEventListener('mousemove', (e) => {
    updateEraserCursorPos(e.clientX, e.clientY);

    const rect = canvas.getBoundingClientRect();
    const currentZoom = window.__webdnd_zoom || 1;
    const curX = (e.clientX - rect.left) / currentZoom;
    const curY = (e.clientY - rect.top) / currentZoom;

    if (isDrawingShape) {
      // Şekil önizlemesi (canlı olarak çizileni göster)
      redrawHistory();
      renderDrawItem({
        type: currentDrawTool,
        x0: shapeStartX,
        y0: shapeStartY,
        x1: curX,
        y1: curY,
        color: currentDrawColor,
        width: currentDrawWidth,
        fill: currentFillEnabled
      });
      return;
    }

    if (!isDrawing) return;

    const isErase = currentDrawTool === 'eraser';
    const activeWidth = isErase ? currentEraserWidth : currentDrawWidth;
    const drawItem = {
      playerId: myId,
      type: isErase ? 'erase' : 'line',
      x0: lastX,
      y0: lastY,
      x1: curX,
      y1: curY,
      color: currentDrawColor,
      width: activeWidth
    };

    renderDrawItem(drawItem);
    localDrawHistory.push(drawItem);
    throttledDrawEmit(drawItem);

    lastX = curX;
    lastY = curY;
  });

  // Touchmove
  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) return;
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches[0];
    const currentZoom = window.__webdnd_zoom || 1;
    const curX = (touch.clientX - rect.left) / currentZoom;
    const curY = (touch.clientY - rect.top) / currentZoom;

    if (isDrawingShape) {
      e.preventDefault();
      redrawHistory();
      renderDrawItem({
        type: currentDrawTool,
        x0: shapeStartX,
        y0: shapeStartY,
        x1: curX,
        y1: curY,
        color: currentDrawColor,
        width: currentDrawWidth,
        fill: currentFillEnabled
      });
      return;
    }

    if (!isDrawing) return;
    e.preventDefault();

    const isErase = currentDrawTool === 'eraser';
    const activeWidth = isErase ? currentEraserWidth : currentDrawWidth;
    const drawItem = {
      playerId: myId,
      type: isErase ? 'erase' : 'line',
      x0: lastX,
      y0: lastY,
      x1: curX,
      y1: curY,
      color: currentDrawColor,
      width: activeWidth
    };

    renderDrawItem(drawItem);
    localDrawHistory.push(drawItem);
    throttledDrawEmit(drawItem);

    lastX = curX;
    lastY = curY;
  }, { passive: false });

  // Mouseup / Touchend
  function handleDrawEnd(clientX, clientY) {
    if (isDrawingShape) {
      isDrawingShape = false;
      const rect = canvas.getBoundingClientRect();
      const currentZoom = window.__webdnd_zoom || 1;
      const finalX = clientX != null ? (clientX - rect.left) / currentZoom : shapeStartX;
      const finalY = clientY != null ? (clientY - rect.top) / currentZoom : shapeStartY;

      if (Math.hypot(finalX - shapeStartX, finalY - shapeStartY) > 3) {
        const shapeItem = {
          playerId: myId,
          type: currentDrawTool,
          x0: shapeStartX,
          y0: shapeStartY,
          x1: finalX,
          y1: finalY,
          color: currentDrawColor,
          width: currentDrawWidth,
          fill: currentFillEnabled
        };
        localDrawHistory.push(shapeItem);
        redrawHistory();
        socket.emit('drawLine', shapeItem);
      } else {
        redrawHistory();
      }
    }
    isDrawing = false;
  }

  canvas.addEventListener('mouseup', (e) => handleDrawEnd(e.clientX, e.clientY));
  canvas.addEventListener('touchend', (e) => {
    const touch = e.changedTouches?.[0];
    handleDrawEnd(touch?.clientX, touch?.clientY);
  });
  canvas.addEventListener('mouseleave', () => {
    isDrawing = false;
    if (isDrawingShape) {
      isDrawingShape = false;
      redrawHistory();
    }
    if (eraserCursor) eraserCursor.classList.add('hidden');
  });
  canvas.addEventListener('touchcancel', () => {
    isDrawing = false;
    isDrawingShape = false;
  });

  // Socket Alımı
  socket.on('draw', (data) => {
    localDrawHistory.push(data);
    renderDrawItem(data);
  });

  socket.on('drawHistory', (history) => {
    localDrawHistory = Array.isArray(history) ? history : [];
    redrawHistory();
  });

  socket.on('clearDrawing', () => {
    localDrawHistory = [];
    redrawHistory();
  });

  // Geri Al (Undo)
  function undoLastDrawing() {
    socket.emit('undoDraw');
    for (let i = localDrawHistory.length - 1; i >= 0; i--) {
      if (localDrawHistory[i].playerId === myId) {
        localDrawHistory.splice(i, 1);
        redrawHistory();
        break;
      }
    }
  }

  // ============================================================
  // ÇİZİM PANELİ KONTROLLERİ & ETKİLEŞİMLERİ (UI BINDINGS)
  // ============================================================

  const toolbar = document.getElementById('map-draw-toolbar');
  const toolBtns = document.querySelectorAll('.draw-btn[data-tool]');
  const sizePills = document.querySelectorAll('.size-pill');
  const sizeSlider = document.getElementById('draw-size-slider');
  const sizePreview = document.getElementById('draw-size-preview');
  const sizeLabel = document.getElementById('draw-size-label');
  const colorDots = document.querySelectorAll('.color-dot');
  const customColorInput = document.getElementById('draw-custom-color');
  const fillCheckbox = document.getElementById('draw-fill-checkbox');
  const fillToggleLabel = document.getElementById('draw-fill-toggle-label');
  const colorSettingItem = document.getElementById('draw-color-setting-item');
  const btnUndo = document.getElementById('btn-draw-undo');
  const btnClearMine = document.getElementById('btn-draw-clear-mine');
  const btnToggleOptions = document.getElementById('btn-toggle-draw-options');
  const settingsRow = document.getElementById('draw-settings-row');

  // Araç Değiştirme Fonksiyonu
  function setDrawTool(toolName) {
    currentDrawTool = toolName;
    window.__webdnd_currentDrawTool = toolName;
    window.__webdnd_toolMode = toolName;

    // Tool butonlarının aktif durumunu güncelle
    toolBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === toolName);
    });

    // Alt/zoom çubuğundaki butonları da güncelle
    const bPan = document.getElementById('btn-toggle-pan-tool');
    const bDraw = document.getElementById('btn-toggle-draw-tool');
    const bEraser = document.getElementById('btn-toggle-eraser-tool');
    if (bPan) bPan.classList.toggle('active', toolName === 'pan');
    if (bDraw) bDraw.classList.toggle('active', toolName === 'pen' || toolName === 'straightLine' || toolName === 'arrow' || toolName === 'rect' || toolName === 'circle');
    if (bEraser) bEraser.classList.toggle('active', toolName === 'eraser');

    // Canvas etkileşimi: El aracında pointer-events kapatılır (harita sürüklenir), çizimde açılır
    if (canvas) {
      canvas.style.pointerEvents = toolName === 'pan' ? 'none' : 'auto';
    }

    // Harita imleç sınıfını güncelle
    gameMapContainer.classList.toggle('tool-mode-pan', toolName === 'pan');
    gameMapContainer.classList.toggle('tool-mode-draw', toolName !== 'pan' && toolName !== 'eraser');
    gameMapContainer.classList.toggle('tool-mode-eraser', toolName === 'eraser');

    // Pan modunda alt ayar satırını gizle, çizim/silgi modunda göster
    if (settingsRow) {
      if (toolName === 'pan') {
        settingsRow.classList.add('hidden');
      } else {
        settingsRow.classList.remove('hidden');
      }
    }

    // Silgi modunda renk seçici ve dolgu gizlenir, kalınlık etiketi "Silgi:" olur
    const isEraser = toolName === 'eraser';
    if (colorSettingItem) colorSettingItem.style.display = isEraser ? 'none' : 'flex';
    if (fillToggleLabel) fillToggleLabel.style.display = (toolName === 'rect' || toolName === 'circle') ? 'inline-flex' : 'none';
    if (sizeLabel) sizeLabel.textContent = isEraser ? 'Silgi:' : 'Kalınlık:';

    // Slider ve pill değerini silgi / kalem boyutuna göre ayarla
    const currentSize = isEraser ? currentEraserWidth : currentDrawWidth;
    if (sizeSlider) sizeSlider.value = currentSize;
    if (sizePreview) sizePreview.textContent = `${currentSize}px`;
    updateSizePillActive(currentSize);

    if (!isEraser && eraserCursor) {
      eraserCursor.classList.add('hidden');
    }
  }
  window.__webdnd_setToolMode = setDrawTool;

  // Kalınlık Pill Aktiflik Güncelleme
  function updateSizePillActive(val) {
    sizePills.forEach(pill => {
      pill.classList.toggle('active', parseInt(pill.dataset.size) === val);
    });
  }

  function setDrawSize(sizeVal) {
    const val = Math.max(2, Math.min(60, parseInt(sizeVal) || 6));
    if (currentDrawTool === 'eraser') {
      currentEraserWidth = val;
    } else {
      currentDrawWidth = val;
    }
    if (sizeSlider) sizeSlider.value = val;
    if (sizePreview) sizePreview.textContent = `${val}px`;
    updateSizePillActive(val);
  }

  function setDrawColor(colorVal) {
    currentDrawColor = colorVal;
    if (customColorInput) customColorInput.value = colorVal;
    colorDots.forEach(dot => {
      dot.classList.toggle('active', dot.dataset.color?.toLowerCase() === colorVal?.toLowerCase());
    });
  }

  // Araç Buton Tıklamaları
  toolBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      setDrawTool(btn.dataset.tool);
    });
  });

  // Kalınlık Butonları
  sizePills.forEach(pill => {
    pill.addEventListener('click', () => {
      setDrawSize(parseInt(pill.dataset.size));
    });
  });

  // Slider
  if (sizeSlider) {
    sizeSlider.addEventListener('input', (e) => {
      setDrawSize(parseInt(e.target.value));
    });
  }

  // Renk Noktaları
  colorDots.forEach(dot => {
    dot.addEventListener('click', () => {
      setDrawColor(dot.dataset.color);
    });
  });

  // Özel Renk Seçici
  if (customColorInput) {
    customColorInput.addEventListener('input', (e) => {
      setDrawColor(e.target.value);
    });
  }

  // Dolgu Checkbox
  if (fillCheckbox) {
    fillCheckbox.addEventListener('change', (e) => {
      currentFillEnabled = Boolean(e.target.checked);
    });
  }

  // Ayarları Aç / Kapat Butonu
  if (btnToggleOptions && settingsRow) {
    btnToggleOptions.addEventListener('click', () => {
      settingsRow.classList.toggle('hidden');
    });
  }

  // Geri Al Butonu
  if (btnUndo) {
    btnUndo.addEventListener('click', undoLastDrawing);
  }

  // Temizle Butonları
  if (btnClearMine) {
    btnClearMine.addEventListener('click', () => {
      if (confirm('Kendi çizimlerinizi temizlemek istiyor musunuz?')) {
        socket.emit('requestClearMyDrawings');
      }
    });
  }

  const btnClearAllDrawings = document.getElementById('btn-clear-all-drawings');
  if (btnClearAllDrawings) {
    btnClearAllDrawings.addEventListener('click', () => {
      if (confirm('TÜM çizimleri temizlemek istiyor musunuz?')) {
        socket.emit('requestClearAllDrawings');
      }
    });
  }

  const btnClearMyDrawings = document.getElementById('btn-clear-my-drawings');
  if (btnClearMyDrawings) {
    btnClearMyDrawings.addEventListener('click', () => {
      socket.emit('requestClearMyDrawings');
    });
  }

  // Klavye Kısayolları (Çizim Araçları)
  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;

    // Ctrl+Z (Undo)
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      undoLastDrawing();
      return;
    }

    if (e.key === 'h' || e.key === 'H') {
      setDrawTool('pan');
    } else if (e.key === 'p' || e.key === 'P') {
      setDrawTool('pen');
    } else if (e.key === 'l' || e.key === 'L') {
      setDrawTool('straightLine');
    } else if (e.key === 'a' || e.key === 'A') {
      setDrawTool('arrow');
    } else if (e.key === 'r' || e.key === 'R') {
      setDrawTool('rect');
    } else if (e.key === 'c' || e.key === 'C') {
      setDrawTool('circle');
    } else if (e.key === 'e' || e.key === 'E') {
      setDrawTool('eraser');
    } else if (e.key === '[') {
      const cur = currentDrawTool === 'eraser' ? currentEraserWidth : currentDrawWidth;
      setDrawSize(Math.max(2, cur - 3));
    } else if (e.key === ']') {
      const cur = currentDrawTool === 'eraser' ? currentEraserWidth : currentDrawWidth;
      setDrawSize(Math.min(60, cur + 3));
    }
  });

  // Başlangıçta Pan modunu ayarla
  setDrawTool('pan');
}

// ============================================================
// RESİM SÜRÜKLE-BIRAK YÜKLEME
// ============================================================

function setupImageDropZone(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;

  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    el.style.border = '2px dashed #e74c3c';
    el.style.backgroundColor = 'rgba(231, 76, 60, 0.1)';
  });

  el.addEventListener('dragleave', (e) => {
    e.preventDefault();
    el.style.border = '';
    el.style.backgroundColor = '';
  });

  el.addEventListener('drop', async (e) => {
    e.preventDefault();
    el.style.border = '';
    el.style.backgroundColor = '';

    if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;

    const file = e.dataTransfer.files[0];
    if (!file.type.startsWith('image/')) {
      alert('Lütfen sadece resim dosyası sürükleyin.');
      return;
    }

    const originalPlaceholder = el.placeholder;
    el.value = '';
    el.placeholder = 'Resim yükleniyor...';
    el.disabled = true;

    const reader = new FileReader();
    reader.readAsDataURL(file);

    reader.onload = async () => {
      try {
        const response = await fetch('/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: reader.result, name: file.name })
        });

        const data = await response.json();
        if (data.url) {
          el.value = data.url;
        } else {
          alert('Resim yüklenemedi: ' + (data.error || 'Bilinmeyen hata'));
        }
      } catch (err) {
        console.error('Yükleme hatası:', err);
        alert('Resim yüklenirken bir hata oluştu.');
      } finally {
        el.disabled = false;
        el.placeholder = originalPlaceholder;
      }
    };

    reader.onerror = () => {
      alert('Dosya okunamadı!');
      el.disabled = false;
      el.placeholder = originalPlaceholder;
    };
  });
}

setupImageDropZone('dm-marker-img');
setupImageDropZone('dm-bg-url');
setupImageDropZone('player-token-img');

// ============================================================
// ZAR ATMA (Sonuç sunucu tarafında üretilir)
// ============================================================

document.querySelectorAll('.dice-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const diceType = parseInt(btn.getAttribute('data-dice'));

    let rollerName = "Bilinmiyor";
    if (role === 'dm') {
      rollerName = "DM";
    } else if (characterData && characterData.name) {
      rollerName = characterData.name;
    }

    // Sadece diceType ve rollerName gönder; sonuç sunucuda üretilecek
    socket.emit('rollDice', { rollerName, diceType });
  });
});

socket.on('diceRolled', (data) => {
  const safeRollerName = escapeHtml(data.rollerName);

  let resultText = `<span style="font-weight: bold;">${safeRollerName}</span> d${data.diceType} attı: <strong>${data.result}</strong>`;

  // D20 Kritik Başarı/Başarısızlık renklendirmesi
  if (data.diceType === 20) {
    if (data.result === 20) {
      resultText = `<span style="font-weight: bold;">${safeRollerName}</span> d20 attı: <strong style="color: #2ecc71;">20 (Kritik Başarı!)</strong>`;
    } else if (data.result === 1) {
      resultText = `<span style="font-weight: bold;">${safeRollerName}</span> d20 attı: <strong style="color: #e74c3c;">1 (Kritik Başarısızlık!)</strong>`;
    }
  }

  addLogHtml(resultText);

  // Log divini en aşağı kaydır
  const controlPanel = document.getElementById('control-panel');
  if (controlPanel) controlPanel.scrollTop = controlPanel.scrollHeight;

  // Harita üzerinde Toast Gösterimi
  const toast = document.createElement('div');
  toast.className = 'dice-toast';

  let toastText = `${escapeHtml(data.rollerName)}: d${data.diceType} 🎲 ${data.result}`;
  if (data.diceType === 20) {
    if (data.result === 20) toastText = `${escapeHtml(data.rollerName)}: 🎲 20 (Kritik!)`;
    if (data.result === 1) toastText = `${escapeHtml(data.rollerName)}: 🎲 1 (Kritik!)`;
  }
  toast.textContent = toastText;

  const mapContainer = document.getElementById('game-map');
  if (mapContainer) {
    mapContainer.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 2000);
  }
});

// ============================================================
// STATUS EFFECTS & CUSTOM EFFECT BUILDER (DM TOOLBOX)
// ============================================================

let currentStatusPresets = [];

// Socket senkronizasyonu
socket.on('customEffectsUpdated', (presets) => {
  if (Array.isArray(presets)) {
    currentStatusPresets = presets;
    renderStatusPresets();
    populateTokenEditorEffectSelect(document.getElementById('dm-marker-add-effect-select'));
    populateTokenEditorEffectSelect(document.getElementById('dm-player-add-effect-select'));
    populateTokenEditorEffectSelect(document.getElementById('dm-marker-obj-effect-select'));
    populateTokenEditorEffectSelect(document.getElementById('dm-marker-edit-obj-effect-select'));
  }
});

socket.on('tokenEffectsUpdated', (data) => {
  if (allPlayers[data.id]) {
    allPlayers[data.id].activeEffects = data.activeEffects;
    if (allPlayers[data.id].character) {
      allPlayers[data.id].character.activeEffects = data.activeEffects;
    }
    const t = tokens[data.id];
    if (t) {
      updateTokenStatusBadges(t, allPlayers[data.id]);
    } else {
      updateToken(allPlayers[data.id]);
    }
    if (editingPlayerId === data.id) {
      renderPlayerEditorActiveEffects(allPlayers[data.id]);
    }
  }
  refreshStatusToolboxTargets();
});

socket.on('logMessage', (data) => {
  if (!data || !data.message) return;
  addLog(data.message, data.color || '#e5c158');
});

/**
 * Durum efekti kural özetini metin olarak üretir.
 */
function describeStatusRules(effects) {
  if (!effects) return '';
  const parts = [];
  if (effects.dotDamage) parts.push(`🔥 Tur sonu ${effects.dotDamage.min}-${effects.dotDamage.max} hasar`);
  if (effects.blind) parts.push('👁️ Kendi saldırıları dezavantajlı');
  if (effects.paralyzed) parts.push('⚡ Gelen saldırılar kesin vuruş & kritik (2x)');
  if (effects.shelter) parts.push('🛡️ Hasar almaz (Dokunulmaz)');
  if (effects.prepared) parts.push('🎯 Gelen saldırılar dezavantajlı');
  if (effects.unstoppable) parts.push('🦏 Felç bağışıklığı');

  // Dirençler
  if (effects.res_bludgeoning || effects.resistance === 'bludgeoning') parts.push('🔨 Ezme Direnci (0.5x)');
  if (effects.res_slashing || effects.resistance === 'slashing') parts.push('⚔️ Kesme Direnci (0.5x)');
  if (effects.res_piercing || effects.resistance === 'piercing') parts.push('🏹 Delme Direnci (0.5x)');
  if (effects.res_magic || effects.resistance === 'magic') parts.push('🔮 Büyü Direnci (0.5x)');

  // Zayıflıklar
  if (effects.vuln_bludgeoning || effects.vulnerability === 'bludgeoning') parts.push('💥🔨 Ezme Zayıflığı (2x)');
  if (effects.vuln_slashing || effects.vulnerability === 'slashing') parts.push('💥⚔️ Kesme Zayıflığı (2x)');
  if (effects.vuln_piercing || effects.vulnerability === 'piercing') parts.push('💥🏹 Delme Zayıflığı (2x)');
  if (effects.vuln_magic || effects.vulnerability === 'magic') parts.push('💥✨ Büyü Zayıflığı (2x)');

  return parts.join(' | ') || 'Özel Efekt';
}

/**
 * Token düzenleme pencerelerindeki durum efekti ekleme dropdown'ını doldurur.
 */
function populateTokenEditorEffectSelect(selectEl) {
  if (!selectEl) return;
  const prevVal = selectEl.value;
  selectEl.innerHTML = '<option value="">— Durum Efekti Ekle —</option>';

  const presets = (typeof currentStatusPresets !== 'undefined' && Array.isArray(currentStatusPresets)) ? currentStatusPresets : [];
  if (presets.length === 0) return;

  const groupRes = document.createElement('optgroup');
  groupRes.label = '🛡️ Hasar Dirençleri (0.5x)';

  const groupVuln = document.createElement('optgroup');
  groupVuln.label = '💥 Hasar Zayıflıkları (2x)';

  const groupDebuff = document.createElement('optgroup');
  groupDebuff.label = '🔥 Zararlı Durumlar (Debuff)';

  const groupBuff = document.createElement('optgroup');
  groupBuff.label = '✨ Yararlı / Özel Durumlar';

  const groupOther = document.createElement('optgroup');
  groupOther.label = '📜 Özel Şablonlar';

  presets.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    const durLabel = p.duration != null ? ` (${p.duration}T)` : ' (Kalıcı)';
    opt.textContent = `${p.icon || '✨'} ${p.name}${durLabel}`;

    const id = p.id || '';
    const name = (p.name || '').toLowerCase();
    const eff = p.effects || {};
    if (id.startsWith('preset_res_') || eff.resistance || eff.res_bludgeoning || eff.res_slashing || eff.res_piercing || eff.res_magic || name.includes('diren')) {
      groupRes.appendChild(opt);
    } else if (id.startsWith('preset_vuln_') || eff.vulnerability || eff.vuln_bludgeoning || eff.vuln_slashing || eff.vuln_piercing || eff.vuln_magic || name.includes('zayıf')) {
      groupVuln.appendChild(opt);
    } else if (eff.dotDamage || eff.blind || eff.paralyzed || ['preset_burn', 'preset_bleed', 'preset_blind', 'preset_paralyzed', 'preset_poison'].includes(id)) {
      groupDebuff.appendChild(opt);
    } else if (eff.shelter || eff.prepared || eff.unstoppable || ['preset_shelter', 'preset_prepared', 'preset_unstoppable'].includes(id)) {
      groupBuff.appendChild(opt);
    } else {
      groupOther.appendChild(opt);
    }
  });

  if (groupRes.children.length > 0) selectEl.appendChild(groupRes);
  if (groupVuln.children.length > 0) selectEl.appendChild(groupVuln);
  if (groupDebuff.children.length > 0) selectEl.appendChild(groupDebuff);
  if (groupBuff.children.length > 0) selectEl.appendChild(groupBuff);
  if (groupOther.children.length > 0) selectEl.appendChild(groupOther);

  if (prevVal) selectEl.value = prevVal;
}

/**
 * Hedef seçim kutusunu doldurur.
 */
function populateStatusTargetSelect() {
  const select = document.getElementById('status-target-select');
  if (!select) return;

  const currentVal = select.value;
  select.innerHTML = '<option value="selected">-- Seçili Hedefler (Haritadakiler) --</option>';

  // Markerlar
  const markerGroup = document.createElement('optgroup');
  markerGroup.label = '👾 Canavarlar / Markerlar';
  Object.values(window.__webdnd_markers || {}).forEach(m => {
    const opt = document.createElement('option');
    opt.value = `marker:${m.id}`;
    opt.textContent = `[Marker] ${m.name || 'NPC'} (HP: ${m.hp ?? '?'})`;
    markerGroup.appendChild(opt);
  });
  if (markerGroup.children.length > 0) select.appendChild(markerGroup);

  // Oyuncular
  const playerGroup = document.createElement('optgroup');
  playerGroup.label = '🛡️ Oyuncular';
  Object.values(allPlayers).forEach(p => {
    if (p.role === 'dm' || !p.character) return;
    const opt = document.createElement('option');
    opt.value = `character:${p.character.id || p.id}`;
    opt.textContent = `[Oyuncu] ${p.character.name} (HP: ${p.character.hp_current}/${p.character.hp_max})`;
    playerGroup.appendChild(opt);
  });
  if (playerGroup.children.length > 0) select.appendChild(playerGroup);

  if (currentVal) select.value = currentVal;
  renderTargetActiveEffectsList();
}

/**
 * Seçili hedefin üzerindeki aktif efektleri listeler.
 */
function renderTargetActiveEffectsList() {
  const container = document.getElementById('status-target-active-effects');
  const select = document.getElementById('status-target-select');
  if (!container || !select) return;

  container.innerHTML = '';
  const val = select.value;
  const targets = resolveStatusSelectedTargets(val);

  if (targets.length === 0) {
    container.innerHTML = '<span style="font-size:11px; color:#7f8c8d; font-style:italic;">Hedef seçilmedi veya efekt yok.</span>';
    return;
  }

  targets.forEach(t => {
    const activeEffects = t.data?.activeEffects || (t.data?.character && t.data.character.activeEffects) || [];
    if (activeEffects.length === 0) return;

    activeEffects.forEach(eff => {
      const chip = document.createElement('span');
      chip.className = 'status-target-chip';
      const durText = eff.duration != null ? `${eff.duration}T` : '∞';
      chip.innerHTML = `
        <span>${eff.icon || '✨'}</span>
        <strong>${escapeHtml(t.name)}:</strong>
        <span>${escapeHtml(eff.name)} (${durText})</span>
        <span class="chip-del-btn" title="Efekti Kaldır">✕</span>
      `;

      chip.querySelector('.chip-del-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        socket.emit('removeStatusEffect', {
          targetType: t.type,
          targetId: t.id,
          effectId: eff.id
        });
      });

      container.appendChild(chip);
    });
  });

  if (container.children.length === 0) {
    container.innerHTML = '<span style="font-size:11px; color:#7f8c8d; font-style:italic;">Seçili hedef(ler) üzerinde aktif efekt yok.</span>';
  }
}

/**
 * Seçim string'ini hedef nesnelerine dönüştürür.
 */
function resolveStatusSelectedTargets(selectVal) {
  const results = [];
  if (selectVal === 'selected') {
    // Saldırı panelinde veya haritada seçili hedefler varsa onları al
    if (typeof selectedTargets !== 'undefined' && Array.isArray(selectedTargets) && selectedTargets.length > 0) {
      selectedTargets.forEach(st => {
        const liveData = st.type === 'marker' ? window.__webdnd_markers[st.id] : (allPlayers[st.id] || Object.values(allPlayers).find(p => p.character?.id === st.id));
        results.push({ type: st.type, id: st.id, name: st.name, data: liveData || st.data });
      });
    } else {
      // Haritadaki tüm tokenlar arasından ilki veya varsa seçili
      Object.values(window.__webdnd_markers || {}).forEach(m => {
        results.push({ type: 'marker', id: m.id, name: m.name, data: m });
      });
      Object.values(allPlayers).forEach(p => {
        if (p.role !== 'dm' && p.character) {
          results.push({ type: 'character', id: p.character.id || p.id, name: p.character.name, data: p });
        }
      });
    }
  } else if (selectVal && selectVal.includes(':')) {
    const [type, id] = selectVal.split(':');
    if (type === 'marker') {
      const m = window.__webdnd_markers[id];
      if (m) results.push({ type: 'marker', id: m.id, name: m.name, data: m });
    } else if (type === 'character') {
      const p = Object.values(allPlayers).find(item => item.id === id || item.character?.id === id);
      if (p && p.character) results.push({ type: 'character', id: p.character.id || p.id, name: p.character.name, data: p });
    }
  }
  return results;
}

/**
 * Hazır ve Özel Efekt Şablonlarını çizer.
 */
function renderStatusPresets() {
  const grid = document.getElementById('status-presets-grid');
  if (!grid) return;

  grid.innerHTML = '';

  if (!currentStatusPresets || currentStatusPresets.length === 0) {
    grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 24px 10px; color: #888; font-size: 13px;">Henüz kayıtlı durum efekti yok. Aşağıdan yeni durum efekti oluşturup kaydedebilirsiniz.</div>';
    return;
  }

  currentStatusPresets.forEach(preset => {
    const card = document.createElement('div');
    card.className = 'status-preset-card';

    const durLabel = preset.duration != null ? `${preset.duration} Tur` : 'Kalıcı';

    card.innerHTML = `
      <div>
        <div class="preset-header">
          <span class="preset-icon">${preset.icon || '✨'}</span>
          <div class="preset-title-wrap">
            <div class="preset-name">${escapeHtml(preset.name)}</div>
          </div>
          <span class="preset-dur-badge">${durLabel}</span>
        </div>
        <div class="preset-desc">${describeStatusRules(preset.effects)}</div>
      </div>
      <div class="preset-actions">
        <button type="button" class="btn-apply-preset" title="Hedefe Uygula">⚡ Uygula</button>
        <button type="button" class="btn-del-preset" title="Şablonu Sil">🗑️</button>
      </div>
    `;

    // Uygula butonu
    card.querySelector('.btn-apply-preset').addEventListener('click', () => {
      applyEffectToCurrentTargets(preset);
    });

    // Sil butonu
    card.querySelector('.btn-del-preset').addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`"${preset.name}" şablonunu silmek istediğinize emin misiniz?`)) {
        socket.emit('deleteCustomEffect', preset.id);
      }
    });

    grid.appendChild(card);
  });
}

/**
 * Belirli bir efekti o an seçili hedeflere uygular.
 */
function applyEffectToCurrentTargets(effect) {
  const select = document.getElementById('status-target-select');
  const targets = resolveStatusSelectedTargets(select ? select.value : 'selected');

  if (targets.length === 0) {
    alert('Lütfen efekti uygulamak için en az bir HEDEF seçin!');
    return;
  }

  targets.forEach(t => {
    socket.emit('applyStatusEffect', {
      targetType: t.type,
      targetId: t.id,
      effect: effect
    });
  });

  setTimeout(renderTargetActiveEffectsList, 300);
}

/**
 * Status Toolbox Modalı açılış fonksiyonu
 */
function openStatusToolboxModal() {
  populateStatusTargetSelect();
  renderStatusPresets();
  const modal = document.getElementById('dm-status-toolbox-modal');
  if (modal) modal.classList.remove('hidden');
}

function refreshStatusToolboxTargets() {
  const modal = document.getElementById('dm-status-toolbox-modal');
  if (modal && !modal.classList.contains('hidden')) {
    populateStatusTargetSelect();
    renderTargetActiveEffectsList();
  }
}

// Global köprüler
window.__webdnd_openStatusToolbox = openStatusToolboxModal;
window.__webdnd_refreshStatusToolbox = refreshStatusToolboxTargets;

// UI Olay Dinleyicileri
document.addEventListener('DOMContentLoaded', () => {
  // Modal açma & kapama
  const btnOpenToolbox = document.getElementById('btn-dm-status-toolbox');
  if (btnOpenToolbox) {
    btnOpenToolbox.addEventListener('click', openStatusToolboxModal);
  }

  const btnCloseToolbox = document.getElementById('btn-close-status-toolbox');
  if (btnCloseToolbox) {
    btnCloseToolbox.addEventListener('click', () => {
      document.getElementById('dm-status-toolbox-modal').classList.add('hidden');
    });
  }

  const btnCancelToolbox = document.getElementById('btn-cancel-status-toolbox');
  if (btnCancelToolbox) {
    btnCancelToolbox.addEventListener('click', () => {
      document.getElementById('dm-status-toolbox-modal').classList.add('hidden');
    });
  }

  // Hedef değişimi
  const targetSelect = document.getElementById('status-target-select');
  if (targetSelect) {
    targetSelect.addEventListener('change', renderTargetActiveEffectsList);
  }

  // Tab Geçişleri
  document.querySelectorAll('.status-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.status-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.status-tab-pane').forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const tabName = btn.dataset.tab;
      const pane = document.getElementById(`status-tab-${tabName}`);
      if (pane) pane.classList.add('active');
    });
  });

  // Hızlı Emoji Seçici
  const iconInput = document.getElementById('status-builder-icon');
  document.querySelectorAll('.quick-icon-btn').forEach(qBtn => {
    qBtn.addEventListener('click', () => {
      if (iconInput) iconInput.value = qBtn.textContent.trim();
    });
  });

  // DoT Checkbox Toggle
  const dotCheck = document.getElementById('status-rule-dot');
  const dotRow = document.getElementById('status-dot-inputs-row');
  if (dotCheck && dotRow) {
    dotCheck.addEventListener('change', () => {
      if (dotCheck.checked) dotRow.classList.remove('hidden');
      else dotRow.classList.add('hidden');
    });
  }

  // Süresiz Checkbox Toggle
  const permCheck = document.getElementById('status-builder-permanent');
  const durInput = document.getElementById('status-builder-duration');
  if (permCheck && durInput) {
    permCheck.addEventListener('change', () => {
      durInput.disabled = permCheck.checked;
    });
  }

  // Özel Efekti Kaydet
  const btnSaveCustom = document.getElementById('btn-save-custom-status');
  if (btnSaveCustom) {
    btnSaveCustom.addEventListener('click', () => {
      const name = document.getElementById('status-builder-name')?.value.trim();
      if (!name) {
        alert('Lütfen efekte bir İsim verin!');
        return;
      }

      const icon = document.getElementById('status-builder-icon')?.value.trim() || '✨';
      const isPermanent = document.getElementById('status-builder-permanent')?.checked;
      const duration = isPermanent ? null : (parseInt(document.getElementById('status-builder-duration')?.value) || 2);

      const hasDot = document.getElementById('status-rule-dot')?.checked;
      const dotMin = parseInt(document.getElementById('status-builder-dot-min')?.value) || 1;
      const dotMax = parseInt(document.getElementById('status-builder-dot-max')?.value) || dotMin;

      const effects = {};
      if (hasDot) effects.dotDamage = { min: dotMin, max: dotMax };
      if (document.getElementById('status-rule-blind')?.checked) effects.blind = true;
      if (document.getElementById('status-rule-paralyzed')?.checked) effects.paralyzed = true;
      if (document.getElementById('status-rule-shelter')?.checked) effects.shelter = true;
      if (document.getElementById('status-rule-prepared')?.checked) effects.prepared = true;
      if (document.getElementById('status-rule-unstoppable')?.checked) effects.unstoppable = true;

      // Hasar Dirençleri
      if (document.getElementById('status-rule-res-bludgeoning')?.checked) effects.res_bludgeoning = true;
      if (document.getElementById('status-rule-res-slashing')?.checked) effects.res_slashing = true;
      if (document.getElementById('status-rule-res-piercing')?.checked) effects.res_piercing = true;
      if (document.getElementById('status-rule-res-magic')?.checked) effects.res_magic = true;

      // Hasar Zayıflıkları
      if (document.getElementById('status-rule-vuln-bludgeoning')?.checked) effects.vuln_bludgeoning = true;
      if (document.getElementById('status-rule-vuln-slashing')?.checked) effects.vuln_slashing = true;
      if (document.getElementById('status-rule-vuln-piercing')?.checked) effects.vuln_piercing = true;
      if (document.getElementById('status-rule-vuln-magic')?.checked) effects.vuln_magic = true;

      const effectObj = {
        name,
        icon,
        duration,
        effects
      };

      socket.emit('saveCustomEffect', effectObj);
      alert(`"${name}" özel efekt şablonu kaydedildi!`);

      // Şablonlar sekmesine dön
      const presetTabBtn = document.querySelector('.status-tab-btn[data-tab="presets"]');
      if (presetTabBtn) presetTabBtn.click();
    });
  }

  // Özel Efekti Doğrudan Hedefe Uygula
  const btnApplyCustom = document.getElementById('btn-apply-custom-status');
  if (btnApplyCustom) {
    btnApplyCustom.addEventListener('click', () => {
      const name = document.getElementById('status-builder-name')?.value.trim() || 'Özel Efekt';
      const icon = document.getElementById('status-builder-icon')?.value.trim() || '✨';
      const isPermanent = document.getElementById('status-builder-permanent')?.checked;
      const duration = isPermanent ? null : (parseInt(document.getElementById('status-builder-duration')?.value) || 2);

      const hasDot = document.getElementById('status-rule-dot')?.checked;
      const dotMin = parseInt(document.getElementById('status-builder-dot-min')?.value) || 1;
      const dotMax = parseInt(document.getElementById('status-builder-dot-max')?.value) || dotMin;

      const effects = {};
      if (hasDot) effects.dotDamage = { min: dotMin, max: dotMax };
      if (document.getElementById('status-rule-blind')?.checked) effects.blind = true;
      if (document.getElementById('status-rule-paralyzed')?.checked) effects.paralyzed = true;
      if (document.getElementById('status-rule-shelter')?.checked) effects.shelter = true;
      if (document.getElementById('status-rule-prepared')?.checked) effects.prepared = true;
      if (document.getElementById('status-rule-unstoppable')?.checked) effects.unstoppable = true;

      // Hasar Dirençleri
      if (document.getElementById('status-rule-res-bludgeoning')?.checked) effects.res_bludgeoning = true;
      if (document.getElementById('status-rule-res-slashing')?.checked) effects.res_slashing = true;
      if (document.getElementById('status-rule-res-piercing')?.checked) effects.res_piercing = true;
      if (document.getElementById('status-rule-res-magic')?.checked) effects.res_magic = true;

      // Hasar Zayıflıkları
      if (document.getElementById('status-rule-vuln-bludgeoning')?.checked) effects.vuln_bludgeoning = true;
      if (document.getElementById('status-rule-vuln-slashing')?.checked) effects.vuln_slashing = true;
      if (document.getElementById('status-rule-vuln-piercing')?.checked) effects.vuln_piercing = true;
      if (document.getElementById('status-rule-vuln-magic')?.checked) effects.vuln_magic = true;

      const effectObj = {
        name,
        icon,
        duration,
        effects
      };

      applyEffectToCurrentTargets(effectObj);
    });
  }

  // Toplu Saldırı Atama Modal Dinleyicileri
  document.getElementById('btn-dm-batch-assign-attacks')?.addEventListener('click', openBatchAssignModal);
  document.getElementById('btn-close-batch-attacks')?.addEventListener('click', closeBatchAssignModal);
  document.getElementById('btn-cancel-batch-attacks')?.addEventListener('click', closeBatchAssignModal);
  document.getElementById('btn-submit-batch-attacks')?.addEventListener('click', submitBatchAssign);

  // Token arama ve seçim butonları
  document.getElementById('batch-tokens-search')?.addEventListener('input', (e) => {
    renderBatchAssignTokens(e.target.value);
  });
  document.getElementById('batch-tokens-select-all')?.addEventListener('click', () => {
    const markersObj = window.__webdnd_markers || {};
    const query = (document.getElementById('batch-tokens-search')?.value || '').toLowerCase().trim();
    Object.values(markersObj).forEach(m => {
      if (!query || (m.name || '').toLowerCase().includes(query)) {
        batchSelectedTokenIds.add(m.id);
      }
    });
    renderBatchAssignTokens(query);
    updateBatchAssignSummary();
  });
  document.getElementById('batch-tokens-clear-all')?.addEventListener('click', () => {
    batchSelectedTokenIds.clear();
    renderBatchAssignTokens(document.getElementById('batch-tokens-search')?.value || '');
    updateBatchAssignSummary();
  });

  // Saldırı arama ve seçim butonları
  document.getElementById('batch-attacks-search')?.addEventListener('input', (e) => {
    renderBatchAssignPresets(e.target.value);
  });
  document.getElementById('batch-attacks-select-all')?.addEventListener('click', () => {
    const allPresets = typeof window.__webdnd_getAttackPresets === 'function' ? window.__webdnd_getAttackPresets() : [];
    const query = (document.getElementById('batch-attacks-search')?.value || '').toLowerCase().trim();
    allPresets.forEach(p => {
      if (!query || (p.name || '').toLowerCase().includes(query) || (p.stat || '').toLowerCase().includes(query)) {
        batchSelectedAttackIds.add(p.id);
      }
    });
    renderBatchAssignPresets(query);
    updateBatchAssignSummary();
  });
  document.getElementById('batch-attacks-clear-all')?.addEventListener('click', () => {
    batchSelectedAttackIds.clear();
    renderBatchAssignPresets(document.getElementById('batch-attacks-search')?.value || '');
    updateBatchAssignSummary();
  });

  // İlk yüklemede özel efektleri sorgula ve token oluşturma saldırı listesini doldur
  if (typeof socket !== 'undefined') {
    socket.emit('getCustomEffects');
  }
  setTimeout(populateCreateTokenAttacksList, 1000);
});

// ============================================================
// DM TOPLU SALDIRI ATAMA (BATCH ASSIGN ATTACKS) SİSTEMİ
// ============================================================

let batchSelectedTokenIds = new Set();
let batchSelectedAttackIds = new Set();

function openBatchAssignModal() {
  const modal = document.getElementById('dm-batch-attacks-modal');
  if (!modal) return;

  batchSelectedTokenIds.clear();
  batchSelectedAttackIds.clear();

  // Haritadaki mevcut tüm markerları varsayılan olarak seçili yapalım
  const markersObj = window.__webdnd_markers || {};
  Object.keys(markersObj).forEach(id => batchSelectedTokenIds.add(id));

  const searchTokens = document.getElementById('batch-tokens-search');
  if (searchTokens) searchTokens.value = '';
  const searchAttacks = document.getElementById('batch-attacks-search');
  if (searchAttacks) searchAttacks.value = '';

  renderBatchAssignTokens();
  renderBatchAssignPresets();
  updateBatchAssignSummary();

  modal.classList.remove('hidden');
}

function closeBatchAssignModal() {
  const modal = document.getElementById('dm-batch-attacks-modal');
  if (modal) modal.classList.add('hidden');
}

function refreshBatchAssignModalIfOpen() {
  const modal = document.getElementById('dm-batch-attacks-modal');
  if (modal && !modal.classList.contains('hidden')) {
    const searchTokens = document.getElementById('batch-tokens-search')?.value || '';
    const searchAttacks = document.getElementById('batch-attacks-search')?.value || '';
    renderBatchAssignTokens(searchTokens);
    renderBatchAssignPresets(searchAttacks);
    updateBatchAssignSummary();
  }
}

function renderBatchAssignTokens(filterText = '') {
  const container = document.getElementById('batch-tokens-list');
  const countBadge = document.getElementById('batch-tokens-count');
  if (!container) return;

  const markersObj = window.__webdnd_markers || {};
  const markerList = Object.values(markersObj);

  if (countBadge) {
    countBadge.textContent = `${markerList.length} Token`;
  }

  const query = (filterText || '').toLowerCase().trim();
  const filtered = markerList.filter(m => {
    if (!query) return true;
    return (m.name || '').toLowerCase().includes(query) || String(m.hp || '').includes(query);
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 24px 8px; color: #64748b; font-size: 12px;">
        ${query ? `"${escapeHtml(query)}" ile eşleşen token bulunamadı.` : 'Haritada henüz oluşturulmuş token bulunmuyor.'}
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  filtered.forEach(m => {
    const item = document.createElement('div');
    const isSelected = batchSelectedTokenIds.has(m.id);
    item.className = `batch-check-item ${isSelected ? 'selected' : ''}`;

    const assignedCount = Array.isArray(m.assignedAttacks) ? m.assignedAttacks.length : 0;
    const hpText = m.hp != null ? `HP: ${m.hp}/${m.maxHp || m.hp}` : 'NPC';

    item.innerHTML = `
      <input type="checkbox" value="${escapeHtml(m.id)}" ${isSelected ? 'checked' : ''}>
      <div class="batch-token-avatar" style="background-color: ${escapeHtml(m.color || '#e5c158')};">
        ${m.imgUrl ? `<img src="${escapeHtml(m.imgUrl)}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">` : escapeHtml(m.name || '?')}
      </div>
      <div class="batch-item-info">
        <span class="batch-item-name">${escapeHtml(m.name || 'Token')}</span>
        <div class="batch-item-meta">
          <span style="color:#64748b; margin-right:4px;">${hpText}</span>
          <span class="batch-badge-count">${assignedCount} Saldırı</span>
        </div>
      </div>
    `;

    const cb = item.querySelector('input[type="checkbox"]');
    item.addEventListener('click', (e) => {
      if (e.target !== cb) {
        cb.checked = !cb.checked;
      }
      if (cb.checked) {
        batchSelectedTokenIds.add(m.id);
        item.classList.add('selected');
      } else {
        batchSelectedTokenIds.delete(m.id);
        item.classList.remove('selected');
      }
      updateBatchAssignSummary();
    });

    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      if (cb.checked) {
        batchSelectedTokenIds.add(m.id);
        item.classList.add('selected');
      } else {
        batchSelectedTokenIds.delete(m.id);
        item.classList.remove('selected');
      }
      updateBatchAssignSummary();
    });

    container.appendChild(item);
  });
}

function renderBatchAssignPresets(filterText = '') {
  const container = document.getElementById('batch-attacks-list');
  const countBadge = document.getElementById('batch-attacks-count');
  if (!container) return;

  const allPresets = typeof window.__webdnd_getAttackPresets === 'function' ? window.__webdnd_getAttackPresets() : [];

  if (countBadge) {
    countBadge.textContent = `${allPresets.length} Saldırı`;
  }

  const query = (filterText || '').toLowerCase().trim();
  const filtered = allPresets.filter(p => {
    if (!query) return true;
    return (p.name || '').toLowerCase().includes(query) || (p.stat || '').toLowerCase().includes(query);
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 24px 8px; color: #64748b; font-size: 12px;">
        ${query ? `"${escapeHtml(query)}" ile eşleşen saldırı preseti bulunamadı.` : 'Henüz kayıtlı saldırı preseti yok.'}
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  filtered.forEach(p => {
    const item = document.createElement('div');
    const isSelected = batchSelectedAttackIds.has(p.id);
    item.className = `batch-check-item ${isSelected ? 'selected' : ''}`;

    const stat = p.stat || 'STR';
    const typeLabel = p.attackType === 'spell' ? `Büyü (Lvl ${p.spellLevel || 1})` : 'Fiziksel';

    item.innerHTML = `
      <input type="checkbox" value="${escapeHtml(p.id)}" ${isSelected ? 'checked' : ''}>
      <span class="batch-badge-stat ${stat.toLowerCase()}">${stat}</span>
      <div class="batch-item-info">
        <span class="batch-item-name">${escapeHtml(p.name)}</span>
        <div class="batch-item-meta">
          <span style="color:#64748b;">${typeLabel}</span>
        </div>
      </div>
    `;

    const cb = item.querySelector('input[type="checkbox"]');
    item.addEventListener('click', (e) => {
      if (e.target !== cb) {
        cb.checked = !cb.checked;
      }
      if (cb.checked) {
        batchSelectedAttackIds.add(p.id);
        item.classList.add('selected');
      } else {
        batchSelectedAttackIds.delete(p.id);
        item.classList.remove('selected');
      }
      updateBatchAssignSummary();
    });

    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      if (cb.checked) {
        batchSelectedAttackIds.add(p.id);
        item.classList.add('selected');
      } else {
        batchSelectedAttackIds.delete(p.id);
        item.classList.remove('selected');
      }
      updateBatchAssignSummary();
    });

    container.appendChild(item);
  });
}

function updateBatchAssignSummary() {
  const badge = document.getElementById('batch-assign-summary-badge');
  const btnSubmit = document.getElementById('btn-submit-batch-attacks');

  const tokenCount = batchSelectedTokenIds.size;
  const attackCount = batchSelectedAttackIds.size;

  if (badge) {
    badge.textContent = `${tokenCount} Token | ${attackCount} Saldırı seçildi`;
  }

  if (btnSubmit) {
    btnSubmit.disabled = (tokenCount === 0 || attackCount === 0);
  }
}

function submitBatchAssign() {
  const tokenIds = Array.from(batchSelectedTokenIds);
  const attackIds = Array.from(batchSelectedAttackIds);

  if (tokenIds.length === 0) {
    alert('Lütfen en az bir hedef token seçin.');
    return;
  }
  if (attackIds.length === 0) {
    alert('Lütfen tokenlara atanacak en az bir saldırı preseti seçin.');
    return;
  }

  const modeRadio = document.querySelector('input[name="batch-assign-mode"]:checked');
  const mode = modeRadio ? modeRadio.value : 'append';

  socket.emit('batchAssignAttacks', {
    markerIds: tokenIds,
    attackPresetIds: attackIds,
    mode: mode
  });

  closeBatchAssignModal();
}

function populateCreateTokenAttacksList() {
  const container = document.getElementById('dm-create-token-attacks-list');
  if (!container) return;

  const allPresets = typeof window.__webdnd_getAttackPresets === 'function' ? window.__webdnd_getAttackPresets() : [];
  if (allPresets.length === 0) {
    container.innerHTML = '<span style="font-size: 11px; color: #64748b;">Henüz kayıtlı saldırı preseti yok.</span>';
    return;
  }

  const previouslyChecked = new Set(Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value));
  container.innerHTML = '';

  allPresets.forEach(preset => {
    const label = document.createElement('label');
    label.className = 'assigned-attack-item';
    label.style.fontSize = '11px';
    label.style.padding = '4px 6px';
    const isChecked = previouslyChecked.has(preset.id);
    label.innerHTML = `
      <input type="checkbox" class="dm-create-token-attack-checkbox" value="${escapeHtml(preset.id)}" ${isChecked ? 'checked' : ''}>
      <span class="assigned-attack-stat-badge ${preset.stat ? preset.stat.toLowerCase() : 'str'}">${preset.stat || 'STR'}</span>
      <span class="assigned-attack-name">${escapeHtml(preset.name)}</span>
    `;
    container.appendChild(label);
  });
}

// Socket batch atama sonucu dinleyicisi
socket.on('batchAssignAttacksResult', (res) => {
  if (res && res.success) {
    const toast = document.createElement('div');
    toast.className = 'dice-toast';
    toast.innerHTML = `⚡ <strong>${res.count} adet tokene</strong> toplu saldırı başarıyla atandı!`;
    const mapContainer = document.getElementById('game-map');
    if (mapContainer) {
      mapContainer.appendChild(toast);
      setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 3000);
    }
  }
});

// Spawner düşman doğurma görsel ve ses animasyonu
socket.on('spawnerSpawned', (data) => {
  const mapContent = document.getElementById('map-content');
  if (mapContent && data && data.x != null && data.y != null) {
    const burst = document.createElement('div');
    burst.className = 'spawner-summon-burst';
    burst.style.left = `${data.x + 25}px`;
    burst.style.top = `${data.y + 25}px`;
    mapContent.appendChild(burst);
    setTimeout(() => { if (burst.parentNode) burst.parentNode.removeChild(burst); }, 1500);
  }
  // Mistik çağırma sesi
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(580, audioCtx.currentTime + 0.35);
    gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.45);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.5);
  } catch(e) {}
});

// Şifa etki göstergesi (Floating Combat Healing)
socket.on('combatHealImpact', (data) => {
  if (!data) return;
  const amount = data.amount || data.heal;
  const targetId = data.targetId || data.recipientId;
  if (!amount || !targetId) return;

  const targetEl = document.querySelector(`.token[data-id="${targetId}"]`);
  const mapContent = document.getElementById('map-content');
  if (targetEl && mapContent) {
    const tLeft = parseFloat(targetEl.style.left) || targetEl.offsetLeft || 0;
    const tTop = parseFloat(targetEl.style.top) || targetEl.offsetTop || 0;
    const tSize = targetEl.offsetWidth || 50;

    const floatHeal = document.createElement('div');
    floatHeal.className = 'token-floating-heal';
    floatHeal.textContent = `💚 +${amount}`;
    floatHeal.style.left = `${tLeft + tSize / 2}px`;
    floatHeal.style.top = `${tTop}px`;
    mapContent.appendChild(floatHeal);
    setTimeout(() => { if (floatHeal.parentNode) floatHeal.parentNode.removeChild(floatHeal); }, 1800);
  }
});

// ============================================================
// HARİTA KAMERASI: YAKINLAŞTIRMA & KAYDIRMA (ZOOM & PAN CONTROLLER)
// ============================================================

(function initMapCamera() {
  const container = document.getElementById('game-map');
  const content = document.getElementById('map-content');
  if (!container || !content) return;

  // State
  let zoom = 1.0;
  let panX = 0;
  let panY = 0;
  const minZoom = 0.2;
  const maxZoom = 3.5;

  let toolMode = 'pan'; // 'pan' (El Aracı) veya 'draw' (Çizim Aracı)
  window.__webdnd_toolMode = toolMode;

  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let initialPanX = 0;
  let initialPanY = 0;
  let hasMovedPan = false;
  let isSpacePressed = false;

  // DOM Elements
  const drawingLayer = document.getElementById('drawing-layer');
  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomOut = document.getElementById('btn-zoom-out');
  const btnZoomReset = document.getElementById('btn-zoom-reset');
  const btnZoomFit = document.getElementById('btn-zoom-fit');
  const zoomLevelBadge = document.getElementById('map-zoom-level');
  const btnTogglePan = document.getElementById('btn-toggle-pan-tool');
  const btnToggleDraw = document.getElementById('btn-toggle-draw-tool');
  const btnToggleEraser = document.getElementById('btn-toggle-eraser-tool');

  // Başlangıçta pan modunu ve drawing-layer etkileşimini ayarla
  function updateToolModeUI() {
    window.__webdnd_toolMode = toolMode;
    container.classList.toggle('tool-mode-pan', toolMode === 'pan');
    container.classList.toggle('tool-mode-draw', toolMode !== 'pan' && toolMode !== 'eraser');
    container.classList.toggle('tool-mode-eraser', toolMode === 'eraser');

    if (btnTogglePan) btnTogglePan.classList.toggle('active', toolMode === 'pan');
    if (btnToggleDraw) btnToggleDraw.classList.toggle('active', toolMode === 'draw' || toolMode === 'pen');
    if (btnToggleEraser) btnToggleEraser.classList.toggle('active', toolMode === 'eraser');

    if (drawingLayer) {
      drawingLayer.style.pointerEvents = toolMode === 'pan' ? 'none' : 'auto';
    }
  }
  updateToolModeUI();

  // Kameranın pozisyon ve ölçeğini map-content'e uygular
  function applyCamera(smooth = false) {
    if (smooth) {
      content.style.transition = 'transform 0.28s cubic-bezier(0.2, 0.9, 0.4, 1)';
      setTimeout(() => { content.style.transition = ''; }, 280);
    } else {
      content.style.transition = '';
    }

    content.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    content.style.transformOrigin = '0 0';

    window.__webdnd_zoom = zoom;
    window.__webdnd_panX = panX;
    window.__webdnd_panY = panY;

    // Geniş açıdan bakıldığında (zoom < 1.0) can barları, karanlık barları ve efektlerin okunabilirliği için büyüme çarpanı
    const wideScale = zoom < 1 ? Math.min(3.5, 1 / Math.pow(zoom, 0.85)) : 1.0;
    content.style.setProperty('--zoom-ui-scale', wideScale.toFixed(3));
    content.style.setProperty('--zoom-scale', zoom.toFixed(3));

    if (zoomLevelBadge) {
      zoomLevelBadge.textContent = `${Math.round(zoom * 100)}%`;
    }
  }

  // Nokta odaklı yakınlaştırma
  function zoomAtPoint(factor, clientX, clientY, smooth = false) {
    const rect = container.getBoundingClientRect();
    const mouseX = clientX != null ? clientX - rect.left : rect.width / 2;
    const mouseY = clientY != null ? clientY - rect.top : rect.height / 2;

    const newZoom = Math.min(maxZoom, Math.max(minZoom, zoom * factor));
    if (Math.abs(newZoom - zoom) < 0.001) return;

    // Fare noktasını sabit tutacak şekilde yeni pan pozisyonu
    panX = mouseX - (mouseX - panX) * (newZoom / zoom);
    panY = mouseY - (mouseY - panY) * (newZoom / zoom);
    zoom = newZoom;

    applyCamera(smooth);
  }

  // Haritayı ekrana sığdır / ortala
  function fitMap(smooth = true) {
    const viewW = container.clientWidth;
    const viewH = container.clientHeight;
    const mapW = content.clientWidth || 2000;
    const mapH = content.clientHeight || 1500;
    if (!mapW || !mapH) return;

    const scaleX = (viewW - 40) / mapW;
    const scaleY = (viewH - 40) / mapH;
    zoom = Math.min(1.2, Math.max(minZoom, Math.min(scaleX, scaleY)));
    panX = (viewW - mapW * zoom) / 2;
    panY = (viewH - mapH * zoom) / 2;
    applyCamera(smooth);
  }

  // %100 Orijinal boyuta sıfırla ve ortala
  function resetZoom(smooth = true) {
    zoom = 1.0;
    const viewW = container.clientWidth;
    const viewH = container.clientHeight;
    const mapW = content.clientWidth || 2000;
    const mapH = content.clientHeight || 1500;
    panX = Math.max(0, (viewW - mapW) / 2);
    panY = Math.max(0, (viewH - mapH) / 2);
    applyCamera(smooth);
  }

  // Haritada belirli bir koordinatı merkezleme (Token odaklama için global helper)
  function centerMapOn(mapX, mapY, smooth = true) {
    const viewW = container.clientWidth;
    const viewH = container.clientHeight;
    panX = viewW / 2 - mapX * zoom;
    panY = viewH / 2 - mapY * zoom;
    applyCamera(smooth);
  }
  window.__webdnd_centerMapOn = centerMapOn;
  window.__webdnd_zoom = zoom;
  window.__webdnd_panX = panX;
  window.__webdnd_panY = panY;

  // Fare Tekerleği (Mouse Wheel) ile Zoom
  container.addEventListener('wheel', (e) => {
    // Scroll edilebilir HUD panellerinde (chat, combat track vs.) haritayı zoomlama
    if (e.target.closest('#bg3-combat-bar-container, #bg3-bottom-hotbar, .bg3-cards-wrapper, .modal, .dm-modal-content, #logs, #kenan-turn-info-card, .dice-history-popup')) {
      return;
    }
    e.preventDefault();

    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    zoomAtPoint(factor, e.clientX, e.clientY, false);
  }, { passive: false });

  // Pan Başlatma
  function startPan(clientX, clientY) {
    isPanning = true;
    window.__webdnd_isPanning = true;
    panStartX = clientX;
    panStartY = clientY;
    initialPanX = panX;
    initialPanY = panY;
    hasMovedPan = false;
    container.classList.add('map-is-panning');
  }

  function doPan(clientX, clientY) {
    if (!isPanning) return;
    const dx = clientX - panStartX;
    const dy = clientY - panStartY;
    if (Math.hypot(dx, dy) > 4) {
      hasMovedPan = true;
    }
    panX = initialPanX + dx;
    panY = initialPanY + dy;
    applyCamera(false);
  }

  function stopPan() {
    if (!isPanning) return;
    isPanning = false;
    window.__webdnd_isPanning = false;
    container.classList.remove('map-is-panning');
  }

  // Mousedown ile pan başlatma
  container.addEventListener('mousedown', (e) => {
    // HUD, çizim araç çubuğu, context menu veya tokenlara tıklanıyorsa haritayı kaydırma
    if (e.target.closest('#map-zoom-controls, #map-draw-toolbar, #player-token-context-menu, #bg3-combat-bar-container, #bg3-bottom-hotbar, #combat-mode-toggle-btn, #dm-aoe-damage-btn, .token, .modal')) {
      return;
    }

    // Orta tuş (1) veya Spacebar basılıyken sol tık
    if (e.button === 1 || (e.button === 0 && isSpacePressed)) {
      e.preventDefault();
      startPan(e.clientX, e.clientY);
      return;
    }

    // Sağ tık (2) ile haritayı kaydırma
    if (e.button === 2) {
      startPan(e.clientX, e.clientY);
      return;
    }

    // Sol tık (0) El/Kaydırma aracındayken (ve AoE hedefleme aktif değilse)
    const isAoeActive = document.getElementById('aoe-targeting-layer')?.classList.contains('active');
    const isPanMode = (toolMode === 'pan' || window.__webdnd_toolMode === 'pan' || window.__webdnd_currentDrawTool === 'pan');
    if (e.button === 0 && isPanMode && !isAoeActive) {
      startPan(e.clientX, e.clientY);
      return;
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (isPanning) {
      doPan(e.clientX, e.clientY);
    }
  });

  document.addEventListener('mouseup', () => {
    if (isPanning) {
      stopPan();
    }
  });

  // Sağ tık sürükleme yapıldıysa sağ tık menüsünü engelle
  container.addEventListener('contextmenu', (e) => {
    if (hasMovedPan && !e.target.closest('.token, .token-status-badge')) {
      e.preventDefault();
      hasMovedPan = false;
    }
  });

  // Space Tuşu ile Geçici El Aracı
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !e.repeat && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
      isSpacePressed = true;
      window.__webdnd_isSpacePressed = true;
      container.classList.add('map-space-held');
    }
  });

  document.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      isSpacePressed = false;
      window.__webdnd_isSpacePressed = false;
      container.classList.remove('map-space-held');
    }
  });

  // Dokunmatik (Touch) Cihazlar: 2 Parmak Kaydırma & Pinch Zoom
  let touchStartDist = null;
  let touchStartZoom = 1.0;
  let touchStartMidX = 0;
  let touchStartMidY = 0;

  container.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      touchStartDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      touchStartZoom = zoom;
      touchStartMidX = (t1.clientX + t2.clientX) / 2;
      touchStartMidY = (t1.clientY + t2.clientY) / 2;
      initialPanX = panX;
      initialPanY = panY;
    }
  }, { passive: false });

  container.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && touchStartDist) {
      e.preventDefault();
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const currentDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const pinchFactor = currentDist / touchStartDist;
      const currentMidX = (t1.clientX + t2.clientX) / 2;
      const currentMidY = (t1.clientY + t2.clientY) / 2;

      zoom = Math.min(maxZoom, Math.max(minZoom, touchStartZoom * pinchFactor));
      panX = initialPanX + (currentMidX - touchStartMidX);
      panY = initialPanY + (currentMidY - touchStartMidY);
      applyCamera(false);
    }
  }, { passive: false });

  container.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) {
      touchStartDist = null;
    }
  });

  // Buton Eventleri
  if (btnZoomIn) {
    btnZoomIn.addEventListener('click', () => zoomAtPoint(1.25, null, null, true));
  }
  if (btnZoomOut) {
    btnZoomOut.addEventListener('click', () => zoomAtPoint(0.8, null, null, true));
  }
  if (btnZoomReset) {
    btnZoomReset.addEventListener('click', () => resetZoom(true));
  }
  if (btnZoomFit) {
    btnZoomFit.addEventListener('click', () => fitMap(true));
  }

  // Araç Butonları (El vs Kalem vs Silgi)
  function switchTool(targetTool) {
    toolMode = targetTool;
    if (typeof window.__webdnd_setToolMode === 'function') {
      window.__webdnd_setToolMode(targetTool);
    } else {
      updateToolModeUI();
    }
  }

  if (btnTogglePan) {
    btnTogglePan.addEventListener('click', () => switchTool('pan'));
  }
  if (btnToggleDraw) {
    btnToggleDraw.addEventListener('click', () => switchTool('pen'));
  }
  if (btnToggleEraser) {
    btnToggleEraser.addEventListener('click', () => switchTool('eraser'));
  }

  // Klavye Kısayolları (Girdi alanları dışında)
  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;

    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      zoomAtPoint(1.2, null, null, true);
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      zoomAtPoint(0.83, null, null, true);
    } else if (e.key === '0') {
      e.preventDefault();
      resetZoom(true);
    } else if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      fitMap(true);
    } else if (e.key === 'h' || e.key === 'H') {
      switchTool('pan');
    } else if (e.key === 'p' || e.key === 'P') {
      switchTool('pen');
    } else if (e.key === 'e' || e.key === 'E') {
      switchTool('eraser');
    }
  });

  // İlk açılışta kamera ölçek CSS değişkenlerini başlat
  applyCamera(false);
})();

// ============================================================
// KEEP-ALIVE PING (Render.com free plan için)
// ============================================================

setInterval(() => {
  fetch('/ping')
    .then(() => console.log('Sunucu uyanık tutuluyor...'))
    .catch(err => console.error('Ping hatası:', err));
}, 10 * 60 * 1000);