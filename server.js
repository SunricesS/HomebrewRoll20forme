const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const app = express();
const axios = require('axios');
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const { createClient } = require('@supabase/supabase-js');

// === SUPABASE KURULUMU ===
const SUPABASE_URL = 'https://fjcnaofzetkoxuyrwfpw.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_oAFX73DbfClKaQVXg8-GSw_qbVX6bWk';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// === SABİTLER ===
const MAX_DRAW_HISTORY = 10000;
const BACKUP_INTERVAL_MS = 30000;
const SESSION_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 saat

// === YARDIMCI FONKSİYONLAR ===

/**
 * URL'nin geçerli bir http/https URL olup olmadığını kontrol eder.
 */
function isValidUrl(str) {
  if (!str || typeof str !== 'string') return false;
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Sayısal değeri güvenli aralığa sınırlar.
 */
function clampNumber(val, min, max) {
  const n = Number(val);
  if (isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

/**
 * String'i belirli uzunluğa kırpar.
 */
function truncateStr(str, maxLen) {
  if (typeof str !== 'string') return '';
  return str.substring(0, maxLen);
}

// === MIDDLEWARE ===
app.use(express.static('public'));

// Genel JSON body limiti — 1 MB
app.use(express.json({ limit: '1mb' }));

app.get('/ping', (req, res) => {
  res.status(200).send('pong');
});

// === REST API ROTALARI ===

// ---- ImgBB Resim Yükleme (yüksek limit) ----
app.post('/upload', express.json({ limit: '10mb' }), async (req, res) => {
  try {
    const base64Image = req.body.image;
    const fileName = truncateStr(req.body.name || 'İsimsiz Resim', 100);
    if (!base64Image || typeof base64Image !== 'string') {
      return res.status(400).json({ error: 'Resim verisi bulunamadı.' });
    }

    // data URI şemasını kaldır (ör. "data:image/png;base64,")
    const base64Data = base64Image.replace(/^data:.*?;base64,/, '');

    const payload = { image: base64Data };
    if (fileName && fileName !== 'İsimsiz Resim') {
      payload.name = fileName;
    }

    const response = await axios.post(`https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`, payload, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });

    if (response.data && response.data.data && response.data.data.url) {
      const imgUrl = response.data.data.url;

      // Supabase'e kaydet
      const { error: dbError } = await supabase
        .from('images')
        .insert([{ name: fileName, url: imgUrl }]);

      if (dbError) {
        console.error('Supabase resim kaydetme hatası:', dbError);
      }

      res.json({ url: imgUrl });
    } else {
      res.status(500).json({ error: 'Resim yüklenemedi.' });
    }
  } catch (error) {
    let errMessage = error.message;
    if (error.response && error.response.data) {
      errMessage = typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data);
    }
    console.error('ImgBB yükleme hatası:', errMessage);
    res.status(500).json({ error: `Resim yüklenirken hata oluştu: ${errMessage}` });
  }
});

// ---- Galeri Resimleri ----
app.get('/api/gallery-images', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('images')
      .select('id, name, url');

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Galeri çekme hatası:', err);
    res.status(500).json({ error: 'Resimler getirilemedi.' });
  }
});

// ---- Profil Listesi ----
app.get('/api/profiles', async (req, res) => {
  try {
    const { data, error } = await supabase.from('profiles').select('*');
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Profil çekme hatası:', err);
    res.status(500).json({ error: 'Profiller getirilemedi.' });
  }
});

// ---- Kullanıcı Karakter Listesi ----
app.get('/api/characters/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const { data, error } = await supabase.from('characters').select('*').eq('user_id', userId);
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Karakter çekme hatası:', err);
    res.status(500).json({ error: 'Karakterler getirilemedi.' });
  }
});

// ---- Yeni Karakter Oluşturma ----
app.post('/api/characters', async (req, res) => {
  try {
    const { user_id, name, hp_max, stats, avatar_url } = req.body;

    if (!user_id || !name || !hp_max) {
      return res.status(400).json({ error: 'user_id, name ve hp_max zorunludur.' });
    }

    const sanitizedName = truncateStr(name, 50);
    const sanitizedHpMax = clampNumber(hp_max, 1, 99999);

    const sanitizedStats = {
      str: clampNumber(stats?.str, 0, 30),
      dex: clampNumber(stats?.dex, 0, 30),
      int: clampNumber(stats?.int, 0, 30),
      con: clampNumber(stats?.con, 0, 30),
      wis: clampNumber(stats?.wis, 0, 30),
      chr: clampNumber(stats?.chr, 0, 30)
    };

    const insertData = {
      user_id,
      name: sanitizedName,
      hp_current: sanitizedHpMax,
      hp_max: sanitizedHpMax,
      stats: sanitizedStats,
      avatar_url: avatar_url && isValidUrl(avatar_url) ? avatar_url : null
    };

    const { data, error } = await supabase
      .from('characters')
      .insert([insertData])
      .select();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Karakter oluşturma hatası:', err);
    res.status(500).json({ error: 'Karakter oluşturulamadı: ' + err.message });
  }
});

// === SUNUCU DURUMU (IN-MEMORY) ===
const players = {};
const markers = {};
const sessionCache = {};
let mapBgUrl = '';
let drawHistory = [];

// === SOCKET.IO EVENT YÖNETİMİ ===
io.on('connection', (socket) => {
  console.log('Bir oyuncu bağlandı: ' + socket.id);

  // ---- Oyuncu Katılma ----
  socket.on('playerJoin', (data) => {
    if (!data || typeof data !== 'object') return;

    // Aynı session önceden var mı kontrol et (kısa süreli kopmalara karşı)
    let existingPlayerId = null;

    if (data.sessionId) {
      existingPlayerId = Object.keys(players).find(k => players[k].sessionId === data.sessionId);
    } else {
      existingPlayerId = Object.keys(players).find(k => {
        if (data.character && players[k].character) return players[k].character.id === data.character.id;
        if (data.role === 'dm' && players[k].role === 'dm') return true;
        return false;
      });
    }

    let startX = 50;
    let startY = 50;
    let color = data.role === 'dm' ? '#8e44ad' : '#3498db';
    let imgUrl = null;

    if (existingPlayerId && players[existingPlayerId]) {
      startX = players[existingPlayerId].x;
      startY = players[existingPlayerId].y;
      color = players[existingPlayerId].color;
      imgUrl = players[existingPlayerId].imgUrl;

      // Eski ghost socket'i temizle ve koptuğunu yayınla (klonları engeller)
      delete players[existingPlayerId];
      socket.broadcast.emit('playerDisconnected', existingPlayerId);
    } else {
      let cacheMatch = null;
      if (data.sessionId && sessionCache[data.sessionId]) {
        cacheMatch = sessionCache[data.sessionId];
      } else {
        // Tarayıcı kapanıp açılmışsa ve sessionId değişmişse rol / karakter id'den bulmayı dene
        cacheMatch = Object.values(sessionCache).find(c => {
          if (data.character && c.character) return c.character.id === data.character.id;
          if (data.role === 'dm' && c.role === 'dm') return true;
          return false;
        });
      }

      if (cacheMatch) {
        startX = cacheMatch.x;
        startY = cacheMatch.y;
        if (cacheMatch.color) color = cacheMatch.color;
        if (cacheMatch.imgUrl) imgUrl = cacheMatch.imgUrl;
      }
    }

    players[socket.id] = {
      id: socket.id,
      sessionId: data.sessionId || socket.id,
      x: startX,
      y: startY,
      role: data.role === 'dm' ? 'dm' : 'player',
      profile: data.profile,
      character: data.character,
      color: color,
      imgUrl: imgUrl
    };

    // Yalnızca yeni bağlanan oyuncuya mevcut oyuncuları gönder
    socket.emit('currentPlayers', players);

    // Diğerlerine yeni oyuncuyu bildir
    socket.broadcast.emit('newPlayer', players[socket.id]);

    // Ayrıca mevcut markerları da gönder
    socket.emit('currentMarkers', markers);
    // Çizim geçmişini gönder
    socket.emit('drawHistory', drawHistory);

    // Arka planı gönder
    if (mapBgUrl) {
      socket.emit('updateBg', mapBgUrl);
    }
  });

  // ---- DM: Yeni Marker Oluştur ----
  socket.on('createMarker', (markerData) => {
    if (!players[socket.id] || players[socket.id].role !== 'dm') return;
    if (!markerData || typeof markerData !== 'object') return;

    const markerId = 'marker_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    const newMarker = {
      id: markerId,
      x: clampNumber(markerData.x, 0, 10000),
      y: clampNumber(markerData.y, 0, 10000),
      name: truncateStr(markerData.name || 'X', 2),
      color: truncateStr(markerData.color || '#f1c40f', 9),
      imgUrl: isValidUrl(markerData.imgUrl) ? markerData.imgUrl : null,
      hp: markerData.hp != null ? clampNumber(markerData.hp, 0, 99999) : null,
      maxHp: markerData.maxHp != null ? clampNumber(markerData.maxHp, 0, 99999) : null,
      size: clampNumber(markerData.size || 50, 10, 500),
      isMarker: true
    };
    markers[markerId] = newMarker;
    io.emit('newMarker', newMarker);
  });

  // ---- DM: Marker Sil ----
  socket.on('deleteMarker', (markerId) => {
    if (!players[socket.id] || players[socket.id].role !== 'dm') return;
    if (typeof markerId !== 'string' || !markers[markerId]) return;

    delete markers[markerId];
    io.emit('removeMarker', markerId);
  });

  // ---- DM: Marker Düzenle ----
  socket.on('editMarker', (data) => {
    if (!players[socket.id] || players[socket.id].role !== 'dm') return;
    if (!data || typeof data !== 'object' || !markers[data.id]) return;

    if (data.hp !== undefined) markers[data.id].hp = clampNumber(data.hp, 0, 99999);
    if (data.size !== undefined) markers[data.id].size = clampNumber(data.size, 10, 500);
    io.emit('updateMarkerData', markers[data.id]);
  });

  // ---- DM: Arka Plan Güncelle ----
  socket.on('updateBg', (url) => {
    if (!players[socket.id] || players[socket.id].role !== 'dm') return;

    if (url && !isValidUrl(url)) return;
    mapBgUrl = url || '';
    io.emit('updateBg', mapBgUrl);
  });

  // ---- Token Görünüm Güncelle ----
  socket.on('updateTokenAppearance', (data) => {
    if (!players[socket.id] || !data || typeof data !== 'object') return;

    if (data.imgUrl !== undefined) {
      players[socket.id].imgUrl = isValidUrl(data.imgUrl) ? data.imgUrl : null;
    }
    if (data.color !== undefined) {
      players[socket.id].color = truncateStr(data.color, 9);
    }
    io.emit('tokenAppearanceUpdated', {
      id: socket.id,
      imgUrl: players[socket.id].imgUrl,
      color: players[socket.id].color
    });
  });

  // ---- DM: Karakter Güncelle ----
  socket.on('updateCharacter', async (data) => {
    if (!players[socket.id] || players[socket.id].role !== 'dm') return;
    if (!data || typeof data !== 'object' || !data.characterId) return;

    const updates = {
      hp_current: clampNumber(data.hp_current, 0, 99999),
      hp_max: clampNumber(data.hp_max, 1, 99999),
      stats: {
        str: clampNumber(data.stats?.str, 0, 30),
        dex: clampNumber(data.stats?.dex, 0, 30),
        int: clampNumber(data.stats?.int, 0, 30),
        con: clampNumber(data.stats?.con, 0, 30),
        wis: clampNumber(data.stats?.wis, 0, 30),
        chr: clampNumber(data.stats?.chr, 0, 30)
      }
    };

    const { error } = await supabase
      .from('characters')
      .update(updates)
      .eq('id', data.characterId);

    if (error) {
      console.error("Supabase güncellerken hata:", error);
      return;
    }

    // Başarılıysa sunucu durumunu güncelle ve herkese anons et
    if (players[data.id] && players[data.id].character) {
      Object.assign(players[data.id].character, updates);
      io.emit('characterUpdated', { id: data.id, updates: updates });
    }
  });

  // ---- Çizim Eventleri ----
  socket.on('drawLine', (data) => {
    if (!data || typeof data !== 'object') return;

    const line = {
      playerId: socket.id,
      x0: clampNumber(data.x0, -10000, 20000),
      y0: clampNumber(data.y0, -10000, 20000),
      x1: clampNumber(data.x1, -10000, 20000),
      y1: clampNumber(data.y1, -10000, 20000),
      color: truncateStr(data.color || '#e74c3c', 9)
    };

    drawHistory.push(line);

    // Sınırsız büyümeyi engelle
    if (drawHistory.length > MAX_DRAW_HISTORY) {
      drawHistory = drawHistory.slice(-MAX_DRAW_HISTORY);
    }

    socket.broadcast.emit('draw', line);
  });

  socket.on('requestClearAllDrawings', () => {
    if (!players[socket.id] || players[socket.id].role !== 'dm') return;
    drawHistory = [];
    io.emit('drawHistory', drawHistory);
  });

  socket.on('requestClearMyDrawings', () => {
    drawHistory = drawHistory.filter(line => line.playerId !== socket.id);
    io.emit('drawHistory', drawHistory);
  });

  // ---- Zar Atma (Sunucu Tarafında Üretim) ----
  socket.on('rollDice', (data) => {
    if (!data || typeof data !== 'object') return;

    const validDice = [4, 6, 8, 10, 12, 20, 100];
    const diceType = validDice.includes(data.diceType) ? data.diceType : 20;
    const result = Math.floor(Math.random() * diceType) + 1;

    const rollerName = truncateStr(data.rollerName || 'Bilinmiyor', 30);

    io.emit('diceRolled', {
      rollerName: rollerName,
      diceType: diceType,
      result: result
    });
  });

  // ---- Token Hareketi ----
  socket.on('playerMovement', (movementData) => {
    if (!movementData || typeof movementData !== 'object') return;
    const sender = players[socket.id];
    if (!sender) return;

    const x = clampNumber(movementData.x, -500, 20000);
    const y = clampNumber(movementData.y, -500, 20000);

    // Kendi id'si ise kendi yerini günceller
    if (movementData.id === socket.id) {
      players[socket.id].x = x;
      players[socket.id].y = y;
      socket.broadcast.emit('updateTokenPosition', { id: socket.id, x, y });
    }
    // Eğer DM ise başkalarını veya markerları hareket ettirebilir
    else if (sender.role === 'dm') {
      if (players[movementData.id]) {
        players[movementData.id].x = x;
        players[movementData.id].y = y;
        socket.broadcast.emit('updateTokenPosition', { id: movementData.id, x, y });
      } else if (markers[movementData.id]) {
        markers[movementData.id].x = x;
        markers[movementData.id].y = y;
        socket.broadcast.emit('updateTokenPosition', { id: movementData.id, x, y });
      }
    }
  });

  // ---- DM: Manuel Kaydet ----
  socket.on('forceSave', async () => {
    if (!players[socket.id] || players[socket.id].role !== 'dm') return;
    await backupMapState();
    socket.emit('saveComplete');
  });

  // ---- Bağlantı Kopma ----
  socket.on('disconnect', () => {
    console.log('Oyuncu ayrıldı: ' + socket.id);
    if (players[socket.id]) {
      const p = players[socket.id];
      sessionCache[p.sessionId] = {
        x: p.x,
        y: p.y,
        color: p.color,
        imgUrl: p.imgUrl,
        role: p.role,
        character: p.character,
        cachedAt: Date.now()
      };

      delete players[socket.id];
      io.emit('playerDisconnected', socket.id);
    }
  });
});

// === MAP STATE RESTORE VE BACKUP ===
async function restoreMapState() {
  try {
    const { data, error } = await supabase
      .from('map_state')
      .select('data')
      .eq('id', 1)
      .single();

    // PGRST116 kodu kayıt bulunamadığında döner
    if (error && error.code !== 'PGRST116') {
      console.error('Map state yüklenirken Supabase hatası:', error.message);
      return;
    }

    if (data && data.data) {
      const savedState = data.data;

      // Oyuncu pozisyonlarını sessionCache'e al
      if (savedState.players) {
        Object.values(savedState.players).forEach(p => {
          if (p.sessionId) {
            sessionCache[p.sessionId] = {
              x: p.x,
              y: p.y,
              color: p.color,
              imgUrl: p.imgUrl,
              role: p.role,
              character: p.character,
              cachedAt: Date.now()
            };
          }
        });
      }

      // Markerları geri yükle
      if (savedState.markers) {
        Object.assign(markers, savedState.markers);
      }

      // Çizim geçmişini geri yükle
      if (savedState.drawHistory && Array.isArray(savedState.drawHistory)) {
        drawHistory = savedState.drawHistory.slice(-MAX_DRAW_HISTORY);
      }

      // Arka planı geri yükle
      if (savedState.mapBgUrl) {
        mapBgUrl = savedState.mapBgUrl;
      }

      console.log('Map durumu başarıyla geri yüklendi.');
    } else {
      console.log('Geri yüklenecek map durumu bulunamadı veya tablo boş.');
    }
  } catch (err) {
    console.error('Map state geri yüklenirken beklenmeyen hata:', err.message);
  }
}

async function backupMapState() {
  try {
    const currentState = {
      players: players,
      markers: markers,
      drawHistory: drawHistory,
      mapBgUrl: mapBgUrl
    };

    const { error } = await supabase
      .from('map_state')
      .upsert({ id: 1, data: currentState });

    if (error) {
      console.error('Map state yedekleme hatası:', error.message);
    } else {
      console.log('Map durumu yedeklendi.');
    }
  } catch (err) {
    console.error('Map state yedekleme sırasında beklenmeyen hata:', err.message);
  }
}

// === SESSION CACHE TEMİZLİĞİ ===
function cleanupSessionCache() {
  const now = Date.now();
  for (const key of Object.keys(sessionCache)) {
    if (now - (sessionCache[key].cachedAt || 0) > SESSION_CACHE_TTL_MS) {
      delete sessionCache[key];
    }
  }
}

// Periyodik görevler
setInterval(backupMapState, BACKUP_INTERVAL_MS);
setInterval(cleanupSessionCache, 60 * 60 * 1000); // Her saat cache temizliği

const PORT = process.env.PORT || 3000;

// Sunucu başlamadan önce durumu geri yükle
restoreMapState().then(() => {
  server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda aktif!`);
  });
});