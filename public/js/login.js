console.log('Login JS loaded v3 with i18n support');

// === CONFIGURATION ===
let currentProfile = null;
let currentCharacter = null;

// === UI ELEMENTS ===
const roleSelectionModal = document.getElementById('role-selection');
const profileSelectionModal = document.getElementById('profile-selection');
const characterSelectionModal = document.getElementById('character-selection');
const characterCreationModal = document.getElementById('character-creation');
const profileListUI = document.getElementById('profile-list');
const characterListUI = document.getElementById('character-list');

// === HELPER FUNCTIONS ===

/**
 * XSS protection — sanitizes user strings.
 */
function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

function tr(key, params, fallback) {
  return typeof t === 'function' ? t(key, params, fallback) : (fallback || key);
}

// === MENU NAVIGATION FUNCTIONS ===
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
  // Store info in sessionStorage
  sessionStorage.setItem('dnd_role', role);
  if (currentProfile) sessionStorage.setItem('dnd_profile', JSON.stringify(currentProfile));
  if (characterData) sessionStorage.setItem('dnd_character', JSON.stringify(characterData));

  // Redirect to game page
  window.location.href = '/game.html';
}

// === FETCH DATA VIA REST API ===

async function fetchProfiles() {
  profileListUI.innerHTML = `<p>${tr('loading_profiles', {}, 'Loading profiles...')}</p>`;

  try {
    const response = await fetch('/api/profiles');
    if (!response.ok) throw new Error('Server error');
    const data = await response.json();

    profileListUI.innerHTML = '';

    if (!data || data.length === 0) {
      profileListUI.innerHTML = `<p>${tr('no_profiles_found', {}, 'No profiles found.')}</p>`;
      return;
    }

    data.forEach(profile => {
      const div = document.createElement('div');
      div.className = 'list-item';

      const nameSpan = document.createElement('span');
      nameSpan.textContent = profile.username || tr('unnamed_user', {}, 'Unnamed User');

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
    console.error("Error fetching profiles:", err);
    profileListUI.innerHTML = `<p style="color:#e74c3c">${tr('fetch_profiles_error', {}, 'Failed to fetch profiles!')}</p>`;
  }
}

async function fetchCharacters(userId) {
  characterListUI.innerHTML = `<p>${tr('loading_characters', {}, 'Loading characters...')}</p>`;

  try {
    const response = await fetch(`/api/characters/${encodeURIComponent(userId)}`);
    if (!response.ok) throw new Error('Server error');
    const data = await response.json();

    characterListUI.innerHTML = '';

    if (!data || data.length === 0) {
      characterListUI.innerHTML = `<p>${tr('no_characters_for_profile', {}, 'No characters found for this profile. Please create a new one.')}</p>`;
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
      selectBtn.textContent = tr('select_btn', {}, 'Select');

      div.appendChild(nameSpan);
      div.appendChild(selectBtn);

      div.addEventListener('click', () => {
        currentCharacter = char;
        startGameAs('player', char);
      });

      characterListUI.appendChild(div);
    });
  } catch (err) {
    console.error("Error fetching characters:", err);
    characterListUI.innerHTML = `<p style="color:#e74c3c">${tr('fetch_profiles_error', {}, 'Failed to fetch characters!')}</p>`;
  }
}

// === EVENT LISTENERS ===

document.getElementById('btn-dm-login').addEventListener('click', () => {
  currentProfile = { username: 'Dungeon Master', role: 'dm' };
  startGameAs('dm');
});

document.getElementById('btn-player-login').addEventListener('click', showProfileSelection);

document.getElementById('btn-create-character').addEventListener('click', showCharacterCreation);

// Re-render when language changes
window.addEventListener('dnd:languageChange', () => {
  if (!profileSelectionModal.classList.contains('hidden')) {
    fetchProfiles();
  }
  if (!characterSelectionModal.classList.contains('hidden') && currentProfile) {
    fetchCharacters(currentProfile.id);
  }
});

// CREATE CHARACTER
document.getElementById('form-create-character').addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!currentProfile) {
    alert(tr('alert_select_profile', {}, 'Please select a profile first!'));
    return showProfileSelection();
  }

  const name = document.getElementById('char-name').value.trim();
  const hpMax = parseInt(document.getElementById('char-hp-max').value);
  const avatarUrl = document.getElementById('char-avatar').value.trim();

  if (!name) {
    alert(tr('alert_name_empty', {}, 'Character name cannot be empty!'));
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
  submitBtn.innerText = tr('saving_progress', {}, 'Saving...');
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
      throw new Error(result.error || 'Unknown error');
    }

    e.target.reset();
    showCharacterSelection();
  } catch (err) {
    console.error("Error creating character:", err);
    alert(tr('alert_char_error', {}, 'Error creating character: ') + err.message);
  } finally {
    submitBtn.innerText = originalText;
    submitBtn.disabled = false;
  }
});
