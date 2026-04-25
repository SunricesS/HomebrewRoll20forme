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
 * URL'nin geçerli bir http/https URL olup olmadığını kontrol edr.
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

// ---- Tüm Karakterler (DM Saldırı Paneli için) ----
app.get('/api/characters', async (req, res) => {
  try {
    const { data, error } = await supabase.from('characters').select('*');
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Tüm karakter çekme hatası:', err);
    res.status(500).json({ error: 'Karakterler getirilemedi.' });
  }
});

// === SAVAŞ SİSTEMİ (COMBAT) ===

/**
 * Sunucu tarafında güvenli zar atma
 */
function rollDie(min, max) {
  if (max <= 0 || min > max) return 0;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function rollAdvantage(min, max) {
  return Math.max(rollDie(min, max), rollDie(min, max));
}

function rollDisadvantage(min, max) {
  return Math.min(rollDie(min, max), rollDie(min, max));
}

// ---- Saldırı Hesapla ----
app.post('/api/combat/attack', (req, res) => {
  try {
    const {
      attackerStats,     // { stat, bonus } — seçilen yetenek değeri ve bonusu
      targetAC,          // hedef AC değeri
      attackType,        // 'physical' | 'spell'
      advantage,         // bool
      disadvantage,      // bool
      attackCount,       // saldırı adedi
      extraDamage,       // manuel ek hasar
      // Fiziksel saldırı parametreleri
      physical,          // { min, max, extraMin, extraMax }
      element1,          // { min, max, extraMin, extraMax, weakness, resistance }
      element2,          // { min, max, extraMin, extraMax, weakness, resistance }
      // Büyü saldırı parametreleri
      spell,             // { min, max, extraMin, extraMax, level }
    } = req.body;

    const safeAC = clampNumber(targetAC, 0, 50);
    const safeCount = clampNumber(attackCount, 1, 20);
    const safeStat = clampNumber(attackerStats?.stat, 0, 30);
    const safeBonus = clampNumber(attackerStats?.bonus, 0, 30);
    const safeExtra = clampNumber(extraDamage, 0, 1000);

    const attacks = [];
    let totalDamage = 0;

    for (let i = 0; i < safeCount; i++) {
      // 1. Vuruş zarı (d20)
      let hitRoll = 0;
      if (advantage && !disadvantage) {
        hitRoll = rollAdvantage(1, 20);
      } else if (disadvantage && !advantage) {
        hitRoll = rollDisadvantage(1, 20);
      } else {
        hitRoll = rollDie(1, 20);
      }

      // 2. Bonuslu zar = hitRoll + floor((stat + bonus) / 2)
      const modifiedRoll = hitRoll + Math.floor((safeStat + safeBonus) / 2);

      // 3. Vuruş kontrolü
      const isCritical = hitRoll === 20;
      const isCritFail = hitRoll === 1;
      const isHit = isCritical || (!isCritFail && modifiedRoll >= safeAC);

      if (!isHit) {
        attacks.push({
          index: i + 1,
          hit: false,
          hitRoll,
          modifiedRoll,
          isCritical: false,
          isCritFail,
          damage: 0
        });
        continue;
      }

      // 4. Hasar hesaplama
      let damage = 0;

      if (attackType === 'physical') {
        // Fiziksel kanal
        let physDmg = 0;
        const pMin = clampNumber(physical?.min, 0, 1000);
        const pMax = clampNumber(physical?.max, 0, 1000);
        const peMin = clampNumber(physical?.extraMin, 0, 1000);
        const peMax = clampNumber(physical?.extraMax, 0, 1000);
        if (pMax > 0) physDmg = rollDie(pMin, pMax) + (peMax > 0 ? rollDie(peMin, peMax) : 0);

        // Element 1 kanalı
        let elem1Dmg = 0;
        const e1Min = clampNumber(element1?.min, 0, 1000);
        const e1Max = clampNumber(element1?.max, 0, 1000);
        const e1eMin = clampNumber(element1?.extraMin, 0, 1000);
        const e1eMax = clampNumber(element1?.extraMax, 0, 1000);
        if (e1Max > 0) elem1Dmg = rollDie(e1Min, e1Max) + (e1eMax > 0 ? rollDie(e1eMin, e1eMax) : 0);

        // Element 2 kanalı
        let elem2Dmg = 0;
        const e2Min = clampNumber(element2?.min, 0, 1000);
        const e2Max = clampNumber(element2?.max, 0, 1000);
        const e2eMin = clampNumber(element2?.extraMin, 0, 1000);
        const e2eMax = clampNumber(element2?.extraMax, 0, 1000);
        if (e2Max > 0) elem2Dmg = rollDie(e2Min, e2Max) + (e2eMax > 0 ? rollDie(e2eMin, e2eMax) : 0);

        // Zayıflık / Direnç çarpanları
        if (physical?.weakness) physDmg *= 2;
        else if (physical?.resistance) physDmg = Math.floor(physDmg / 2);

        if (element1?.weakness) elem1Dmg *= 2;
        else if (element1?.resistance) elem1Dmg = Math.floor(elem1Dmg / 2);

        if (element2?.weakness) elem2Dmg *= 2;
        else if (element2?.resistance) elem2Dmg = Math.floor(elem2Dmg / 2);

        damage = physDmg + elem1Dmg + elem2Dmg + safeExtra;
      } else {
        // Büyü saldırısı
        const slotMultipliers = { 1: 1, 2: 1.5, 3: 2, 4: 2.5 };
        const sLevel = clampNumber(spell?.level, 1, 4);
        const mult = slotMultipliers[sLevel] || 1;

        const sMin = clampNumber(spell?.min, 0, 1000);
        const sMax = clampNumber(spell?.max, 0, 1000);
        const seMin = clampNumber(spell?.extraMin, 0, 1000);
        const seMax = clampNumber(spell?.extraMax, 0, 1000);

        let spellDmg = 0;
        if (sMax > 0) {
          spellDmg = rollDie(
            Math.floor(sMin * mult),
            Math.floor(sMax * mult)
          ) + (seMax > 0 ? rollDie(
            Math.floor(seMin * mult),
            Math.floor(seMax * mult)
          ) : 0);
        }

        damage = spellDmg + safeExtra;
      }

      // 5. Kritik vuruş çarpanı (1.5x)
      if (isCritical) {
        damage = Math.floor(damage * 1.5);
      }

      totalDamage += damage;

      attacks.push({
        index: i + 1,
        hit: true,
        hitRoll,
        modifiedRoll,
        isCritical,
        isCritFail: false,
        damage
      });
    }

    res.json({ attacks, totalDamage, attackType });
  } catch (err) {
    console.error('Saldırı hesaplama hatası:', err);
    res.status(500).json({ error: 'Saldırı hesaplanamadı.' });
  }
});

// ---- Hasar Uygula ----
app.post('/api/combat/apply-damage', async (req, res) => {
  try {
    const { targetType, targetId, damage } = req.body;
    const safeDamage = clampNumber(damage, 0, 99999);

    if (targetType === 'character') {
      // Veritabanından mevcut HP'yi çek
      const { data: charData, error: fetchErr } = await supabase
        .from('characters')
        .select('hp_current, hp_max')
        .eq('id', targetId)
        .single();

      if (fetchErr) throw fetchErr;

      const newHp = Math.max(0, (charData.hp_current || 0) - safeDamage);

      const { error: updateErr } = await supabase
        .from('characters')
        .update({ hp_current: newHp })
        .eq('id', targetId);

      if (updateErr) throw updateErr;

      // Socket üzerinden tüm istemcilere bildir
      // Bağlı oyuncunun socket id'sini bul
      const playerEntry = Object.entries(players).find(
        ([, p]) => p.character && p.character.id === targetId
      );
      if (playerEntry) {
        const [socketId, playerData] = playerEntry;
        playerData.character.hp_current = newHp;
        io.emit('characterUpdated', {
          id: socketId,
          updates: { hp_current: newHp, hp_max: charData.hp_max }
        });
      }

      res.json({ success: true, newHp, targetType: 'character' });
    } else if (targetType === 'marker') {
      // Marker hasar (in-memory)
      if (markers[targetId] && markers[targetId].hp != null) {
        markers[targetId].hp = Math.max(0, markers[targetId].hp - safeDamage);
        io.emit('updateMarkerData', markers[targetId]);
        res.json({ success: true, newHp: markers[targetId].hp, targetType: 'marker' });
      } else {
        res.status(404).json({ error: 'Marker bulunamadı veya HP yok.' });
      }
    } else {
      res.status(400).json({ error: 'Geçersiz hedef tipi.' });
    }
  } catch (err) {
    console.error('Hasar uygulama hatası:', err);
    res.status(500).json({ error: 'Hasar uygulanamadı.' });
  }
});

// ---- Karakter Güncelle (REST — Saldırı paneli stat güncellemesi) ----
app.put('/api/characters/:charId', async (req, res) => {
  try {
    const charId = req.params.charId;
    const { hp_current, hp_max, ac, ac_bonus, corruption, spell_slots, stats } = req.body;

    const updates = {};
    if (hp_current !== undefined) updates.hp_current = clampNumber(hp_current, 0, 99999);
    if (hp_max !== undefined) updates.hp_max = clampNumber(hp_max, 1, 99999);
    if (ac !== undefined) updates.ac = clampNumber(ac, 0, 50);
    if (ac_bonus !== undefined) updates.ac_bonus = clampNumber(ac_bonus, 0, 50);
    if (corruption !== undefined) updates.corruption = clampNumber(corruption, 0, 100);
    if (spell_slots !== undefined) {
      updates.spell_slots = {
        lvl1: clampNumber(spell_slots?.lvl1, 0, 20),
        lvl2: clampNumber(spell_slots?.lvl2, 0, 20),
        lvl3: clampNumber(spell_slots?.lvl3, 0, 20),
        lvl4: clampNumber(spell_slots?.lvl4, 0, 20),
      };
    }
    if (stats) {
      updates.stats = {
        str: clampNumber(stats.str, 0, 30),
        str_bonus: clampNumber(stats.str_bonus, 0, 30),
        dex: clampNumber(stats.dex, 0, 30),
        dex_bonus: clampNumber(stats.dex_bonus, 0, 30),
        int: clampNumber(stats.int, 0, 30),
        int_bonus: clampNumber(stats.int_bonus, 0, 30),
        con: clampNumber(stats.con, 0, 30),
        con_bonus: clampNumber(stats.con_bonus, 0, 30),
        wis: clampNumber(stats.wis, 0, 30),
        wis_bonus: clampNumber(stats.wis_bonus, 0, 30),
        chr: clampNumber(stats.chr, 0, 30),
        chr_bonus: clampNumber(stats.chr_bonus, 0, 30),
      };
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Güncellenecek alan yok.' });
    }

    const { error } = await supabase
      .from('characters')
      .update(updates)
      .eq('id', charId);

    if (error) throw error;

    // Bağlı oyuncuyu sync et
    const playerEntry = Object.entries(players).find(
      ([, p]) => p.character && p.character.id === charId
    );
    if (playerEntry) {
      const [socketId, playerData] = playerEntry;
      Object.assign(playerData.character, updates);
      io.emit('characterUpdated', { id: socketId, updates });
    }

    res.json({ success: true, updates });
  } catch (err) {
    console.error('Karakter güncelleme hatası:', err);
    res.status(500).json({ error: 'Karakter güncellenemedi.' });
  }
});

// ---- Yeni Karakter Oluşturma ----
app.post('/api/characters', async (req, res) => {
  try {
    const { user_id, name, hp_max, stats, avatar_url, ac, ac_bonus } = req.body;

    if (!user_id || !name || !hp_max) {
      return res.status(400).json({ error: 'user_id, name ve hp_max zorunludur.' });
    }

    const sanitizedName = truncateStr(name, 50);
    const sanitizedHpMax = clampNumber(hp_max, 1, 99999);

    const sanitizedStats = {
      str: clampNumber(stats?.str, 0, 30),
      str_bonus: clampNumber(stats?.str_bonus, 0, 30),
      dex: clampNumber(stats?.dex, 0, 30),
      dex_bonus: clampNumber(stats?.dex_bonus, 0, 30),
      int: clampNumber(stats?.int, 0, 30),
      int_bonus: clampNumber(stats?.int_bonus, 0, 30),
      con: clampNumber(stats?.con, 0, 30),
      con_bonus: clampNumber(stats?.con_bonus, 0, 30),
      wis: clampNumber(stats?.wis, 0, 30),
      wis_bonus: clampNumber(stats?.wis_bonus, 0, 30),
      chr: clampNumber(stats?.chr, 0, 30),
      chr_bonus: clampNumber(stats?.chr_bonus, 0, 30)
    };

    const insertData = {
      user_id,
      name: sanitizedName,
      hp_current: sanitizedHpMax,
      hp_max: sanitizedHpMax,
      ac: clampNumber(ac, 0, 50) || 10,
      ac_bonus: clampNumber(ac_bonus, 0, 50) || 0,
      corruption: 0,
      spell_slots: { lvl1: 0, lvl2: 0, lvl3: 0, lvl4: 0 },
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
      ac: markerData.ac != null ? clampNumber(markerData.ac, 0, 50) : 10,
      stats: markerData.stats ? {
        str: clampNumber(markerData.stats?.str, 0, 30),
        str_bonus: clampNumber(markerData.stats?.str_bonus, 0, 30),
        dex: clampNumber(markerData.stats?.dex, 0, 30),
        dex_bonus: clampNumber(markerData.stats?.dex_bonus, 0, 30),
        int: clampNumber(markerData.stats?.int, 0, 30),
        int_bonus: clampNumber(markerData.stats?.int_bonus, 0, 30),
        con: clampNumber(markerData.stats?.con, 0, 30),
        con_bonus: clampNumber(markerData.stats?.con_bonus, 0, 30),
        wis: clampNumber(markerData.stats?.wis, 0, 30),
        wis_bonus: clampNumber(markerData.stats?.wis_bonus, 0, 30),
        chr: clampNumber(markerData.stats?.chr, 0, 30),
        chr_bonus: clampNumber(markerData.stats?.chr_bonus, 0, 30),
      } : null,
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
        str_bonus: clampNumber(data.stats?.str_bonus, 0, 30),
        dex: clampNumber(data.stats?.dex, 0, 30),
        dex_bonus: clampNumber(data.stats?.dex_bonus, 0, 30),
        int: clampNumber(data.stats?.int, 0, 30),
        int_bonus: clampNumber(data.stats?.int_bonus, 0, 30),
        con: clampNumber(data.stats?.con, 0, 30),
        con_bonus: clampNumber(data.stats?.con_bonus, 0, 30),
        wis: clampNumber(data.stats?.wis, 0, 30),
        wis_bonus: clampNumber(data.stats?.wis_bonus, 0, 30),
        chr: clampNumber(data.stats?.chr, 0, 30),
        chr_bonus: clampNumber(data.stats?.chr_bonus, 0, 30)
      }
    };

    // Opsiyonel alanlar
    if (data.ac !== undefined) updates.ac = clampNumber(data.ac, 0, 50);
    if (data.ac_bonus !== undefined) updates.ac_bonus = clampNumber(data.ac_bonus, 0, 50);
    if (data.corruption !== undefined) updates.corruption = clampNumber(data.corruption, 0, 100);
    if (data.spell_slots) {
      updates.spell_slots = {
        lvl1: clampNumber(data.spell_slots.lvl1, 0, 20),
        lvl2: clampNumber(data.spell_slots.lvl2, 0, 20),
        lvl3: clampNumber(data.spell_slots.lvl3, 0, 20),
        lvl4: clampNumber(data.spell_slots.lvl4, 0, 20),
      };
    }

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