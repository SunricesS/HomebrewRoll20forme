console.log('Login JS yükleniyor... v2');

// === SUPABASE KURULUMU ===
const SUPABASE_URL = 'https://fjcnaofzetkoxuyrwfpw.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_oAFX73DbfClKaQVXg8-GSw_qbVX6bWk';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentProfile = null;
let currentCharacter = null;

// === UI ELEMENTLERİ ===
const roleSelectionModal = document.getElementById('role-selection');
const profileSelectionModal = document.getElementById('profile-selection');
const characterSelectionModal = document.getElementById('character-selection');
const characterCreationModal = document.getElementById('character-creation');
const profileListUI = document.getElementById('profile-list');
const characterListUI = document.getElementById('character-list');

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
}

window.showProfileSelection = function () {
    hideAllModals();
    profileSelectionModal.classList.remove('hidden');
    fetchProfiles();
}

window.showCharacterSelection = function () {
    hideAllModals();
    characterSelectionModal.classList.remove('hidden');
    if (currentProfile) fetchCharacters(currentProfile.id);
}

window.showCharacterCreation = function () {
    hideAllModals();
    characterCreationModal.classList.remove('hidden');
}

function startGameAs(role, characterData = null) {
    // Bilgileri tarayıcı hafızasına (sessionStorage) kaydet
    sessionStorage.setItem('dnd_role', role);
    if (currentProfile) sessionStorage.setItem('dnd_profile', JSON.stringify(currentProfile));
    if (characterData) sessionStorage.setItem('dnd_character', JSON.stringify(characterData));

    // Oyun sayfasına yönlendir
    window.location.href = '/game.html';
}

// === SUPABASE VERİ ÇEKME ===

async function fetchProfiles() {
    profileListUI.innerHTML = '<p>Profiller yükleniyor...</p>';

    const { data, error } = await supabaseClient.from('profiles').select('*');

    if (error) {
        console.error("Profilleri çekerken hata:", error);
        profileListUI.innerHTML = '<p style="color:red">Veri çekilemedi!</p>';
        return;
    }

    profileListUI.innerHTML = '';

    if (data.length === 0) {
        profileListUI.innerHTML = '<p>Hiç profil bulunamadı.</p>';
        return;
    }

    data.forEach(profile => {
        const div = document.createElement('div');
        div.className = 'list-item';
        div.innerHTML = `
            <span>${profile.username || "İsimsiz Kullanıcı"}</span>
            <span class="role">${profile.role || "player"}</span>
        `;
        div.onclick = () => {
            currentProfile = profile;
            showCharacterSelection();
        };
        profileListUI.appendChild(div);
    });
}

async function fetchCharacters(userId) {
    characterListUI.innerHTML = '<p>Karakterler yükleniyor...</p>';

    const { data, error } = await supabaseClient.from('characters').select('*').eq('user_id', userId);

    if (error) {
        console.error("Karakterleri çekerken hata:", error);
        characterListUI.innerHTML = '<p style="color:red">Karakterler çekilemedi!</p>';
        return;
    }

    characterListUI.innerHTML = '';

    if (data.length === 0) {
        characterListUI.innerHTML = '<p>Bu profile ait karakter bulunamadı. Lütfen yeni bir tane oluşturun.</p>';
        return;
    }

    data.forEach(char => {
        const div = document.createElement('div');
        div.className = 'list-item';
        div.innerHTML = `
            <span><strong>${char.name}</strong></span>
            <button class="btn success" style="padding: 5px 10px; font-size: 12px;">Seç</button>
        `;
        div.onclick = () => {
            currentCharacter = char;
            startGameAs('player', char);
        };
        characterListUI.appendChild(div);
    });
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

    const name = document.getElementById('char-name').value;
    const hpMax = parseInt(document.getElementById('char-hp-max').value);
    const avatarUrl = document.getElementById('char-avatar').value;

    const stats = {
        str: parseInt(document.getElementById('stat-str').value),
        dex: parseInt(document.getElementById('stat-dex').value),
        int: parseInt(document.getElementById('stat-int').value),
        con: parseInt(document.getElementById('stat-con').value),
        wis: parseInt(document.getElementById('stat-wis').value),
        chr: parseInt(document.getElementById('stat-chr').value)
    };

    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerText;
    submitBtn.innerText = "Kaydediliyor...";
    submitBtn.disabled = true;

    const { data, error } = await supabaseClient
        .from('characters')
        .insert([{
            user_id: currentProfile.id,
            name: name,
            hp_current: hpMax,
            hp_max: hpMax,
            stats: stats,
            avatar_url: avatarUrl || null
        }])
        .select();

    submitBtn.innerText = originalText;
    submitBtn.disabled = false;

    if (error) {
        console.error("Karakter oluşturulamadı:", error);
        alert("Karakter oluşturulurken bir hata oluştu: " + error.message);
    } else {
        e.target.reset();
        showCharacterSelection();
    }
});
