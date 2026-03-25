require('dotenv').config();
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

app.use(express.static('public'));

app.get('/ping', (req, res) => {
  res.status(200).send('pong');
});

app.use(express.json({ limit: '10mb' }));

// === IMGBB RESİM YÜKLEME ===
app.post('/upload', async (req, res) => {
  try {
    const base64Image = req.body.image;
    const fileName = req.body.name || 'İsimsiz Resim';
    if (!base64Image) {
      return res.status(400).json({ error: 'Resim verisi bulunamadı.' });
    }

    // Remove the data URI scheme if present e.g. "data:image/png;base64,"
    const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');

    const formData = new URLSearchParams();
    formData.append('image', base64Data);

    const response = await axios.post(`https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`, formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
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
    console.error('ImgBB yükleme hatası:', error.response ? error.response.data : error.message);
    res.status(500).json({ error: 'Resim yüklenirken hata oluştu.' });
  }
});

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

const players = {};
const markers = {};
const sessionCache = {};
let mapBgUrl = '';
let drawHistory = [];

io.on('connection', (socket) => {
  console.log('Bir oyuncu bağlandı: ' + socket.id);

  socket.on('playerJoin', (data) => {
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
    } else if (data.sessionId && sessionCache[data.sessionId]) {
      startX = sessionCache[data.sessionId].x;
      startY = sessionCache[data.sessionId].y;
      color = sessionCache[data.sessionId].color;
      imgUrl = sessionCache[data.sessionId].imgUrl;
    }

    players[socket.id] = {
      id: socket.id,
      sessionId: data.sessionId || socket.id,
      x: startX,
      y: startY,
      role: data.role,
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

  // DM tarafından oluşturulan yeni mekan işaretleri
  socket.on('createMarker', (markerData) => {
    // Sadece DM ekleyebilir yetki kontrolü
    if (players[socket.id] && players[socket.id].role === 'dm') {
      const markerId = 'marker_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
      const newMarker = {
        id: markerId,
        x: markerData.x,
        y: markerData.y,
        name: markerData.name,
        color: markerData.color,
        imgUrl: markerData.imgUrl,
        hp: markerData.hp,
        maxHp: markerData.maxHp,
        size: markerData.size || 50,
        isMarker: true
      };
      markers[markerId] = newMarker;
      io.emit('newMarker', newMarker);
    }
  });

  socket.on('deleteMarker', (markerId) => {
    if (players[socket.id] && players[socket.id].role === 'dm') {
      if (markers[markerId]) {
        delete markers[markerId];
        io.emit('removeMarker', markerId);
      }
    }
  });

  socket.on('editMarker', (data) => {
    if (players[socket.id] && players[socket.id].role === 'dm') {
      if (markers[data.id]) {
        if (data.hp !== undefined) markers[data.id].hp = data.hp;
        if (data.size !== undefined) markers[data.id].size = data.size;
        io.emit('updateMarkerData', markers[data.id]);
      }
    }
  });

  socket.on('updateBg', (url) => {
    if (players[socket.id] && players[socket.id].role === 'dm') {
      mapBgUrl = url;
      io.emit('updateBg', mapBgUrl);
    }
  });

  socket.on('updateTokenAppearance', (data) => {
    if (players[socket.id]) {
      if (data.imgUrl !== undefined) players[socket.id].imgUrl = data.imgUrl;
      if (data.color !== undefined) players[socket.id].color = data.color;
      io.emit('tokenAppearanceUpdated', {
        id: socket.id,
        imgUrl: players[socket.id].imgUrl,
        color: players[socket.id].color
      });
    }
  });

  socket.on('updateCharacter', async (data) => {
    // Sadece DM yetkili
    if (players[socket.id] && players[socket.id].role === 'dm') {

      // Veritabanına kaydet
      const updates = {
        hp_current: data.hp_current,
        hp_max: data.hp_max,
        stats: data.stats
      };

      const { error } = await supabase
        .from('characters')
        .update(updates)
        .eq('id', data.characterId);

      if (error) {
        console.error("Supabase güncellerken hata:", error);
        return; // Hata durumunda event broadcast etmiyoruz
      }

      // Başarılıysa sunucu durumunu güncelle ve herkese anons et
      if (players[data.id] && players[data.id].character) {
        Object.assign(players[data.id].character, updates);
        io.emit('characterUpdated', { id: data.id, updates: updates });
      }
    }
  });

  // --- ÇİZİM EVENTLERİ ---
  socket.on('drawLine', (data) => {
    // Sunucudan giden id'yi güvence altına alalım
    data.playerId = socket.id;
    drawHistory.push(data);
    socket.broadcast.emit('draw', data);
  });

  socket.on('requestClearAllDrawings', () => {
    if (players[socket.id] && players[socket.id].role === 'dm') {
      drawHistory = [];
      io.emit('drawHistory', drawHistory);
    }
  });

  socket.on('requestClearMyDrawings', () => {
    // Sadece istek atan kişinin çizimlerini sil
    drawHistory = drawHistory.filter(line => line.playerId !== socket.id);
    io.emit('drawHistory', drawHistory);
  });

  // --- ZAR ATMA EVENTİ ---
  socket.on('rollDice', (data) => {
    io.emit('diceRolled', data);
  });

  // İstemciden 'playerMovement' veya DM'den başkasının hareketi geldiğinde çalışır
  socket.on('playerMovement', (movementData) => {
    const sender = players[socket.id];
    if (!sender) return;

    // Kendi id'si ise kendi yerini günceller
    if (movementData.id === socket.id) {
      players[socket.id].x = movementData.x;
      players[socket.id].y = movementData.y;
      socket.broadcast.emit('updateTokenPosition', {
        id: socket.id,
        x: movementData.x,
        y: movementData.y
      });
    }
    // Eğer DM ise başkalarını veya markerları hareket ettirebilir
    else if (sender.role === 'dm') {
      if (players[movementData.id]) {
        players[movementData.id].x = movementData.x;
        players[movementData.id].y = movementData.y;
        socket.broadcast.emit('updateTokenPosition', {
          id: movementData.id,
          x: movementData.x,
          y: movementData.y
        });
      } else if (markers[movementData.id]) {
        markers[movementData.id].x = movementData.x;
        markers[movementData.id].y = movementData.y;
        socket.broadcast.emit('updateTokenPosition', {
          id: movementData.id,
          x: movementData.x,
          y: movementData.y
        });
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('Oyuncu ayrıldı: ' + socket.id);
    if (players[socket.id]) {
      const p = players[socket.id];
      sessionCache[p.sessionId] = {
        x: p.x,
        y: p.y,
        color: p.color,
        imgUrl: p.imgUrl
      };

      delete players[socket.id];
      io.emit('playerDisconnected', socket.id);
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda aktif!`);
});