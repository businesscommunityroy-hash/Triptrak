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
 
// ─── PERSISTENCE ─────────────────────────────────────────────────────────────
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
 
// ─── INIT ────────────────────────────────────────────────────────────────────
function init() {
  load();
  autoDetectTrip();
 
  if (!state.user) {
    showScreen('login');
  } else {
    updateAvatars();
    renderHome();
    showScreen('home');
  }
 
  bindEvents();
}
 
// ─── AUTO DETECT ACTIVE TRIP ─────────────────────────────────────────────────
function autoDetectTrip() {
  if (state.trips.length === 0) return;
  const today = new Date().toISOString().split('T')[0];
  const active = state.trips.find(t => t.start <= today && t.end >= today);
  if (active && (!state.activeTrip || state.activeTrip.id !== active.id)) {
    state.activeTrip = active;
    save();
  }
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
        const userInfo = await fetchGoogleUserInfo(googleToken);
        googleUser = userInfo;
        if (state.user && state.user.email === userInfo.email) {
          updateAvatars();
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
    state.user = { name, company, initials: getInitials(name) };
    save();
    updateAvatars();
    renderHome();
    showScreen('home');
  });
 
  // HOME → PROFILE
  document.getElementById('btn-profile').addEventListener('click', () => {
    document.getElementById('profile-name').value = state.user.name;
    document.getElementById('profile-company').value = state.user.company;
    showScreen('profile');
  });
  document.getElementById('btn-profile-history').addEventListener('click', () => {
    document.getElementById('profile-name').value = state.user.name;
    document.getElementById('profile-company').value = state.user.company;
    showScreen('profile');
  });
 
  // HOME → CAPTURE
  document.getElementById('btn-capture').addEventListener('click', () => {
    showScreen('capture');
    const el = document.getElementById('capture-trip-label');
    if (el) el.textContent = state.activeTrip 
      ? `${state.activeTrip.name} · ${formatDate(state.activeTrip.start)} → ${formatDate(state.activeTrip.end)}`
      : 'Tomá una foto o subí desde tu galería.';
  });
  document.getElementById('btn-capture-2').addEventListener('click', () => {
    showScreen('capture');
    const el = document.getElementById('capture-trip-label');
    if (el) el.textContent = state.activeTrip 
      ? `${state.activeTrip.name} · ${formatDate(state.activeTrip.start)} → ${formatDate(state.activeTrip.end)}`
      : 'Tomá una foto o subí desde tu galería.';
  });
 
  // HOME → ANALYZE
  document.getElementById('btn-analyze').addEventListener('click', () => {
    renderAnalyze();
    showScreen('analyze');
  });
 
  // HOME → NEW TRIP
  document.getElementById('btn-new-trip').addEventListener('click', () => openModal('modal-new-trip'));
  document.getElementById('btn-cancel-trip').addEventListener('click', () => closeModal('modal-new-trip'));
 
  // HOME → CHANGE TRIP
document.getElementById('btn-change-trip').addEventListener('click', () => {
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
 
  // REMINDER CLOSE
  document.getElementById('btn-edit-trip-quick').addEventListener('click', () => {
    if (!state.activeTrip) return alert('No hay viaje activo.');
    editTrip(state.activeTrip.id);
  });

 

  // GOOGLE CALENDAR
  document.getElementById('btn-add-calendar').addEventListener('click', () => {
    if (!state.activeTrip) return alert('No hay viaje activo.');
    addTripToGoogleCalendar(state.activeTrip);
  });
  document.getElementById('btn-reminder-close').addEventListener('click', () => {
    document.getElementById('reminder').style.display = 'none';
  });
 
  // NEW TRIP — check overlap on date change
  document.getElementById('new-trip-start').addEventListener('change', checkTripOverlap);
  document.getElementById('new-trip-end').addEventListener('change', checkTripOverlap);
 
  // CREATE TRIP
  document.getElementById('btn-create-trip').addEventListener('click', createTrip);
 
  // NAV — HISTORY
  document.getElementById('nav-history').addEventListener('click', () => {
    renderHistory();
    showScreen('history');
  });
  document.getElementById('nav-history-2').addEventListener('click', () => {
    renderHistory();
    showScreen('history');
  });
  document.getElementById('nav-home-2').addEventListener('click', () => {
    renderHome();
    showScreen('home');
  });
 
  // CAPTURE
  document.getElementById('upload-zone').addEventListener('click', () => {
    document.getElementById('file-input').click();
  });
  document.getElementById('file-input').addEventListener('change', (e) => {
    handleImageFile(e.target.files[0]);
  });
  document.getElementById('btn-gallery').addEventListener('click', () => {
    document.getElementById('gallery-input').click();
  });
  document.getElementById('gallery-input').addEventListener('change', (e) => {
    handleImageFile(e.target.files[0]);
  });
  document.getElementById('btn-multi').addEventListener('click', () => {
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
  document.getElementById('btn-profile-back').addEventListener('click', () => showScreen('home'));
  document.getElementById('btn-profile-save').addEventListener('click', () => {
    const name = document.getElementById('profile-name').value.trim();
    const company = document.getElementById('profile-company').value.trim();
    if (!name) return alert('Ingresá tu nombre.');
    state.user = { ...state.user, name, company, initials: getInitials(name) };
    save();
    updateAvatars();
    alert('Perfil guardado.');
  });
  document.getElementById('btn-categories').addEventListener('click', () => {
    renderCategories();
    showScreen('categories');
  });
 // MANUAL EXPENSE
document.getElementById('btn-manual').addEventListener('click', () => {
    renderManualCategoryChips();
    const now = new Date();
    const local = new Date(now - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    document.getElementById('manual-datetime').value = local;
    document.getElementById('manual-amount').value = '';
    document.getElementById('manual-currency').value = 'USD';
    document.getElementById('manual-description').value = '';
    document.getElementById('manual-upload-zone').style.display = 'block';
    document.getElementById('manual-photo-preview').style.display = 'none';
    document.getElementById('manual-photo-img').src = '';
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
      document.getElementById('manual-photo-img').src = ev.target.result;
      document.getElementById('manual-photo-preview').style.display = 'block';
      document.getElementById('manual-upload-zone').style.display = 'none';

    };
    reader.readAsDataURL(file);
  });
  document.getElementById('btn-save-manual').addEventListener('click', saveManualExpense);
  // MANAGE TRIPS
  document.getElementById('btn-manage-trips').addEventListener('click', () => {
    renderManageTrips();
    showScreen('manage-trips');
  });
  document.getElementById('btn-manage-trips-back').addEventListener('click', () => showScreen('profile'));
  // CATEGORIES
  document.getElementById('btn-categories-back').addEventListener('click', () => showScreen('profile'));
  document.getElementById('btn-add-category').addEventListener('click', addCategory);
  document.getElementById('new-category-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addCategory();
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
 
  if (!trip) {
    nameEl.textContent = 'No hay viajes disponibles';
    datesEl.textContent = 'Creá un nuevo viaje para empezar';
  } else {
    const { total, elapsed } = tripDayInfo(trip);
    nameEl.textContent = 'Viaje: ' + trip.name;
    const isUpcoming = trip.start > new Date().toISOString().split('T')[0];
    const statusText = isUpcoming ? 'Próximo' : `En curso · Día ${elapsed} de ${total}`;
    datesEl.innerHTML = `Fechas: ${formatDate(trip.start)} → ${formatDate(trip.end)}<br>Estado: ${statusText}`;


  }
 
  renderStatsGrid();
  renderExpensesList();
  checkReminder();
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
 
  const icons = { '🍽️ Comida': '🍽️', '🏨 Hotel': '🏨', '✈️ Vuelo': '✈️', '⛽ Combustible': '⛽', '🚕 Transporte': '🚕', '🎭 Entretenimiento': '🎭', '📦 Otro': '📦' };
 
  grid.innerHTML = activeCats.map(cat => `
    <div class="stat-card">
      <div class="stat-icon">${icons[cat] || '📦'}</div>
      <p class="stat-val">$${totals[cat].toFixed(2)}</p>
      <p class="stat-label">${cat.replace(/^[^\s]+\s/, '')}</p>
    </div>
  `).join('');
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
  if (!state.activeTrip) return;
  const today = new Date().toISOString().split('T')[0];
  const expenses = getTripExpenses(state.activeTrip.id);
  const todayExpenses = expenses.filter(e => e.date === today);
  const reminder = document.getElementById('reminder');
  const today2 = new Date().toISOString().split('T')[0];
  const tripStarted = state.activeTrip && state.activeTrip.start <= today2 && state.activeTrip.end >= today2;
  reminder.style.display = (tripStarted && todayExpenses.length === 0) ? 'flex' : 'none';
}
 
// ─── TRIP OVERLAP ─────────────────────────────────────────────────────────────
function checkTripOverlap() {
  const start = document.getElementById('new-trip-start').value;
  const end = document.getElementById('new-trip-end').value;
  if (!start || !end) return;
 
  const overlap = state.trips.some(t => !(end < t.start || start > t.end));
  document.getElementById('modal-overlap-alert').style.display = overlap ? 'block' : 'none';
}
 
// ─── CREATE TRIP ─────────────────────────────────────────────────────────────
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
  await createDriveFolder(trip);

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
    state.pendingImage = { dataUrl: e.target.result, file };
    showReviewScreen(e.target.result);
    processImageWithAI(e.target.result);
  };
  reader.readAsDataURL(file);
}
 
function showReviewScreen(dataUrl) {
  const photo = document.getElementById('review-photo');
  photo.innerHTML = `<img src="${dataUrl}" alt="Recibo">`;
  document.getElementById('field-datetime').value = 'Analizando...';
  document.getElementById('field-amount').value = 'Analizando...';
  document.getElementById('field-currency').value = 'Analizando...';
  document.getElementById('field-usd').value = 'Analizando...';
  document.getElementById('field-description').value = 'Analizando...';
  renderCategoryChips();
  showScreen('review');
}
 
// ─── AI PROCESSING ────────────────────────────────────────────────────────────
async function processImageWithAI(dataUrl) {
  const base64 = dataUrl.split(',')[1];
  const mediaType = dataUrl.split(';')[0].split(':')[1];
 
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64 }
            },
            {
              type: 'text',
              text: `Analizá este recibo y extraé la información en JSON exacto, sin texto adicional, sin markdown:
{
  "datetime": "fecha y hora del recibo en formato legible, ej: Jun 22, 2026 — 8:30 PM",
  "amountOrig": "monto original como número, ej: 87.50",
  "currency": "código de moneda de 3 letras, ej: USD, EUR, MXN",
  "description": "descripción breve del gasto en español",
  "category": "una de estas opciones exactas: Comida, Hotel, Vuelo, Combustible, Transporte, Entretenimiento, Otro"
}`
            }
          ]
        }]
      })
    });
 
    const data = await response.json();
    const text = data.content[0].text.trim();
    const clean = text.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);
 
    document.getElementById('field-datetime').value = result.datetime || '';
    document.getElementById('field-amount').value = result.amountOrig || '';
    document.getElementById('field-currency').value = result.currency || 'USD';
    document.getElementById('field-description').value = result.description || '';
 
    await convertToUSD(result.amountOrig, result.currency);
    preselectCategory(result.category);
 
  } catch (err) {
    console.error('AI error:', err);
    document.getElementById('field-datetime').value = new Date().toLocaleDateString('es');
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

  if (!state.selectedCategory) {
    btn.disabled = false;
    btn.textContent = 'Guardar recibo →';
    return alert('Seleccioná un tipo de gasto.');
  }
 
  let category = state.selectedCategory;
  if (category === '📦 Otro') {
    const otroVal = document.getElementById('otro-input') ? document.getElementById('otro-input').value.trim() : '';
    if (!otroVal) return alert('Escribí el concepto del gasto.');
    category = '📦 ' + otroVal;
  }
 
  const datetime = document.getElementById('field-datetime').value;
  const amountOrig = document.getElementById('field-amount').value;
  const currency = document.getElementById('field-currency').value;
  const amountUSD = document.getElementById('field-usd').value;
  const description = document.getElementById('field-description').value;
 
  if (!amountOrig) return alert('Ingresá el monto.');
 if (state.activeTrip) {
    const expDate = document.getElementById('field-datetime').value;
    const date = expDate ? expDate.split(',')[0].trim() : '';
    if (date && (date < state.activeTrip.start || date > state.activeTrip.end)) {
      const continuar = confirm(`⚠️ La fecha está fuera del rango del viaje (${state.activeTrip.start} → ${state.activeTrip.end}). ¿Querés continuar igual?`);
      if (!continuar) return;
    }
  }
  const today = new Date().toISOString().split('T')[0];
  const expense = {
    id: Date.now(),
    tripId: state.activeTrip.id,
    datetime,
    date: today,
    amountOrig,
    currency,
    amountUSD,
    description,
    category,
    image: null,
  };
 
  state.expenses.push(expense);
    åsave();
  if (state.activeTrip.sheetId) {
    await appendExpenseToSheet(expense, state.activeTrip.sheetId);
  }
  if (state.pendingImage && state.activeTrip.driveFolderId) {
    await uploadPhotoToDrive(expense, state.pendingImage.dataUrl);
  }
  state.pendingImage = null;
  renderHome();
  showScreen('home');
  alert('Gasto guardado.');
}
 
// ─── ANALYZE ─────────────────────────────────────────────────────────────────
function renderAnalyze() {
  if (!state.activeTrip) return;
  const trip = state.activeTrip;
  const expenses = getTripExpenses(trip.id);
  const { total, elapsed } = tripDayInfo(trip);
 
  document.getElementById('analyze-trip-name').textContent = trip.name;
 
  const totalSpent = expenses.reduce((s, e) => s + (parseFloat(e.amountUSD) || 0), 0);
  const avgPerDay = elapsed > 0 ? totalSpent / elapsed : 0;
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
      <div class="history-item">
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
    const date = datetimeVal.split('T')[0];
    if (date < state.activeTrip.start || date > state.activeTrip.end) {
      const continuar = confirm(`⚠️ La fecha está fuera del rango del viaje (${state.activeTrip.start} → ${state.activeTrip.end}). ¿Querés continuar igual?`);
      if (!continuar) {
        btn.disabled = false;
        btn.textContent = 'Guardar gasto →';
        return;
      }
    }
  }

  const date = datetimeVal.split('T')[0];
  const time = datetimeVal.split('T')[1] || '';
  const datetime = `${formatDate(date)} — ${time}`;

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

  state.expenses.push(expense);
  save();

  if (state.activeTrip.sheetId) {
    await appendExpenseToSheet(expense, state.activeTrip.sheetId);
  }

  if (state.pendingImage && state.activeTrip.driveFolderId) {
    await uploadPhotoToDrive(expense, state.pendingImage.dataUrl);
  }

  state.pendingImage = null;
  btn.disabled = false;
  btn.textContent = 'Guardar gasto →';
  renderHome();
  showScreen('home');
  alert('Gasto guardado.');
}

// ─── START ────────────────────────────────────────────────────────────────────
// ─── GOOGLE CALENDAR ─────────────────────────────────────────────────────────
function addTripToGoogleCalendar(trip) {
  const client = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: GOOGLE_SCOPES,
    callback: async (response) => {
      if (response.error) return alert('Error al conectar con Google.');
      googleToken = response.access_token;
      await createCalendarEvent(trip, googleToken);
    },
  });
  client.requestAccessToken();
}

async function createCalendarEvent(trip, token) {
  const event = {
    summary: `✈️ ${trip.name}`,
    start: { date: trip.start },
    end: { date: trip.end },
    description: 'Viaje registrado en TripTrack.',
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
      alert(`✅ Viaje "${trip.name}" agregado a Google Calendar.`);
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
  if (!googleToken) {
    await new Promise((resolve) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: GOOGLE_SCOPES,
        callback: (response) => {
          if (!response.error) {
            googleToken = response.access_token;
          }
          resolve();
        },
      });
      client.requestAccessToken();
    });
  }

  if (!googleToken) {
    alert('No se pudo conectar con Google. Intentá de nuevo.');
    return;
  }

  try {
    // Buscar si ya existe la carpeta TripTrack
    const searchRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=name='TripTrack' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      { headers: { Authorization: `Bearer ${googleToken}` } }
    );
    const searchData = await searchRes.json();
    
    let rootFolderId;
    if (searchData.files && searchData.files.length > 0) {
      rootFolderId = searchData.files[0].id;
    } else {
      // Crear carpeta raíz TripTrack
      const rootRes = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${googleToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'TripTrack',
          mimeType: 'application/vnd.google-apps.folder',
        }),
      });
      const rootData = await rootRes.json();
      rootFolderId = rootData.id;
    }

    // Crear carpeta del viaje dentro de TripTrack
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

    // Guardar el ID de la carpeta en el viaje
    trip.driveFolderId = tripData.id;
    trip.driveUrl = `https://drive.google.com/drive/folders/${tripData.id}`;

    const idx = state.trips.findIndex(t => t.id === trip.id);
    if (idx !== -1) state.trips[idx] = trip;
    if (state.activeTrip && state.activeTrip.id === trip.id) state.activeTrip = trip;
    save();

    await createTripSheet(trip);

    alert(`✅ Viaje "${trip.name}" creado y carpeta en Drive lista.`);
  } catch (err) {
    console.error(err);
    alert('Viaje creado pero no se pudo crear la carpeta en Drive. Intentá de nuevo.');
  }
}
function silentLogin() {
  const client = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: GOOGLE_SCOPES,
    prompt: '',
    callback: (response) => {
      if (!response.error) {
        googleToken = response.access_token;
      }
    },
  });
  client.requestAccessToken();
}
async function uploadPhotoToDrive(expense, dataUrl) {
  if (!googleToken && window._driveToken) googleToken = window._driveToken;
  if (!googleToken) {
    await new Promise((resolve) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: GOOGLE_SCOPES,
        callback: (response) => {
          if (!response.error) googleToken = response.access_token;
          resolve();
        },
      });
      client.requestAccessToken();
    });
  }
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
  renderHome();
}
// ─── GOOGLE SHEETS ───────────────────────────────────────────────────────────
async function createTripSheet(trip) {
  if (!googleToken) return;

  try {
    // Crear el Google Sheet
    const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${googleToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: { title: `${trip.name} — Gastos` },
        sheets: [
          { properties: { title: 'Detalle', sheetId: 0 } },
          { properties: { title: 'Resumen', sheetId: 1 } },
        ],
      }),
    });

    const sheetData = await createRes.json();
    const sheetId = sheetData.spreadsheetId;

    // Agregar headers Sheet 1
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Detalle!A1:H1?valueInputOption=RAW`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${googleToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: [['Fecha', 'Tipo de gasto', 'Descripción', 'Moneda original', 'Monto original', 'Monto USD', 'Notas', 'Recibo']],
      }),
    });

    // Mover el Sheet a la carpeta del viaje
    await fetch(`https://www.googleapis.com/drive/v3/files/${sheetId}?addParents=${trip.driveFolderId}&removeParents=root`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${googleToken}`,
        'Content-Type': 'application/json',
      },
    });

    // Guardar el ID del sheet en el viaje
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
  if (!googleToken) {
    await new Promise((resolve) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: GOOGLE_SCOPES,
        callback: (response) => {
          if (!response.error) googleToken = response.access_token;
          resolve();
        },
      });
      client.requestAccessToken();
    });
  }
  if (!window._driveToken) window._driveToken = googleToken;
  if (!googleToken) return;

  try {
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
    ];

    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Detalle!A:H:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${googleToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [row] }),
    });

  } catch (err) {
    console.error('Error agregando fila al Sheet:', err);
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
          <button class="btn-sm" onclick="editTrip(${trip.id})">✏️ Editar</button>
          <button class="btn-sm" onclick="viewTripExpenses(${trip.id})">📋 Gastos</button>
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

  // Eliminar carpeta en Drive
  if (trip.driveFolderId) {
    if (!googleToken && window._driveToken) googleToken = window._driveToken;
    if (!googleToken) {
      await new Promise((resolve) => {
        const client = google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: GOOGLE_SCOPES,
          callback: (response) => {
            if (!response.error) googleToken = response.access_token;
            resolve();
          },
        });
        client.requestAccessToken();
      });
    }
    try {
      await fetch(`https://www.googleapis.com/drive/v3/files/${trip.driveFolderId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${googleToken}` },
      });
    } catch (err) {
      console.error('Error eliminando carpeta en Drive:', err);
    }
  }

  // Eliminar gastos del viaje
  state.expenses = state.expenses.filter(e => e.tripId !== id);

  // Eliminar viaje
  state.trips = state.trips.filter(t => t.id !== id);

  // Si era el viaje activo, limpiar
  if (state.activeTrip && state.activeTrip.id === id) {
    state.activeTrip = state.trips.length > 0 ? state.trips[state.trips.length - 1] : null;
  }

  save();
  renderManageTrips();
  renderHome();
  alert(`Viaje "${trip.name}" eliminado.`);
}

function editTrip(id) {
  const trip = state.trips.find(t => t.id === id);
  if (!trip) return;

  const newName = prompt('Nombre del viaje:', trip.name);
  if (!newName) return;

  const newStart = prompt('Fecha inicio (YYYY-MM-DD):', trip.start);
  if (!newStart) return;

  const newEnd = prompt('Fecha fin (YYYY-MM-DD):', trip.end);
  if (!newEnd) return;

  // Validar que los gastos existentes estén dentro del nuevo rango
  const expenses = getTripExpenses(id);
  const outOfRange = expenses.filter(e => e.date < newStart || e.date > newEnd);
  if (outOfRange.length > 0) {
    alert(`No podés cambiar las fechas porque ${outOfRange.length} gasto(s) quedarían fuera del rango.`);
    return;
  }

  const idx = state.trips.findIndex(t => t.id === id);
  state.trips[idx] = { ...trip, name: newName, start: newStart, end: newEnd };
  if (state.activeTrip && state.activeTrip.id === id) {
    state.activeTrip = state.trips[idx];
  }
  save();
  renderManageTrips();
  renderHome();
}

function viewTripExpenses(id) {
  alert('Próximamente — administrar gastos individuales.');
}
init();