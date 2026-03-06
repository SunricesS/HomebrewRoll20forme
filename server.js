const express = require('express');
const app = express();
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

const players = {};
const markers = {};
let mapBgUrl = '';
let drawHistory = [];

io.on('connection', (socket) => {
  console.log('Bir oyuncu bağlandı: ' + socket.id);

  socket.on('playerJoin', (data) => {
    players[socket.id] = {
      id: socket.id,
      x: 50,
      y: 50,
      role: data.role,
      profile: data.profile,
      character: data.character,
      color: data.role === 'dm' ? '#8e44ad' : '#3498db'
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

  socket.on('updateBg', (url) => {
    if (players[socket.id] && players[socket.id].role === 'dm') {
      mapBgUrl = url;
      io.emit('updateBg', mapBgUrl);
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
    delete players[socket.id];
    io.emit('playerDisconnected', socket.id);
  });
});

server.listen(3000, () => {
  console.log('Sunucu 3000 portunda aktif: http://localhost:3000');
});