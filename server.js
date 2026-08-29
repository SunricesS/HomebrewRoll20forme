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
app.use(express.json({ limit: '10mb' }));

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

function rollChannelDamage(channel) {
  if (!channel) return { damage: 0, breakdown: '' };

  // 1. Dice pool desteği ({ dice: { d4, d6, ... }, bonus, weakness, resistance })
  if (channel.dice && typeof channel.dice === 'object') {
    let rawTotal = 0;
    const parts = [];
    const sidesList = [4, 6, 8, 10, 12, 20];
    let hasDice = false;

    for (const sides of sidesList) {
      const count = clampNumber(parseInt(channel.dice[`d${sides}`] ?? channel.dice[sides] ?? 0), 0, 50);
      if (count > 0) {
        hasDice = true;
        const rolls = [];
        for (let i = 0; i < count; i++) {
          const r = rollDie(1, sides);
          rolls.push(r);
          rawTotal += r;
        }
        parts.push(`${count}d${sides} [${rolls.join(' + ')}]`);
      }
    }

    const bonus = clampNumber(parseInt(channel.bonus) || 0, -1000, 1000);
    if (bonus !== 0) {
      rawTotal += bonus;
      parts.push(bonus > 0 ? `+${bonus}` : `${bonus}`);
    }

    if (hasDice || bonus !== 0) {
      let finalDmg = Math.max(0, rawTotal);
      if (channel.weakness) {
        finalDmg *= 2;
        parts.push('(Zayıf 2x)');
      } else if (channel.resistance) {
        finalDmg = Math.floor(finalDmg / 2);
        parts.push('(Dirençli 0.5x)');
      }
      return { damage: finalDmg, breakdown: parts.join(' ') };
    }
  }

  // 2. Geriye dönük uyumluluk (Legacy min/max)
  let dmg = 0;
  const parts = [];
  const pMin = clampNumber(channel.min, 0, 1000);
  const pMax = clampNumber(channel.max, 0, 1000);
  const peMin = clampNumber(channel.extraMin, 0, 1000);
  const peMax = clampNumber(channel.extraMax, 0, 1000);

  if (pMax > 0) {
    const r1 = rollDie(pMin, pMax);
    dmg += r1;
    parts.push(`[${r1}]`);
  }
  if (peMax > 0) {
    const r2 = rollDie(peMin, peMax);
    dmg += r2;
    parts.push(`Ek:[${r2}]`);
  }

  if (channel.weakness) {
    dmg *= 2;
    parts.push('(Zayıf 2x)');
  } else if (channel.resistance) {
    dmg = Math.floor(dmg / 2);
    parts.push('(Dirençli 0.5x)');
  }

  return { damage: dmg, breakdown: parts.join(' + ') };
}

function rollSpellDamage(spell) {
  if (!spell) return { damage: 0, breakdown: '' };
  const slotMultipliers = { 1: 1, 2: 1.5, 3: 2, 4: 2.5 };
  const sLevel = clampNumber(spell.level, 1, 4);
  const mult = slotMultipliers[sLevel] || 1;

  if (spell.dice && typeof spell.dice === 'object') {
    let rawTotal = 0;
    const parts = [];
    const sidesList = [4, 6, 8, 10, 12, 20];
    let hasDice = false;

    for (const sides of sidesList) {
      const count = clampNumber(parseInt(spell.dice[`d${sides}`] ?? spell.dice[sides] ?? 0), 0, 50);
      if (count > 0) {
        hasDice = true;
        const rolls = [];
        for (let i = 0; i < count; i++) {
          const r = rollDie(1, sides);
          rolls.push(r);
          rawTotal += r;
        }
        parts.push(`${count}d${sides} [${rolls.join(' + ')}]`);
      }
    }

    const bonus = clampNumber(parseInt(spell.bonus) || 0, -1000, 1000);
    if (bonus !== 0) {
      rawTotal += bonus;
      parts.push(bonus > 0 ? `+${bonus}` : `${bonus}`);
    }

    if (hasDice || bonus !== 0) {
      const scaledDmg = Math.max(0, Math.floor(rawTotal * mult));
      if (mult !== 1) {
        parts.push(`(Lvl ${sLevel}: ${mult}x)`);
      }
      return { damage: scaledDmg, breakdown: parts.join(' ') };
    }
  }

  // Geriye dönük uyumluluk (Legacy min/max)
  const sMin = clampNumber(spell.min, 0, 1000);
  const sMax = clampNumber(spell.max, 0, 1000);
  const seMin = clampNumber(spell.extraMin, 0, 1000);
  const seMax = clampNumber(spell.extraMax, 0, 1000);

  let spellDmg = 0;
  const parts = [];
  if (sMax > 0) {
    const r1 = rollDie(Math.floor(sMin * mult), Math.floor(sMax * mult));
    spellDmg += r1;
    parts.push(`[${r1}]`);
    if (seMax > 0) {
      const r2 = rollDie(Math.floor(seMin * mult), Math.floor(seMax * mult));
      spellDmg += r2;
      parts.push(`Ek:[${r2}]`);
    }
  }
  return { damage: spellDmg, breakdown: parts.join(' + ') };
}

// ---- Saldırı Hesapla ----
app.post('/api/combat/attack', (req, res) => {
  try {
    const {
      attacker,             // { type: 'marker' | 'character', id: '...' }
      attackerStats,        // { stat, bonus } — seçilen yetenek değeri ve bonusu
      target,               // { type: 'marker' | 'character', id: '...' }
      targetAC,             // hedef AC değeri
      attackType,           // 'physical' | 'spell'
      advantage,            // bool
      disadvantage,         // bool
      attackCount,          // saldırı adedi
      extraDamage,          // manuel ek hasar
      halfDamageOnMiss,     // bool — Iska durumunda yarım hasar vurulsun mu
      statusEffectsToApply, // array — İsabet durumunda hedefe uygulanacak durum efektleri
      // Fiziksel saldırı parametreleri
      physical,             // { dice, bonus, min, max, extraMin, extraMax, weakness, resistance }
      element1,             // { dice, bonus, min, max, extraMin, extraMax, weakness, resistance }
      element2,             // { dice, bonus, min, max, extraMin, extraMax, weakness, resistance }
      // Büyü saldırı parametreleri
      spell,                // { dice, bonus, min, max, extraMin, extraMax, level }
    } = req.body;

    const safeAC = clampNumber(targetAC, 0, 50);
    const safeCount = clampNumber(attackCount, 1, 20);
    const safeStat = clampNumber(attackerStats?.stat, 0, 30);
    const safeBonus = clampNumber(attackerStats?.bonus, 0, 30);
    const safeExtra = clampNumber(extraDamage, 0, 1000);

    // Durum Efektlerini Çözümle
    const attackerEffects = attacker ? getTokenActiveEffects(attacker.type, attacker.id) : [];
    const targetEffects = target ? getTokenActiveEffects(target.type, target.id) : [];

    const hasAttackerBlind = attackerEffects.some(e => e.effects?.blind);
    const hasTargetPrepared = targetEffects.some(e => e.effects?.prepared);
    const hasTargetUnstoppable = targetEffects.some(e => e.effects?.unstoppable);
    const hasTargetParalyzed = targetEffects.some(e => e.effects?.paralyzed) && !hasTargetUnstoppable;

    let effectiveAdvantage = Boolean(advantage);
    let effectiveDisadvantage = Boolean(disadvantage);

    if (hasAttackerBlind || hasTargetPrepared) {
      effectiveDisadvantage = true;
    }

    const attacks = [];
    let totalDamage = 0;

    for (let i = 0; i < safeCount; i++) {
      // 1. Vuruş zarı (d20)
      let hitRoll = 0;
      if (effectiveAdvantage && !effectiveDisadvantage) {
        hitRoll = rollAdvantage(1, 20);
      } else if (effectiveDisadvantage && !effectiveAdvantage) {
        hitRoll = rollDisadvantage(1, 20);
      } else {
        hitRoll = rollDie(1, 20);
      }

      // 2. Bonuslu zar = hitRoll + floor((stat + bonus) / 2)
      const modifiedRoll = hitRoll + Math.floor((safeStat + safeBonus) / 2);

      // 3. Vuruş kontrolü (Felç: Kesin Vuruş & Kesin Kritik)
      let isCritical = hitRoll === 20;
      let isCritFail = hitRoll === 1;
      let isHit = false;

      if (hasTargetParalyzed) {
        isHit = true;
        isCritical = true; // Felçli hedefe yapılan tüm saldırılar kesin vuruş ve kritiktir
      } else {
        isHit = isCritical || (!isCritFail && modifiedRoll >= safeAC);
      }

      if (!isHit) {
        let missDamage = 0;
        let missReason = 'ISKA';

        if (halfDamageOnMiss) {
          // Iska durumunda ham hasar hesaplanır ve yarısı uygulanır
          let rawDmg = 0;
          const missParts = [];

          if (attackType === 'physical') {
            const physRes = rollChannelDamage(physical);
            const elem1Res = rollChannelDamage(element1);
            const elem2Res = rollChannelDamage(element2);

            if (physRes.breakdown) missParts.push(`Fiziksel: ${physRes.breakdown}`);
            if (elem1Res.breakdown) missParts.push(`Ateş/El.1: ${elem1Res.breakdown}`);
            if (elem2Res.breakdown) missParts.push(`Buz/El.2: ${elem2Res.breakdown}`);

            rawDmg = physRes.damage + elem1Res.damage + elem2Res.damage + safeExtra;
            if (safeExtra > 0) missParts.push(`Manuel Ek: +${safeExtra}`);
          } else {
            const spellRes = rollSpellDamage(spell);
            if (spellRes.breakdown) missParts.push(`Büyü: ${spellRes.breakdown}`);
            rawDmg = spellRes.damage + safeExtra;
            if (safeExtra > 0) missParts.push(`Manuel Ek: +${safeExtra}`);
          }

          missDamage = Math.max(1, Math.floor(rawDmg / 2));
          totalDamage += missDamage;
          missReason = `ISKA (½ Hasar: ${missDamage}) [Ham: ${rawDmg}]`;
        } else {
          if (hasAttackerBlind) missReason = 'ISKA (Körlük)';
          else if (hasTargetPrepared) missReason = 'ISKA (Hazır)';
        }

        attacks.push({
          index: i + 1,
          hit: false,
          halfDamageMiss: Boolean(halfDamageOnMiss && missDamage > 0),
          hitRoll,
          modifiedRoll,
          isCritical: false,
          isCritFail,
          damage: missDamage,
          breakdown: missReason
        });
        continue;
      }

      // 4. Hasar hesaplama
      let damage = 0;
      const breakdownParts = [];

      if (attackType === 'physical') {
        const physRes = rollChannelDamage(physical);
        const elem1Res = rollChannelDamage(element1);
        const elem2Res = rollChannelDamage(element2);

        if (physRes.breakdown) breakdownParts.push(`Fiziksel: ${physRes.breakdown}`);
        if (elem1Res.breakdown) breakdownParts.push(`Ateş/El.1: ${elem1Res.breakdown}`);
        if (elem2Res.breakdown) breakdownParts.push(`Buz/El.2: ${elem2Res.breakdown}`);

        damage = physRes.damage + elem1Res.damage + elem2Res.damage + safeExtra;
        if (safeExtra > 0) breakdownParts.push(`Manuel Ek: +${safeExtra}`);
      } else {
        const spellRes = rollSpellDamage(spell);
        if (spellRes.breakdown) breakdownParts.push(`Büyü: ${spellRes.breakdown}`);
        damage = spellRes.damage + safeExtra;
        if (safeExtra > 0) breakdownParts.push(`Manuel Ek: +${safeExtra}`);
      }

      // 5. Kritik vuruş çarpanı (1.5x)
      if (isCritical) {
        damage = Math.floor(damage * 1.5);
        if (hasTargetParalyzed) {
          breakdownParts.push('(⚡ FELÇ KRİTİK x1.5)');
        } else {
          breakdownParts.push('(KRİTİK x1.5)');
        }
      }

      totalDamage += damage;

      attacks.push({
        index: i + 1,
        hit: true,
        halfDamageMiss: false,
        hitRoll,
        modifiedRoll,
        isCritical,
        isCritFail: false,
        damage,
        breakdown: breakdownParts.join(' | ') || `${damage}`
      });
    }

    res.json({
      attacks,
      totalDamage,
      attackType,
      statusEffectsToApply: Array.isArray(statusEffectsToApply) ? statusEffectsToApply : [],
      statusNotes: {
        attackerBlind: hasAttackerBlind,
        targetPrepared: hasTargetPrepared,
        targetParalyzed: hasTargetParalyzed,
        halfDamageOnMiss: Boolean(halfDamageOnMiss)
      }
    });
  } catch (err) {
    console.error('Saldırı hesaplama hatası:', err);
    res.status(500).json({ error: 'Saldırı hesaplanamadı.' });
  }
});

// ---- Hasar Uygula ----
app.post('/api/combat/apply-damage', async (req, res) => {
  try {
    const { targetType, targetId, damage, statusEffectsToApply } = req.body;
    const safeDamage = clampNumber(damage, 0, 99999);

    // Barınak (Shelter) kontrolü
    const targetEffects = getTokenActiveEffects(targetType, targetId);
    const hasShelter = targetEffects.some(e => e.effects?.shelter);

    if (hasShelter && safeDamage > 0) {
      io.emit('logMessage', { message: '🛡️ Barınak: Hasar tamamen engellendi (Dokunulmaz)!', color: '#3498db' });
      return res.json({ success: true, damageApplied: 0, shelterBlocked: true, message: 'Barınak: Hasar engellendi!' });
    }

    // Durum efektlerini hedefe uygula (varsa)
    if (Array.isArray(statusEffectsToApply) && statusEffectsToApply.length > 0) {
      statusEffectsToApply.forEach(eff => {
        applyStatusEffectToTarget(targetType, targetId, eff);
      });
    }

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
        syncCombatantHp(socketId, newHp, charData.hp_max);
      } else {
        syncCombatantHp(targetId, newHp, charData.hp_max);
      }

      res.json({ success: true, newHp, targetType: 'character' });
    } else if (targetType === 'marker') {
      // Marker hasar (in-memory)
      if (markers[targetId] && markers[targetId].hp != null) {
        markers[targetId].hp = Math.max(0, markers[targetId].hp - safeDamage);
        io.emit('updateMarkerData', markers[targetId]);
        syncCombatantHp(targetId, markers[targetId].hp, markers[targetId].maxHp);
        res.json({ success: true, newHp: markers[targetId].hp, targetType: 'marker' });
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

// === STATUS EFFECTS & CUSTOM EFFECT BUILDER MOTORU ===
const defaultStatusPresets = [
  { id: 'preset_burn', name: 'Yanma', icon: '🔥', duration: 3, effects: { dotDamage: { min: 1, max: 6 } } },
  { id: 'preset_bleed', name: 'Kanama', icon: '🩸', duration: 2, effects: { dotDamage: { min: 2, max: 8 } } },
  { id: 'preset_blind', name: 'Körlük', icon: '👁️', duration: 2, effects: { blind: true } },
  { id: 'preset_paralyzed', name: 'Felç', icon: '⚡', duration: 1, effects: { paralyzed: true } },
  { id: 'preset_shelter', name: 'Barınak', icon: '🛡️', duration: 1, effects: { shelter: true } },
  { id: 'preset_prepared', name: 'Hazır', icon: '🎯', duration: 2, effects: { prepared: true } },
  { id: 'preset_unstoppable', name: 'Durdurulamaz', icon: '🦏', duration: 3, effects: { unstoppable: true } },
  { id: 'preset_poison', name: 'Zehir', icon: '☠️', duration: 3, effects: { dotDamage: { min: 1, max: 4 }, blind: true } }
];
let customStatusPresets = [...defaultStatusPresets];

// === HAZIR SALDIRI PRESETLERİ (ATTACK PRESETS) ===
const defaultAttackPresets = [
  {
    id: 'atk_preset_flame_sword',
    name: 'Alev Kılıcı',
    stat: 'STR',
    attackType: 'physical',
    spellLevel: 1,
    dicePools: {
      phys: { dice: { 6: 1 }, bonus: 2, weakness: false, resistance: false },
      elem1: { dice: { 6: 1 }, bonus: 0, weakness: false, resistance: false },
      elem2: { dice: {}, bonus: 0, weakness: false, resistance: false },
      spell: { dice: {}, bonus: 0 }
    },
    statusEffectsToApply: [
      { id: 'preset_burn', name: 'Yanma', icon: '🔥', duration: 2, effects: { dotDamage: { min: 1, max: 6 } } }
    ],
    halfDamageOnMiss: true,
    extraDamage: 0,
    attackCount: 1,
    description: '1d6+2 Fiziksel + 1d6 Ateş. İsabet halinde 2 tur Yanma uygular. Iskalasa bile yarım hasar verir.'
  },
  {
    id: 'atk_preset_heavy_strike',
    name: 'Güçlü Vuruş',
    stat: 'STR',
    attackType: 'physical',
    spellLevel: 1,
    dicePools: {
      phys: { dice: { 8: 2 }, bonus: 3, weakness: false, resistance: false },
      elem1: { dice: {}, bonus: 0, weakness: false, resistance: false },
      elem2: { dice: {}, bonus: 0, weakness: false, resistance: false },
      spell: { dice: {}, bonus: 0 }
    },
    statusEffectsToApply: [],
    halfDamageOnMiss: false,
    extraDamage: 0,
    attackCount: 1,
    description: '2d8+3 Ağır fiziksel ezici darbe.'
  },
  {
    id: 'atk_preset_frost_bolt',
    name: 'Buz Oku',
    stat: 'INT',
    attackType: 'spell',
    spellLevel: 1,
    dicePools: {
      phys: { dice: {}, bonus: 0, weakness: false, resistance: false },
      elem1: { dice: {}, bonus: 0, weakness: false, resistance: false },
      elem2: { dice: { 8: 1 }, bonus: 2, weakness: false, resistance: false },
      spell: { dice: { 8: 1 }, bonus: 2 }
    },
    statusEffectsToApply: [
      { id: 'preset_blind', name: 'Körlük', icon: '👁️', duration: 1, effects: { blind: true } }
    ],
    halfDamageOnMiss: true,
    extraDamage: 0,
    attackCount: 1,
    description: '1d8+2 Büyü hasarı. Göz kamaştırıcı soğuklukla 1 tur Körlük uygular, ıskalarsa yarım hasar vurur.'
  },
  {
    id: 'atk_preset_poison_dagger',
    name: 'Zehirli Hançer',
    stat: 'DEX',
    attackType: 'physical',
    spellLevel: 1,
    dicePools: {
      phys: { dice: { 4: 1 }, bonus: 3, weakness: false, resistance: false },
      elem1: { dice: {}, bonus: 0, weakness: false, resistance: false },
      elem2: { dice: {}, bonus: 0, weakness: false, resistance: false },
      spell: { dice: {}, bonus: 0 }
    },
    statusEffectsToApply: [
      { id: 'preset_poison', name: 'Zehir', icon: '☠️', duration: 3, effects: { dotDamage: { min: 1, max: 4 }, blind: true } }
    ],
    halfDamageOnMiss: false,
    extraDamage: 0,
    attackCount: 1,
    description: '1d4+3 Hızlı hançer darbesi. İsabet halinde 3 tur Zehir (1-4 DoT & Körlük) uygular.'
  },
  {
    id: 'atk_preset_holy_smite',
    name: 'Kutsal Darbe',
    stat: 'WIS',
    attackType: 'spell',
    spellLevel: 2,
    dicePools: {
      phys: { dice: { 6: 1 }, bonus: 2, weakness: false, resistance: false },
      elem1: { dice: { 6: 2 }, bonus: 0, weakness: false, resistance: false },
      elem2: { dice: {}, bonus: 0, weakness: false, resistance: false },
      spell: { dice: { 6: 2 }, bonus: 2 }
    },
    statusEffectsToApply: [
      { id: 'preset_paralyzed', name: 'Felç', icon: '⚡', duration: 1, effects: { paralyzed: true } }
    ],
    halfDamageOnMiss: true,
    extraDamage: 0,
    attackCount: 1,
    description: '2. Seviye kutsal ışık patlaması. İsabet halinde 1 tur Felç uygular, ıskalasa bile yarım hasar vurur.'
  },
  {
    id: 'atk_preset_shadow_strike',
    name: 'Gölge Darbesi',
    stat: 'DEX',
    attackType: 'physical',
    spellLevel: 1,
    dicePools: {
      phys: { dice: { 6: 2 }, bonus: 4, weakness: false, resistance: false },
      elem1: { dice: {}, bonus: 0, weakness: false, resistance: false },
      elem2: { dice: {}, bonus: 0, weakness: false, resistance: false },
      spell: { dice: {}, bonus: 0 }
    },
    statusEffectsToApply: [
      { id: 'preset_bleed', name: 'Kanama', icon: '🩸', duration: 2, effects: { dotDamage: { min: 2, max: 8 } } }
    ],
    halfDamageOnMiss: false,
    extraDamage: 0,
    attackCount: 1,
    description: '2d6+4 Sinsi gölge saldırısı. İsabet halinde 2 tur Kanama (2-8 DoT) uygular.'
  }
];
let attackPresets = [...defaultAttackPresets];

/**
 * Token veya karakterin aktif durum efektlerini döndürür.
 */
function getTokenActiveEffects(targetType, targetId) {
  if (!targetId) return [];
  if (targetType === 'marker') {
    return markers[targetId]?.activeEffects || [];
  } else if (targetType === 'character' || targetType === 'player') {
    const playerEntry = Object.values(players).find(
      p => p.id === targetId || (p.character && p.character.id === targetId)
    );
    if (playerEntry) {
      if (!playerEntry.activeEffects) playerEntry.activeEffects = [];
      return playerEntry.activeEffects;
    }
  }
  const c = combatState.combatants.find(item => item.id === targetId || item.characterId === targetId);
  return c?.activeEffects || [];
}

/**
 * Hedefe durum efekti ekler veya günceller.
 */
function applyStatusEffectToTarget(targetType, targetId, effect) {
  if (!effect || !targetId) return false;

  const currentEffects = getTokenActiveEffects(targetType, targetId);
  const hasUnstoppable = currentEffects.some(e => e.effects?.unstoppable);

  const effectToApply = JSON.parse(JSON.stringify(effect));
  effectToApply.id = effectToApply.id || ('eff_' + Date.now() + '_' + Math.floor(Math.random() * 1000));

  // Felç bağışıklığı kontrolü
  if (effectToApply.effects?.paralyzed && hasUnstoppable) {
    delete effectToApply.effects.paralyzed;
    io.emit('logMessage', { message: `🦏 Durdurulamaz: ${effectToApply.name || 'Efekt'} içindeki Felç bağışıklık nedeniyle engellendi!`, color: '#e67e22' });
  }

  // Token üzerinde kaydet
  if (targetType === 'marker' && markers[targetId]) {
    if (!markers[targetId].activeEffects) markers[targetId].activeEffects = [];
    const idx = markers[targetId].activeEffects.findIndex(e => e.id === effectToApply.id || e.name === effectToApply.name);
    if (idx >= 0) markers[targetId].activeEffects[idx] = effectToApply;
    else markers[targetId].activeEffects.push(effectToApply);
    io.emit('updateMarkerData', markers[targetId]);
  } else {
    const playerEntry = Object.entries(players).find(
      ([, p]) => p.id === targetId || (p.character && p.character.id === targetId)
    );
    if (playerEntry) {
      const [socketId, p] = playerEntry;
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
      io.emit('tokenEffectsUpdated', { id: socketId, characterId: p.character?.id, activeEffects: p.activeEffects });
    }
  }

  // Savaşçı listesinde güncelle
  if (combatState.active) {
    const c = combatState.combatants.find(item => item.id === targetId || item.characterId === targetId);
    if (c) {
      if (!c.activeEffects) c.activeEffects = [];
      const idx = c.activeEffects.findIndex(e => e.id === effectToApply.id || e.name === effectToApply.name);
      if (idx >= 0) c.activeEffects[idx] = effectToApply;
      else c.activeEffects.push(effectToApply);
      io.emit('combatStateUpdated', combatState);
    }
  }

  const targetName = (targetType === 'marker' ? markers[targetId]?.name : Object.values(players).find(p => p.id === targetId || p.character?.id === targetId)?.character?.name) || 'Hedef';
  io.emit('logMessage', {
    message: `${effectToApply.icon || '✨'} [${effectToApply.name}]: ${targetName} üzerine uygulandı (${effectToApply.duration ? effectToApply.duration + ' Tur' : 'Kalıcı'}).`,
    color: '#e5c158'
  });

  return true;
}

/**
 * Hedef üzerinden durum efektini kaldırır.
 */
function removeStatusEffectFromTarget(targetType, targetId, effectId) {
  if (!targetId || !effectId) return false;

  let effectName = 'Efekt';

  if (targetType === 'marker' && markers[targetId] && markers[targetId].activeEffects) {
    const eff = markers[targetId].activeEffects.find(e => e.id === effectId);
    if (eff) effectName = eff.name;
    markers[targetId].activeEffects = markers[targetId].activeEffects.filter(e => e.id !== effectId);
    io.emit('updateMarkerData', markers[targetId]);
  } else {
    const playerEntry = Object.entries(players).find(
      ([, p]) => p.id === targetId || (p.character && p.character.id === targetId)
    );
    if (playerEntry) {
      const [socketId, p] = playerEntry;
      if (p.activeEffects) {
        const eff = p.activeEffects.find(e => e.id === effectId);
        if (eff) effectName = eff.name;
        p.activeEffects = p.activeEffects.filter(e => e.id !== effectId);
      }
      if (p.character && p.character.activeEffects) {
        p.character.activeEffects = p.character.activeEffects.filter(e => e.id !== effectId);
      }
      io.emit('tokenEffectsUpdated', { id: socketId, characterId: p.character?.id, activeEffects: p.activeEffects || [] });
    }
  }

  if (combatState.active) {
    const c = combatState.combatants.find(item => item.id === targetId || item.characterId === targetId);
    if (c && c.activeEffects) {
      const eff = c.activeEffects.find(e => e.id === effectId);
      if (eff) effectName = eff.name;
      c.activeEffects = c.activeEffects.filter(e => e.id !== effectId);
      io.emit('combatStateUpdated', combatState);
    }
  }

  return true;
}

/**
 * Tur biten combatant'ın DoT hasarını uygular ve süreli efektlerinin duration sayacını 1 azaltır.
 */
async function processCombatantTurnEnd(combatant) {
  if (!combatant || !combatant.activeEffects || combatant.activeEffects.length === 0) return;

  const expiredEffects = [];
  const targetType = combatant.isMarker ? 'marker' : 'character';
  const targetId = combatant.isMarker ? combatant.id : (combatant.characterId || combatant.id);

  // 1. DoT Hasarı Kontrolü
  for (const eff of combatant.activeEffects) {
    if (eff.effects?.dotDamage) {
      const minDmg = clampNumber(parseInt(eff.effects.dotDamage.min) || 1, 0, 9999);
      const maxDmg = clampNumber(parseInt(eff.effects.dotDamage.max) || minDmg, minDmg, 9999);
      const dotDmg = rollDie(minDmg, maxDmg);

      if (dotDmg > 0) {
        // Hedefte shelter (barınak) var mı?
        const hasShelter = combatant.activeEffects.some(e => e.effects?.shelter);
        if (hasShelter) {
          io.emit('logMessage', {
            message: `🛡️ [Barınak]: ${combatant.name} üzerindeki ${eff.name} DoT hasarı engellendi!`,
            color: '#3498db'
          });
        } else {
          // Hasarı uygula
          if (combatant.isMarker && markers[combatant.id] && markers[combatant.id].hp != null) {
            markers[combatant.id].hp = Math.max(0, markers[combatant.id].hp - dotDmg);
            combatant.hpCurrent = markers[combatant.id].hp;
            combatant.isDead = combatant.hpCurrent <= 0;
            io.emit('updateMarkerData', markers[combatant.id]);
            syncCombatantHp(combatant.id, combatant.hpCurrent, combatant.hpMax);
          } else if (!combatant.isMarker && combatant.characterId) {
            try {
              const { data: charData } = await supabase
                .from('characters')
                .select('hp_current, hp_max')
                .eq('id', combatant.characterId)
                .single();
              if (charData) {
                const newHp = Math.max(0, (charData.hp_current || 0) - dotDmg);
                await supabase.from('characters').update({ hp_current: newHp }).eq('id', combatant.characterId);
                combatant.hpCurrent = newHp;
                combatant.isDead = newHp <= 0;

                const playerEntry = Object.entries(players).find(
                  ([, p]) => p.character && p.character.id === combatant.characterId
                );
                if (playerEntry) {
                  const [socketId, p] = playerEntry;
                  p.character.hp_current = newHp;
                  io.emit('characterUpdated', { id: socketId, updates: { hp_current: newHp, hp_max: charData.hp_max } });
                }
                syncCombatantHp(combatant.id, newHp, charData.hp_max);
              }
            } catch (err) {
              console.error('DoT character hasar hatası:', err);
            }
          }

          io.emit('logMessage', {
            message: `${eff.icon || '🔥'} [${eff.name}]: ${combatant.name} ${dotDmg} tur sonu hasarı aldı! (Kalan HP: ${combatant.hpCurrent || 0})`,
            color: '#e74c3c'
          });
        }
      }
    }
  }

  // 2. Süre Azaltma & Süresi Dolanları Ayıklama
  combatant.activeEffects.forEach(eff => {
    if (eff.duration != null && eff.duration > 0) {
      eff.duration -= 1;
      if (eff.duration <= 0) {
        expiredEffects.push(eff);
      }
    }
  });

  // Süresi dolanları kaldır
  if (expiredEffects.length > 0) {
    expiredEffects.forEach(exp => {
      removeStatusEffectFromTarget(targetType, targetId, exp.id);
      io.emit('logMessage', {
        message: `✨ [${exp.name}] etkisi ${combatant.name} üzerinden sona erdi.`,
        color: '#9b59b6'
      });
    });
  }

  // Senkronizasyon
  if (combatant.isMarker && markers[combatant.id]) {
    markers[combatant.id].activeEffects = combatant.activeEffects.filter(e => e.duration == null || e.duration > 0);
    io.emit('updateMarkerData', markers[combatant.id]);
  } else {
    const playerEntry = Object.entries(players).find(
      ([, p]) => p.id === combatant.id || (p.character && p.character.id === combatant.characterId)
    );
    if (playerEntry) {
      const [socketId, p] = playerEntry;
      p.activeEffects = combatant.activeEffects.filter(e => e.duration == null || e.duration > 0);
      if (p.character) p.character.activeEffects = p.activeEffects;
      io.emit('tokenEffectsUpdated', { id: socketId, characterId: p.character?.id, activeEffects: p.activeEffects });
    }
  }

  io.emit('combatStateUpdated', combatState);
}

// === SAVAŞ / İNİSİYATİF DURUMU (BG3 COMBAT TRACKER) ===
let combatState = {
  active: false,
  round: 1,
  currentTurnIndex: 0,
  combatants: []
};

/**
 * Haritadaki tüm aktif oyuncu ve marker tokenları için 1d20 + CHR modifikatörü hesaplayıp
 * BG3 tarzı inisiyatif listesi oluşturur ve sıralar.
 */
function calculateInitiativeForCombat() {
  const list = [];

  // 1. Oyuncular (DM Hariç)
  Object.values(players).forEach(p => {
    // DM tokeni savaşa dahil edilmez
    if (p.role === 'dm') return;

    const name = p.character?.name || 'Oyuncu';
    const characterId = p.character?.id || null;
    const chrStat = p.character?.stats?.chr != null ? p.character.stats.chr : 10;
    const chrBonus = p.character?.stats?.chr_bonus != null ? p.character.stats.chr_bonus : 0;
    // D&D CHR Modifikatörü = floor((CHR - 10) / 2) + Bonus
    const chrMod = Math.floor((chrStat - 10) / 2) + chrBonus;
    const roll = Math.floor(Math.random() * 20) + 1;
    const total = roll + chrMod;
    const hpCurrent = p.character?.hp_current ?? null;
    const hpMax = p.character?.hp_max ?? null;

    list.push({
      id: p.id,
      sessionId: p.sessionId,
      characterId: characterId,
      name: name,
      color: p.color || '#3498db',
      imgUrl: p.imgUrl || p.character?.avatar_url || null,
      isMarker: false,
      role: p.role || 'player',
      hpCurrent: hpCurrent,
      hpMax: hpMax,
      chrStat: chrStat,
      chrBonus: chrBonus,
      chrMod: chrMod,
      roll: roll,
      total: total,
      isDead: hpCurrent !== null && hpCurrent <= 0,
      activeEffects: p.activeEffects || p.character?.activeEffects || []
    });
  });

  // 2. DM Marker'ları (Canavarlar / NPC'ler)
  Object.values(markers).forEach(m => {
    const name = m.name || 'NPC';
    const chrStat = m.stats?.chr != null ? m.stats.chr : 10;
    const chrBonus = m.stats?.chr_bonus != null ? m.stats.chr_bonus : 0;
    const chrMod = Math.floor((chrStat - 10) / 2) + chrBonus;
    const roll = Math.floor(Math.random() * 20) + 1;
    const total = roll + chrMod;
    const hpCurrent = m.hp ?? null;
    const hpMax = m.maxHp ?? null;

    list.push({
      id: m.id,
      name: name,
      color: m.color || '#e74c3c',
      imgUrl: m.imgUrl || null,
      isMarker: true,
      role: 'marker',
      hpCurrent: hpCurrent,
      hpMax: hpMax,
      chrStat: chrStat,
      chrBonus: chrBonus,
      chrMod: chrMod,
      roll: roll,
      total: total,
      isDead: hpCurrent !== null && hpCurrent <= 0,
      activeEffects: m.activeEffects || []
    });
  });

  // 3. Sıralama:
  // - En yüksek toplam puan en solda (azalan)
  // - Eşitlik durumunda CHR değeri (stat + bonus) yüksek olana öncelik
  // - Hâlâ eşitse d20 ham zar sonucuna göre
  list.sort((a, b) => {
    if (b.total !== a.total) {
      return b.total - a.total;
    }
    const aChrTotal = a.chrStat + a.chrBonus;
    const bChrTotal = b.chrStat + b.chrBonus;
    if (bChrTotal !== aChrTotal) {
      return bChrTotal - aChrTotal;
    }
    if (b.roll !== a.roll) {
      return b.roll - a.roll;
    }
    return a.name.localeCompare(b.name);
  });

  return list;
}

/**
 * Savaşçı can değerini günceller ve değişiklik varsa tüm istemcilere bildirir.
 */
function syncCombatantHp(id, hpCurrent, hpMax) {
  if (!combatState.active || !combatState.combatants.length) return;
  let changed = false;
  combatState.combatants.forEach(c => {
    if (c.id === id || (c.sessionId && c.sessionId === id)) {
      if (hpCurrent !== undefined) c.hpCurrent = hpCurrent;
      if (hpMax !== undefined) c.hpMax = hpMax;
      c.isDead = c.hpCurrent !== null && c.hpCurrent <= 0;
      changed = true;
    }
  });
  if (changed) {
    io.emit('combatStateUpdated', combatState);
  }
}

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

    // Mevcut Savaş / İnisiyatif durumunu gönder
    socket.emit('combatStateUpdated', combatState);
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
      ac_bonus: markerData.acBonus != null ? clampNumber(markerData.acBonus, 0, 50) : 0,
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

    // Eğer savaş aktifse yeni marker'ı da savaşa ekle
    if (combatState.active) {
      const chrStat = newMarker.stats?.chr != null ? newMarker.stats.chr : 10;
      const chrBonus = newMarker.stats?.chr_bonus != null ? newMarker.stats.chr_bonus : 0;
      const chrMod = Math.floor((chrStat - 10) / 2) + chrBonus;
      const roll = Math.floor(Math.random() * 20) + 1;
      const total = roll + chrMod;
      combatState.combatants.push({
        id: newMarker.id,
        name: newMarker.name || 'NPC',
        color: newMarker.color || '#e74c3c',
        imgUrl: newMarker.imgUrl || null,
        isMarker: true,
        role: 'marker',
        hpCurrent: newMarker.hp,
        hpMax: newMarker.maxHp,
        chrStat,
        chrBonus,
        chrMod,
        roll,
        total,
        isDead: newMarker.hp !== null && newMarker.hp <= 0
      });
      io.emit('combatStateUpdated', combatState);
    }
  });


  // ---- DM: Marker Sil ----
  socket.on('deleteMarker', (markerId) => {
    if (!players[socket.id] || players[socket.id].role !== 'dm') return;
    if (typeof markerId !== 'string' || !markers[markerId]) return;

    delete markers[markerId];
    io.emit('removeMarker', markerId);

    // Savaş aktifse listeden çıkar
    if (combatState.active) {
      combatState.combatants = combatState.combatants.filter(c => c.id !== markerId);
      if (combatState.currentTurnIndex >= combatState.combatants.length) {
        combatState.currentTurnIndex = Math.max(0, combatState.combatants.length - 1);
      }
      io.emit('combatStateUpdated', combatState);
    }
  });

  // ---- DM: Marker Düzenle ----
  socket.on('editMarker', (data) => {
    if (!players[socket.id] || players[socket.id].role !== 'dm') return;
    if (!data || typeof data !== 'object' || !markers[data.id]) return;

    const m = markers[data.id];

    if (data.name !== undefined) m.name = truncateStr(data.name || 'X', 2);
    if (data.color !== undefined) m.color = truncateStr(data.color || '#f1c40f', 9);
    if (data.imgUrl !== undefined) m.imgUrl = isValidUrl(data.imgUrl) ? data.imgUrl : null;
    if (data.hp !== undefined) m.hp = data.hp != null ? clampNumber(data.hp, 0, 99999) : null;
    if (data.maxHp !== undefined) m.maxHp = data.maxHp != null ? clampNumber(data.maxHp, 0, 99999) : null;
    if (data.size !== undefined) m.size = clampNumber(data.size, 10, 500);
    if (data.ac !== undefined) m.ac = clampNumber(data.ac, 0, 50);
    if (data.ac_bonus !== undefined || data.acBonus !== undefined) {
      m.ac_bonus = clampNumber(data.ac_bonus ?? data.acBonus, 0, 50);
    }
    if (data.stats && typeof data.stats === 'object') {
      m.stats = {
        str: clampNumber(data.stats.str, 0, 30),
        str_bonus: clampNumber(data.stats.str_bonus, 0, 30),
        dex: clampNumber(data.stats.dex, 0, 30),
        dex_bonus: clampNumber(data.stats.dex_bonus, 0, 30),
        int: clampNumber(data.stats.int, 0, 30),
        int_bonus: clampNumber(data.stats.int_bonus, 0, 30),
        con: clampNumber(data.stats.con, 0, 30),
        con_bonus: clampNumber(data.stats.con_bonus, 0, 30),
        wis: clampNumber(data.stats.wis, 0, 30),
        wis_bonus: clampNumber(data.stats.wis_bonus, 0, 30),
        chr: clampNumber(data.stats.chr, 0, 30),
        chr_bonus: clampNumber(data.stats.chr_bonus, 0, 30),
      };
    }

    io.emit('updateMarkerData', m);

    // Savaş aktifse combatant bilgilerini de senkronize et
    if (combatState.active) {
      const c = combatState.combatants.find(item => item.id === data.id);
      if (c) {
        if (data.name !== undefined) c.name = m.name;
        if (data.color !== undefined) c.color = m.color;
        if (data.imgUrl !== undefined) c.imgUrl = m.imgUrl;
        if (data.hp !== undefined) c.hpCurrent = m.hp;
        if (data.maxHp !== undefined) c.hpMax = m.maxHp;
        c.isDead = m.hp !== null && m.hp <= 0;
      }
      io.emit('combatStateUpdated', combatState);
    }
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

    if (combatState.active) {
      const c = combatState.combatants.find(item => item.id === socket.id);
      if (c) {
        if (data.imgUrl !== undefined) c.imgUrl = players[socket.id].imgUrl;
        if (data.color !== undefined) c.color = players[socket.id].color;
        io.emit('combatStateUpdated', combatState);
      }
    }
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
      syncCombatantHp(data.id, updates.hp_current, updates.hp_max);
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

  // ---- BG3 COMBAT / İNİSİYATİF EVENTLERİ ----
  socket.on('getCombatState', () => {
    socket.emit('combatStateUpdated', combatState);
  });

  socket.on('startCombat', () => {
    combatState.combatants = calculateInitiativeForCombat();
    combatState.active = true;
    combatState.round = 1;
    combatState.currentTurnIndex = 0;
    io.emit('combatStateUpdated', combatState);
    io.emit('combatStarted', { round: combatState.round, combatants: combatState.combatants });
  });

  socket.on('endCombat', () => {
    combatState.active = false;
    combatState.currentTurnIndex = 0;
    combatState.round = 1;
    combatState.combatants = [];
    io.emit('combatStateUpdated', combatState);
    io.emit('combatEnded');
  });

  socket.on('toggleCombat', () => {
    if (combatState.active) {
      combatState.active = false;
      combatState.currentTurnIndex = 0;
      combatState.round = 1;
      combatState.combatants = [];
      io.emit('combatStateUpdated', combatState);
      io.emit('combatEnded');
    } else {
      combatState.combatants = calculateInitiativeForCombat();
      combatState.active = true;
      combatState.round = 1;
      combatState.currentTurnIndex = 0;
      io.emit('combatStateUpdated', combatState);
      io.emit('combatStarted', { round: combatState.round, combatants: combatState.combatants });
    }
  });

  socket.on('nextCombatTurn', async () => {
    if (!combatState.active || !combatState.combatants.length) return;

    // 1. Sırası biten combatant için DoT hasarını uygula ve süreleri azalt
    const currentCombatant = combatState.combatants[combatState.currentTurnIndex];
    if (currentCombatant) {
      await processCombatantTurnEnd(currentCombatant);
    }

    // 2. Sıradaki combatant'a geç
    let nextIndex = combatState.currentTurnIndex + 1;
    if (nextIndex >= combatState.combatants.length) {
      nextIndex = 0;
      combatState.round += 1;
    }
    combatState.currentTurnIndex = nextIndex;
    io.emit('combatStateUpdated', combatState);
  });

  socket.on('prevCombatTurn', () => {
    if (!combatState.active || !combatState.combatants.length) return;
    
    if (combatState.currentTurnIndex > 0) {
      combatState.currentTurnIndex -= 1;
    } else if (combatState.round > 1) {
      combatState.round -= 1;
      combatState.currentTurnIndex = combatState.combatants.length - 1;
    }
    io.emit('combatStateUpdated', combatState);
  });

  socket.on('setCombatTurn', async (index) => {
    if (!combatState.active || !combatState.combatants.length) return;
    const safeIdx = clampNumber(index, 0, combatState.combatants.length - 1);
    
    const currentCombatant = combatState.combatants[combatState.currentTurnIndex];
    if (currentCombatant && safeIdx !== combatState.currentTurnIndex) {
      await processCombatantTurnEnd(currentCombatant);
    }

    combatState.currentTurnIndex = safeIdx;
    io.emit('combatStateUpdated', combatState);
  });

  socket.on('rerollCombatInitiative', () => {
    if (!combatState.active) return;
    combatState.combatants = calculateInitiativeForCombat();
    combatState.currentTurnIndex = 0;
    io.emit('combatStateUpdated', combatState);
  });

  // ---- STATUS EFFECTS & CUSTOM EFFECT BUILDER SOCKET EVENTLERİ ----
  socket.on('getCustomEffects', () => {
    socket.emit('customEffectsUpdated', customStatusPresets);
  });

  socket.on('saveCustomEffect', async (effectTemplate) => {
    if (!players[socket.id] || players[socket.id].role !== 'dm') return;
    if (!effectTemplate || !effectTemplate.name) return;

    const newEffect = {
      id: effectTemplate.id || ('custom_' + Date.now()),
      name: truncateStr(effectTemplate.name, 30),
      icon: effectTemplate.icon || '✨',
      duration: effectTemplate.duration != null && effectTemplate.duration !== '' ? clampNumber(parseInt(effectTemplate.duration), 1, 99) : null,
      effects: effectTemplate.effects || {}
    };

    const existingIdx = customStatusPresets.findIndex(e => e.id === newEffect.id);
    if (existingIdx >= 0) {
      customStatusPresets[existingIdx] = newEffect;
    } else {
      customStatusPresets.push(newEffect);
    }

    io.emit('customEffectsUpdated', customStatusPresets);

    // Supabase veritabanına kaydet (upsert)
    try {
      const dbRecord = {
        id: newEffect.id,
        name: newEffect.name,
        icon: newEffect.icon,
        duration: newEffect.duration,
        effects: newEffect.effects
      };
      const { error } = await supabase.from('status_presets').upsert(dbRecord);
      if (error && error.code !== 'PGRST205') {
        console.error('Supabase status preset kaydetme hatası:', error.message);
      }
    } catch (err) {
      console.error('Supabase status preset kaydetme istisnası:', err.message);
    }
  });

  socket.on('deleteCustomEffect', async (effectId) => {
    if (!players[socket.id] || players[socket.id].role !== 'dm') return;
    customStatusPresets = customStatusPresets.filter(e => e.id !== effectId);
    io.emit('customEffectsUpdated', customStatusPresets);

    // Supabase veritabanından sil
    try {
      const { error } = await supabase.from('status_presets').delete().eq('id', effectId);
      if (error && error.code !== 'PGRST205') {
        console.error('Supabase status preset silme hatası:', error.message);
      }
    } catch (err) {
      console.error('Supabase status preset silme istisnası:', err.message);
    }
  });

  socket.on('applyStatusEffect', ({ targetType, targetId, effect }) => {
    if (!players[socket.id] || players[socket.id].role !== 'dm') return;
    applyStatusEffectToTarget(targetType, targetId, effect);
  });

  socket.on('removeStatusEffect', ({ targetType, targetId, effectId }) => {
    if (!players[socket.id] || players[socket.id].role !== 'dm') return;
    removeStatusEffectFromTarget(targetType, targetId, effectId);
  });

  // ---- ATTACK PRESETS SOCKET EVENTLERİ ----
  socket.on('getAttackPresets', () => {
    socket.emit('attackPresetsUpdated', attackPresets);
  });

  socket.on('saveAttackPreset', async (preset) => {
    if (!players[socket.id] || players[socket.id].role !== 'dm') return;
    if (!preset || !preset.name) return;

    const newPreset = {
      id: preset.id || ('atk_custom_' + Date.now()),
      name: truncateStr(preset.name, 40),
      stat: preset.stat || 'STR',
      attackType: preset.attackType === 'spell' ? 'spell' : 'physical',
      spellLevel: clampNumber(parseInt(preset.spellLevel) || 1, 1, 4),
      dicePools: preset.dicePools || { phys: {}, elem1: {}, elem2: {}, spell: {} },
      statusEffectsToApply: Array.isArray(preset.statusEffectsToApply) ? preset.statusEffectsToApply : [],
      halfDamageOnMiss: Boolean(preset.halfDamageOnMiss),
      extraDamage: clampNumber(parseInt(preset.extraDamage) || 0, 0, 1000),
      attackCount: clampNumber(parseInt(preset.attackCount) || 1, 1, 20),
      description: truncateStr(preset.description || '', 200)
    };

    const existingIdx = attackPresets.findIndex(p => p.id === newPreset.id);
    if (existingIdx >= 0) {
      attackPresets[existingIdx] = newPreset;
    } else {
      attackPresets.push(newPreset);
    }

    io.emit('attackPresetsUpdated', attackPresets);

    // Supabase veritabanına kaydet (upsert)
    try {
      const dbRecord = {
        id: newPreset.id,
        name: newPreset.name,
        stat: newPreset.stat,
        attack_type: newPreset.attackType,
        spell_level: newPreset.spellLevel,
        dice_pools: newPreset.dicePools,
        status_effects_to_apply: newPreset.statusEffectsToApply,
        half_damage_on_miss: newPreset.halfDamageOnMiss,
        extra_damage: newPreset.extraDamage,
        attack_count: newPreset.attackCount,
        description: newPreset.description
      };
      const { error } = await supabase.from('attack_presets').upsert(dbRecord);
      if (error && error.code !== 'PGRST205') {
        console.error('Supabase attack preset kaydetme hatası:', error.message);
      }
    } catch (err) {
      console.error('Supabase attack preset kaydetme istisnası:', err.message);
    }
  });

  socket.on('deleteAttackPreset', async (presetId) => {
    if (!players[socket.id] || players[socket.id].role !== 'dm') return;
    attackPresets = attackPresets.filter(p => p.id !== presetId);
    io.emit('attackPresetsUpdated', attackPresets);

    // Supabase veritabanından sil
    try {
      const { error } = await supabase.from('attack_presets').delete().eq('id', presetId);
      if (error && error.code !== 'PGRST205') {
        console.error('Supabase attack preset silme hatası:', error.message);
      }
    } catch (err) {
      console.error('Supabase attack preset silme istisnası:', err.message);
    }
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

      // Savaş devam ediyorsa listeden çıkar
      if (combatState.active) {
        combatState.combatants = combatState.combatants.filter(c => c.id !== socket.id);
        if (combatState.currentTurnIndex >= combatState.combatants.length) {
          combatState.currentTurnIndex = Math.max(0, combatState.combatants.length - 1);
        }
        io.emit('combatStateUpdated', combatState);
      }
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

// === ATTACK PRESETS RESTORE VE SEED ===
async function restoreAttackPresets() {
  try {
    const { data, error } = await supabase
      .from('attack_presets')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      if (error.code !== 'PGRST116' && error.code !== 'PGRST205') {
        console.error('Attack presets yüklenirken Supabase hatası:', error.message);
      } else if (error.code === 'PGRST205') {
        console.log('attack_presets tablosu henüz veritabanında oluşturulmamış. Tablo oluşturulduğunda otomatik senkronize edilecektir.');
      }
      return;
    }

    if (data && data.length > 0) {
      attackPresets = data.map(row => ({
        id: row.id,
        name: row.name,
        stat: row.stat || 'STR',
        attackType: row.attack_type || row.attackType || 'physical',
        spellLevel: row.spell_level ?? row.spellLevel ?? 1,
        dicePools: row.dice_pools || row.dicePools || { phys: {}, elem1: {}, elem2: {}, spell: {} },
        statusEffectsToApply: Array.isArray(row.status_effects_to_apply) ? row.status_effects_to_apply : (Array.isArray(row.statusEffectsToApply) ? row.statusEffectsToApply : []),
        halfDamageOnMiss: Boolean(row.half_damage_on_miss ?? row.halfDamageOnMiss),
        extraDamage: row.extra_damage ?? row.extraDamage ?? 0,
        attackCount: row.attack_count ?? row.attackCount ?? 1,
        description: row.description || ''
      }));
      console.log(`Supabase'den ${attackPresets.length} adet saldırı preseti başarıyla yüklendi.`);
    } else {
      console.log('Supabase attack_presets tablosu boş, varsayılan presetler tohumlanıyor...');
      await seedDefaultAttackPresets();
    }
  } catch (err) {
    console.error('Attack presets geri yüklenirken beklenmeyen hata:', err.message);
  }
}

async function seedDefaultAttackPresets() {
  try {
    const rowsToInsert = defaultAttackPresets.map(p => ({
      id: p.id,
      name: p.name,
      stat: p.stat,
      attack_type: p.attackType,
      spell_level: p.spellLevel,
      dice_pools: p.dicePools,
      status_effects_to_apply: p.statusEffectsToApply,
      half_damage_on_miss: p.halfDamageOnMiss,
      extra_damage: p.extraDamage,
      attack_count: p.attackCount,
      description: p.description
    }));
    const { error } = await supabase.from('attack_presets').upsert(rowsToInsert);
    if (error) {
      if (error.code !== 'PGRST205') {
        console.error('Varsayılan attack presetleri tohumlanırken hata:', error.message);
      }
    } else {
      console.log('Varsayılan attack presetleri Supabase veritabanına kaydedildi.');
    }
  } catch (err) {
    console.error('Default attack presets seed istisnası:', err.message);
  }
}

// === STATUS PRESETS RESTORE VE SEED ===
async function restoreStatusPresets() {
  try {
    const { data, error } = await supabase
      .from('status_presets')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      if (error.code !== 'PGRST116' && error.code !== 'PGRST205') {
        console.error('Status presets yüklenirken Supabase hatası:', error.message);
      } else if (error.code === 'PGRST205') {
        console.log('status_presets tablosu henüz veritabanında oluşturulmamış. Tablo oluşturulduğunda otomatik senkronize edilecektir.');
      }
      return;
    }

    if (data && data.length > 0) {
      customStatusPresets = data.map(row => ({
        id: row.id,
        name: row.name,
        icon: row.icon || '✨',
        duration: row.duration != null ? row.duration : null,
        effects: row.effects || {}
      }));
      console.log(`Supabase'den ${customStatusPresets.length} adet durum efekti preseti başarıyla yüklendi.`);
    } else {
      console.log('Supabase status_presets tablosu boş, varsayılan presetler tohumlanıyor...');
      await seedDefaultStatusPresets();
    }
  } catch (err) {
    console.error('Status presets geri yüklenirken beklenmeyen hata:', err.message);
  }
}

async function seedDefaultStatusPresets() {
  try {
    const rowsToInsert = defaultStatusPresets.map(p => ({
      id: p.id,
      name: p.name,
      icon: p.icon,
      duration: p.duration,
      effects: p.effects
    }));
    const { error } = await supabase.from('status_presets').upsert(rowsToInsert);
    if (error) {
      if (error.code !== 'PGRST205') {
        console.error('Varsayılan status presetleri tohumlanırken hata:', error.message);
      }
    } else {
      console.log('Varsayılan status presetleri Supabase veritabanına kaydedildi.');
    }
  } catch (err) {
    console.error('Default status presets seed istisnası:', err.message);
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

// Sunucu başlamadan önce durumları geri yükle
Promise.all([restoreMapState(), restoreAttackPresets(), restoreStatusPresets()]).then(() => {
  server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda aktif!`);
  });
});