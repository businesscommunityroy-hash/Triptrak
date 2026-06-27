// ─── STATE ───────────────────────────────────────────────────────────────────
const GOOGLE_CLIENT_ID = '730162655718-e46iif24nubvtastkkhfhc5l5ostq1n8.apps.googleusercontent.com';
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');
let googleToken = null;
let googleUser = null;
let tokenExpiresAt = parseInt(localStorage.getItem('triptrak_token_expires') || '0');
let _lastKnownDriveModified = 0;
let _lastSyncCheckTime = Date.now();
const STALE_SYNC_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutos
if (Date.now() < tokenExpiresAt) {
  googleToken = localStorage.getItem('triptrak_token') || null;
}

async function getValidToken() {
  const now = Date.now();

  if (googleToken && now < tokenExpiresAt) {
    return googleToken;
  }

  const silentToken = await new Promise((resolve) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: GOOGLE_SCOPES,
      prompt: '',
      callback: (response) => {
        if (response.error) {
          resolve(null);
        } else {
          resolve(response.access_token);
        }
      },
    });
    client.requestAccessToken();
  });

  if (silentToken) {
    googleToken = silentToken;
    tokenExpiresAt = Date.now() + 55 * 60 * 1000;
    window._driveToken = googleToken;
    localStorage.setItem('triptrak_token', googleToken);
    localStorage.setItem('triptrak_token_expires', tokenExpiresAt.toString());
    return googleToken;
  }

  const visibleToken = await new Promise((resolve) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: GOOGLE_SCOPES,
      callback: (response) => {
        if (response.error) {
          resolve(null);
        } else {
          resolve(response.access_token);
        }
      },
    });
    client.requestAccessToken();
  });
  if (visibleToken) {
    googleToken = visibleToken;
    tokenExpiresAt = Date.now() + 55 * 60 * 1000;
    window._driveToken = googleToken;
    localStorage.setItem('triptrak_token', googleToken);
    localStorage.setItem('triptrak_token_expires', tokenExpiresAt.toString());
  }
  return googleToken;
}

async function getValidTokenSilentOnly() {
  const now = Date.now();

  if (googleToken && now < tokenExpiresAt) {
    return googleToken;
  }

  const silentToken = await new Promise((resolve) => {
    let resolved = false;
    const safeResolve = (val) => {
      if (resolved) return;
      resolved = true;
      resolve(val);
    };

    // Safety timeout: si Safari u otro navegador bloquea el popup silencioso
    // y nunca llama al callback, nos rendimos despues de 4 segundos en vez
    // de dejar la app colgada en "Cargando..." para siempre.
    setTimeout(() => safeResolve(null), 4000);

    try {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: GOOGLE_SCOPES,
        prompt: '',
        callback: (response) => {
          if (response.error) {
            safeResolve(null);
          } else {
            safeResolve(response.access_token);
          }
        },
      });
      client.requestAccessToken();
    } catch (err) {
      console.warn('Error solicitando token silencioso:', err);
      safeResolve(null);
    }
  });

  if (silentToken) {
    googleToken = silentToken;
    tokenExpiresAt = Date.now() + 55 * 60 * 1000;
    window._driveToken = googleToken;
    localStorage.setItem('triptrak_token', googleToken);
    localStorage.setItem('triptrak_token_expires', tokenExpiresAt.toString());
    return googleToken;
  }

  return null;
}

const state = {
  user: null,
  trips: [],
  activeTrip: null,
  expenses: [],
  categories: [
    { id: 1, name: '🍽️ Desayuno', active: true },
    { id: 2, name: '🍽️ Comida', active: true },
    { id: 3, name: '🍽️ Cena', active: true },
    { id: 4, name: '🤝 Cena con cliente', active: true },
    { id: 5, name: '🏨 Hotel', active: true },
    { id: 6, name: '✈️ Vuelo', active: true },
    { id: 7, name: '🧳 Maletas / Equipaje', active: true },
    { id: 8, name: '🚕 Taxi / Uber', active: true },
    { id: 9, name: '🚗 Renta de auto', active: true },
    { id: 10, name: '⛽ Combustible', active: true },
    { id: 11, name: '🅿️ Estacionamiento', active: true },
    { id: 12, name: '🚌 Transporte público', active: true },
    { id: 13, name: '📦 Otro', active: true },
  ],
  pendingImage: null,
  selectedCategory: null,
};

// ─── ACTION LOG (debugging) ────────────────────────────────────────────────────
let actionLog = [];

function logAction(action, result, detail = '') {
  const entry = {
    timestamp: new Date().toISOString(),
    action,
    result, // 'success', 'pending', 'failed'
    detail,
  };
  actionLog.push(entry);
  if (actionLog.length > 100) actionLog.shift(); // mantener solo las últimas 100
  try {
    localStorage.setItem('triptrak_action_log', JSON.stringify(actionLog));
  } catch (e) {}
  console.log(`[LOG] ${action} → ${result}`, detail);
  updateSyncIndicator(result);
}

function updateSyncIndicator(result) {
  const indicator = document.getElementById('sync-indicator');
  if (!indicator) return;

  if (result === 'pending') {
    indicator.style.background = 'var(--yellow)';
  } else if (result === 'failed') {
    indicator.style.background = 'var(--red)';
  } else if (result === 'success') {
    indicator.style.background = 'var(--green)';
  }
}

function save() {
  const expensesWithoutImages = state.expenses.map(e => ({ ...e, image: null }));
  try {
    localStorage.setItem('triptrack', JSON.stringify({
      user: state.user,
      trips: state.trips,
      activeTrip: state.activeTrip,
      expenses: expensesWithoutImages,
      categories: state.categories,
    }));
  } catch (err) {
    console.warn('localStorage lleno, limpiando datos antiguos...');
    localStorage.removeItem('triptrack');
    localStorage.setItem('triptrack', JSON.stringify({
      user: state.user,
      trips: state.trips,
      activeTrip: state.activeTrip,
      expenses: expensesWithoutImages,
      categories: state.categories,
    }));
  }
  saveDataToDrive();
}

function load() {
  const data = localStorage.getItem('triptrack');
  if (!data) return;
  const parsed = JSON.parse(data);
  state.user = parsed.user || null;
  state.trips = parsed.trips || [];
  state.activeTrip = parsed.activeTrip || null;
  state.expenses = parsed.expenses || [];
  state.categories = parsed.categories || state.categories;
}

// ─── SCREEN NAVIGATION ───────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
  window.scrollTo(0, 0);
}

// ─── MODAL ───────────────────────────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function showToast(message, icon = '✅') {
  const toast = document.getElementById('toast');
  document.getElementById('toast-icon').textContent = icon;
  document.getElementById('toast-message').textContent = message;
  toast.style.display = 'flex';
  setTimeout(() => {
    toast.style.display = 'none';
  }, 2500);
}
function showLoading(text) {
  document.getElementById('loading-text').textContent = text;
  document.getElementById('loading-overlay').style.display = 'flex';
}
function hideLoading() {
  document.getElementById('loading-overlay').style.display = 'none';
}

// ─── INIT ────────────────────────────────────────────────────────────────────
function init() {
  load();

  if (!state.user) {
    showScreen('login');
  } else {
    showLoading('Cargando tus datos...');
    syncOnLoad();
  }

  bindEvents();
}

async function syncOnLoad() {
  const token = await getValidTokenSilentOnly();
  if (!token) {
    console.log('Sync al cargar: no se pudo obtener token silenciosamente, se omite esta vez.');
    hideLoading();
    autoDetectTrip();
    updateAvatars();
    renderHome();
    showScreen('home');
    alert('⚠️ No se pudo cargar la última versión de Drive automáticamente.\n\nAl aceptar, vamos a intentar sincronizar de nuevo (puede pedirte iniciar sesión con Google).');
    showLoading('Sincronizando con Drive...');
    const driveData = await loadDataFromDrive();
    if (driveData) {
      state.trips = driveData.trips || [];
      state.expenses = driveData.expenses || [];
      state.categories = driveData.categories || state.categories;
      if (driveData.profile) {
        state.user = { ...state.user, ...driveData.profile, initials: getInitials(driveData.profile.name) };
      }
      autoDetectTrip();
      renderHome();
      updateAvatars();
      showToast('Sincronizado correctamente', '🔄');
    }
    hideLoading();
    return;
  }

  const driveData = await loadDataFromDrive();
  if (driveData) {
    state.trips = driveData.trips || [];
    state.expenses = driveData.expenses || [];
    state.categories = driveData.categories || state.categories;
    if (driveData.profile) {
      state.user = { ...state.user, ...driveData.profile, initials: getInitials(driveData.profile.name) };
    }
  }

  autoDetectTrip();
  hideLoading();
  updateAvatars();
  renderHome();
  showScreen('home');
}

// ─── AUTO DETECT ACTIVE TRIP ─────────────────────────────────────────────────
function autoDetectTrip() {
  // Si el activeTrip actual ya no existe en la lista de trips, limpiarlo
  if (state.activeTrip && !state.trips.find(t => t.id === state.activeTrip.id)) {
    state.activeTrip = null;
  }

  if (state.trips.length === 0) return;
  const today = new Date().toISOString().split('T')[0];
  const active = state.trips.find(t => t.start <= today && t.end >= today);
  if (active && (!state.activeTrip || state.activeTrip.id !== active.id)) {
    state.activeTrip = active;
    save();
  }
}

// ─── NAVEGACION CENTRALIZADA ─────────────────────────────────────────────────
function goToHomeAndReleaseTrip() {
  state.activeTrip = null;
  save();
  renderHome();
  showScreen('home');
}

async function goToHistory() {
  showLoading('Sincronizando con Drive...');
  const driveData = await loadDataFromDrive();
  if (driveData) {
    state.trips = driveData.trips || [];
    state.expenses = driveData.expenses || [];
    state.categories = driveData.categories || state.categories;
  }
  hideLoading();
  renderHistory();
  showScreen('history');
}

function goToCapture() {
  showScreen('capture');
  const el = document.getElementById('capture-trip-label');
  if (el) el.textContent = state.activeTrip
    ? `${state.activeTrip.name} · ${formatDate(state.activeTrip.start)} → ${formatDate(state.activeTrip.end)}`
    : 'Tomá una foto o subí desde tu galería.';
}

// ─── BIND EVENTS ─────────────────────────────────────────────────────────────
function bindEvents() {

  // LOGIN
  document.getElementById('btn-login').addEventListener('click', () => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: GOOGLE_SCOPES,
      callback: async (response) => {
        if (response.error) return alert('Error al iniciar sesión con Google.');
        googleToken = response.access_token;
        tokenExpiresAt = Date.now() + 55 * 60 * 1000;
        window._driveToken = googleToken;
        localStorage.setItem('triptrak_token', googleToken);
        localStorage.setItem('triptrak_token_expires', tokenExpiresAt.toString());
        const userInfo = await fetchGoogleUserInfo(googleToken);
        googleUser = userInfo;

        showLoading('Sincronizando con Drive...');
        const driveData = await loadDataFromDrive();
        if (driveData) {
          state.trips = driveData.trips || [];
          state.expenses = driveData.expenses || [];
          state.categories = driveData.categories || state.categories;
        }
        hideLoading();

        const hasLocalProfile = state.user && state.user.email === userInfo.email;
        const hasDriveProfile = driveData && driveData.profile && driveData.profile.email === userInfo.email;

        if (hasLocalProfile || hasDriveProfile) {
          if (!hasLocalProfile && hasDriveProfile) {
            state.user = {
              name: driveData.profile.name,
              company: driveData.profile.company,
              email: driveData.profile.email,
              initials: getInitials(driveData.profile.name),
            };
            save();
          }
          updateAvatars();
          autoDetectTrip();
          renderHome();
          showScreen('home');
        } else {
          state.user = {
            name: userInfo.name,
            email: userInfo.email,
            initials: getInitials(userInfo.name),
            company: '',
          };
          document.getElementById('setup-name').value = userInfo.name;
          save();
          showScreen('setup');
        }
      },
    });
    client.requestAccessToken();
  });

  // SETUP
  document.getElementById('btn-setup-save').addEventListener('click', () => {
    const name = document.getElementById('setup-name').value.trim();
    const company = document.getElementById('setup-company').value.trim();
    if (!name) return alert('Ingresá tu nombre.');
    state.user = { name, company, initials: getInitials(name), email: googleUser ? googleUser.email : '' };
    save();
    updateAvatars();
    renderHome();
    showScreen('home');
  });

  // HOME → PROFILE
  document.getElementById('btn-profile').addEventListener('click', () => {
    document.getElementById('profile-name').value = state.user.name;
    document.getElementById('profile-company').value = state.user.company;
    document.getElementById('profile-name-view').textContent = `Nombre: ${state.user.name}`;
    document.getElementById('profile-company-view').textContent = `Empresa: ${state.user.company || 'Sin empresa'}`;
    document.getElementById('profile-view-mode').style.display = 'block';
    document.getElementById('profile-edit-mode').style.display = 'none';
    showScreen('profile');
  });
  document.getElementById('btn-profile-history').addEventListener('click', () => {
    document.getElementById('profile-name').value = state.user.name;
    document.getElementById('profile-company').value = state.user.company;
    document.getElementById('profile-name-view').textContent = `Nombre: ${state.user.name}`;
    document.getElementById('profile-company-view').textContent = `Empresa: ${state.user.company || 'Sin empresa'}`;
    document.getElementById('profile-view-mode').style.display = 'block';
    document.getElementById('profile-edit-mode').style.display = 'none';
    showScreen('profile');
  });

  // HOME → CAPTURE (centralizado)
  document.getElementById('btn-capture').addEventListener('click', goToCapture);
  document.getElementById('btn-capture-2').addEventListener('click', goToCapture);
  document.getElementById('btn-capture-analyze').addEventListener('click', goToCapture);
  document.getElementById('btn-capture-trip-expenses').addEventListener('click', goToCapture);
  document.getElementById('btn-capture-detail').addEventListener('click', goToCapture);

  // HOME → ANALYZE
  document.getElementById('btn-analyze').addEventListener('click', () => {
    renderAnalyze();
    showScreen('analyze');
  });

  // HOME → NEW TRIP
  document.getElementById('btn-new-trip').addEventListener('click', () => {
    openModal('modal-new-trip');
  });
  document.getElementById('btn-new-trip-history').addEventListener('click', () => {
    openModal('modal-new-trip');
  });
  document.getElementById('btn-cancel-trip').addEventListener('click', () => closeModal('modal-new-trip'));

  document.getElementById('new-trip-start').addEventListener('change', (e) => {
    const startDate = e.target.value;
    if (startDate) {
      const nextDay = new Date(startDate + 'T00:00:00');
      nextDay.setDate(nextDay.getDate() + 1);
      document.getElementById('new-trip-end').value = nextDay.toISOString().split('T')[0];
    }
    checkTripOverlap();
  });

  // HOME → CHANGE TRIP
  document.getElementById('btn-change-trip').addEventListener('click', async () => {
    showLoading('Sincronizando con Drive...');
    const driveData = await loadDataFromDrive();
    if (driveData) {
      state.trips = driveData.trips || [];
      state.expenses = driveData.expenses || [];
      state.categories = driveData.categories || state.categories;
    }
    hideLoading();
    renderChangeTripModal();
    openModal('modal-change-trip');
  });
  document.getElementById('btn-cancel-change-trip').addEventListener('click', () => closeModal('modal-change-trip'));

  // HOME → DRIVE
  document.getElementById('btn-view-drive').addEventListener('click', () => {
    if (state.activeTrip && state.activeTrip.driveUrl) {
      window.open(state.activeTrip.driveUrl, '_blank');
    } else {
      alert('Todavía no hay carpeta de Drive para este viaje. Se creará cuando guardes el primer recibo.');
    }
  });

  // QUICK EDIT desde Home
  document.getElementById('btn-edit-trip-quick').addEventListener('click', () => {
    if (!state.activeTrip) return alert('No hay viaje activo.');
    openTripDetail(state.activeTrip.id);
  });

  document.getElementById('btn-sync').addEventListener('click', async () => {
    showLoading('Sincronizando con Drive...');
    const driveData = await loadDataFromDrive();
    if (driveData) {
      state.trips = driveData.trips || [];
      state.expenses = driveData.expenses || [];
      state.categories = driveData.categories || state.categories;
      if (driveData.profile) {
        state.user = { ...state.user, ...driveData.profile, initials: getInitials(driveData.profile.name) };
      }
      autoDetectTrip();
      renderHome();
      updateAvatars();
      showToast('Sincronizado correctamente', '🔄');
    } else {
      alert('No se pudo sincronizar. Intentá de nuevo.');
    }
    hideLoading();
  });

  // GOOGLE CALENDAR (Home)
  document.getElementById('btn-add-calendar').addEventListener('click', async () => {
    if (!state.activeTrip) return alert('No hay viaje activo.');
    if (state.activeTrip.calendarEventId) {
      await removeFromGoogleCalendar(state.activeTrip);
    } else {
      addTripToGoogleCalendar(state.activeTrip);
    }
  });
  document.getElementById('btn-reminder-close').addEventListener('click', () => {
    document.getElementById('reminder').style.display = 'none';
  });

  // NEW TRIP — check overlap on date change
  document.getElementById('new-trip-end').addEventListener('change', checkTripOverlap);

  // CREATE TRIP
  document.getElementById('btn-create-trip').addEventListener('click', createTrip);

  // NAV → INICIO (centralizado, siempre suelta el viaje activo)
  document.getElementById('nav-home').addEventListener('click', goToHomeAndReleaseTrip);
  document.getElementById('nav-home-2').addEventListener('click', goToHomeAndReleaseTrip);
  document.getElementById('nav-home-analyze').addEventListener('click', goToHomeAndReleaseTrip);
  document.getElementById('nav-home-trip-expenses').addEventListener('click', goToHomeAndReleaseTrip);
  document.getElementById('nav-home-detail').addEventListener('click', goToHomeAndReleaseTrip);

  // NAV → HISTORIAL (centralizado, sincroniza antes de mostrar)
  document.getElementById('nav-history').addEventListener('click', goToHistory);
  document.getElementById('nav-history-2').addEventListener('click', goToHistory);
  document.getElementById('nav-history-analyze').addEventListener('click', goToHistory);
  document.getElementById('nav-history-trip-expenses').addEventListener('click', goToHistory);
  document.getElementById('nav-history-detail').addEventListener('click', goToHistory);

  // CAPTURE
  document.getElementById('upload-zone').addEventListener('click', () => {
    if (!state.activeTrip) {
      alert('Primero seleccioná o creá un viaje desde "Cambiar viaje".');
      return;
    }
    document.getElementById('file-input').click();
  });
  document.getElementById('file-input').addEventListener('change', (e) => {
    handleImageFile(e.target.files[0]);
  });
  document.getElementById('btn-gallery').addEventListener('click', () => {
    if (!state.activeTrip) {
      alert('Primero seleccioná o creá un viaje desde "Cambiar viaje".');
      return;
    }
    document.getElementById('gallery-input').click();
  });
  document.getElementById('gallery-input').addEventListener('change', (e) => {
    handleImageFile(e.target.files[0]);
  });
  document.getElementById('btn-multi').addEventListener('click', () => {
    if (!state.activeTrip) {
      alert('Primero seleccioná o creá un viaje desde "Cambiar viaje".');
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.addEventListener('change', (e) => {
      handleImageFile(e.target.files[0]);
    });
    input.click();
  });

  // DRAG & DROP
  const zone = document.getElementById('upload-zone');
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.style.borderColor = 'var(--accent)'; });
  zone.addEventListener('dragleave', () => { zone.style.borderColor = ''; });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.style.borderColor = '';
    if (e.dataTransfer.files[0]) handleImageFile(e.dataTransfer.files[0]);
  });

  // REVIEW — BACK
  document.getElementById('btn-review-back').addEventListener('click', () => showScreen('capture'));
  document.getElementById('btn-capture-back').addEventListener('click', () => showScreen('home'));

  // SAVE EXPENSE
  document.getElementById('btn-save-expense').addEventListener('click', saveExpense);

  // ANALYZE — BACK
  document.getElementById('btn-analyze-back').addEventListener('click', () => showScreen('home'));

  // PROFILE
  document.getElementById('btn-profile-back').addEventListener('click', goToHomeAndReleaseTrip);
  document.getElementById('btn-profile-save').addEventListener('click', () => {
    const name = document.getElementById('profile-name').value.trim();
    const company = document.getElementById('profile-company').value.trim();
    if (!name) return alert('Ingresá tu nombre.');
    state.user = { ...state.user, name, company, initials: getInitials(name) };
    save();
    updateAvatars();
    showToast('Perfil guardado correctamente', '✅');
    document.getElementById('profile-name-view').textContent = `Nombre: ${name}`;
    document.getElementById('profile-company-view').textContent = `Empresa: ${company || 'Sin empresa'}`;
    document.getElementById('profile-view-mode').style.display = 'block';
    document.getElementById('profile-edit-mode').style.display = 'none';
  });
  document.getElementById('btn-enable-edit-profile').addEventListener('click', () => {
    document.getElementById('profile-view-mode').style.display = 'none';
    document.getElementById('profile-edit-mode').style.display = 'block';
  });
  document.getElementById('btn-cancel-edit-profile').addEventListener('click', () => {
    document.getElementById('profile-view-mode').style.display = 'block';
    document.getElementById('profile-edit-mode').style.display = 'none';
  });
  document.getElementById('btn-categories').addEventListener('click', () => {
    renderCategories();
    showScreen('categories');
  });

  // MANUAL EXPENSE
  document.getElementById('btn-manual').addEventListener('click', async () => {
    if (!state.activeTrip) {
      alert('Primero seleccioná o creá un viaje desde "Cambiar viaje".');
      showScreen('home');
      return;
    }

    showLoading('Sincronizando con Drive...');
    const driveData = await loadDataFromDrive();
    if (driveData) {
      state.trips = driveData.trips || [];
      state.expenses = driveData.expenses || [];
      state.categories = driveData.categories || state.categories;
      autoDetectTrip();
    }
    hideLoading();

    // Verificar de nuevo despues de sincronizar: si el viaje activo se
    // elimino desde otra sesion mientras tanto, avisar y no dejar continuar
    // con un gasto que quedaria huerfano (sin viaje real al que pertenecer).
    if (!state.activeTrip) {
      alert('El viaje que tenías seleccionado ya no existe (probablemente lo eliminaste o lo eliminaron desde otro dispositivo). Seleccioná o creá un viaje para continuar.');
      renderHome();
      showScreen('home');
      return;
    }

    renderManualCategoryChips();
    const now = new Date();
    const localDate = new Date(now - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    document.getElementById('manual-datetime').value = localDate;
    document.getElementById('manual-amount').value = '';
    document.getElementById('manual-currency').value = 'USD';
    document.getElementById('manual-description').value = '';
    document.getElementById('manual-upload-zone').style.display = 'block';
    document.getElementById('manual-photo-preview').style.display = 'none';
    document.getElementById('manual-photo-thumb').src = '';
    state.pendingImage = null;
    document.getElementById('manual-screen-title').textContent = state.activeTrip
      ? `Gasto manual — ${state.activeTrip.name} (${formatDate(state.activeTrip.start)} → ${formatDate(state.activeTrip.end)})`
      : 'Gasto manual';
    showScreen('manual');
  });
  document.getElementById('btn-manual-back').addEventListener('click', () => showScreen('capture'));

  // MANUAL PHOTO
  document.getElementById('manual-upload-zone').addEventListener('click', () => {
    document.getElementById('manual-file-input').click();
  });
  document.getElementById('manual-file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      state.pendingImage = { dataUrl: ev.target.result, file };
      document.getElementById('manual-photo-thumb').src = ev.target.result;
      document.getElementById('photo-fullscreen-img').src = ev.target.result;
      document.getElementById('manual-photo-preview').style.display = 'block';
      document.getElementById('manual-upload-zone').style.display = 'none';
    };
    reader.readAsDataURL(file);
  });
  document.getElementById('btn-save-manual').addEventListener('click', saveManualExpense);
  document.getElementById('btn-trip-expenses-back').addEventListener('click', () => showScreen('manage-trips'));
  document.getElementById('btn-trip-detail-back').addEventListener('click', goToHomeAndReleaseTrip);

  // TRIP DETAIL — edit toggle
  document.getElementById('btn-enable-edit').addEventListener('click', () => {
    document.getElementById('detail-view-mode').style.display = 'none';
    document.getElementById('detail-edit-mode').style.display = 'block';
  });
  document.getElementById('btn-cancel-edit-trip').addEventListener('click', () => {
    document.getElementById('detail-view-mode').style.display = 'block';
    document.getElementById('detail-edit-mode').style.display = 'none';
  });

  // TRIP DETAIL — save (UNICA copia)
  document.getElementById('btn-save-trip-detail').addEventListener('click', async () => {
    const trip = state.trips.find(t => t.id === window._detailTripId);
    if (!trip) return;

    const newName = document.getElementById('detail-trip-name').value.trim();
    const newStart = document.getElementById('detail-trip-start').value;
    const newEnd = document.getElementById('detail-trip-end').value;

    if (!newName || !newStart || !newEnd) return alert('Completá todos los campos.');
    if (newStart > newEnd) return alert('La fecha de inicio debe ser antes que la de fin.');

    const expenses = getTripExpenses(trip.id);
    const outOfRange = expenses.filter(e => e.date < newStart || e.date > newEnd);
    if (outOfRange.length > 0) {
      return alert(`No podés cambiar las fechas porque ${outOfRange.length} gasto(s) quedarían fuera del rango.`);
    }

    const idx = state.trips.findIndex(t => t.id === trip.id);
    state.trips[idx] = { ...trip, name: newName, start: newStart, end: newEnd };
    if (state.activeTrip && state.activeTrip.id === trip.id) {
      state.activeTrip = state.trips[idx];
    }
    save();

    showLoading('Actualizando Drive y Sheet...');
    await getValidToken();

    if (googleToken) {
      if (trip.driveFolderId) {
        try {
          await fetch(`https://www.googleapis.com/drive/v3/files/${trip.driveFolderId}`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${googleToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: `${newStart}_${newName}` }),
          });
        } catch (err) { console.error('Error renombrando carpeta:', err); }
      }
      if (trip.sheetId) {
        try {
          await fetch(`https://www.googleapis.com/drive/v3/files/${trip.sheetId}`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${googleToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: `${newStart}_${newName}` }),
          });
        } catch (err) { console.error('Error renombrando sheet:', err); }
      }
    }

    hideLoading();
    showToast('Viaje actualizado correctamente', '✅');
    openTripDetail(trip.id);
    renderHome();
  });

  // TRIP DETAIL — delete (UNICA copia)
  document.getElementById('btn-detail-delete-trip').addEventListener('click', async () => {
    await deleteTrip(window._detailTripId);
    showScreen('home');
  });

  // TRIP DETAIL — drive (UNICA copia)
  document.getElementById('btn-detail-drive').addEventListener('click', () => {
    const trip = state.trips.find(t => t.id === window._detailTripId);
    if (trip && trip.driveUrl) window.open(trip.driveUrl, '_blank');
  });

  // TRIP DETAIL — calendar (UNICA copia)
  document.getElementById('btn-detail-calendar').addEventListener('click', async () => {
    const trip = state.trips.find(t => t.id === window._detailTripId);
    if (!trip) return;
    if (trip.calendarEventId) {
      await removeFromGoogleCalendar(trip);
    } else {
      await addTripToGoogleCalendar(trip);
    }
    openTripDetail(trip.id);
  });

  // TRIP DETAIL — toggle expenses list (UNICA copia)
  document.getElementById('btn-toggle-expenses').addEventListener('click', () => {
    const list = document.getElementById('detail-expenses-list');
    list.style.display = list.style.display === 'none' ? 'block' : 'none';
  });

  // EXPENSE DETAIL — back
  document.getElementById('btn-expense-detail-back').addEventListener('click', () => {
    const trip = state.trips.find(t => t.id === window._detailTripId);
    if (trip) openTripDetail(trip.id);
  });

  // EXPENSE DETAIL — save
  document.getElementById('btn-save-expense-detail').addEventListener('click', async () => {
    const expense = state.expenses.find(e => e.id === window._detailExpenseId);
    if (!expense) return;

    const newDate = document.getElementById('expense-detail-date').value;
    const newAmount = document.getElementById('expense-detail-amount').value;
    const newCurrency = document.getElementById('expense-detail-currency').value;
    const newDescription = document.getElementById('expense-detail-description').value;
    const newCategory = window._detailSelectedCategory;

    if (!newDate || !newAmount) return alert('Completá fecha y monto.');

    const trip = state.trips.find(t => t.id === expense.tripId);
    if (trip && (newDate < trip.start || newDate > trip.end)) {
      return alert(`⚠️ La fecha está fuera del rango del viaje (${formatDate(trip.start)} → ${formatDate(trip.end)}).`);
    }

    const idx = state.expenses.findIndex(e => e.id === expense.id);
    let newAmountUSD = newAmount;
    if (newCurrency !== 'USD') {
      try {
        const res = await fetch(`https://api.exchangerate-api.com/v4/latest/${newCurrency}`);
        const data = await res.json();
        const rate = data.rates['USD'];
        if (rate) newAmountUSD = (parseFloat(newAmount) * rate).toFixed(2);
      } catch { newAmountUSD = newAmount; }
    } else {
      newAmountUSD = parseFloat(newAmount).toFixed(2);
    }

    state.expenses[idx] = {
      ...expense,
      date: newDate,
      datetime: formatDate(newDate),
      amountOrig: newAmount,
      currency: newCurrency,
      amountUSD: newAmountUSD,
      description: newDescription,
      category: newCategory,
    };
    save();

    if (trip && trip.sheetId) {
      await updateExpenseInSheet(state.expenses[idx], trip.sheetId);
    }

    showToast('Gasto actualizado correctamente', '✅');
    openExpenseDetail(expense.id);
  });

  document.getElementById('btn-enable-edit-expense').addEventListener('click', () => {
    document.getElementById('expense-detail-view-mode').style.display = 'none';
    document.getElementById('expense-detail-edit-mode').style.display = 'block';
  });
  document.getElementById('btn-cancel-edit-expense').addEventListener('click', () => {
    document.getElementById('expense-detail-view-mode').style.display = 'block';
    document.getElementById('expense-detail-edit-mode').style.display = 'none';
  });
  document.getElementById('btn-delete-expense-detail').addEventListener('click', async () => {
    const expense = state.expenses.find(e => e.id === window._detailExpenseId);
    if (!expense) return;

    const confirmDelete = confirm(`¿Eliminar este gasto de ${expense.category} por $${expense.amountUSD}?`);
    if (!confirmDelete) return;

    const trip = state.trips.find(t => t.id === expense.tripId);

    if (expense.driveFileId) {
      await getValidToken();
      try {
        await fetch(`https://www.googleapis.com/drive/v3/files/${expense.driveFileId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${googleToken}` },
        });
      } catch (err) { console.error('Error eliminando foto:', err); }
    }

    if (trip && trip.sheetId) {
      await deleteExpenseFromSheet(expense.id, trip.sheetId);
    }

    state.expenses = state.expenses.filter(e => e.id !== expense.id);
    save();

    showToast('Gasto eliminado correctamente', '🗑️');
    if (trip) openTripDetail(trip.id);
  });

  document.getElementById('btn-manage-trips-back').addEventListener('click', () => showScreen('profile'));

  // DEV MODE TOGGLE
  const devToggle = document.getElementById('toggle-dev-mode');
  const devSlider = document.getElementById('dev-toggle-slider');
  const devTools = document.getElementById('dev-tools');

  function updateDevToggleUI(enabled) {
    devTools.style.display = enabled ? 'block' : 'none';
    devSlider.style.background = enabled ? 'var(--accent)' : 'var(--border)';
  }

  const savedDevMode = localStorage.getItem('triptrak_dev_mode') === 'true';
  devToggle.checked = savedDevMode;
  updateDevToggleUI(savedDevMode);

  devToggle.addEventListener('change', () => {
    localStorage.setItem('triptrak_dev_mode', devToggle.checked);
    updateDevToggleUI(devToggle.checked);
  });

  document.getElementById('btn-diagnostic').addEventListener('click', runDiagnostic);
  document.getElementById('btn-view-log').addEventListener('click', () => {
    const log = actionLog.slice().reverse().slice(0, 20);
    if (log.length === 0) {
      alert('No hay acciones registradas todavía en esta sesión.');
      return;
    }
    let report = '📋 ÚLTIMAS 20 ACCIONES (más reciente primero):\n\n';
    log.forEach(entry => {
      const icon = entry.result === 'success' ? '✅' : entry.result === 'failed' ? '❌' : '⏳';
      const time = new Date(entry.timestamp).toLocaleTimeString('es');
      report += `${icon} [${time}] ${entry.action}\n   ${entry.detail}\n\n`;
    });
    console.log(report);
    alert(report);
  });

  // CATEGORIES
  document.getElementById('btn-categories-back').addEventListener('click', () => showScreen('profile'));
  document.getElementById('btn-add-category').addEventListener('click', addCategory);
  document.getElementById('new-category-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addCategory();
  });

  document.getElementById('btn-logout').addEventListener('click', () => {
    const confirmLogout = confirm('¿Cerrar sesión? Vas a tener que volver a iniciar sesión con Google.');
    if (!confirmLogout) return;
    localStorage.clear();
    googleToken = null;
    window._driveToken = null;
    window._driveFileId = null;
    tokenExpiresAt = 0;
    location.reload();
  });
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function getInitials(name) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function updateAvatars() {
  const initials = state.user ? state.user.initials || '?' : '?';
  document.getElementById('btn-profile').textContent = initials;
  document.getElementById('btn-profile-history').textContent = initials;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' });
}

function tripDayInfo(trip) {
  const today = new Date();
  const start = new Date(trip.start + 'T00:00:00');
  const end = new Date(trip.end + 'T23:59:59');
  const total = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
  const elapsed = Math.max(1, Math.min(Math.round((today - start) / (1000 * 60 * 60 * 24)) + 1, total));
  return { total, elapsed };
}

function getTripExpenses(tripId) {
  return state.expenses.filter(e => e.tripId === tripId);
}

function getCategoryTotals(expenses) {
  const totals = {};
  expenses.forEach(e => {
    totals[e.category] = (totals[e.category] || 0) + (parseFloat(e.amountUSD) || 0);
  });
  return totals;
}

// ─── RENDER HOME ─────────────────────────────────────────────────────────────
function renderHome() {
  const trip = state.activeTrip;
  const nameEl = document.getElementById('home-trip-name');
  const datesEl = document.getElementById('home-trip-dates');
  const suggestionsEl = document.getElementById('home-no-trip-suggestions');

  if (!trip) {
    if (state.trips.length > 0) {
      nameEl.textContent = 'No hay viaje seleccionado';
      datesEl.innerHTML = `Tienes ${state.trips.length} viaje(s) creados.<br>Tocá "Seleccionar viaje" para elegir uno.`;
      renderHomeNoTripSuggestions();
      suggestionsEl.style.display = 'block';
    } else {
      nameEl.textContent = 'No hay viajes disponibles';
      datesEl.textContent = 'Creá un nuevo viaje para empezar';
      suggestionsEl.style.display = 'none';
    }
  } else {
    const { total, elapsed } = tripDayInfo(trip);
    nameEl.textContent = 'Viaje: ' + trip.name;
    const isUpcoming = trip.start > new Date().toISOString().split('T')[0];
    const statusText = isUpcoming ? 'Próximo' : `En curso · Día ${elapsed} de ${total}`;
    datesEl.innerHTML = `Fechas: ${formatDate(trip.start)} → ${formatDate(trip.end)}<br>Estado: ${statusText}`;
    suggestionsEl.style.display = 'none';
  }

  renderStatsGrid();
  renderExpensesList();
  checkReminder();

  const changeBtn = document.getElementById('btn-change-trip');
  if (changeBtn) {
    changeBtn.textContent = trip ? '🔄 Cambiar viaje' : '✈️ Seleccionar viaje';
  }

  const tripOnlyButtons = ['btn-analyze', 'btn-view-drive', 'btn-edit-trip-quick', 'btn-add-calendar'];
  tripOnlyButtons.forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.style.display = trip ? 'inline-flex' : 'none';
  });

  const calBtn = document.getElementById('btn-add-calendar');
  if (calBtn) {
    if (trip && trip.calendarEventId) {
      calBtn.textContent = '🗑️ Quitar de Calendar';
    } else {
      calBtn.textContent = '📅 Agregar a Calendar';
    }
  }
}

function renderHomeNoTripSuggestions() {
  const today = new Date().toISOString().split('T')[0];
  const container = document.getElementById('home-no-trip-suggestions');

  const upcoming = state.trips.filter(t => t.start > today).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 3);
  const past = state.trips.filter(t => t.end < today).sort((a, b) => b.end.localeCompare(a.end)).slice(0, 3);

  const listToShow = upcoming.length > 0 ? upcoming : past;
  const label = upcoming.length > 0 ? 'Próximos viajes' : 'Viajes recientes';

  if (listToShow.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <p class="section-title" style="padding:0 0 10px;">${label}</p>
    ${listToShow.map(t => `
      <div class="history-item" onclick="openTripDetail(${t.id})" style="cursor:pointer;">
        <p class="history-name">${t.name}</p>
        <p class="history-dates">${formatDate(t.start)} → ${formatDate(t.end)}</p>
      </div>
    `).join('')}
  `;
}

function renderStatsGrid() {
  const grid = document.getElementById('stats-grid');
  if (!state.activeTrip) { grid.innerHTML = ''; return; }

  const expenses = getTripExpenses(state.activeTrip.id);
  const totals = getCategoryTotals(expenses);
  const activeCats = Object.keys(totals);

  if (activeCats.length === 0) {
    grid.innerHTML = '<p style="color:var(--text2);font-size:13px;padding:0 0 8px;">Aún no hay gastos registrados.</p>';
    return;
  }

  grid.innerHTML = activeCats.map(cat => {
    const match = cat.match(/^([^\sa-zA-ZÀ-ÿ]+)\s*/);
    const icon = match ? match[1] : '📦';
    return `
    <div class="stat-card">
      <div class="stat-icon">${icon}</div>
      <p class="stat-val">$${totals[cat].toFixed(2)}</p>
      <p class="stat-label">${cat.replace(/^[^a-zA-ZÀ-ÿ]+/, '')}</p>
    </div>
  `;
  }).join('');
}

function renderExpensesList() {
  const list = document.getElementById('expenses-list');
  if (!state.activeTrip) { list.innerHTML = ''; return; }

  const expenses = getTripExpenses(state.activeTrip.id).slice().reverse().slice(0, 10);

  if (expenses.length === 0) {
    list.innerHTML = '<div class="empty-state">📭<p>No hay recibos aún.<br>Tocá el botón de cámara para empezar.</p></div>';
    return;
  }

  const icons = { '🍽️ Comida': { icon: '🍽️', color: 'rgba(46,204,143,0.1)' }, '🏨 Hotel': { icon: '🏨', color: 'rgba(124,92,252,0.1)' }, '✈️ Vuelo': { icon: '✈️', color: 'rgba(79,127,255,0.1)' }, '⛽ Combustible': { icon: '⛽', color: 'rgba(79,127,255,0.1)' }, '🚕 Transporte': { icon: '🚕', color: 'rgba(245,166,35,0.1)' }, '🎭 Entretenimiento': { icon: '🎭', color: 'rgba(255,92,92,0.1)' }, '📦 Otro': { icon: '📦', color: 'rgba(139,144,167,0.1)' } };

  list.innerHTML = expenses.map(e => {
    const meta = icons[e.category] || { icon: '📦', color: 'rgba(139,144,167,0.1)' };
    return `
      <div class="expense-item">
        <div class="exp-icon" style="background:${meta.color};">${meta.icon}</div>
        <div class="exp-info">
          <p class="exp-concept">${e.description || e.category}</p>
          <p class="exp-date">${e.datetime}</p>
        </div>
        <div class="exp-amount">
          <p class="exp-usd">$${parseFloat(e.amountUSD).toFixed(2)}</p>
          <p class="exp-orig">${e.currency !== 'USD' ? e.amountOrig + ' ' + e.currency : 'USD'}</p>
        </div>
      </div>
    `;
  }).join('');
}

function checkReminder() {
  const reminder = document.getElementById('reminder');
  const reminderText = document.getElementById('reminder-text-wrap');
  const today = new Date().toISOString().split('T')[0];

  // Buscamos el viaje "del dia": el activo si esta en curso hoy, o si no
  // hay activo, cualquier viaje cuyas fechas incluyan hoy. Mismo mensaje
  // siempre, sin importar como se llego al Home.
  let todayTrip = null;
  if (state.activeTrip && state.activeTrip.start <= today && state.activeTrip.end >= today) {
    todayTrip = state.activeTrip;
  } else {
    todayTrip = state.trips.find(t => t.start <= today && t.end >= today) || null;
  }

  if (todayTrip) {
    const expenses = getTripExpenses(todayTrip.id);
    const todayExpenses = expenses.filter(e => e.date === today);
    if (todayExpenses.length === 0) {
      reminderText.innerHTML = `Viaje "${todayTrip.name}" · ${formatDate(todayTrip.start)} → ${formatDate(todayTrip.end)} está activo. ¿Querés cargar gastos? <span id="btn-reminder-add-expense" style="color:var(--accent); text-decoration:underline; cursor:pointer; font-weight:600;">Agregar gasto</span>`;
      reminder.style.display = 'flex';
      document.getElementById('btn-reminder-add-expense').onclick = () => {
        state.activeTrip = todayTrip;
        save();
        goToCapture();
      };
      return;
    }
  }

  reminder.style.display = 'none';
}

// ─── TRIP OVERLAP ─────────────────────────────────────────────────────────────
function checkTripOverlap() {
  const start = document.getElementById('new-trip-start').value;
  const end = document.getElementById('new-trip-end').value;
  if (!start || !end) return;

  const overlap = state.trips.some(t => !(end < t.start || start > t.end));
  document.getElementById('modal-overlap-alert').style.display = overlap ? 'block' : 'none';
}

async function createTrip() {
  const btn = document.getElementById('btn-create-trip');
  if (btn.disabled) return;
  btn.disabled = true;
  btn.textContent = 'Creando...';

  const name = document.getElementById('new-trip-name').value.trim();
  const start = document.getElementById('new-trip-start').value;
  const end = document.getElementById('new-trip-end').value;

  if (!name || !start || !end) {
    btn.disabled = false;
    btn.textContent = 'Crear viaje →';
    return alert('Completá todos los campos.');
  }
  if (start > end) {
    btn.disabled = false;
    btn.textContent = 'Crear viaje →';
    return alert('La fecha de inicio debe ser antes que la de fin.');
  }
  const today = new Date().toISOString().split('T')[0];
  if (end < today) {
    const continuar = confirm(`⚠️ Las fechas de este viaje ya pasaron. ¿Querés crearlo de todas formas?`);
    if (!continuar) {
      btn.disabled = false;
      btn.textContent = 'Crear viaje →';
      return;
    }
  }

  // Verificar duplicado exacto (mismo nombre + mismas fechas)
  const exactDuplicate = state.trips.find(t => t.name.toLowerCase() === name.toLowerCase() && t.start === start && t.end === end);
  if (exactDuplicate) {
    const continuar = confirm(`⚠️ Ya existe un viaje "${name}" con esas mismas fechas. ¿Querés crear uno duplicado de todas formas?`);
    if (!continuar) {
      btn.disabled = false;
      btn.textContent = 'Crear viaje →';
      return;
    }
  }

  const trip = { id: Date.now(), name, start, end, driveUrl: null };
  state.trips.push(trip);
  state.activeTrip = trip;
  save();

  document.getElementById('new-trip-name').value = '';
  document.getElementById('new-trip-start').value = '';
  document.getElementById('new-trip-end').value = '';
  document.getElementById('modal-overlap-alert').style.display = 'none';
  closeModal('modal-new-trip');

  renderHome();
  showLoading('Creando carpeta en Drive y hoja de gastos...');
  await createDriveFolder(trip);
  hideLoading();

  btn.disabled = false;
  btn.textContent = 'Crear viaje →';
}

// ─── IMAGE HANDLING ───────────────────────────────────────────────────────────
function handleImageFile(file) {
  if (!file) return;
  if (!state.activeTrip) {
    alert('Primero creá un viaje.');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    compressImage(e.target.result, (compressedDataUrl) => {
      state.pendingImage = { dataUrl: compressedDataUrl, file };
      showReviewScreen(compressedDataUrl);
      processImageWithAI(compressedDataUrl);
    });
  };
  reader.readAsDataURL(file);
}

function compressImage(dataUrl, callback) {
  const img = new Image();
  img.onload = () => {
    const maxWidth = 1200;
    const scale = Math.min(1, maxWidth / img.width);
    const canvas = document.createElement('canvas');
    canvas.width = img.width * scale;
    canvas.height = img.height * scale;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const compressed = canvas.toDataURL('image/jpeg', 0.7);
    callback(compressed);
  };
  img.src = dataUrl;
}

function showReviewScreen(dataUrl) {
  const photo = document.getElementById('review-photo');
  photo.innerHTML = `<img src="${dataUrl}" alt="Recibo">`;
  document.getElementById('field-date').value = '';
  document.getElementById('field-amount').value = 'Obteniendo Datos con AI...';
  document.getElementById('field-currency').value = 'Obteniendo Datos con AI...';
  document.getElementById('field-usd').value = 'Obteniendo Datos con AI...';
  document.getElementById('field-description').value = 'Obteniendo Datos con AI...';
  renderCategoryChips();
  showScreen('review');
  const label = document.getElementById('review-trip-label');
  if (label) {
    label.textContent = state.activeTrip
      ? `${state.activeTrip.name} · ${formatDate(state.activeTrip.start)} → ${formatDate(state.activeTrip.end)}`
      : 'La IA extrajo esta información. Corregí si algo está mal.';
  }
}

// ─── AI PROCESSING ────────────────────────────────────────────────────────────
async function processImageWithAI(dataUrl) {
  const base64 = dataUrl.split(',')[1];
  const mediaType = dataUrl.split(';')[0].split(':')[1];

  try {
    const response = await fetch('/api/analyze-receipt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: base64,
        mediaType: mediaType,
      })
    });

    const data = await response.json();
    const text = data.content[0].text.trim();
    const clean = text.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);
    console.log('Resultado AI:', result);

    if (result.dateISO) {
      document.getElementById('field-date').value = result.dateISO;
    }
    document.getElementById('field-amount').value = result.amountOrig || '';
    document.getElementById('field-currency').value = result.currency || 'USD';
    document.getElementById('field-description').value = result.description || '';

    await convertToUSD(result.amountOrig, result.currency);
    preselectCategory(result.category);

  } catch (err) {
    console.error('AI error:', err);
    document.getElementById('field-amount').value = '';
    document.getElementById('field-currency').value = 'USD';
    document.getElementById('field-usd').value = '';
    document.getElementById('field-description').value = '';
    alert('No se pudo leer el recibo automáticamente. Ingresá los datos manualmente.');
  }
}

// ─── CURRENCY CONVERSION ─────────────────────────────────────────────────────
async function convertToUSD(amount, currency) {
  if (!amount || !currency) return;
  if (currency === 'USD') {
    document.getElementById('field-usd').value = parseFloat(amount).toFixed(2);
    return;
  }

  try {
    const res = await fetch(`https://api.exchangerate-api.com/v4/latest/${currency}`);
    const data = await res.json();
    const rate = data.rates['USD'];
    if (rate) {
      const usd = (parseFloat(amount) * rate).toFixed(2);
      document.getElementById('field-usd').value = usd;
    }
  } catch {
    document.getElementById('field-usd').value = amount;
  }
}

// ─── CATEGORY CHIPS ──────────────────────────────────────────────────────────
function renderCategoryChips() {
  const container = document.getElementById('category-chips');
  const active = state.categories.filter(c => c.active);
  state.selectedCategory = null;

  container.innerHTML = active.map(c =>
    `<div class="chip" data-cat="${c.name}" onclick="selectChip(this)">${c.name}</div>`
  ).join('') + `<div id="otro-field" style="display:none; width:100%; margin-top:8px;">
      <input type="text" id="otro-input" placeholder="Escribi el concepto..."
        style="background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:12px 14px; width:100%; color:var(--text); font-family:Inter,sans-serif; font-size:14px; outline:none;">
    </div>`;
}

function selectChip(el) {
  document.querySelectorAll('#category-chips .chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  state.selectedCategory = el.dataset.cat;
  const otroField = document.getElementById('otro-field');
  if (el.dataset.cat === '📦 Otro') {
    otroField.style.display = 'block';
    document.getElementById('otro-input').focus();
  } else {
    otroField.style.display = 'none';
  }
}

function preselectCategory(aiCategory) {
  if (!aiCategory) return;
  const chips = document.querySelectorAll('#category-chips .chip');
  chips.forEach(chip => {
    if (chip.dataset.cat.toLowerCase().includes(aiCategory.toLowerCase())) {
      chip.classList.add('active');
      state.selectedCategory = chip.dataset.cat;
    }
  });
}

// ─── SAVE EXPENSE ─────────────────────────────────────────────────────────────
async function saveExpense() {
  const btn = document.getElementById('btn-save-expense');
  if (btn.disabled) return;
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  if (!state.activeTrip) {
    btn.disabled = false;
    btn.textContent = 'Guardar recibo →';
    alert('Ya no hay un viaje activo (puede haberse eliminado desde otro dispositivo). El gasto no se guardó.');
    renderHome();
    showScreen('home');
    return;
  }

  if (!state.selectedCategory) {
    btn.disabled = false;
    btn.textContent = 'Guardar recibo →';
    return alert('Seleccioná un tipo de gasto.');
  }

  let category = state.selectedCategory;
  if (category === '📦 Otro') {
    const otroVal = document.getElementById('otro-input') ? document.getElementById('otro-input').value.trim() : '';
    if (!otroVal) {
      btn.disabled = false;
      btn.textContent = 'Guardar recibo →';
      return alert('Escribí el concepto del gasto.');
    }
    category = '📦 ' + otroVal;
  }

  const datetime = document.getElementById('field-date').value;
  const amountOrig = document.getElementById('field-amount').value;
  const currency = document.getElementById('field-currency').value;
  const amountUSD = document.getElementById('field-usd').value;
  const description = document.getElementById('field-description').value;

  if (!amountOrig) {
    btn.disabled = false;
    btn.textContent = 'Guardar recibo →';
    return alert('Ingresá el monto.');
  }

  if (state.activeTrip) {
    const expDate = document.getElementById('field-date').value;
    const date = expDate ? expDate.split(',')[0].trim() : '';
    if (date && (date < state.activeTrip.start || date > state.activeTrip.end)) {
      btn.disabled = false;
      btn.textContent = 'Guardar recibo →';
      return alert(`⚠️ La fecha está fuera del rango del viaje (${formatDate(state.activeTrip.start)} → ${formatDate(state.activeTrip.end)}). No podés guardar este gasto.`);
    }
  }

  const expense = {
    id: Date.now(),
    tripId: state.activeTrip.id,
    datetime,
    date: datetime,
    amountOrig,
    currency,
    amountUSD,
    description,
    category,
    image: null,
  };

  logAction('saveExpense', 'pending', `Creando gasto ${expense.id}, monto: ${amountUSD}`);
  state.expenses.push(expense);
  save();

  if (state.activeTrip.sheetId) {
    await appendExpenseToSheet(expense, state.activeTrip.sheetId);
  }

  if (state.pendingImage && state.activeTrip.driveFolderId) {
    await uploadPhotoToDrive(expense, state.pendingImage.dataUrl);
  }

  logAction('saveExpense', 'success', `Gasto ${expense.id} guardado completamente`);
  state.pendingImage = null;
  btn.disabled = false;
  btn.textContent = 'Guardar recibo →';
  renderHome();
  showScreen('home');
  showToast('Gasto guardado correctamente');
}

// ─── ANALYZE ─────────────────────────────────────────────────────────────────
function renderAnalyze() {
  if (!state.activeTrip) return;
  const trip = state.activeTrip;
  const expenses = getTripExpenses(trip.id);
  const { total, elapsed } = tripDayInfo(trip);

  document.getElementById('analyze-trip-name').textContent = trip.name;

  const totalSpent = expenses.reduce((s, e) => s + (parseFloat(e.amountUSD) || 0), 0);
  const daysWithExpenses = new Set(expenses.map(e => e.date)).size;
  const avgPerDay = daysWithExpenses > 0 ? totalSpent / daysWithExpenses : 0;
  const projection = avgPerDay * total;

  document.getElementById('analyze-stats').innerHTML = `
    <div class="stat-card">
      <div class="stat-icon">💰</div>
      <p class="stat-val">$${totalSpent.toFixed(2)}</p>
      <p class="stat-label">Total gastado</p>
    </div>
    <div class="stat-card">
      <div class="stat-icon">📅</div>
      <p class="stat-val">Día ${elapsed} de ${total}</p>
      <p class="stat-label">Progreso del viaje</p>
    </div>
    <div class="stat-card">
      <div class="stat-icon">📊</div>
      <p class="stat-val">$${avgPerDay.toFixed(2)}</p>
      <p class="stat-label">Promedio por día</p>
    </div>
  `;

  const totals = getCategoryTotals(expenses);
  const maxVal = Math.max(...Object.values(totals), 1);
  document.getElementById('analyze-categories').innerHTML = Object.entries(totals).map(([cat, val]) => `
    <div class="analyze-bar-row">
      <div class="analyze-bar-label">
        <span>${cat}</span>
        <span>$${val.toFixed(2)}</span>
      </div>
      <div class="analyze-bar-track">
        <div class="analyze-bar-fill" style="width:${(val / maxVal * 100).toFixed(0)}%"></div>
      </div>
    </div>
  `).join('') || '<p style="color:var(--text2);font-size:13px;">Sin gastos aún.</p>';

  const dayMap = {};
  expenses.forEach(e => {
    const d = e.date || 'Sin fecha';
    dayMap[d] = (dayMap[d] || 0) + (parseFloat(e.amountUSD) || 0);
  });

  document.getElementById('analyze-days').innerHTML = Object.entries(dayMap).sort().map(([day, val]) => `
    <div class="day-row">
      <span class="day-label">${formatDate(day)}</span>
      <span class="day-amount">$${val.toFixed(2)}</span>
    </div>
  `).join('') || '<p style="color:var(--text2);font-size:13px;">Sin gastos aún.</p>';
}

// ─── HISTORY ─────────────────────────────────────────────────────────────────
function renderHistory() {
  const list = document.getElementById('history-list');
  if (state.trips.length === 0) {
    list.innerHTML = '<div class="empty-state">🗂️<p>No hay viajes anteriores.</p></div>';
    return;
  }

  list.innerHTML = state.trips.slice().reverse().map(trip => {
    const expenses = getTripExpenses(trip.id);
    const total = expenses.reduce((s, e) => s + (parseFloat(e.amountUSD) || 0), 0);
    return `
      <div class="history-item" onclick="openTripDetail(${trip.id})" style="cursor:pointer;">
        <p class="history-name">${trip.name}</p>
        <p class="history-dates">${formatDate(trip.start)} → ${formatDate(trip.end)}</p>
        <p class="history-total">$${total.toFixed(2)} USD</p>
      </div>
    `;
  }).join('');
}

// ─── CATEGORIES MANAGEMENT ───────────────────────────────────────────────────
function renderCategories() {
  const list = document.getElementById('categories-list');
  list.innerHTML = state.categories.map((c, i) => `
    <div class="category-item ${c.active ? '' : 'inactive'}">
      <span class="category-name">${c.name}</span>
      <div class="category-actions">
        <button class="btn-icon" onclick="toggleCategory(${i})" title="${c.active ? 'Desactivar' : 'Activar'}">
          ${c.active ? '✅' : '⭕'}
        </button>
        <button class="btn-icon danger" onclick="deleteCategory(${i})" title="Eliminar">🗑️</button>
      </div>
    </div>
  `).join('');
}

function toggleCategory(idx) {
  state.categories[idx].active = !state.categories[idx].active;
  save();
  renderCategories();
}

function deleteCategory(idx) {
  if (!confirm(`¿Eliminar "${state.categories[idx].name}"?`)) return;
  state.categories.splice(idx, 1);
  save();
  renderCategories();
}

function addCategory() {
  const input = document.getElementById('new-category-input');
  const name = input.value.trim();
  if (!name) return;
  state.categories.push({ id: Date.now(), name, active: true });
  save();
  input.value = '';
  renderCategories();
}

function renderManualCategoryChips() {
  const container = document.getElementById('manual-category-chips');
  const active = state.categories.filter(c => c.active);
  state.selectedCategory = null;

  container.innerHTML = active.map(c =>
    `<div class="chip" data-cat="${c.name}" onclick="selectManualChip(this)">${c.name}</div>`
  ).join('') + `
    <div id="manual-otro-field" style="display:none; width:100%; margin-top:8px;">
      <input type="text" id="manual-otro-input" placeholder="Escribí el concepto..."
        style="background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:12px 14px; width:100%; color:var(--text); font-family:Inter,sans-serif; font-size:14px; outline:none;">
    </div>
  `;
}

function selectManualChip(el) {
  document.querySelectorAll('#manual-category-chips .chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  state.selectedCategory = el.dataset.cat;
  const otroField = document.getElementById('manual-otro-field');
  if (el.dataset.cat === '📦 Otro') {
    otroField.style.display = 'block';
    document.getElementById('manual-otro-input').focus();
  } else {
    otroField.style.display = 'none';
  }
}

async function saveManualExpense() {
  const btn = document.getElementById('btn-save-manual');
  if (btn.disabled) return;
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  if (!state.activeTrip) {
    btn.disabled = false;
    btn.textContent = 'Guardar gasto →';
    alert('Ya no hay un viaje activo (puede haberse eliminado desde otro dispositivo mientras completabas el formulario). El gasto no se guardó.');
    renderHome();
    showScreen('home');
    return;
  }

  if (!state.selectedCategory) {
    btn.disabled = false;
    btn.textContent = 'Guardar gasto →';
    return alert('Seleccioná un tipo de gasto.');
  }

  let category = state.selectedCategory;
  if (category === '📦 Otro') {
    const otroVal = document.getElementById('manual-otro-input').value.trim();
    if (!otroVal) {
      btn.disabled = false;
      btn.textContent = 'Guardar gasto →';
      return alert('Escribí el concepto del gasto.');
    }
    category = '📦 ' + otroVal;
  }

  const datetimeVal = document.getElementById('manual-datetime').value;
  const amountOrig = document.getElementById('manual-amount').value;
  const currency = document.getElementById('manual-currency').value.toUpperCase();
  const description = document.getElementById('manual-description').value;

  if (!amountOrig) {
    btn.disabled = false;
    btn.textContent = 'Guardar gasto →';
    return alert('Ingresá el monto.');
  }
  if (!datetimeVal) {
    btn.disabled = false;
    btn.textContent = 'Guardar gasto →';
    return alert('Ingresá la fecha.');
  }
  if (state.activeTrip) {
    const date = datetimeVal;
    if (date < state.activeTrip.start || date > state.activeTrip.end) {
      btn.disabled = false;
      btn.textContent = 'Guardar gasto →';
      return alert(`⚠️ La fecha está fuera del rango del viaje (${formatDate(state.activeTrip.start)} → ${formatDate(state.activeTrip.end)}). No podés guardar este gasto.`);
    }
  }

  const date = datetimeVal;
  const datetime = formatDate(date);

  let amountUSD = amountOrig;
  if (currency !== 'USD') {
    try {
      const res = await fetch(`https://api.exchangerate-api.com/v4/latest/${currency}`);
      const data = await res.json();
      const rate = data.rates['USD'];
      if (rate) amountUSD = (parseFloat(amountOrig) * rate).toFixed(2);
    } catch { amountUSD = amountOrig; }
  }

  const expense = {
    id: Date.now(),
    tripId: state.activeTrip.id,
    datetime,
    date,
    amountOrig,
    currency,
    amountUSD,
    description,
    category,
    image: null,
  };

  logAction('saveManualExpense', 'pending', `Creando gasto ${expense.id}, monto: ${amountUSD}`);
  state.expenses.push(expense);
  save();

  if (state.activeTrip.sheetId) {
    await appendExpenseToSheet(expense, state.activeTrip.sheetId);
  }

  if (state.pendingImage && state.activeTrip.driveFolderId) {
    await uploadPhotoToDrive(expense, state.pendingImage.dataUrl);
  }

  logAction('saveManualExpense', 'success', `Gasto ${expense.id} guardado completamente`);
  state.pendingImage = null;
  btn.disabled = false;
  btn.textContent = 'Guardar gasto →';
  renderHome();
  showScreen('home');
  showToast('Gasto guardado correctamente');
}

// ─── GOOGLE CALENDAR ─────────────────────────────────────────────────────────
async function addTripToGoogleCalendar(trip) {
  const token = await getValidToken();
  if (!token) return alert('Error al conectar con Google.');
  await createCalendarEvent(trip, token);
}

async function createCalendarEvent(trip, token) {
  const endDate = new Date(trip.end + 'T00:00:00');
  endDate.setDate(endDate.getDate() + 1);
  const endDateStr = endDate.toISOString().split('T')[0];

  const event = {
    summary: `✈️ ${trip.name}`,
    start: { date: trip.start },
    end: { date: endDateStr },
    description: 'Viaje registrado en TripTrak.',
  };

  try {
    const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    });

    const data = await res.json();
    if (data.id) {
      trip.calendarEventId = data.id;
      const idx = state.trips.findIndex(t => t.id === trip.id);
      if (idx !== -1) state.trips[idx] = trip;
      if (state.activeTrip && state.activeTrip.id === trip.id) state.activeTrip = trip;
      save();
      showToast(`Viaje "${trip.name}" agregado a Calendar`, '📅');
      renderHome();
    } else {
      alert('No se pudo crear el evento. Intentá de nuevo.');
    }
  } catch (err) {
    console.error(err);
    alert('Error al conectar con Google Calendar.');
  }
}

async function fetchGoogleUserInfo(token) {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${token}` }
  });
  return await res.json();
}

// ─── GOOGLE DRIVE ─────────────────────────────────────────────────────────────
async function createDriveFolder(trip) {
  logAction('createDriveFolder', 'pending', `Iniciando para viaje: ${trip.name}`);
  await getValidToken();

  if (!googleToken) {
    logAction('createDriveFolder', 'failed', 'No se obtuvo googleToken');
    alert('No se pudo conectar con Google. Intentá de nuevo.');
    return;
  }

  try {
    const searchRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=name='TripTrak' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      { headers: { Authorization: `Bearer ${googleToken}` } }
    );
    const searchData = await searchRes.json();

    let rootFolderId;
    if (searchData.files && searchData.files.length > 0) {
      rootFolderId = searchData.files[0].id;
    } else {
      const rootRes = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${googleToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'TripTrak',
          mimeType: 'application/vnd.google-apps.folder',
        }),
      });
      const rootData = await rootRes.json();
      rootFolderId = rootData.id;
    }

    const tripRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${googleToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `${trip.start}_${trip.name}`,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [rootFolderId],
      }),
    });
    const tripData = await tripRes.json();

    if (!tripData.id) {
      logAction('createDriveFolder', 'failed', `Drive no devolvió ID de carpeta. Respuesta: ${JSON.stringify(tripData)}`);
      alert('Viaje creado pero no se pudo crear la carpeta en Drive. Intentá de nuevo desde Administrar viajes.');
      return;
    }

    trip.driveFolderId = tripData.id;
    trip.driveUrl = `https://drive.google.com/drive/folders/${tripData.id}`;

    const idx = state.trips.findIndex(t => t.id === trip.id);
    if (idx !== -1) state.trips[idx] = trip;
    if (state.activeTrip && state.activeTrip.id === trip.id) state.activeTrip = trip;
    save();

    await createTripSheet(trip);

    logAction('createDriveFolder', 'success', `Carpeta creada: ${tripData.id}`);
    showToast(`Viaje "${trip.name}" creado correctamente`, '✅');
  } catch (err) {
    console.error(err);
    logAction('createDriveFolder', 'failed', `Excepción: ${err.message}`);
    alert('Viaje creado pero no se pudo crear la carpeta en Drive. Intentá de nuevo.');
  }
}

async function uploadPhotoToDrive(expense, dataUrl) {
  await getValidToken();
  if (!googleToken) return;

  try {
    console.log('Subiendo foto...', expense, dataUrl ? 'tiene imagen' : 'sin imagen');
    const base64 = dataUrl.split(',')[1];
    const mimeType = dataUrl.split(';')[0].split(':')[1];
    const ext = mimeType.split('/')[1];
    const fileName = `${expense.date}_${expense.category.replace(/[^a-zA-Z0-9]/g, '')}_${expense.amountUSD}USD.${ext}`;

    const metadata = {
      name: fileName,
      parents: [state.activeTrip.driveFolderId],
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));

    const byteChars = atob(base64);
    const byteArr = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
    form.append('file', new Blob([byteArr], { type: mimeType }));

    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { Authorization: `Bearer ${googleToken}` },
      body: form,
    });

    const data = await res.json();
    if (data.id) {
      expense.driveFileId = data.id;
      const idx = state.expenses.findIndex(e => e.id === expense.id);
      if (idx !== -1) state.expenses[idx] = expense;
      save();
    }
  } catch (err) {
    console.error('Error subiendo foto a Drive:', err);
  }
}

function renderChangeTripModal() {
  const today = new Date().toISOString().split('T')[0];
  const active = state.trips.filter(t => t.end >= today);
  const past = state.trips.filter(t => t.end < today);

  const renderTrip = (trip) => `
    <div class="history-item" onclick="selectTrip(${trip.id})">
      <p class="history-name">${trip.name}</p>
      <p class="history-dates">${formatDate(trip.start)} → ${formatDate(trip.end)}</p>
      ${state.activeTrip && state.activeTrip.id === trip.id ? '<p style="font-size:11px;color:var(--accent);margin-top:4px;">● Viaje actual</p>' : ''}
    </div>
  `;

  const activeEl = document.getElementById('change-trip-active');
  const pastEl = document.getElementById('change-trip-past');

  activeEl.innerHTML = active.length > 0
    ? active.map(renderTrip).join('')
    : '<p style="color:var(--text2);font-size:13px;padding:8px 0;">No hay viajes activos o próximos.</p>';

  pastEl.innerHTML = past.length > 0
    ? past.map(renderTrip).join('')
    : '<p style="color:var(--text2);font-size:13px;padding:8px 0;">No hay viajes anteriores.</p>';
}

function selectTrip(id) {
  const trip = state.trips.find(t => t.id === id);
  if (!trip) return;
  state.activeTrip = trip;
  save();
  closeModal('modal-change-trip');
  openTripDetail(id);
}

// ─── GOOGLE SHEETS ───────────────────────────────────────────────────────────
async function createTripSheet(trip) {
  await getValidToken();
  if (!googleToken) return;
  try {
    const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${googleToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: { title: `${trip.start}_${trip.name}` },
        sheets: [
          { properties: { title: 'Detalle', sheetId: 0 } },
          { properties: { title: 'Resumen', sheetId: 1 } },
        ],
      }),
    });

    const sheetData = await createRes.json();
    const sheetId = sheetData.spreadsheetId;

    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Detalle!A1:I1?valueInputOption=RAW`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${googleToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: [['Fecha', 'Tipo de gasto', 'Descripción', 'Moneda original', 'Monto original', 'Monto USD', 'Notas', 'Recibo', 'ID (no editar)']],
      }),
    });

    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${googleToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          {
            repeatCell: {
              range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.31, green: 0.5, blue: 1.0 },
                  textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
                  horizontalAlignment: 'CENTER',
                },
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
            },
          },
          {
            updateSheetProperties: {
              properties: { sheetId: 0, gridProperties: { frozenRowCount: 1 } },
              fields: 'gridProperties.frozenRowCount',
            },
          },
          {
            setBasicFilter: {
              filter: {
                range: { sheetId: 0, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: 9 },
              },
            },
          },
          {
            autoResizeDimensions: {
              dimensions: { sheetId: 0, dimension: 'COLUMNS', startIndex: 0, endIndex: 9 },
            },
          },
        ],
      }),
    });

    await fetch(`https://www.googleapis.com/drive/v3/files/${sheetId}?addParents=${trip.driveFolderId}&removeParents=root`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${googleToken}`,
        'Content-Type': 'application/json',
      },
    });

    trip.sheetId = sheetId;
    trip.sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}`;
    const idx = state.trips.findIndex(t => t.id === trip.id);
    if (idx !== -1) state.trips[idx] = trip;
    if (state.activeTrip && state.activeTrip.id === trip.id) state.activeTrip = trip;
    save();

  } catch (err) {
    console.error('Error creando Sheet:', err);
  }
}

async function appendExpenseToSheet(expense, sheetId) {
  logAction('appendExpenseToSheet', 'pending', `Gasto: ${expense.id}, monto: ${expense.amountUSD}`);
  await getValidToken();
  if (!window._driveToken) window._driveToken = googleToken;
  if (!googleToken) {
    logAction('appendExpenseToSheet', 'failed', 'No se obtuvo googleToken');
    return;
  }

  try {
    const receiptUrl = expense.driveFileId
      ? `https://drive.google.com/file/d/${expense.driveFileId}/view`
      : '';

    const row = [
      expense.date,
      expense.category.replace(/^[^a-zA-ZÀ-ÿ]+/, ''),
      expense.description || '',
      expense.currency,
      expense.amountOrig,
      expense.amountUSD,
      '',
      receiptUrl,
      expense.id,
    ];

    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Detalle!A:I:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${googleToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [row] }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      logAction('appendExpenseToSheet', 'failed', `HTTP ${res.status}: ${errBody}`);
      return;
    }

    logAction('appendExpenseToSheet', 'success', `Gasto ${expense.id} agregado al Sheet`);
  } catch (err) {
    console.error('Error agregando fila al Sheet:', err);
    logAction('appendExpenseToSheet', 'failed', `Excepción: ${err.message}`);
  }
}

async function findRowByExpenseId(sheetId, expenseId) {
  if (!googleToken) return null;
  try {
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Detalle!I:I`, {
      headers: { Authorization: `Bearer ${googleToken}` },
    });
    const data = await res.json();
    if (!data.values) return null;
    const rowIndex = data.values.findIndex(row => row[0] === String(expenseId));
    return rowIndex === -1 ? null : rowIndex + 1; // +1 porque Sheets es 1-indexed
  } catch (err) {
    console.error('Error buscando fila:', err);
    return null;
  }
}

async function updateExpenseInSheet(expense, sheetId) {
  await getValidToken();
  if (!googleToken) return;

  const rowNum = await findRowByExpenseId(sheetId, expense.id);
  if (!rowNum) {
    console.warn('No se encontró la fila en el Sheet para actualizar.');
    return;
  }

  const receiptUrl = expense.driveFileId
    ? `https://drive.google.com/file/d/${expense.driveFileId}/view`
    : '';

  const row = [
    expense.date,
    expense.category,
    expense.description || '',
    expense.currency,
    expense.amountOrig,
    expense.amountUSD,
    '',
    receiptUrl,
    expense.id,
  ];

  try {
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Detalle!A${rowNum}:I${rowNum}?valueInputOption=RAW`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${googleToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [row] }),
    });
  } catch (err) {
    console.error('Error actualizando fila en Sheet:', err);
  }
}

async function deleteExpenseFromSheet(expenseId, sheetId) {
  await getValidToken();
  if (!googleToken) return;

  const rowNum = await findRowByExpenseId(sheetId, expenseId);
  if (!rowNum) {
    console.warn('No se encontró la fila en el Sheet para eliminar.');
    return;
  }

  try {
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${googleToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [{
          deleteDimension: {
            range: {
              sheetId: 0,
              dimension: 'ROWS',
              startIndex: rowNum - 1,
              endIndex: rowNum,
            },
          },
        }],
      }),
    });
  } catch (err) {
    console.error('Error eliminando fila en Sheet:', err);
  }
}

// ─── MANAGE TRIPS ─────────────────────────────────────────────────────────────
function renderManageTrips() {
  const list = document.getElementById('manage-trips-list');
  if (state.trips.length === 0) {
    list.innerHTML = '<div class="empty-state">🗺️<p>No hay viajes todavía.</p></div>';
    return;
  }

  list.innerHTML = state.trips.slice().reverse().map(trip => {
    const expenses = getTripExpenses(trip.id);
    const total = expenses.reduce((s, e) => s + (parseFloat(e.amountUSD) || 0), 0);
    const isActive = state.activeTrip && state.activeTrip.id === trip.id;
    return `
      <div class="history-item" style="${isActive ? 'border-color:var(--accent);' : ''}">
        <p class="history-name">${trip.name} ${isActive ? '● Activo' : ''}</p>
        <p class="history-dates">${formatDate(trip.start)} → ${formatDate(trip.end)}</p>
        <p class="history-total">$${total.toFixed(2)} USD · ${expenses.length} gastos</p>
        <div style="display:flex;gap:8px;margin-top:12px;">
          <button class="btn-sm" onclick="openTripDetail(${trip.id})">✏️ Editar / Ver</button>
          <button class="btn-sm danger" onclick="deleteTrip(${trip.id})" style="color:var(--red);border-color:var(--red);">🗑️ Eliminar</button>
        </div>
      </div>
    `;
  }).join('');
}

async function deleteTrip(id) {
  const trip = state.trips.find(t => t.id === id);
  if (!trip) return;

  const confirm1 = confirm(`¿Eliminar el viaje "${trip.name}"? Se eliminarán todos los gastos y la carpeta en Drive.`);
  if (!confirm1) return;

  await getValidToken();
  if (trip.driveFolderId) {
    try {
      await fetch(`https://www.googleapis.com/drive/v3/files/${trip.driveFolderId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${googleToken}` },
      });
    } catch (err) {
      console.error('Error eliminando carpeta en Drive:', err);
    }
  }

  if (trip.calendarEventId) {
    try {
      await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${trip.calendarEventId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${googleToken}` },
      });
    } catch (err) {
      console.error('Error eliminando evento de Calendar:', err);
    }
  }

  state.expenses = state.expenses.filter(e => e.tripId !== id);
  state.trips = state.trips.filter(t => t.id !== id);

  if (state.activeTrip && state.activeTrip.id === id) {
    state.activeTrip = state.trips.length > 0 ? state.trips[state.trips.length - 1] : null;
  }

  save();
  renderManageTrips();
  renderHome();
  showToast(`Viaje "${trip.name}" eliminado`, '🗑️');
}

function openPhotoFullscreen() {
  document.getElementById('photo-fullscreen').style.display = 'flex';
}

function closePhotoFullscreen() {
  document.getElementById('photo-fullscreen').style.display = 'none';
}

function removeManualPhoto() {
  state.pendingImage = null;
  document.getElementById('manual-photo-preview').style.display = 'none';
  document.getElementById('manual-photo-thumb').src = '';
  document.getElementById('photo-fullscreen-img').src = '';
  document.getElementById('manual-upload-zone').style.display = 'block';
}

async function removeFromGoogleCalendar(trip) {
  await getValidToken();

  try {
    await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${trip.calendarEventId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${googleToken}` },
    });

    trip.calendarEventId = null;
    const idx = state.trips.findIndex(t => t.id === trip.id);
    if (idx !== -1) state.trips[idx] = trip;
    if (state.activeTrip && state.activeTrip.id === trip.id) state.activeTrip = trip;
    save();
    showToast('Quitado de Google Calendar', '🗑️');
    renderHome();
  } catch (err) {
    console.error('Error quitando evento de Calendar:', err);
    alert('No se pudo quitar el evento. Intentá de nuevo.');
  }
}

// ─── DRIVE JSON SOURCE OF TRUTH ────────────────────────────────────────────────
async function findOrCreateDataFile() {
  await getValidToken();
  if (!googleToken) return null;

  try {
    const searchFolder = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=name='TripTrak' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      { headers: { Authorization: `Bearer ${googleToken}` } }
    );
    const folderData = await searchFolder.json();

    let rootFolderId;
    if (folderData.files && folderData.files.length > 0) {
      rootFolderId = folderData.files[0].id;
    } else {
      const createFolder = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${googleToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'TripTrak',
          mimeType: 'application/vnd.google-apps.folder',
        }),
      });
      const newFolder = await createFolder.json();
      rootFolderId = newFolder.id;
    }

    const searchFile = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=name='triptrak-data.json' and '${rootFolderId}' in parents and trashed=false`,
      { headers: { Authorization: `Bearer ${googleToken}` } }
    );
    const fileData = await searchFile.json();

    if (fileData.files && fileData.files.length > 0) {
      return { fileId: fileData.files[0].id, rootFolderId };
    }

    const emptyData = { trips: [], expenses: [], categories: state.categories, lastModified: Date.now() };
    const metadata = {
      name: 'triptrak-data.json',
      parents: [rootFolderId],
      mimeType: 'application/json',
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', new Blob([JSON.stringify(emptyData)], { type: 'application/json' }));

    const createFile = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { Authorization: `Bearer ${googleToken}` },
      body: form,
    });
    const newFile = await createFile.json();

    return { fileId: newFile.id, rootFolderId };

  } catch (err) {
    console.error('Error en findOrCreateDataFile:', err);
    return null;
  }
}

async function loadDataFromDrive() {
  const fileInfo = await findOrCreateDataFile();
  if (!fileInfo) return null;

  try {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileInfo.fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${googleToken}` },
    });
    const data = await res.json();
    window._driveFileId = fileInfo.fileId;
    _lastKnownDriveModified = data.lastModified || 0;
    _lastSyncCheckTime = Date.now();
    return data;
  } catch (err) {
    console.error('Error leyendo JSON de Drive:', err);
    return null;
  }
}

async function saveDataToDrive() {
  logAction('saveDataToDrive', 'pending', `Trips: ${state.trips.length}, Expenses: ${state.expenses.length}`);
  await getValidToken();
  if (!googleToken) {
    logAction('saveDataToDrive', 'failed', 'No se obtuvo googleToken');
    return;
  }

  if (!window._driveFileId) {
    const fileInfo = await findOrCreateDataFile();
    if (!fileInfo) {
      logAction('saveDataToDrive', 'failed', 'findOrCreateDataFile devolvió null');
      return;
    }
    window._driveFileId = fileInfo.fileId;
  }

  // Verificar si Drive tiene una version mas reciente que la que conocemos
  try {
    const checkRes = await fetch(`https://www.googleapis.com/drive/v3/files/${window._driveFileId}?alt=media`, {
      headers: { Authorization: `Bearer ${googleToken}` },
    });
    const currentDriveData = await checkRes.json();
    const driveModified = currentDriveData.lastModified || 0;

    if (driveModified > _lastKnownDriveModified) {
      logAction('saveDataToDrive', 'failed', `CONFLICTO: Drive tiene version mas reciente (${driveModified}) que la conocida (${_lastKnownDriveModified})`);
      alert('⚠️ Los datos cambiaron en otro dispositivo.\n\nVamos a sincronizar y te vamos a llevar al Inicio.');
      logAction('saveDataToDrive', 'pending', 'Conflicto detectado, sincronizando automaticamente');
      const freshData = await loadDataFromDrive();
      if (freshData) {
        state.trips = freshData.trips || [];
        state.expenses = freshData.expenses || [];
        state.categories = freshData.categories || state.categories;
        autoDetectTrip();
        showToast('Sincronizado con los datos correctos', '🔄');
      }
      renderHome();
      showScreen('home');
      return;
    }
  } catch (err) {
    console.warn('No se pudo verificar version actual de Drive antes de guardar:', err);
  }

  const now = Date.now();
  const dataToSave = {
    trips: state.trips,
    expenses: state.expenses.map(e => ({ ...e, image: null })),
    categories: state.categories,
    profile: { name: state.user.name, company: state.user.company, email: state.user.email },
    lastModified: now,
  };

  try {
    const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${window._driveFileId}?uploadType=media`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${googleToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(dataToSave),
    });

    if (!res.ok) {
      const errBody = await res.text();
      logAction('saveDataToDrive', 'failed', `HTTP ${res.status}: ${errBody}`);
      return;
    }

    _lastKnownDriveModified = now;
    logAction('saveDataToDrive', 'success', `Guardado: ${state.trips.length} viajes, ${state.expenses.length} gastos`);
  } catch (err) {
    console.error('Error guardando JSON en Drive:', err);
    logAction('saveDataToDrive', 'failed', `Excepción: ${err.message}`);
  }
}

async function runDiagnostic() {
  showLoading('Comparando memoria vs Drive...');

  const memoryTrips = state.trips;
  const memoryExpenses = state.expenses;

  const driveData = await loadDataFromDrive();

  hideLoading();

  if (!driveData) {
    alert('❌ No se pudo leer el JSON de Drive. Revisá la conexión o el token.');
    return;
  }

  const driveTrips = driveData.trips || [];
  const driveExpenses = driveData.expenses || [];

  const memoryTripIds = new Set(memoryTrips.map(t => t.id));
  const driveTripIds = new Set(driveTrips.map(t => t.id));

  const inMemoryNotInDrive = memoryTrips.filter(t => !driveTripIds.has(t.id));
  const inDriveNotInMemory = driveTrips.filter(t => !memoryTripIds.has(t.id));

  const memoryExpenseIds = new Set(memoryExpenses.map(e => e.id));
  const driveExpenseIds = new Set(driveExpenses.map(e => e.id));

  const expensesInMemoryNotInDrive = memoryExpenses.filter(e => !driveExpenseIds.has(e.id));
  const expensesInDriveNotInMemory = driveExpenses.filter(e => !memoryExpenseIds.has(e.id));

  let report = `🔍 DIAGNÓSTICO\n\n`;
  report += `Viajes en memoria: ${memoryTrips.length}\n`;
  report += `Viajes en Drive: ${driveTrips.length}\n\n`;

  if (inMemoryNotInDrive.length > 0) {
    report += `⚠️ EN MEMORIA pero NO en Drive (riesgo de pérdida):\n`;
    inMemoryNotInDrive.forEach(t => report += `  - ${t.name} (${t.start})\n`);
    report += `\n`;
  }

  if (inDriveNotInMemory.length > 0) {
    report += `ℹ️ EN DRIVE pero no en memoria (normal si se creó en otro dispositivo):\n`;
    inDriveNotInMemory.forEach(t => report += `  - ${t.name} (${t.start})\n`);
    report += `\n`;
  }

  if (expensesInMemoryNotInDrive.length > 0) {
    report += `⚠️ GASTOS en memoria pero NO en Drive (riesgo de pérdida): ${expensesInMemoryNotInDrive.length}\n\n`;
  }

  if (expensesInDriveNotInMemory.length > 0) {
    report += `ℹ️ GASTOS en Drive pero no en memoria: ${expensesInDriveNotInMemory.length}\n\n`;
  }

  if (inMemoryNotInDrive.length === 0 && inDriveNotInMemory.length === 0 && expensesInMemoryNotInDrive.length === 0 && expensesInDriveNotInMemory.length === 0) {
    report += `✅ TODO SINCRONIZADO CORRECTAMENTE`;
  }

  console.log(report);
  alert(report);
}

// ─── AUTO SYNC ON VISIBILITY CHANGE ────────────────────────────────────────────
// ─── AUTO SYNC: tiempo desde la ultima sincronizacion ──────────────────────────
async function syncIfStale(reason) {
  if (!state.user) return;
  const elapsed = Date.now() - _lastSyncCheckTime;
  if (elapsed < STALE_SYNC_THRESHOLD_MS) return;

  _lastSyncCheckTime = Date.now();
  console.log(`Sincronizando por inactividad (${reason}), pasaron ${Math.round(elapsed / 60000)} min`);

  const driveData = await loadDataFromDrive();
  if (driveData) {
    state.trips = driveData.trips || [];
    state.expenses = driveData.expenses || [];
    state.categories = driveData.categories || state.categories;
    if (driveData.profile) {
      state.user = { ...state.user, ...driveData.profile, initials: getInitials(driveData.profile.name) };
    }
    autoDetectTrip();

    const homeScreen = document.getElementById('screen-home');
    if (homeScreen && homeScreen.classList.contains('active')) {
      renderHome();
      updateAvatars();
    }
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    syncIfStale('volvio a la pestaña');
  }
});

// Cualquier click en la app, si paso suficiente tiempo desde la ultima
// sincronizacion, dispara una sincronizacion silenciosa antes de procesar
// la accion - cubre el caso de una sesion dejada abierta en primer plano
// toda la noche, que visibilitychange no detectaria por si sola.
document.addEventListener('click', () => {
  syncIfStale('click despues de inactividad');
}, { capture: true });

// ─── TRIP DETAIL (unified screen) ──────────────────────────────────────────────
function openTripDetail(tripId) {
  const trip = state.trips.find(t => t.id === tripId);
  if (!trip) return;

  window._detailTripId = tripId;

  // Al ver el detalle de un viaje, lo activamos tambien - asi tiene sentido
  // poder capturar gastos directamente desde esta pantalla (boton Capturar
  // del footer) sin que la app diga "primero elegi un viaje".
  if (!state.activeTrip || state.activeTrip.id !== trip.id) {
    state.activeTrip = trip;
    save();
  }

  document.getElementById('detail-trip-name').value = trip.name;
  document.getElementById('detail-trip-start').value = trip.start;
  document.getElementById('detail-trip-end').value = trip.end;
  document.getElementById('detail-trip-name-view').textContent = trip.name;
  document.getElementById('detail-trip-dates-view').textContent = `${formatDate(trip.start)} → ${formatDate(trip.end)}`;
  document.getElementById('detail-view-mode').style.display = 'block';
  document.getElementById('detail-edit-mode').style.display = 'none';

  const isMobile = /Mobi|Android/i.test(navigator.userAgent);
  document.getElementById('btn-detail-drive').style.display = isMobile ? 'none' : 'inline-flex';

  const calBtn = document.getElementById('btn-detail-calendar');
  calBtn.textContent = trip.calendarEventId ? '🗑️ Quitar de Calendar' : '📅 Agregar a Calendar';

  renderTripDetailStats(trip);
  renderTripDetailExpensesList(trip);

  document.getElementById('detail-expenses-list').style.display = 'none';
  const expenses = getTripExpenses(trip.id);
  document.getElementById('btn-toggle-expenses').textContent = `📋 Ver gastos (${expenses.length})`;

  showScreen('trip-detail');
}

function renderTripDetailStats(trip) {
  const expenses = getTripExpenses(trip.id);
  const { total, elapsed } = tripDayInfo(trip);
  const totalSpent = expenses.reduce((s, e) => s + (parseFloat(e.amountUSD) || 0), 0);
  const daysWithExpenses = new Set(expenses.map(e => e.date)).size;
  const avgPerDay = daysWithExpenses > 0 ? totalSpent / daysWithExpenses : 0;

  document.getElementById('detail-stats').innerHTML = `
    <div class="stat-card">
      <div class="stat-icon">💰</div>
      <p class="stat-val">$${totalSpent.toFixed(2)}</p>
      <p class="stat-label">Total gastado</p>
    </div>
    <div class="stat-card">
      <div class="stat-icon">📅</div>
      <p class="stat-val">Día ${elapsed} de ${total}</p>
      <p class="stat-label">Progreso del viaje</p>
    </div>
    <div class="stat-card">
      <div class="stat-icon">📊</div>
      <p class="stat-val">$${avgPerDay.toFixed(2)}</p>
      <p class="stat-label">Promedio por día</p>
    </div>
  `;

  const totals = getCategoryTotals(expenses);
  const maxVal = Math.max(...Object.values(totals), 1);
  document.getElementById('detail-categories').innerHTML = Object.entries(totals).map(([cat, val]) => `
    <div class="analyze-bar-row">
      <div class="analyze-bar-label">
        <span>${cat}</span>
        <span>$${val.toFixed(2)}</span>
      </div>
      <div class="analyze-bar-track">
        <div class="analyze-bar-fill" style="width:${(val / maxVal * 100).toFixed(0)}%"></div>
      </div>
    </div>
  `).join('') || '<p style="color:var(--text2);font-size:13px;">Sin gastos aún.</p>';
}

function renderTripDetailExpensesList(trip) {
  const expenses = getTripExpenses(trip.id);
  const list = document.getElementById('detail-expenses-list');

  if (expenses.length === 0) {
    list.innerHTML = '<p style="color:var(--text2);font-size:13px;padding:8px 0;">No hay gastos en este viaje.</p>';
    return;
  }

  list.innerHTML = expenses.slice().reverse().map(e => `
    <div class="history-item" onclick="openExpenseDetail(${e.id})" style="cursor:pointer;">
      <p class="history-name">${e.category}</p>
      <p class="history-dates">${e.datetime} — ${e.description || ''}</p>
      <p class="history-total">$${parseFloat(e.amountUSD).toFixed(2)} USD ${e.currency !== 'USD' ? `(${e.amountOrig} ${e.currency})` : ''}</p>
    </div>
  `).join('');
}

function openExpenseDetail(expenseId) {
  const expense = state.expenses.find(e => e.id === expenseId);
  if (!expense) return;

  window._detailExpenseId = expenseId;

  document.getElementById('expense-detail-category-view').textContent = expense.category;
  document.getElementById('expense-detail-summary-view').textContent = `${formatDate(expense.date)} · $${parseFloat(expense.amountUSD).toFixed(2)} USD${expense.description ? ' · ' + expense.description : ''}`;

  const photoViewWrap = document.getElementById('expense-detail-photo-view-wrap');
  const photoView = document.getElementById('expense-detail-photo-view');
  if (expense.image) {
    photoView.innerHTML = `<img src="${expense.image}" alt="Recibo" style="width:100%;height:100%;object-fit:cover;border-radius:12px;">`;
    photoViewWrap.style.display = 'block';
  } else {
    photoViewWrap.style.display = 'none';
  }

  document.getElementById('expense-detail-date').value = expense.date;
  document.getElementById('expense-detail-amount').value = expense.amountOrig;
  document.getElementById('expense-detail-currency').value = expense.currency;
  document.getElementById('expense-detail-description').value = expense.description || '';

  renderExpenseDetailChips(expense.category);

  const photoEditEl = document.getElementById('expense-detail-photo');
  const removeBtn = document.getElementById('btn-remove-expense-photo');
  if (expense.image) {
    photoEditEl.innerHTML = `<img src="${expense.image}" alt="Recibo" style="width:100%;height:100%;object-fit:cover;border-radius:12px;">`;
    photoEditEl.style.display = 'flex';
    removeBtn.style.display = 'block';
  } else {
    photoEditEl.style.display = 'none';
    removeBtn.style.display = 'none';
  }

  window._detailExpensePendingImage = null;

  document.getElementById('expense-detail-view-mode').style.display = 'block';
  document.getElementById('expense-detail-edit-mode').style.display = 'none';

  showScreen('expense-detail');
}

function renderExpenseDetailChips(currentCategory) {
  const container = document.getElementById('expense-detail-chips');
  const active = state.categories.filter(c => c.active);

  container.innerHTML = active.map(c =>
    `<div class="chip ${c.name === currentCategory ? 'active' : ''}" data-cat="${c.name}" onclick="selectExpenseDetailChip(this)">${c.name}</div>`
  ).join('');

  window._detailSelectedCategory = currentCategory;
}

function selectExpenseDetailChip(el) {
  document.querySelectorAll('#expense-detail-chips .chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  window._detailSelectedCategory = el.dataset.cat;
}

init();
