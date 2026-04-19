console.log('Login JS yükleniyor... v3');

// === YAPILANDIRMA ===
let currentProfile = null;
let currentCharacter = null;

// === UI ELEMENTLERİ ===
const roleSelectionModal = document.getElementById('role-selection');
const profileSelectionModal = document.getElementById('profile-selection');
const characterSelectionModal = document.getElementById('character-selection');
const characterCreationModal = document.getElementById('character-creation');
const profileListUI = document.getElementById('profile-list');
const characterListUI = document.getElementById('character-list');

// === YARDIMCI FONKSİYONLAR ===

/**
 * XSS koruması — kullanıcı girdilerini güvenli hale getirir.
 */
function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

// === MENÜ GEÇİŞ FONKSİYONLARI ===
function hideAllModals() {
  roleSelectionModal.classList.add('hidden');
  profileSelectionModal.classList.add('hidden');
  characterSelectionModal.classList.add('hidden');
  characterCreationModal.classList.add('hidden');
}

window.showRoleSelection = function () {
  hideAllModals();
  roleSelectionModal.classList.remove('hidden');
};

window.showProfileSelection = function () {
  hideAllModals();
  profileSelectionModal.classList.remove('hidden');
  fetchProfiles();
};

window.showCharacterSelection = function () {
  hideAllModals();
  characterSelectionModal.classList.remove('hidden');
  if (currentProfile) fetchCharacters(currentProfile.id);
};

window.showCharacterCreation = function () {
  hideAllModals();
  characterCreationModal.classList.remove('hidden');
};

function startGameAs(role, characterData = null) {
  // Bilgileri tarayıcı hafızasına (sessionStorage) kaydet
  sessionStorage.setItem('dnd_role', role);
  if (currentProfile) sessionStorage.setItem('dnd_profile', JSON.stringify(currentProfile));
  if (characterData) sessionStorage.setItem('dnd_character', JSON.stringify(characterData));

  // Oyun sayfasına yönlendir
  window.location.href = '/game.html';
}

// === SUNUCU API ÜZERİNDEN VERİ ÇEKME ===

async function fetchProfiles() {
  profileListUI.innerHTML = '<p>Profiller yükleniyor...</p>';

  try {
    const response = await fetch('/api/profiles');
    if (!response.ok) throw new Error('Sunucu hatası');
    const data = await response.json();

    profileListUI.innerHTML = '';

    if (!data || data.length === 0) {
      profileListUI.innerHTML = '<p>Hiç profil bulunamadı.</p>';
      return;
    }

    data.forEach(profile => {
      const div = document.createElement('div');
      div.className = 'list-item';

      const nameSpan = document.createElement('span');
      nameSpan.textContent = profile.username || 'İsimsiz Kullanıcı';

      const roleSpan = document.createElement('span');
      roleSpan.className = 'role';
      roleSpan.textContent = profile.role || 'player';

      div.appendChild(nameSpan);
      div.appendChild(roleSpan);

      div.addEventListener('click', () => {
        currentProfile = profile;
        showCharacterSelection();
      });

      profileListUI.appendChild(div);
    });
  } catch (err) {
    console.error("Profilleri çekerken hata:", err);
    profileListUI.innerHTML = '<p style="color:#e74c3c">Veri çekilemedi!</p>';
  }
}

async function fetchCharacters(userId) {
  characterListUI.innerHTML = '<p>Karakterler yükleniyor...</p>';

  try {
    const response = await fetch(`/api/characters/${encodeURIComponent(userId)}`);
    if (!response.ok) throw new Error('Sunucu hatası');
    const data = await response.json();

    characterListUI.innerHTML = '';

    if (!data || data.length === 0) {
      characterListUI.innerHTML = '<p>Bu profile ait karakter bulunamadı. Lütfen yeni bir tane oluşturun.</p>';
      return;
    }

    data.forEach(char => {
      const div = document.createElement('div');
      div.className = 'list-item';

      const nameSpan = document.createElement('span');
      const strong = document.createElement('strong');
      strong.textContent = char.name;
      nameSpan.appendChild(strong);

      const selectBtn = document.createElement('button');
      selectBtn.className = 'btn success';
      selectBtn.style.cssText = 'padding: 5px 10px; font-size: 12px;';
      selectBtn.textContent = 'Seç';

      div.appendChild(nameSpan);
      div.appendChild(selectBtn);

      div.addEventListener('click', () => {
        currentCharacter = char;
        startGameAs('player', char);
      });

      characterListUI.appendChild(div);
    });
  } catch (err) {
    console.error("Karakterleri çekerken hata:", err);
    characterListUI.innerHTML = '<p style="color:#e74c3c">Karakterler çekilemedi!</p>';
  }
}

// === EVENT LISTENER'LAR ===

document.getElementById('btn-dm-login').addEventListener('click', () => {
  currentProfile = { username: 'Dungeon Master', role: 'dm' };
  startGameAs('dm');
});

document.getElementById('btn-player-login').addEventListener('click', showProfileSelection);

document.getElementById('btn-create-character').addEventListener('click', showCharacterCreation);

// KARAKTER OLUŞTURMA
document.getElementById('form-create-character').addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!currentProfile) {
    alert("Lütfen önce bir profil seçin!");
    return showProfileSelection();
  }

  const name = document.getElementById('char-name').value.trim();
  const hpMax = parseInt(document.getElementById('char-hp-max').value);
  const avatarUrl = document.getElementById('char-avatar').value.trim();

  if (!name) {
    alert('Karakter adı boş olamaz!');
    return;
  }

  const stats = {
    str: parseInt(document.getElementById('stat-str').value) || 10,
    dex: parseInt(document.getElementById('stat-dex').value) || 10,
    int: parseInt(document.getElementById('stat-int').value) || 10,
    con: parseInt(document.getElementById('stat-con').value) || 10,
    wis: parseInt(document.getElementById('stat-wis').value) || 10,
    chr: parseInt(document.getElementById('stat-chr').value) || 10
  };

  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.innerText;
  submitBtn.innerText = "Kaydediliyor...";
  submitBtn.disabled = true;

  try {
    const response = await fetch('/api/characters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: currentProfile.id,
        name: name,
        hp_max: hpMax,
        stats: stats,
        avatar_url: avatarUrl || null
      })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Bilinmeyen hata');
    }

    e.target.reset();
    showCharacterSelection();
  } catch (err) {
    console.error("Karakter oluşturulamadı:", err);
    alert("Karakter oluşturulurken bir hata oluştu: " + err.message);
  } finally {
    submitBtn.innerText = originalText;
    submitBtn.disabled = false;
  }
});
