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
});

socket.on('updateMarkerData', (markerData) => {
  window.__webdnd_markers[markerData.id] = markerData;
  updateToken(markerData);
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
});

// ============================================================
// TOKEN YÖNETİMİ
// ============================================================

/**
 * Yeni bir token DOM elemanı oluşturur ve haritaya ekler.
 */
function addToken(playerData) {
  // Eğer zaten varsa var olanı temizle (klon engelleme)
  if (tokens[playerData.id]) {
    tokens[playerData.id].remove();
    delete tokens[playerData.id];
  }

  const t = document.createElement('div');
  t.className = 'token';
  t.dataset.id = playerData.id;

  // Eğer bu token bize aitse
  if (playerData.id === myId) {
    t.classList.add('my-token');
  }

  // Pozisyon, Renk, Boyut
  applyTokenStyles(t, playerData);

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

  // Çift tıklama — Eğer canı olan bir marker ve kullanıcı DM ise
  if (role === 'dm' && playerData.isMarker && playerData.hp != null) {
    t.addEventListener('dblclick', () => openMarkerEditor(playerData));
  }

  // HP Badge
  const { hpCurrent, hpMax } = extractHp(playerData);
  if (hpCurrent !== null && hpMax !== null) {
    updateHpBadge(t, hpCurrent, hpMax);
  }

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

  // Stil güncelle
  applyTokenStyles(t, playerData);

  // HP Badge güncelle
  const { hpCurrent, hpMax } = extractHp(playerData);
  if (hpCurrent !== null && hpMax !== null) {
    updateHpBadge(t, hpCurrent, hpMax);
  }
}

/**
 * Token DOM elemanına pozisyon, renk ve boyut stillerini uygular.
 */
function applyTokenStyles(t, data) {
  t.style.left = data.x + 'px';
  t.style.top = data.y + 'px';
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

  throttledMovementEmit(draggedToken.dataset.id, newX, newY);
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

  throttledMovementEmit(draggedToken.dataset.id, newX, newY);
}, { passive: false });

document.addEventListener('mouseup', () => {
  isDragging = false;
  draggedToken = null;
});

document.addEventListener('touchend', () => {
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
    const nameEl = document.getElementById('dm-marker-name');
    const colorEl = document.getElementById('dm-marker-color');
    const imgEl = document.getElementById('dm-marker-img');
    const hpEl = document.getElementById('dm-marker-hp');
    const maxHpEl = document.getElementById('dm-marker-max-hp');
    const sizeEl = document.getElementById('dm-marker-size');

    const name = (nameEl.value || 'X').substring(0, 2);
    const color = colorEl.value || '#f1c40f';
    const imgUrl = imgEl ? imgEl.value : '';
    const hp = hpEl && hpEl.value !== '' ? parseInt(hpEl.value) : null;
    const maxHp = maxHpEl && maxHpEl.value !== '' ? parseInt(maxHpEl.value) : null;
    const size = sizeEl && sizeEl.value !== '' ? parseInt(sizeEl.value) : 50;

    socket.emit('createMarker', { name, color, x: 200, y: 200, imgUrl, hp, maxHp, size });

    // Formu Temizle
    nameEl.value = '';
    if (imgEl) imgEl.value = '';
    if (hpEl) hpEl.value = '';
    if (maxHpEl) maxHpEl.value = '';
    if (sizeEl) sizeEl.value = '50';
  });
}

// ---- Marker Düzenleme Modalı ----
let editingMarkerId = null;

function openMarkerEditor(markerData) {
  editingMarkerId = markerData.id;
  document.getElementById('dm-marker-edit-title').textContent = `"${markerData.name}" Düzenle`;
  document.getElementById('dm-marker-edit-hp').value = markerData.hp;
  document.getElementById('dm-marker-edit-size').value = markerData.size || 50;
  document.getElementById('dm-marker-editor-modal').classList.remove('hidden');
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
    const newHp = parseInt(document.getElementById('dm-marker-edit-hp').value);
    const newSize = parseInt(document.getElementById('dm-marker-edit-size').value);

    if (!isNaN(newHp) && !isNaN(newSize)) {
      socket.emit('editMarker', { id: editingMarkerId, hp: newHp, size: newSize });
      document.getElementById('dm-marker-editor-modal').classList.add('hidden');
      editingMarkerId = null;
    } else {
      alert('Lütfen geçerli sayılar girin.');
    }
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

function showDmEditor(playerData) {
  if (typeof flushDmEdit === 'function') flushDmEdit();

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

  document.getElementById('dm-player-editor').classList.remove('hidden');
}

function saveDmEditorState(playerId) {
  if (!playerId || !allPlayers[playerId] || !allPlayers[playerId].character) return;

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
// KEEP-ALIVE PING (Render.com free plan için)
// ============================================================

setInterval(() => {
  fetch('/ping')
    .then(() => console.log('Sunucu uyanık tutuluyor...'))
    .catch(err => console.error('Ping hatası:', err));
}, 10 * 60 * 1000);