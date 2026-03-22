// Kullanıcı giriş yapmış mı kontrol et
const role = sessionStorage.getItem('dnd_role');
if (!role) {
  // Giriş yapmadan bu sayfaya geldiyse, login ekranına at
  window.location.href = '/index.html';
}

const profileData = JSON.parse(sessionStorage.getItem('dnd_profile') || 'null');
const characterData = JSON.parse(sessionStorage.getItem('dnd_character') || 'null');

const socket = io();

let myId = null;
const tokens = {};
const allPlayers = {}; // Odaya bağlı tüm oyuncuları burada tutacağız
const gameMapContainer = document.getElementById('game-map');
const gameMap = document.getElementById('map-content');

let isDragging = false;
let draggedToken = null;
let offsetX = 0;
let offsetY = 0;

// Bağlandığını anlamak için basit bir kontrol
socket.on('connect', () => {
  console.log("Sunucuya bağlandım!");
  myId = socket.id;
  document.getElementById('status').innerText = "Bağlandı!";

  // Sunucuya giriş bilgisini ilet
  socket.emit('playerJoin', { role, profile: profileData, character: characterData });

  // Arayüze log ekle
  const logs = document.getElementById('logs');
  const li = document.createElement('li');
  li.innerText = role === 'dm' ? "DM Olarak giriş yaptınız." : `${characterData.name} olarak giriş yaptınız.`;
  logs.appendChild(li);

  if (role === 'dm') {
    document.getElementById('dm-tools').classList.remove('hidden');
  } else {
    document.getElementById('player-info-panel').classList.remove('hidden');
  }
});

socket.on('currentPlayers', (players) => {
  Object.assign(allPlayers, players);
  Object.values(players).forEach(player => {
    addToken(player);
  });
  renderPlayerInfo();
});

socket.on('newPlayer', (playerData) => {
  allPlayers[playerData.id] = playerData;
  addToken(playerData);

  const logs = document.getElementById('logs');
  const li = document.createElement('li');
  let nameStr = playerData.role === 'dm' ? "DM" : (playerData.character ? playerData.character.name : "Bir Oyuncu");
  li.innerText = `${nameStr} katıldı.`;
  logs.appendChild(li);

  renderPlayerInfo();
});

socket.on('currentMarkers', (markers) => {
  Object.values(markers).forEach(marker => {
    addToken(marker);
  });
});

socket.on('newMarker', (markerData) => {
  addToken(markerData);
});

socket.on('removeMarker', (markerId) => {
  if (tokens[markerId]) {
    tokens[markerId].remove();
    delete tokens[markerId];
  }
});

socket.on('updateBg', (url) => {
  if (url) {
    const img = new Image();
    img.onload = () => {
      gameMap.style.backgroundImage = `url('${url}')`;
      gameMap.style.backgroundSize = '100% 100%';
      gameMap.style.backgroundPosition = 'top left';
      gameMap.style.width = Math.max(img.width, 800) + 'px';
      gameMap.style.height = Math.max(img.height, 600) + 'px';
      if (typeof resizeCanvas === 'function') resizeCanvas();
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
  if (allPlayers[data.id]) {
    allPlayers[data.id].imgUrl = data.imgUrl;
    allPlayers[data.id].color = data.color;
    
    // UI token elementini güncelle
    const t = tokens[data.id];
    if (t) {
      t.style.borderColor = data.color;
      if (data.imgUrl) {
        t.style.backgroundImage = `url('${data.imgUrl}')`;
        t.style.backgroundSize = 'cover';
        t.style.backgroundPosition = 'center';
        t.style.backgroundColor = 'transparent';
        t.innerText = '';
      } else {
        t.style.backgroundImage = 'none';
        t.style.backgroundColor = data.color;
        // Metni geri getir
        let initial = allPlayers[data.id].role === 'dm' ? 'DM' : (allPlayers[data.id].character ? allPlayers[data.id].character.name.charAt(0).toUpperCase() : '?');
        t.innerText = initial;
      }
    }
  }
});

socket.on('characterUpdated', (data) => {
  if (allPlayers[data.id] && allPlayers[data.id].character) {
    Object.assign(allPlayers[data.id].character, data.updates);
    renderPlayerInfo();

    if (document.getElementById('dm-edit-form')) {
      const btn = document.getElementById('dm-edit-form').querySelector('button[type="submit"]');
      btn.innerText = "Kaydet";
      btn.disabled = false;
    }

    // Kendi hesabıysa SessionStorage da güncelleyelim.
    if (data.id === myId) {
      sessionStorage.setItem('dnd_character', JSON.stringify(allPlayers[myId].character));
    }
  }
});

socket.on('updateTokenPosition', (position) => {
  if (tokens[position.id]) {
    tokens[position.id].style.left = position.x + 'px';
    tokens[position.id].style.top = position.y + 'px';
  }
});

function addToken(playerData) {
  const t = document.createElement('div');
  t.className = 'token';

  // Eğer bu token bize aitse
  if (playerData.id === myId) {
    t.classList.add('my-token');
  }

  // Pozisyon ve Renk
  t.style.left = playerData.x + 'px';
  t.style.top = playerData.y + 'px';
  t.style.borderColor = playerData.color || '#e74c3c';

  if (playerData.imgUrl) {
    t.style.backgroundImage = `url('${playerData.imgUrl}')`;
    t.style.backgroundSize = 'cover';
    t.style.backgroundPosition = 'center';
    t.style.backgroundColor = 'transparent';
  } else {
    t.style.backgroundColor = playerData.color || '#e74c3c';
  }

  // İçine baş harf koyalım
  let initial = '?';
  if (playerData.isMarker) {
    initial = playerData.name;
    t.title = 'İşaret: ' + playerData.name;
    t.style.borderRadius = '10%'; // Markerlar biraz farklı görünsün (karemsi)

    // DM eklediği işareti sağ tık ile silebilir
    if (role === 'dm') {
      t.addEventListener('contextmenu', (e) => {
        e.preventDefault(); // Varsayılan sağ tık menüsünü engelle
        socket.emit('deleteMarker', playerData.id);
      });
    }
  } else {
    initial = playerData.role === 'dm' ? 'DM' : (playerData.character ? playerData.character.name.charAt(0).toUpperCase() : '?');
    t.title = playerData.role === 'dm' ? 'DM' : (playerData.character ? playerData.character.name : 'Oyuncu');
  }

  if (!playerData.imgUrl) {
    t.innerText = initial;
  }

  // Sürükleme yetkisi: Kendi token'ı VEYA kişi DM ise herhangi bir token.
  if (playerData.id === myId || role === 'dm') {
    // Sürüklenebilir görünüm ekleyelim (zaten DM ise hepsini grab yapabilirizi .my-token sağlar)
    t.classList.add('my-token');

    t.addEventListener('mousedown', (e) => {
      isDragging = true;
      draggedToken = t;
      // Hangi token'ı sürüklediğimizi kaydet
      draggedToken.dataset.id = playerData.id;

      const rect = t.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
    });

    t.addEventListener('touchstart', (e) => {
      if (e.touches.length > 1) return; // İki parmakla haritayı kaydırmaya izin ver
      isDragging = true;
      draggedToken = t;
      draggedToken.dataset.id = playerData.id;

      const rect = t.getBoundingClientRect();
      const touch = e.touches[0];
      offsetX = touch.clientX - rect.left;
      offsetY = touch.clientY - rect.top;
    }, { passive: true });
  }

  gameMap.appendChild(t);
  tokens[playerData.id] = t;
}

document.addEventListener('mousemove', (e) => {
  if (!isDragging || !draggedToken) return;

  const mapRect = gameMap.getBoundingClientRect();
  let newX = e.clientX - mapRect.left - offsetX;
  let newY = e.clientY - mapRect.top - offsetY;

  draggedToken.style.left = newX + 'px';
  draggedToken.style.top = newY + 'px';

  socket.emit('playerMovement', { id: draggedToken.dataset.id, x: newX, y: newY });
});

document.addEventListener('touchmove', (e) => {
  if (!isDragging || !draggedToken || e.touches.length > 1) return;
  e.preventDefault();

  const touch = e.touches[0];
  const mapRect = gameMap.getBoundingClientRect();
  let newX = touch.clientX - mapRect.left - offsetX;
  let newY = touch.clientY - mapRect.top - offsetY;

  draggedToken.style.left = newX + 'px';
  draggedToken.style.top = newY + 'px';

  socket.emit('playerMovement', { id: draggedToken.dataset.id, x: newX, y: newY });
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

// DM Araçları Dinleyicisi
const btnAddMarker = document.getElementById('btn-add-marker');
if (btnAddMarker) {
  btnAddMarker.addEventListener('click', () => {
    const name = document.getElementById('dm-marker-name').value || 'X';
    const color = document.getElementById('dm-marker-color').value || '#f1c40f';
    const imgUrl = document.getElementById('dm-marker-img') ? document.getElementById('dm-marker-img').value : '';
    // Yeni markeri haritanın ortasına atalım
    socket.emit('createMarker', { name: name.substring(0, 2), color: color, x: 200, y: 200, imgUrl: imgUrl });
    document.getElementById('dm-marker-name').value = '';
    if (document.getElementById('dm-marker-img')) {
        document.getElementById('dm-marker-img').value = '';
    }
  });
}

const btnUpdateDmPen = document.getElementById('btn-update-dm-pen');
if (btnUpdateDmPen) {
  btnUpdateDmPen.addEventListener('click', () => {
    const color = document.getElementById('dm-pen-color').value;
    socket.emit('updateTokenAppearance', { color: color });
    
    // Kendi değerlerimizi hemen önbelleğe alıp apply that color faster (optional)
    if (allPlayers[myId]) {
      allPlayers[myId].color = color;
    }
  });
}

const btnSetBg = document.getElementById('btn-set-bg');
if (btnSetBg) {
  btnSetBg.addEventListener('click', () => {
    const url = document.getElementById('dm-bg-url').value;
    socket.emit('updateBg', url);
    document.getElementById('dm-bg-url').value = '';
  });
}

// Token Apperance update for players
const btnUpdateToken = document.getElementById('btn-update-token');
if (btnUpdateToken) {
  btnUpdateToken.addEventListener('click', () => {
    const imgUrl = document.getElementById('player-token-img').value;
    const color = document.getElementById('player-token-color').value;
    socket.emit('updateTokenAppearance', { imgUrl, color });
    
    // Kendi değerlerimizi hemen önbelleğe alıp apply that color faster (optional)
    if (allPlayers[myId]) {
      allPlayers[myId].imgUrl = imgUrl;
      allPlayers[myId].color = color;
    }
  });
}

// === OYUNCU BİLGİ PANELİ RENDER===
function renderPlayerInfo() {
  const othersList = document.getElementById('other-players-list');
  const dmPlayerList = document.getElementById('dm-player-list');

  if (othersList) othersList.innerHTML = '';
  if (dmPlayerList) dmPlayerList.innerHTML = '';

  let hasOthers = false;

  Object.values(allPlayers).forEach(p => {
    if (p.role !== 'dm' && p.character) {

      // DM Görünümündeki Editör Listesi
      if (role === 'dm' && p.id !== myId) {
        hasOthers = true;
        const c = p.character;
        const listBtn = document.createElement('div');
        listBtn.className = 'list-item';
        listBtn.innerHTML = `
                <span><strong>${c.name}</strong></span>
                <span style="font-size: 12px; background: rgba(0,0,0,0.3); padding: 3px 6px; border-radius: 4px;">HP: ${c.hp_current}/${c.hp_max}</span>
            `;
        listBtn.onclick = () => showDmEditor(p);
        dmPlayerList.appendChild(listBtn);
      }

      // Oyuncu Görünümündeki "Diğer Oyuncular"
      if (role !== 'dm' && p.id !== myId) {
        hasOthers = true;
        const c = p.character;
        const div = document.createElement('div');
        div.className = 'other-player-item';
        div.innerHTML = `
                <span class="other-player-name">${c.name}</span>
                <span class="char-hp">${c.hp_current} / ${c.hp_max}</span>
            `;
        othersList.appendChild(div);
      }
    }
  });

  if (!hasOthers) {
    if (role === 'dm') dmPlayerList.innerHTML = '<p style="font-size: 12px; color:#bdc3c7;">Bağlı oyuncu yok.</p>';
    else othersList.innerHTML = '<p style="font-size:12px; color:#bdc3c7;">Odada başka oyuncu yok.</p>';
  }

  // Oyuncunun kendi kartını render etmesi sadece DM değilse çalışır
  if (role !== 'dm') {
    const myCard = document.getElementById('my-character-card');
    myCard.innerHTML = '';
    const me = allPlayers[myId];
    if (me && me.character) {
      const c = me.character;
      const avatarHtml = c.avatar_url
        ? `<img src="${c.avatar_url}" class="char-avatar" alt="Avatar">`
        : `<div class="char-avatar">${c.name.charAt(0).toUpperCase()}</div>`;

      myCard.innerHTML = `
          <div class="char-header">
              ${avatarHtml}
              <div>
                  <h3 class="char-name">${c.name}</h3>
                  <div class="char-hp">HP: ${c.hp_current} / ${c.hp_max}</div>
              </div>
          </div>
          <div class="char-stats-grid">
              <div class="stat-box"><span class="stat-label">STR</span><span class="stat-value">${c.stats.str ?? 10}</span></div>
              <div class="stat-box"><span class="stat-label">DEX</span><span class="stat-value">${c.stats.dex ?? 10}</span></div>
              <div class="stat-box"><span class="stat-label">INT</span><span class="stat-value">${c.stats.int ?? 10}</span></div>
              <div class="stat-box"><span class="stat-label">CON</span><span class="stat-value">${c.stats.con ?? 10}</span></div>
              <div class="stat-box"><span class="stat-label">WIS</span><span class="stat-value">${c.stats.wis ?? 10}</span></div>
              <div class="stat-box"><span class="stat-label">CHR</span><span class="stat-value">${c.stats.chr ?? 10}</span></div>
          </div>
        `;
    } else {
      myCard.innerHTML = '<p>Karakter bilgisi yüklenemedi.</p>';
    }
  }
}

// === DM OYUNCU EDİTÖRÜ ===
let editingPlayerId = null;

function showDmEditor(playerData) {
  editingPlayerId = playerData.id;
  const c = playerData.character;

  document.getElementById('dm-edit-name').innerText = c.name + " Düzenleniyor";
  document.getElementById('dm-edit-hp').value = c.hp_current;
  document.getElementById('dm-edit-max-hp').value = c.hp_max;
  document.getElementById('dm-edit-str').value = c.stats.str ?? 10;
  document.getElementById('dm-edit-dex').value = c.stats.dex ?? 10;
  document.getElementById('dm-edit-int').value = c.stats.int ?? 10;
  document.getElementById('dm-edit-con').value = c.stats.con ?? 10;
  document.getElementById('dm-edit-wis').value = c.stats.wis ?? 10;
  document.getElementById('dm-edit-chr').value = c.stats.chr ?? 10;

  document.getElementById('dm-player-editor').classList.remove('hidden');
}

const formDmEdit = document.getElementById('dm-edit-form');
if (formDmEdit) {
  formDmEdit.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!editingPlayerId || !allPlayers[editingPlayerId]) return;

    const updatedData = {
      id: editingPlayerId,
      characterId: allPlayers[editingPlayerId].character.id, // Supabase için
      hp_current: parseInt(document.getElementById('dm-edit-hp').value),
      hp_max: parseInt(document.getElementById('dm-edit-max-hp').value),
      stats: {
        str: parseInt(document.getElementById('dm-edit-str').value),
        dex: parseInt(document.getElementById('dm-edit-dex').value),
        int: parseInt(document.getElementById('dm-edit-int').value),
        con: parseInt(document.getElementById('dm-edit-con').value),
        wis: parseInt(document.getElementById('dm-edit-wis').value),
        chr: parseInt(document.getElementById('dm-edit-chr').value)
      }
    };

    const btn = formDmEdit.querySelector('button[type="submit"]');
    btn.innerText = "Kaydediliyor...";
    btn.disabled = true;

    socket.emit('updateCharacter', updatedData);
  });
}

// === ÇİZİM KATMANI (DRAWING LAYER) ===
const canvas = document.getElementById('drawing-layer');
const ctx = canvas ? canvas.getContext('2d') : null;
let isDrawing = false;
let lastX = 0;
let lastY = 0;
let localDrawHistory = [];

if (canvas) {
  // Harita boyutuna göre canvas boyutunu ayarla
  function resizeCanvas() {
    if (!canvas) return;
    canvas.width = gameMap.clientWidth || 2000;
    canvas.height = gameMap.clientHeight || 1500;
    redrawHistory();
  }

  // Boyut değiştiğinde yeniden boyutlandır
  window.addEventListener('resize', resizeCanvas);

  // İlk boyutlandırmayı biraz bekleyerek yapalım (CSS tam yüklendiğinde)
  setTimeout(resizeCanvas, 100);

  function redrawHistory() {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    localDrawHistory.forEach(line => {
      drawLineOnCanvas(line.x0, line.y0, line.x1, line.y1, line.color);
    });
  }

  function drawLineOnCanvas(x0, y0, x1, y1, color) {
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.closePath();
  }

  canvas.addEventListener('mousedown', (e) => {
    isDrawing = true;
    const rect = canvas.getBoundingClientRect();
    lastX = e.clientX - rect.left;
    lastY = e.clientY - rect.top;
  });

  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1) {
      isDrawing = false;
      return;
    }
    isDrawing = true;
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches[0];
    lastX = touch.clientX - rect.left;
    lastY = touch.clientY - rect.top;
  }, { passive: true });

  canvas.addEventListener('mousemove', (e) => {
    if (!isDrawing) return;
    const rect = canvas.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;

    let myColor = '#e74c3c';
    if (allPlayers[myId] && allPlayers[myId].color) {
      myColor = allPlayers[myId].color;
    }

    const lineData = { playerId: myId, x0: lastX, y0: lastY, x1: currentX, y1: currentY, color: myColor };

    drawLineOnCanvas(lastX, lastY, currentX, currentY, myColor);
    localDrawHistory.push(lineData);
    socket.emit('drawLine', lineData);

    lastX = currentX;
    lastY = currentY;
  });

  canvas.addEventListener('touchmove', (e) => {
    if (!isDrawing || e.touches.length > 1) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches[0];
    const currentX = touch.clientX - rect.left;
    const currentY = touch.clientY - rect.top;

    let myColor = '#e74c3c';
    if (allPlayers[myId] && allPlayers[myId].color) {
      myColor = allPlayers[myId].color;
    }

    const lineData = { playerId: myId, x0: lastX, y0: lastY, x1: currentX, y1: currentY, color: myColor };

    drawLineOnCanvas(lastX, lastY, currentX, currentY, myColor);
    localDrawHistory.push(lineData);
    socket.emit('drawLine', lineData);

    lastX = currentX;
    lastY = currentY;
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
