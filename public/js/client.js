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
 * Token üzerindeki HP badge'ini oluşturur veya günceller.
 */
function updateHpBadge(tokenEl, hpCurrent, hpMax) {
  if (hpCurrent == null || hpMax == null || isNaN(hpCurrent)) return;

  let hpBadge = tokenEl.querySelector('.token-hp-badge');
  if (!hpBadge) {
    hpBadge = document.createElement('div');
    hpBadge.className = 'token-hp-badge';
    tokenEl.appendChild(hpBadge);
  }
  hpBadge.textContent = `${hpCurrent} / ${hpMax}`;
  hpBadge.style.backgroundColor = getHpColor(hpCurrent, hpMax);
}

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
  if (playerData.isMarker) return playerData.name || '?';
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

  if (role === 'dm') {
    document.getElementById('dm-tools').classList.remove('hidden');
  } else {
    document.getElementById('player-info-panel').classList.remove('hidden');
  }
});

// ============================================================
// SOCKET EVENT HANDLER'LARI
// ============================================================

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
});

socket.on('attackPresetsUpdated', () => {
  if (typeof editingPlayerId !== 'undefined' && editingPlayerId && allPlayers && allPlayers[editingPlayerId]) {
    renderPlayerAssignedAttacks(allPlayers[editingPlayerId]);
  }
  if (typeof editingMarkerId !== 'undefined' && editingMarkerId && window.__webdnd_markers && window.__webdnd_markers[editingMarkerId]) {
    renderMarkerAssignedAttacks(window.__webdnd_markers[editingMarkerId]);
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
  renderPlayerInfo();

  // HP Badge güncelle
  const t = tokens[data.id];
  if (t) {
    updateHpBadge(t, allPlayers[data.id].character.hp_current, allPlayers[data.id].character.hp_max);
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
    window.__webdnd_markers[position.id].x = position.x;
    window.__webdnd_markers[position.id].y = position.y;
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
    t.title = 'İşaret: ' + escapeHtml(playerData.name);
    t.style.borderRadius = '10%';

    // DM eklediği işareti sağ tık ile silebilir
    if (role === 'dm') {
      t.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        socket.emit('deleteMarker', playerData.id);
      });
    }
  } else {
    t.title = escapeHtml(getPlayerDisplayName(playerData));
  }

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

  // Ctrl+Click ile hedef seçimi (DM için)
  if (role === 'dm') {
    t.addEventListener('click', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();

      // Hedef bilgilerini çöz
      let targetInfo = null;
      if (playerData.isMarker) {
        // Güncel marker verisini al
        const currentMarker = window.__webdnd_markers[playerData.id];
        if (currentMarker) {
          targetInfo = { type: 'marker', id: currentMarker.id, name: currentMarker.name, data: currentMarker };
        }
      } else if (playerData.character) {
        // Güncel oyuncu verisini al
        const currentPlayer = allPlayers[playerData.id];
        if (currentPlayer && currentPlayer.character) {
          targetInfo = { type: 'character', id: currentPlayer.character.id, name: currentPlayer.character.name, data: currentPlayer.character };
        }
      }

      if (targetInfo && typeof window.__webdnd_ctrlClickTarget === 'function') {
        window.__webdnd_ctrlClickTarget(targetInfo, t);
      }
    });
  }

  // HP Badge
  const { hpCurrent, hpMax } = extractHp(playerData);
  if (hpCurrent !== null && hpMax !== null) {
    updateHpBadge(t, hpCurrent, hpMax);
  }

  // Durum Efekt Rozetleri
  updateTokenStatusBadges(t, playerData);

  gameMap.appendChild(t);
  tokens[playerData.id] = t;
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
    }
  }

  // Stil güncelle (POZİSYONU SIFIRLAMADAN: updatePosition = false)
  applyTokenStyles(t, playerData, false);

  // Başlık / İsim güncelle
  if (playerData.isMarker) {
    t.title = 'İşaret: ' + escapeHtml(playerData.name || '');
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

  // Durum Efekt Rozetleri güncelle
  updateTokenStatusBadges(t, playerData);
}

/**
 * Token üzerindeki aktif durum efekt rozetlerini günceller.
 */
function updateTokenStatusBadges(tokenEl, playerData) {
  let badgeWrap = tokenEl.querySelector('.token-status-badges');
  const activeEffects = playerData.activeEffects || (playerData.character && playerData.character.activeEffects) || [];

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

  const size = data.size || 50;
  t.style.width = size + 'px';
  t.style.height = size + 'px';

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
    if (e.ctrlKey || e.metaKey) return;
    isDragging = true;
    draggedToken = tokenEl;
    draggedToken.dataset.id = tokenId;
    const rect = tokenEl.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
  });

  tokenEl.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1) return;
    isDragging = true;
    draggedToken = tokenEl;
    draggedToken.dataset.id = tokenId;
    const rect = tokenEl.getBoundingClientRect();
    const touch = e.touches[0];
    offsetX = touch.clientX - rect.left;
    offsetY = touch.clientY - rect.top;
  }, { passive: true });
}

// === Throttled Hareket Emit ===
const throttledMovementEmit = throttle((id, x, y) => {
  socket.emit('playerMovement', { id, x, y });
}, 16); // ~60fps

document.addEventListener('mousemove', (e) => {
  if (!isDragging || !draggedToken) return;

  const mapRect = gameMap.getBoundingClientRect();
  const newX = e.clientX - mapRect.left - offsetX;
  const newY = e.clientY - mapRect.top - offsetY;

  draggedToken.style.left = newX + 'px';
  draggedToken.style.top = newY + 'px';

  const id = draggedToken.dataset.id;
  if (id) {
    if (allPlayers[id]) {
      allPlayers[id].x = newX;
      allPlayers[id].y = newY;
    }
    if (window.__webdnd_markers && window.__webdnd_markers[id]) {
      window.__webdnd_markers[id].x = newX;
      window.__webdnd_markers[id].y = newY;
    }
    throttledMovementEmit(id, newX, newY);
  }
});

document.addEventListener('touchmove', (e) => {
  if (!isDragging || !draggedToken || e.touches.length > 1) return;
  e.preventDefault();

  const touch = e.touches[0];
  const mapRect = gameMap.getBoundingClientRect();
  const newX = touch.clientX - mapRect.left - offsetX;
  const newY = touch.clientY - mapRect.top - offsetY;

  draggedToken.style.left = newX + 'px';
  draggedToken.style.top = newY + 'px';

  const id = draggedToken.dataset.id;
  if (id) {
    if (allPlayers[id]) {
      allPlayers[id].x = newX;
      allPlayers[id].y = newY;
    }
    if (window.__webdnd_markers && window.__webdnd_markers[id]) {
      window.__webdnd_markers[id].x = newX;
      window.__webdnd_markers[id].y = newY;
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

    const name   = (nameEl.value || 'X').substring(0, 2);
    const color  = colorEl.value || '#f1c40f';
    const imgUrl = imgEl ? imgEl.value : '';
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

    socket.emit('createMarker', { name, color, x: 200, y: 200, imgUrl, hp, maxHp, size, ac, acBonus, stats });

    // Sadece adı temizle — HP/AC/stat değerleri bir sonraki aynı tür düşman için kalır
    nameEl.value = '';
    if (imgEl) imgEl.value = '';
  });
}

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

  renderMarkerEditorActiveEffects(markerData);
  renderMarkerAssignedAttacks(markerData);

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
      assignedAttacks
    });

    document.getElementById('dm-marker-editor-modal').classList.add('hidden');
    editingMarkerId = null;
  });
}

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

  // AC & Corruption
  const acEl = document.getElementById('dm-edit-ac');
  const acBonusEl = document.getElementById('dm-edit-ac-bonus');
  const corruptionEl = document.getElementById('dm-edit-corruption');
  if (acEl) acEl.value = c.ac ?? 10;
  if (acBonusEl) acBonusEl.value = c.ac_bonus ?? 0;
  if (corruptionEl) corruptionEl.value = c.corruption ?? 0;

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

function saveDmEditorState(playerId) {
  if (!playerId || !allPlayers[playerId] || !allPlayers[playerId].character) return;

  const assignedCheckboxes = document.querySelectorAll('#dm-player-assigned-attacks input[type="checkbox"]:checked');
  const assignedAttacks = Array.from(assignedCheckboxes).map(cb => cb.value);

  const updatedData = {
    id: playerId,
    characterId: allPlayers[playerId].character.id,
    hp_current: parseInt(document.getElementById('dm-edit-hp').value),
    hp_max: parseInt(document.getElementById('dm-edit-max-hp').value),
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
// ÇİZİM KATMANI (DRAWING LAYER)
// ============================================================

const canvas = document.getElementById('drawing-layer');
const ctx = canvas ? canvas.getContext('2d') : null;
let isDrawing = false;
let lastX = 0;
let lastY = 0;
let localDrawHistory = [];

if (canvas && ctx) {
  function resizeCanvas() {
    canvas.width = gameMap.clientWidth || 2000;
    canvas.height = gameMap.clientHeight || 1500;
    redrawHistory();
  }

  window.addEventListener('resize', resizeCanvas);
  setTimeout(resizeCanvas, 100);

  function redrawHistory() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    localDrawHistory.forEach(line => {
      drawLineOnCanvas(line.x0, line.y0, line.x1, line.y1, line.color);
    });
  }

  function drawLineOnCanvas(x0, y0, x1, y1, color) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.closePath();
  }

  // Throttled çizim emit
  const throttledDrawEmit = throttle((lineData) => {
    socket.emit('drawLine', lineData);
  }, 16);

  canvas.addEventListener('mousedown', (e) => {
    isDrawing = true;
    const rect = canvas.getBoundingClientRect();
    lastX = e.clientX - rect.left;
    lastY = e.clientY - rect.top;
  });

  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1) { isDrawing = false; return; }
    isDrawing = true;
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches[0];
    lastX = touch.clientX - rect.left;
    lastY = touch.clientY - rect.top;
  }, { passive: true });

  function handleDrawMove(currentX, currentY) {
    if (!isDrawing) return;

    let myColor = '#e74c3c';
    if (allPlayers[myId] && allPlayers[myId].color) {
      myColor = allPlayers[myId].color;
    }

    const lineData = { playerId: myId, x0: lastX, y0: lastY, x1: currentX, y1: currentY, color: myColor };

    drawLineOnCanvas(lastX, lastY, currentX, currentY, myColor);
    localDrawHistory.push(lineData);
    throttledDrawEmit(lineData);

    lastX = currentX;
    lastY = currentY;
  }

  canvas.addEventListener('mousemove', (e) => {
    if (!isDrawing) return;
    const rect = canvas.getBoundingClientRect();
    handleDrawMove(e.clientX - rect.left, e.clientY - rect.top);
  });

  canvas.addEventListener('touchmove', (e) => {
    if (!isDrawing || e.touches.length > 1) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches[0];
    handleDrawMove(touch.clientX - rect.left, touch.clientY - rect.top);
  }, { passive: false });

  canvas.addEventListener('mouseup', () => isDrawing = false);
  canvas.addEventListener('mouseout', () => isDrawing = false);
  canvas.addEventListener('touchend', () => isDrawing = false);
  canvas.addEventListener('touchcancel', () => isDrawing = false);

  socket.on('draw', (data) => {
    localDrawHistory.push(data);
    drawLineOnCanvas(data.x0, data.y0, data.x1, data.y1, data.color);
  });

  socket.on('drawHistory', (history) => {
    localDrawHistory = history;
    redrawHistory();
  });

  socket.on('clearDrawing', () => {
    localDrawHistory = [];
    redrawHistory();
  });

  const btnClearAllDrawings = document.getElementById('btn-clear-all-drawings');
  if (btnClearAllDrawings) {
    btnClearAllDrawings.addEventListener('click', () => {
      socket.emit('requestClearAllDrawings');
    });
  }

  const btnClearMyDrawings = document.getElementById('btn-clear-my-drawings');
  if (btnClearMyDrawings) {
    btnClearMyDrawings.addEventListener('click', () => {
      socket.emit('requestClearMyDrawings');
    });
  }
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

let currentStatusPresets = [
  { id: 'preset_burn', name: 'Yanma', icon: '🔥', duration: 3, effects: { dotDamage: { min: 1, max: 6 } } },
  { id: 'preset_bleed', name: 'Kanama', icon: '🩸', duration: 2, effects: { dotDamage: { min: 2, max: 8 } } },
  { id: 'preset_blind', name: 'Körlük', icon: '👁️', duration: 2, effects: { blind: true } },
  { id: 'preset_paralyzed', name: 'Felç', icon: '⚡', duration: 1, effects: { paralyzed: true } },
  { id: 'preset_shelter', name: 'Barınak', icon: '🛡️', duration: 1, effects: { shelter: true } },
  { id: 'preset_prepared', name: 'Hazır', icon: '🎯', duration: 2, effects: { prepared: true } },
  { id: 'preset_unstoppable', name: 'Durdurulamaz', icon: '🦏', duration: 3, effects: { unstoppable: true } },
  { id: 'preset_poison', name: 'Zehir', icon: '☠️', duration: 3, effects: { dotDamage: { min: 1, max: 4 }, blind: true } }
];

// Socket senkronizasyonu
socket.on('customEffectsUpdated', (presets) => {
  if (Array.isArray(presets)) {
    currentStatusPresets = presets;
    renderStatusPresets();
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
  return parts.join(' | ') || 'Özel Efekt';
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

      const effectObj = {
        name,
        icon,
        duration,
        effects
      };

      applyEffectToCurrentTargets(effectObj);
    });
  }

  // İlk yüklemede özel efektleri sorgula
  if (typeof socket !== 'undefined') {
    socket.emit('getCustomEffects');
  }
});

// ============================================================
// KEEP-ALIVE PING (Render.com free plan için)
// ============================================================

setInterval(() => {
  fetch('/ping')
    .then(() => console.log('Sunucu uyanık tutuluyor...'))
    .catch(err => console.error('Ping hatası:', err));
}, 10 * 60 * 1000);