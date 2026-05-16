// ===== ECO APP.JS =====

// ===== STATE =====
let state = {
  tasks: [],
  transactions: [],
  accounts: [{ id: uid(), name: 'Dinheiro', balance: 0 }],
  goals: [],
  notes: [],
  habits: [],
  calendarEvents: [],
  settings: { userName: '', theme: 'dark' },
  categories: [
    { id: uid(), icon: '🍽', name: 'Alimentação' },
    { id: uid(), icon: '🚌', name: 'Transporte' },
    { id: uid(), icon: '💊', name: 'Saúde' },
    { id: uid(), icon: '🎮', name: 'Lazer' },
    { id: uid(), icon: '📚', name: 'Educação' },
    { id: uid(), icon: '🏠', name: 'Casa' },
    { id: uid(), icon: '👕', name: 'Roupas' },
    { id: uid(), icon: '💰', name: 'Poupança' },
    { id: uid(), icon: '📦', name: 'Outro' },
  ],
  morningItems: [],
  morningDone: {}, // { date: { itemId: true } }
  focusQuotes: [
    'respira fundo ✦',
    'o silêncio também é produtivo.',
    'uma coisa de cada vez.',
    'estás exatamente onde deves estar.',
    'o foco é a forma mais alta de atenção.',
    'menos ruído, mais clareza.',
    'a profundidade vem da concentração.',
  ],
  currentTransType: null,   // FIX: null = nenhum selecionado por padrão
  taskFilter: 'all',
  transFilter: 'all',
  calendarView: 'month',
  calendarDate: null, // será inicializado no init
};

// ===== PENDING NOTE IMAGES =====
let pendingNoteImages = [];

// ===== IMAGE POSITIONER STATE =====
let positioner = {
  bannerId: null,
  imgSrc: null,
  isGif: false,
  offsetX: 0,
  offsetY: 0,
  zoom: 100,
  isDragging: false,
  startX: 0,
  startY: 0,
  startOffX: 0,
  startOffY: 0,
};

// ===== UTILS =====
function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ===== FIRESTORE SYNC =====
let _saveDebounceTimer = null;

function save() {
  localStorage.setItem('eco_v2', JSON.stringify(state));
  if (_saveDebounceTimer) clearTimeout(_saveDebounceTimer);
  _saveDebounceTimer = setTimeout(() => { _syncToFirestore(); }, 1500);
}

// Remove qualquer string base64 longa do state antes de enviar para a nuvem
// (banners/fotos devem estar como URLs do Storage, não como base64)
function _stripBase64FromState(s) {
  function stripVal(v) {
    if (typeof v === 'string' && v.startsWith('data:') && v.length > 500) return '__base64_removed__';
    if (Array.isArray(v)) return v.map(stripVal);
    if (v && typeof v === 'object') return _stripBase64FromObj(v);
    return v;
  }
  return _stripBase64FromObj(s);
}
function _stripBase64FromObj(obj) {
  const out = {};
  for (const k in obj) out[k] = (function stripVal(v) {
    if (typeof v === 'string' && v.startsWith('data:') && v.length > 500) return '__base64_removed__';
    if (Array.isArray(v)) return v.map(stripVal);
    if (v && typeof v === 'object') return _stripBase64FromObj(v);
    return v;
  })(obj[k]);
  return out;
}

async function _syncToFirestore() {
  const db = window._firestoreDb;
  const uid_user = window._currentUid;
  if (!db || !uid_user) {
    console.warn('[Lúmen] _syncToFirestore: db=' + !!db + ' uid=' + uid_user);
    return;
  }
  _syncStart();
  try {
    const { doc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    // Remover notas com imagens inline (base64) E limpar qualquer outro base64 solto no state
    const notesForCloud = (state.notes || []).map(n => ({ ...n, images: [] }));
    const stateRaw = { ...state, notes: notesForCloud };
    const stateForCloud = _stripBase64FromState(stateRaw);
    const payload = JSON.stringify(stateForCloud);
    const sizeKB = Math.round(payload.length / 1024);
    console.log('[Lúmen] Firestore save — payload: ' + sizeKB + ' KB, uid: ' + uid_user);
    if (payload.length > 900000) {
      console.error('[Lúmen] Payload demasiado grande (' + sizeKB + ' KB) — abortando save para proteger quota');
      toast('⚠ Dados demasiado grandes para a nuvem. Imagens já guardadas no Storage.');
      _syncEnd();
      return;
    }
    await setDoc(doc(db, 'users', uid_user), { data: payload });
    console.log('[Lúmen] Firestore save OK (' + sizeKB + ' KB)');
    _syncEnd();
  } catch (e) {
    console.error('[Lúmen] Firestore save ERRO:', e.code, e.message);
    toast('⚠ Erro ao sincronizar: ' + (e.code || e.message));
    _syncEnd();
  }
}

async function loadFromFirestore() {
  const db = window._firestoreDb;
  const uid_user = window._currentUid;
  if (!db || !uid_user) {
    console.warn('[Lúmen] loadFromFirestore: db=' + !!db + ' uid=' + uid_user);
    return false;
  }
  console.log('[Lúmen] loadFromFirestore a carregar para uid:', uid_user);
  try {
    const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const snap = await getDoc(doc(db, 'users', uid_user));
    if (snap.exists()) {
      const raw = snap.data().data;
      console.log('[Lúmen] Firestore load OK — ' + Math.round(raw.length / 1024) + ' KB');
      const parsed = JSON.parse(raw);
      state = { ...state, ...parsed };
      _sanitizeState();
      _recalcAccountBalances();
      localStorage.setItem('eco_v2', JSON.stringify(state));
      return true;
    } else {
      console.log('[Lúmen] Firestore: documento não existe ainda (utilizador novo)');
    }
  } catch (e) {
    console.error('[Lúmen] Firestore load ERRO:', e.code, e.message, e);
  }
  return false;
}

function _sanitizeState() {
  if (!state.categories || state.categories.length === 0) {
    state.categories = [
      { id: uid(), icon: '🍽', name: 'Alimentação' },
      { id: uid(), icon: '🚌', name: 'Transporte' },
      { id: uid(), icon: '💊', name: 'Saúde' },
      { id: uid(), icon: '🎮', name: 'Lazer' },
      { id: uid(), icon: '📚', name: 'Educação' },
      { id: uid(), icon: '🏠', name: 'Casa' },
      { id: uid(), icon: '👕', name: 'Roupas' },
      { id: uid(), icon: '💰', name: 'Poupança' },
      { id: uid(), icon: '📦', name: 'Outro' },
    ];
  }
  if (!state.notes) state.notes = [];
  if (!state.calendarEvents) state.calendarEvents = [];
  if (!state.morningItems) state.morningItems = [];
  if (!state.morningDone) state.morningDone = {};
  if (!state.focusQuotes) state.focusQuotes = ['respira fundo ✦'];
  state.currentTransType = null;

  // Limpar entradas de morningDone com mais de 30 dias
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().split('T')[0];
  Object.keys(state.morningDone).forEach(dateKey => {
    if (dateKey < cutoffStr) delete state.morningDone[dateKey];
  });
}

function load() {
  const d = localStorage.getItem('eco_v2');
  if (d) {
    const parsed = JSON.parse(d);
    state = { ...state, ...parsed };
    _sanitizeState();
    _recalcAccountBalances();
  }
}
function fmtEur(n) {
  return '€\u00a0' + Number(n || 0).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(s) {
  if (!s) return '';
  return new Date(s + 'T00:00:00').toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' });
}
function today() { return new Date().toISOString().split('T')[0]; }
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}
function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

// ===== SYNC INDICATOR =====
let _syncCount = 0;
function _syncStart() {
  _syncCount++;
  let ind = document.getElementById('syncIndicator');
  if (!ind) {
    ind = document.createElement('div');
    ind.id = 'syncIndicator';
    document.body.appendChild(ind);
  }
  ind.classList.add('syncing');
}
function _syncEnd() {
  _syncCount = Math.max(0, _syncCount - 1);
  if (_syncCount === 0) {
    const ind = document.getElementById('syncIndicator');
    if (ind) ind.classList.remove('syncing');
  }
}

// ===== COMPRESS IMAGE BEFORE UPLOAD =====
function _compressDataUrl(dataUrl, maxW, maxH, quality) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth, h = img.naturalHeight;
      const ratio = Math.min(maxW / w, maxH / h, 1); // nunca ampliar
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl); // fallback sem compressão
    img.src = dataUrl;
  });
}

// ===== FIREBASE STORAGE UPLOAD =====
async function _uploadToStorage(path, dataUrl) {
  const storage = window._firebaseStorage;
  const uid_user = window._currentUid;
  if (!storage || !uid_user) return null;
  _syncStart();
  try {
    // Comprimir JPEGs antes do upload (banners, profilePic, greetingMedia)
    let uploadData = dataUrl;
    if (!path.endsWith('.gif') && dataUrl.startsWith('data:')) {
      uploadData = await _compressDataUrl(dataUrl, 1600, 900, 0.75);
    }
    const { ref, uploadString, getDownloadURL } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js');
    const storageRef = ref(storage, `users/${uid_user}/${path}`);
    const snapshot = await uploadString(storageRef, uploadData, 'data_url');
    const url = await getDownloadURL(snapshot.ref);
    _syncEnd();
    return url;
  } catch (e) {
    console.warn('[Lúmen] Storage upload erro:', e);
    _syncEnd();
    return null;
  }
}

async function _deleteFromStorage(path) {
  const storage = window._firebaseStorage;
  const uid_user = window._currentUid;
  if (!storage || !uid_user) return;
  try {
    const { ref, deleteObject } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js');
    await deleteObject(ref(storage, `users/${uid_user}/${path}`));
  } catch (e) { /* ficheiro pode não existir */ }
}


function toggleBannerMenu(bannerId, btn) {
  const dropdown = document.getElementById('bmenu-' + bannerId);
  if (!dropdown) return;
  const isOpen = dropdown.classList.contains('open');
  closeBannerMenu();
  if (!isOpen) dropdown.classList.add('open');
}
function closeBannerMenu() {
  document.querySelectorAll('.banner-menu-dropdown.open').forEach(d => d.classList.remove('open'));
}
document.addEventListener('click', e => {
  if (!e.target.closest('.banner-menu-wrap')) closeBannerMenu();
});

// ===== HABITS TAB SWITCHER =====
function switchHabitsTab(tab, btn) {
  document.querySelectorAll('#page-habits .tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  const tracker = document.getElementById('habitsTrackerTab');
  const garden = document.getElementById('habitsGardenTab');
  const addBtn = document.getElementById('habitsAddBtn');
  const subtitle = document.getElementById('habitsSubtitle');
  if (tab === 'tracker') {
    tracker.style.display = '';
    garden.style.display = 'none';
    if (addBtn) addBtn.style.display = '';
    if (subtitle) subtitle.textContent = 'Os teus hábitos, cultivados dia a dia.';
  } else {
    tracker.style.display = 'none';
    garden.style.display = '';
    if (addBtn) addBtn.style.display = 'none';
    if (subtitle) subtitle.textContent = 'Cada hábito é uma semente. Rega-os todos os dias.';
    renderGarden();
  }
}

// ===== NAVIGATION =====
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => {
    if (n.getAttribute('onclick')?.includes(`'${id}'`)) n.classList.add('active');
  });
  if (id === 'calendar') renderCalendar();
  if (id === 'morning') renderMorningRoutine();
  renderAll();
}
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.toggle('collapsed');
  // No desktop, a seta do header basta. No mobile, a lógica é gerida pelo openSidebarMobile/closeSidebarMobile.
}

// ===== MODALS =====
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('open');
});

// ===== GREETING =====
function updateGreeting() {
  const h = new Date().getHours();
  const name = state.settings.userName;
  let g = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  if (name) g += `, ${name}`;
  g += ' ✦';

  const greetingEl = document.getElementById('greeting');
  const greetingImgEl = document.getElementById('greetingImg');

  if (state.settings.greetingMedia) {
    // mostrar imagem/gif no lugar do texto
    if (greetingEl) greetingEl.style.display = 'none';
    if (greetingImgEl) {
      greetingImgEl.src = state.settings.greetingMedia;
      greetingImgEl.style.display = 'block';
    }
  } else {
    if (greetingEl) { greetingEl.style.display = ''; greetingEl.textContent = g; }
    if (greetingImgEl) greetingImgEl.style.display = 'none';
  }

  const el = document.getElementById('currentDate');
  if (el) el.textContent = new Date().toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// ===== SETTINGS =====
function saveSetting(k, v) { state.settings[k] = v; save(); }
function setTheme(theme, btn) {
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.settings.theme = theme;
  save();
}
function setProfilePic(input) {
  const file = input.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = async e => {
    const dataUrl = e.target.result;
    state.settings.profilePic = dataUrl;
    const pic = document.getElementById('profilePic');
    if (pic) { pic.src = dataUrl; pic.style.display = 'block'; }
    save();
    const url = await _uploadToStorage('profilePic.jpg', dataUrl);
    if (url) {
      state.settings.profilePic = url;
      if (pic) pic.src = url;
      save();
    }
  };
  r.readAsDataURL(file);
}
function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'eco-backup.json'; a.click();
  URL.revokeObjectURL(url); toast('Dados exportados!');
}
function clearAll() {
  if (confirm('Tem a certeza? Esta ação apagará todos os seus dados locais e na nuvem.')) {
    // Apagar do Firestore antes de sair
    const db = window._firestoreDb;
    const uid_user = window._currentUid;
    if (db && uid_user) {
      import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js').then(({ doc, deleteDoc }) => {
        deleteDoc(doc(db, 'users', uid_user)).catch(e => console.warn('[Lúmen] clearAll Firestore erro:', e));
      });
    }
    localStorage.removeItem('eco_v2');
    localStorage.removeItem('lumen_user');
    localStorage.removeItem('eco_user');
    localStorage.setItem('lumen_logged_out', '1');
    const doSignOut = window._doFirebaseSignOut;
    if (typeof doSignOut === 'function') {
      doSignOut().finally(() => { window.location.href = 'login.html'; });
    } else {
      window.location.href = 'login.html';
    }
  }
}

// ===== GREETING MEDIA (foto/gif no saudação) =====
function setGreetingMedia(input) {
  const file = input.files[0]; if (!file) return;
  const isGif = file.type === 'image/gif';
  const r = new FileReader();
  r.onload = async e => {
    const dataUrl = e.target.result;
    state.settings.greetingMedia = dataUrl;
    save();
    updateGreeting();
    toast('A carregar imagem de saudação... ⏳');
    const removeBtn = document.getElementById('removeGreetingBtn');
    if (removeBtn) removeBtn.style.display = 'inline-flex';
    const ext = isGif ? 'greetingMedia.gif' : 'greetingMedia.jpg';
    const url = await _uploadToStorage(ext, dataUrl);
    if (url) {
      state.settings.greetingMedia = url;
      save();
      updateGreeting();
      toast('Imagem de saudação sincronizada ✦');
    } else {
      toast('Imagem aplicada (apenas local — sem ligação à nuvem)');
    }
  };
  r.readAsDataURL(file);
  input.value = '';
}
function removeGreetingMedia() {
  delete state.settings.greetingMedia;
  save();
  updateGreeting();
  toast('Imagem removida. Texto de saudação restaurado.');
  const removeBtn = document.getElementById('removeGreetingBtn');
  if (removeBtn) removeBtn.style.display = 'none';
}

// ===== IMAGE POSITIONER (with GIF support) =====
function openImagePositioner(bannerId, input) {
  const file = input.files[0]; if (!file) return;
  const isGif = file.type === 'image/gif';
  const reader = new FileReader();
  reader.onload = async e => {
    positioner.bannerId = bannerId;
    positioner.imgSrc = e.target.result;
    positioner.isGif = isGif;
    positioner.offsetX = 0;
    positioner.offsetY = 0;
    positioner.zoom = 100;

    if (isGif) {
      // GIFs: aplicar visualmente de imediato com base64
      const banner = document.getElementById(bannerId);
      banner.style.backgroundImage = `url(${e.target.result})`;
      banner.style.backgroundSize = 'cover';
      banner.style.backgroundPosition = 'center';
      toast('A carregar GIF para a nuvem... ⏳');
      // Upload para o Storage e guardar URL
      const url = await _uploadToStorage(`banners/${bannerId}.gif`, e.target.result);
      if (url) {
        state.settings['banner_' + bannerId] = url;
        state.settings['bannerIsGif_' + bannerId] = true;
        save();
        toast('GIF sincronizado com a nuvem ✦');
      } else {
        // Fallback: guardar base64 localmente apenas
        state.settings['banner_' + bannerId] = e.target.result;
        state.settings['bannerIsGif_' + bannerId] = true;
        save();
        toast('GIF aplicado (apenas local — sem ligação à nuvem)');
      }
    } else {
      const img = document.getElementById('positionerImg');
      img.src = e.target.result;
      document.getElementById('positionerZoom').value = 100;
      document.getElementById('positionerZoomVal').textContent = '100%';
      img.onload = () => { applyPositionerTransform(); };
      openModal('imagePositionModal');
    }
  };
  reader.readAsDataURL(file);
  input.value = '';
}

function applyPositionerTransform() {
  const viewport = document.getElementById('positionerViewport');
  const img = document.getElementById('positionerImg');
  const vw = viewport.clientWidth;
  const vh = viewport.clientHeight;
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;

  const scale = (positioner.zoom / 100) * Math.max(vw / iw, vh / ih);
  const scaledW = iw * scale;
  const scaledH = ih * scale;

  const maxX = 0;
  const minX = vw - scaledW;
  const maxY = 0;
  const minY = vh - scaledH;
  positioner.offsetX = Math.min(maxX, Math.max(minX, positioner.offsetX));
  positioner.offsetY = Math.min(maxY, Math.max(minY, positioner.offsetY));

  img.style.transform = `translate(${positioner.offsetX}px, ${positioner.offsetY}px) scale(${scale})`;
  img.style.transformOrigin = 'top left';
  img.style.width = iw + 'px';
  img.style.height = ih + 'px';
}

function updatePositionerZoom(val) {
  positioner.zoom = parseInt(val);
  document.getElementById('positionerZoomVal').textContent = val + '%';
  applyPositionerTransform();
}

async function applyBannerPosition() {
  const viewport = document.getElementById('positionerViewport');
  const img = document.getElementById('positionerImg');
  const vw = viewport.clientWidth;
  const vh = viewport.clientHeight;
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const scale = (positioner.zoom / 100) * Math.max(vw / iw, vh / ih);

  const canvas = document.createElement('canvas');
  canvas.width = vw;
  canvas.height = vh;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, positioner.offsetX, positioner.offsetY, iw * scale, ih * scale);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.78);

  const banner = document.getElementById(positioner.bannerId);
  banner.style.backgroundImage = `url(${dataUrl})`;
  banner.style.backgroundSize = 'cover';
  banner.style.backgroundPosition = 'center';

  closeModal('imagePositionModal');
  toast('A carregar imagem para a nuvem... ⏳');

  const ext = positioner.bannerId + '.jpg';
  const url = await _uploadToStorage(`banners/${ext}`, dataUrl);
  if (url) {
    state.settings['banner_' + positioner.bannerId] = url;
    state.settings['bannerIsGif_' + positioner.bannerId] = false;
    save();
    toast('Imagem sincronizada com a nuvem ✦');
  } else {
    // Fallback local
    state.settings['banner_' + positioner.bannerId] = dataUrl;
    state.settings['bannerIsGif_' + positioner.bannerId] = false;
    save();
    toast('Imagem aplicada (apenas local — sem ligação à nuvem)');
  }
}

function removeBanner(bannerId) {
  const banner = document.getElementById(bannerId);
  if (banner) {
    banner.style.backgroundImage = '';
    banner.style.backgroundSize = '';
    banner.style.backgroundPosition = '';
  }
  const isGif = state.settings['bannerIsGif_' + bannerId];
  _deleteFromStorage(`banners/${bannerId}${isGif ? '.gif' : '.jpg'}`);
  delete state.settings['banner_' + bannerId];
  delete state.settings['bannerIsGif_' + bannerId];
  save();
  toast('Imagem removida!');
}

// Drag logic for positioner
(function setupPositionerDrag() {
  document.addEventListener('DOMContentLoaded', () => {
    const vp = document.getElementById('positionerViewport');
    if (!vp) return;
    vp.addEventListener('mousedown', e => {
      positioner.isDragging = true;
      positioner.startX = e.clientX;
      positioner.startY = e.clientY;
      positioner.startOffX = positioner.offsetX;
      positioner.startOffY = positioner.offsetY;
      e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if (!positioner.isDragging) return;
      positioner.offsetX = positioner.startOffX + (e.clientX - positioner.startX);
      positioner.offsetY = positioner.startOffY + (e.clientY - positioner.startY);
      applyPositionerTransform();
    });
    window.addEventListener('mouseup', () => { positioner.isDragging = false; });

    vp.addEventListener('touchstart', e => {
      const t = e.touches[0];
      positioner.isDragging = true;
      positioner.startX = t.clientX;
      positioner.startY = t.clientY;
      positioner.startOffX = positioner.offsetX;
      positioner.startOffY = positioner.offsetY;
      e.preventDefault();
    }, { passive: false });
    window.addEventListener('touchmove', e => {
      if (!positioner.isDragging) return;
      const t = e.touches[0];
      positioner.offsetX = positioner.startOffX + (t.clientX - positioner.startX);
      positioner.offsetY = positioner.startOffY + (t.clientY - positioner.startY);
      applyPositionerTransform();
    }, { passive: false });
    window.addEventListener('touchend', () => { positioner.isDragging = false; });
  });
})();

function restoreBanners() {
  Object.keys(state.settings).forEach(k => {
    if (k.startsWith('banner_') && !k.startsWith('bannerIsGif_')) {
      const bannerId = k.replace('banner_', '');
      const el = document.getElementById(bannerId);
      if (el) {
        el.style.backgroundImage = `url(${state.settings[k]})`;
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
      }
    }
  });
}

// ===== TASKS =====
function addTask() {
  const title = document.getElementById('taskTitle').value.trim();
  if (!title) { toast('Dê um nome à tarefa!'); return; }
  const taskDate = document.getElementById('taskDate').value;
  const task = {
    id: uid(), title,
    category: document.getElementById('taskCategory').value,
    priority: document.getElementById('taskPriority').value,
    date: taskDate,
    notes: document.getElementById('taskNotes').value.trim(),
    done: false,
  };
  state.tasks.push(task);
  // Se tem data, adicionar automaticamente ao calendário
  if (taskDate) {
    state.calendarEvents.push({
      id: uid(),
      title: title,
      date: taskDate,
      type: 'task',
      refId: task.id,
      color: task.priority === 'high' ? '#d4889a' : task.priority === 'med' ? '#d4b896' : '#89c4a4',
    });
  }
  save();
  closeModal('taskModal');
  document.getElementById('taskTitle').value = '';
  document.getElementById('taskNotes').value = '';
  renderTasks(); renderDashboard(); renderCalendar();
  toast('Tarefa adicionada!');
}
function toggleTask(id) {
  const t = state.tasks.find(t => t.id === id);
  if (t) { t.done = !t.done; save(); renderTasks(); renderDashboard(); }
}
function deleteTask(id) {
  state.tasks = state.tasks.filter(t => t.id !== id);
  // Remove eventos do calendário associados
  state.calendarEvents = state.calendarEvents.filter(e => e.refId !== id);
  save(); renderTasks(); renderDashboard(); renderCalendar(); toast('Tarefa removida.');
}
function filterTasks(f, btn) {
  state.taskFilter = f;
  document.querySelectorAll('#page-planner .tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  renderTasks();
}
function renderTasks() {
  const f = state.taskFilter;
  let tasks = state.tasks;
  if (f === 'today') tasks = tasks.filter(t => t.date === today());
  else if (f === 'upcoming') tasks = tasks.filter(t => t.date > today());
  else if (f === 'done') tasks = tasks.filter(t => t.done);

  ['high', 'med', 'low'].forEach(p => {
    const col = document.getElementById('tasks' + p.charAt(0).toUpperCase() + p.slice(1));
    if (!col) return;
    const items = tasks.filter(t => t.priority === p);
    if (!items.length) { col.innerHTML = '<div class="empty-state">Nenhuma tarefa aqui ✦</div>'; return; }
    col.innerHTML = items.map(t => `
      <div class="task-item ${t.done ? 'done' : ''}">
        <div class="task-item-top">
          <div class="task-checkbox ${t.done ? 'checked' : ''}" onclick="toggleTask('${t.id}')">${t.done ? '✓' : ''}</div>
          <span class="task-item-title">${t.title}</span>
          <button class="task-item-delete" onclick="deleteTask('${t.id}')">✕</button>
        </div>
        <div class="task-item-meta">
          <span class="task-tag">${t.category}</span>
          ${t.date ? `<span class="task-tag task-date-tag">${fmtDate(t.date)}</span>` : ''}
        </div>
        ${t.notes ? `<div style="font-size:0.78rem;color:var(--text3);margin-top:0.4rem;">${t.notes}</div>` : ''}
      </div>`).join('');
  });
}

// ===== FINANCE =====
function setTransactionType(type) {
  state.currentTransType = type;
  document.getElementById('typeIncome').classList.toggle('active', type === 'income');
  document.getElementById('typeExpense').classList.toggle('active', type === 'expense');
}

// FIX: resetar seleção de tipo ao abrir modal de transação
function openTransactionModal() {
  state.currentTransType = null;
  const incomeBtn = document.getElementById('typeIncome');
  const expenseBtn = document.getElementById('typeExpense');
  if (incomeBtn) incomeBtn.classList.remove('active');
  if (expenseBtn) expenseBtn.classList.remove('active');
  // Limpar campos
  const titleEl = document.getElementById('transTitle');
  const amountEl = document.getElementById('transAmount');
  if (titleEl) titleEl.value = '';
  if (amountEl) amountEl.value = '';
  openModal('transactionModal');
}

function updateCategorySelect() {
  const sel = document.getElementById('transCategory');
  if (!sel) return;
  sel.innerHTML = state.categories.map(c => `<option value="${c.name}">${c.icon} ${c.name}</option>`).join('');
}

function _recalcAccountBalances() {
  state.accounts.forEach(acc => {
    acc.balance = state.transactions
      .filter(t => t.account === acc.name)
      .reduce((sum, t) => sum + (t.type === 'income' ? t.amount : -t.amount), 0);
  });
}

function addTransaction() {
  if (!state.currentTransType) { toast('Selecione Entrada ou Saída!'); return; }
  const title = document.getElementById('transTitle').value.trim();
  const amount = parseFloat(document.getElementById('transAmount').value);
  if (!title || isNaN(amount) || amount <= 0) { toast('Preencha todos os campos!'); return; }
  const t = {
    id: uid(), title, amount,
    type: state.currentTransType,
    category: document.getElementById('transCategory').value,
    account: document.getElementById('transAccount').value,
    date: document.getElementById('transDate').value || today(),
  };
  state.transactions.push(t);
  _recalcAccountBalances();
  save();
  closeModal('transactionModal');
  renderFinance(); renderDashboard();
  toast('Transação adicionada!');
}

function deleteTransaction(id) {
  state.transactions = state.transactions.filter(t => t.id !== id);
  _recalcAccountBalances();
  save(); renderFinance(); renderDashboard(); toast('Transação removida.');
}

function addAccount() {
  const name = document.getElementById('accountName').value.trim();
  const balance = parseFloat(document.getElementById('accountBalance').value) || 0;
  if (!name) { toast('Dê um nome à conta!'); return; }
  state.accounts.push({ id: uid(), name, balance });
  save(); closeModal('accountModal');
  document.getElementById('accountName').value = '';
  document.getElementById('accountBalance').value = '';
  updateAccountSelect(); renderFinance();
  toast('Conta adicionada!');
}

function deleteAccount(id) {
  state.accounts = state.accounts.filter(a => a.id !== id);
  save(); renderFinance(); updateAccountSelect();
}

function updateAccountSelect() {
  const sel = document.getElementById('transAccount');
  if (!sel) return;
  sel.innerHTML = state.accounts.map(a => `<option value="${a.name}">${a.name}</option>`).join('');
}

function filterTransactions(f, btn) {
  state.transFilter = f;
  document.querySelectorAll('#page-finance .tab-bar.small .tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  renderTransactionsList();
}

// ===== CATEGORY EDITOR =====
function openCategoryModal() {
  renderCategoryEditor();
  openModal('categoryModal');
}
function closeCategoryModal() {
  closeModal('categoryModal');
  renderFinance();
}
function renderCategoryEditor() {
  const list = document.getElementById('categoryEditorList');
  if (!list) return;
  list.innerHTML = state.categories.map(c => `
    <div class="category-editor-item">
      <span class="category-editor-icon">${c.icon}</span>
      <span class="category-editor-name">${c.name}</span>
      <button class="category-editor-del" onclick="deleteCategory('${c.id}')">✕ Remover</button>
    </div>`).join('');
  updateCategorySelect();
}
function addCategory() {
  const name = document.getElementById('newCatName').value.trim();
  const icon = document.getElementById('newCatIcon').value.trim() || '🏷';
  if (!name) { toast('Dê um nome à categoria!'); return; }
  if (state.categories.find(c => c.name.toLowerCase() === name.toLowerCase())) { toast('Categoria já existe!'); return; }
  state.categories.push({ id: uid(), icon, name });
  save();
  document.getElementById('newCatName').value = '';
  document.getElementById('newCatIcon').value = '';
  renderCategoryEditor();
  toast('Categoria adicionada!');
}
function deleteCategory(id) {
  state.categories = state.categories.filter(c => c.id !== id);
  save(); renderCategoryEditor();
  toast('Categoria removida.');
}

// ===== FINANCE RENDER =====
function renderFinance() {
  const income = state.transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = state.transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const savings = state.transactions.filter(t => t.category === 'Poupança').reduce((s, t) => s + t.amount, 0);
  setText('totalIncome', fmtEur(income));
  setText('totalExpense', fmtEur(expense));
  setText('totalBalance', fmtEur(income - expense));
  setText('totalSavings', fmtEur(savings));

  const accList = document.getElementById('accountsList');
  if (accList) {
    accList.innerHTML = state.accounts.length === 0 ? '<div class="empty-state">Nenhuma conta ainda ✦</div>'
      : state.accounts.map(a => `
        <div class="account-card">
          <button class="account-delete" onclick="deleteAccount('${a.id}')">✕</button>
          <div class="account-card-name">🏦 ${a.name}</div>
          <div class="account-card-balance">${fmtEur(a.balance)}</div>
        </div>`).join('');
  }

  const catTotals = {};
  state.categories.forEach(c => { catTotals[c.name] = 0; });
  state.transactions.filter(t => t.type === 'expense').forEach(t => {
    if (catTotals[t.category] !== undefined) catTotals[t.category] += t.amount;
    else catTotals[t.category] = t.amount;
  });
  const maxCat = Math.max(...Object.values(catTotals), 1);

  const catGrid = document.getElementById('categoriesGrid');
  if (catGrid) {
    catGrid.innerHTML = state.categories.map(c => `
      <div class="category-card">
        <div class="category-card-name">${c.icon} ${c.name}</div>
        <div class="category-card-value">${fmtEur(catTotals[c.name] || 0)}</div>
        <div class="category-card-bar"><div class="category-card-bar-fill" style="width:${((catTotals[c.name] || 0) / maxCat * 100).toFixed(1)}%"></div></div>
      </div>`).join('');
  }

  renderPieChart(catTotals);
  renderTransactionsList();
  updateAccountSelect();
  updateCategorySelect();
}

// ===== PIE CHART =====
const PIE_COLORS = [
  '#b8a9e8','#89c4a4','#d4889a','#d4b896','#7ec8e3',
  '#f0c080','#a8d8a8','#e8a0b4','#98c4d8','#c8a8e8',
  '#d4c080','#a0c8a0','#e8b8c8','#80b8d0',
];
function renderPieChart(catTotals) {
  const canvas = document.getElementById('pieChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const entries = Object.entries(catTotals).filter(([, v]) => v > 0);
  const total = entries.reduce((s, [, v]) => s + v, 0);

  if (total === 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '13px DM Sans'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Sem dados', w / 2, h / 2);
    document.getElementById('pieLegend').innerHTML = '';
    return;
  }

  let startAngle = -Math.PI / 2;
  const cx = w / 2, cy = h / 2, r = w / 2 - 6, innerR = r * 0.52;

  entries.forEach(([name, val], i) => {
    const slice = (val / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, startAngle, startAngle + slice);
    ctx.closePath();
    ctx.fillStyle = PIE_COLORS[i % PIE_COLORS.length];
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    startAngle += slice;
  });

  ctx.beginPath(); ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#1a1a26';
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = 'bold 11px DM Sans'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(fmtEur(total), cx, cy);

  const legend = document.getElementById('pieLegend');
  if (legend) {
    legend.innerHTML = entries.slice(0, 8).map(([name, val], i) => `
      <div class="pie-legend-item">
        <span class="pie-legend-dot" style="background:${PIE_COLORS[i % PIE_COLORS.length]}"></span>
        <span class="pie-legend-label">${name}</span>
        <span class="pie-legend-val">${fmtEur(val)}</span>
      </div>`).join('');
  }
}

function renderTransactionsList() {
  const list = document.getElementById('transactionsList');
  if (!list) return;
  let trans = [...state.transactions].sort((a, b) => b.date.localeCompare(a.date));
  if (state.transFilter === 'income') trans = trans.filter(t => t.type === 'income');
  if (state.transFilter === 'expense') trans = trans.filter(t => t.type === 'expense');
  if (!trans.length) { list.innerHTML = '<div class="empty-state">Nenhuma transação ainda ✦</div>'; return; }

  const groups = {};
  trans.forEach(t => { const g = t.date || today(); if (!groups[g]) groups[g] = []; groups[g].push(t); });
  list.innerHTML = Object.keys(groups).sort((a, b) => b.localeCompare(a)).map(date => `
    <div class="transaction-group-label">${fmtDate(date)}</div>
    ${groups[date].map(t => `
      <div class="transaction-item">
        <div class="trans-icon ${t.type}">${t.type === 'income' ? '↑' : '↓'}</div>
        <div class="trans-info">
          <div class="trans-title">${t.title}</div>
          <div class="trans-meta">${t.category} · ${t.account}</div>
        </div>
        <div class="trans-amount ${t.type}">${t.type === 'income' ? '+' : '−'}${fmtEur(t.amount)}</div>
        <button class="trans-delete" onclick="deleteTransaction('${t.id}')">✕</button>
      </div>`).join('')}`).join('');
}

// ===== GOALS =====
function addGoal() {
  const title = document.getElementById('goalTitle').value.trim();
  if (!title) { toast('Dê um título à meta!'); return; }
  const deadline = document.getElementById('goalDeadline').value;
  const goal = {
    id: uid(), title,
    desc: document.getElementById('goalDesc').value.trim(),
    target: parseFloat(document.getElementById('goalTarget').value) || 0,
    current: 0,
    deadline,
    category: document.getElementById('goalCategory').value,
    completed: false,
  };
  state.goals.push(goal);
  // Adicionar ao calendário se tiver data de conclusão
  if (deadline) {
    state.calendarEvents.push({
      id: uid(),
      title: '🎯 ' + title,
      date: deadline,
      type: 'goal',
      refId: goal.id,
      color: '#b8a9e8',
    });
  }
  save(); closeModal('goalModal');
  document.getElementById('goalTitle').value = '';
  document.getElementById('goalDesc').value = '';
  document.getElementById('goalTarget').value = '';
  renderGoals(); renderDashboard(); renderCalendar(); toast('Meta criada!');
}
function updateGoalProgress(id, val) {
  const g = state.goals.find(g => g.id === id);
  if (g) { g.current = parseFloat(val) || 0; save(); renderGoals(); }
}
function toggleGoal(id) {
  const g = state.goals.find(g => g.id === id);
  if (g) { g.completed = !g.completed; save(); renderGoals(); renderDashboard(); }
}
function deleteGoal(id) {
  state.goals = state.goals.filter(g => g.id !== id);
  state.calendarEvents = state.calendarEvents.filter(e => e.refId !== id);
  save(); renderGoals(); renderDashboard(); renderCalendar(); toast('Meta removida.');
}
function renderGoals() {
  const list = document.getElementById('goalsList');
  if (!list) return;
  if (!state.goals.length) { list.innerHTML = '<div class="empty-state">Nenhuma meta ainda. Sonha alto ◎</div>'; return; }
  list.innerHTML = state.goals.map(g => {
    const pct = g.target > 0 ? Math.min(100, (g.current / g.target) * 100).toFixed(0) : 0;
    return `<div class="goal-card ${g.completed ? 'completed' : ''}">
      <div class="goal-category">${g.category}</div>
      <div class="goal-title">${g.title}</div>
      ${g.desc ? `<div class="goal-desc">${g.desc}</div>` : ''}
      ${g.target > 0 ? `
        <div class="goal-progress-bar"><div class="goal-progress-fill" style="width:${pct}%"></div></div>
        <div class="goal-progress-label">${fmtEur(g.current)} de ${fmtEur(g.target)} (${pct}%)</div>
        <input type="number" class="goal-progress-input" placeholder="Atualizar progresso em €..." min="0" step="0.01"
          onchange="updateGoalProgress('${g.id}', this.value)" />` : ''}
      <div class="goal-footer">
        <div class="goal-deadline">${g.deadline ? '📅 ' + fmtDate(g.deadline) : ''}</div>
        <div class="goal-actions">
          <button class="goal-btn complete" onclick="toggleGoal('${g.id}')">${g.completed ? '↩ Reabrir' : '✓ Concluir'}</button>
          <button class="goal-btn" onclick="deleteGoal('${g.id}')">✕</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ===== NOTES =====
function setMood(mood, btn) {
  state.currentMood = mood;
  document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function handleNoteImages(input) {
  const files = Array.from(input.files);
  files.forEach(file => {
    const r = new FileReader();
    r.onload = e => {
      pendingNoteImages.push(e.target.result);
      renderNoteImagesPreview();
    };
    r.readAsDataURL(file);
  });
  input.value = '';
}

function renderNoteImagesPreview() {
  const preview = document.getElementById('noteImagesPreview');
  if (!preview) return;
  preview.innerHTML = pendingNoteImages.map((src, i) => `
    <div class="note-img-thumb">
      <img src="${src}" alt="" />
      <button class="note-img-thumb-del" onclick="removePendingImage(${i})">✕</button>
    </div>`).join('');
}

function removePendingImage(i) {
  pendingNoteImages.splice(i, 1);
  renderNoteImagesPreview();
}

function addNote() {
  const content = document.getElementById('noteContent').value.trim();
  if (!content && pendingNoteImages.length === 0) { toast('Escreva algo ou adicione uma imagem!'); return; }
  state.notes.unshift({
    id: uid(),
    title: document.getElementById('noteTitle').value.trim() || 'Nota sem título',
    content,
    mood: state.currentMood,
    images: [...pendingNoteImages],
    date: new Date().toISOString(),
  });
  save(); closeModal('noteModal');
  document.getElementById('noteTitle').value = '';
  document.getElementById('noteContent').value = '';
  pendingNoteImages = [];
  renderNoteImagesPreview();
  renderNotes(); renderDashboard();
  toast('Nota salva!');
}

function deleteNote(id) {
  state.notes = state.notes.filter(n => n.id !== id);
  save(); renderNotes(); renderDashboard(); toast('Nota removida.');
}

function renderNotes() {
  const list = document.getElementById('notesList');
  if (!list) return;
  if (!state.notes.length) { list.innerHTML = '<div class="empty-state">Cria a tua primeira nota ✧</div>'; return; }
  list.innerHTML = state.notes.map(n => {
    const imgCount = n.images ? n.images.length : 0;
    let imgClass = '', imgsHtml = '';
    if (imgCount === 1) { imgClass = 'count-1'; imgsHtml = `<img src="${n.images[0]}" alt="" />`; }
    else if (imgCount === 2) { imgClass = 'count-2'; imgsHtml = n.images.map(s => `<img src="${s}" alt="" />`).join(''); }
    else if (imgCount === 3) { imgClass = 'count-3'; imgsHtml = n.images.map(s => `<img src="${s}" alt="" />`).join(''); }
    else if (imgCount >= 4) { imgClass = 'count-many'; imgsHtml = n.images.slice(0, 4).map((s, i) => i === 3 && imgCount > 4 ? `<div style="position:relative;"><img src="${s}" alt="" /><div style="position:absolute;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;color:white;font-size:1.2rem;font-family:'Cormorant Garamond',serif;">+${imgCount - 4}</div></div>` : `<img src="${s}" alt="" />`).join(''); }

    return `<div class="note-card">
      ${imgCount > 0 ? `<div class="note-card-images ${imgClass}">${imgsHtml}</div>` : ''}
      <div class="note-card-body">
        <div class="note-card-top">
          <div class="note-card-title">${n.title}</div>
          <div style="display:flex;align-items:center;gap:0.4rem;">
            <span class="note-card-mood">${n.mood}</span>
            <button class="note-delete" onclick="event.stopPropagation();deleteNote('${n.id}')">✕</button>
          </div>
        </div>
        <div class="note-card-date">${new Date(n.date).toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        ${n.content ? `<div class="note-card-preview">${n.content}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ===== HABITS =====
function addHabit() {
  const title = document.getElementById('habitTitle').value.trim();
  if (!title) { toast('Dê um nome ao hábito!'); return; }
  state.habits.push({
    id: uid(), title,
    icon: document.getElementById('habitIcon').value || '✦',
    freq: document.getElementById('habitFreq').value,
    goal: parseInt(document.getElementById('habitGoal').value) || 1,
    counts: {},
  });
  save(); closeModal('habitModal');
  document.getElementById('habitTitle').value = '';
  document.getElementById('habitIcon').value = '';
  document.getElementById('habitGoal').value = '1';
  renderHabits(); renderDashboard(); toast('Hábito criado!');
}
function incrementHabit(id) {
  const h = state.habits.find(h => h.id === id); if (!h) return;
  const t = today(); h.counts[t] = (h.counts[t] || 0) + 1;
  save(); renderHabits(); renderDashboard();
}
function decrementHabit(id) {
  const h = state.habits.find(h => h.id === id); if (!h) return;
  const t = today(); h.counts[t] = Math.max(0, (h.counts[t] || 0) - 1);
  save(); renderHabits();
}
function deleteHabit(id) {
  state.habits = state.habits.filter(h => h.id !== id);
  save(); renderHabits(); renderDashboard(); toast('Hábito removido.');
}
function renderHabits() {
  const list = document.getElementById('habitsList');
  if (!list) return;
  if (!state.habits.length) { list.innerHTML = '<div class="empty-state">Cria o teu primeiro hábito ◉</div>'; return; }
  list.innerHTML = state.habits.map(h => {
    const count = h.counts[today()] || 0;
    const pct = Math.min(100, (count / h.goal) * 100);
    const done = count >= h.goal;
    return `<div class="habit-card">
      <button class="habit-delete" onclick="deleteHabit('${h.id}')">✕</button>
      <div class="habit-icon">${h.icon}</div>
      <div class="habit-title">${h.title}</div>
      <div class="habit-freq">${h.freq}</div>
      <svg class="habit-ring" viewBox="0 0 60 60">
        <circle cx="30" cy="30" r="26" fill="none" stroke="var(--border)" stroke-width="4"/>
        <circle cx="30" cy="30" r="26" fill="none" stroke="${done ? 'var(--accent-green)' : 'var(--accent)'}" stroke-width="4"
          stroke-dasharray="${2 * Math.PI * 26}" stroke-dashoffset="${2 * Math.PI * 26 * (1 - pct / 100)}"
          stroke-linecap="round" transform="rotate(-90 30 30)" style="transition:stroke-dashoffset 0.4s ease;"/>
        <text x="30" y="35" text-anchor="middle" fill="var(--text)" font-size="11" font-family="DM Sans">${count}/${h.goal}</text>
      </svg>
      <div class="habit-counter">
        <button class="habit-count-btn" onclick="decrementHabit('${h.id}')">−</button>
        <button class="habit-count-btn" onclick="incrementHabit('${h.id}')" style="${done ? 'border-color:var(--accent-green);color:var(--accent-green);' : ''}">+</button>
      </div>
    </div>`;
  }).join('');
}

// ===== CALENDAR =====
let calendarCurrentDate = new Date();

function renderCalendar() {
  const calEl = document.getElementById('calendarGrid');
  if (!calEl) return;

  const year = calendarCurrentDate.getFullYear();
  const month = calendarCurrentDate.getMonth();

  // Header
  const monthNames = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const monthLabel = document.getElementById('calMonthLabel');
  if (monthLabel) monthLabel.textContent = `${monthNames[month]} ${year}`;

  const firstDay = new Date(year, month, 1).getDay(); // 0=dom
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = (firstDay + 6) % 7; // segunda=0

  // Coletar eventos do mês
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthEvents = state.calendarEvents.filter(e => e.date && e.date.startsWith(monthStr));

  // Tarefas do mês (que não foram adicionadas como evento)
  const taskEvents = state.tasks.filter(t => t.date && t.date.startsWith(monthStr) && !state.calendarEvents.find(e => e.refId === t.id));

  let html = '';
  const dayNames = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];
  html += dayNames.map(d => `<div class="cal-day-header">${d}</div>`).join('');

  for (let i = 0; i < startOffset; i++) html += '<div class="cal-day cal-day-empty"></div>';

  const todayStr = today();
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isToday = dateStr === todayStr;
    const dayEvts = [...monthEvents.filter(e => e.date === dateStr), ...taskEvents.filter(t => t.date === dateStr).map(t => ({ title: t.title, color: t.priority === 'high' ? '#d4889a' : t.priority === 'med' ? '#d4b896' : '#89c4a4' }))];

    html += `<div class="cal-day ${isToday ? 'cal-day-today' : ''}" onclick="openCalendarDay('${dateStr}')">
      <div class="cal-day-num">${d}</div>
      <div class="cal-day-events">
        ${dayEvts.slice(0, 3).map(e => `<div class="cal-event-dot" style="background:${e.color || 'var(--accent)'};" title="${e.title}"></div>`).join('')}
        ${dayEvts.length > 3 ? `<div class="cal-event-more">+${dayEvts.length - 3}</div>` : ''}
      </div>
    </div>`;
  }

  calEl.innerHTML = html;
  renderCalendarList();
}

function calendarPrev() {
  calendarCurrentDate.setMonth(calendarCurrentDate.getMonth() - 1);
  renderCalendar();
}
function calendarNext() {
  calendarCurrentDate.setMonth(calendarCurrentDate.getMonth() + 1);
  renderCalendar();
}
function calendarToday() {
  calendarCurrentDate = new Date();
  renderCalendar();
}

function openCalendarDay(dateStr) {
  const dayEvts = state.calendarEvents.filter(e => e.date === dateStr);
  const dayTasks = state.tasks.filter(t => t.date === dateStr);
  const d = new Date(dateStr + 'T00:00:00');
  const label = d.toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  document.getElementById('calDayTitle').textContent = label;
  document.getElementById('calDayDate').value = dateStr;

  const list = document.getElementById('calDayEventsList');
  let items = '';

  dayTasks.forEach(t => {
    items += `<div class="cal-day-event-item">
      <span class="cal-event-type-dot" style="background:${t.priority === 'high' ? '#d4889a' : t.priority === 'med' ? '#d4b896' : '#89c4a4'}"></span>
      <span style="flex:1">✦ ${t.title}</span>
      <span style="font-size:0.72rem;color:var(--text3)">Tarefa</span>
    </div>`;
  });

  dayEvts.forEach(e => {
    if (e.type !== 'task') {
      items += `<div class="cal-day-event-item">
        <span class="cal-event-type-dot" style="background:${e.color || 'var(--accent)'}"></span>
        <span style="flex:1">${e.title}</span>
        <button style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:0.8rem;" onclick="deleteCalendarEvent('${e.id}')">✕</button>
      </div>`;
    }
  });

  list.innerHTML = items || '<div style="color:var(--text3);font-size:0.85rem;padding:0.5rem 0;">Nenhum evento neste dia.</div>';
  openModal('calendarDayModal');
}

function deleteCalendarEvent(id) {
  state.calendarEvents = state.calendarEvents.filter(e => e.id !== id);
  save();
  renderCalendar();
  // Re-render modal
  const modal = document.getElementById('calendarDayModal');
  if (modal && modal.classList.contains('open')) {
    const dateStr = document.getElementById('calDayDate').value;
    if (dateStr) openCalendarDay(dateStr);
  }
}

function addCalendarEvent() {
  const title = document.getElementById('calEventTitle').value.trim();
  const date = document.getElementById('calDayDate').value;
  const type = document.getElementById('calEventType').value;
  if (!title || !date) { toast('Preencha o título e a data!'); return; }

  const colors = { aviso: '#d4b896', meta: '#b8a9e8', tarefa: '#89c4a4', outro: '#7ec8e3' };
  state.calendarEvents.push({
    id: uid(), title, date, type, color: colors[type] || 'var(--accent)',
  });
  save();
  document.getElementById('calEventTitle').value = '';
  renderCalendar();
  openCalendarDay(date);
  toast('Evento adicionado!');
}

function renderCalendarList() {
  const listEl = document.getElementById('calendarUpcoming');
  if (!listEl) return;
  const todayStr = today();
  const upcoming = state.calendarEvents
    .filter(e => e.date >= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 8);

  const taskUpcoming = state.tasks
    .filter(t => t.date && t.date >= todayStr && !t.done)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5);

  const all = [
    ...upcoming.map(e => ({ ...e, _isEvent: true })),
    ...taskUpcoming.filter(t => !state.calendarEvents.find(e => e.refId === t.id)).map(t => ({
      title: t.title, date: t.date, color: t.priority === 'high' ? '#d4889a' : t.priority === 'med' ? '#d4b896' : '#89c4a4', _isEvent: false
    }))
  ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 10);

  if (!all.length) { listEl.innerHTML = '<div class="empty-state">Nenhum evento próximo ✦</div>'; return; }
  listEl.innerHTML = all.map(e => `
    <div class="cal-list-item">
      <div class="cal-list-dot" style="background:${e.color}"></div>
      <div class="cal-list-info">
        <div class="cal-list-title">${e.title}</div>
        <div class="cal-list-date">${fmtDate(e.date)}</div>
      </div>
    </div>`).join('');
}

// ===== FEEDBACK =====
function openFeedback() {
  document.getElementById('feedbackText').value = '';
  document.getElementById('feedbackType').value = 'bug';
  openModal('feedbackModal');
}

function submitFeedback() {
  const text = document.getElementById('feedbackText').value.trim();
  const type = document.getElementById('feedbackType').value;
  if (!text) { toast('Escreva seu feedback!'); return; }

  // Salvar feedback localmente
  if (!state.feedbacks) state.feedbacks = [];
  state.feedbacks.push({
    id: uid(),
    type, text,
    date: new Date().toISOString(),
  });
  save();
  closeModal('feedbackModal');
  toast('Obrigado pelo feedback! ✦');
}

// ===== DASHBOARD =====
function renderDashboard() {
  const todayTasks = state.tasks.filter(t => !t.done && (t.date === today() || !t.date));
  setText('tasksToday', todayTasks.length);

  const income = state.transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = state.transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  setText('summaryBalance', fmtEur(income - expense));

  const hDone = state.habits.filter(h => (h.counts[today()] || 0) >= h.goal).length;
  setText('habitsToday', `${hDone}/${state.habits.length}`);
  setText('activeGoals', state.goals.filter(g => !g.completed).length);

  const upcoming = document.getElementById('upcomingTasks');
  if (upcoming) {
    const items = state.tasks.filter(t => !t.done).slice(0, 5);
    const colors = { high: 'var(--accent-red)', med: 'var(--accent-gold)', low: 'var(--accent-green)' };
    upcoming.innerHTML = items.length
      ? items.map(t => `<div class="task-preview-item">
          <span class="task-preview-dot" style="background:${colors[t.priority]}"></span>
          <span class="task-preview-title">${t.title}</span>
          <span class="task-preview-date">${t.date ? fmtDate(t.date) : ''}</span>
        </div>`).join('')
      : '<div class="empty-state">Sem tarefas pendentes ✦</div>';
  }

  const fp = document.getElementById('financePreview');
  if (fp) {
    const savings = state.transactions.filter(t => t.category === 'Poupança').reduce((s, t) => s + t.amount, 0);
    fp.innerHTML = `
      <div class="finance-preview-row"><span class="fp-label">↑ Entradas</span><span class="fp-value green">${fmtEur(income)}</span></div>
      <div class="finance-preview-row"><span class="fp-label">↓ Saídas</span><span class="fp-value red">${fmtEur(expense)}</span></div>
      <div class="finance-preview-row"><span class="fp-label">◈ Saldo</span><span class="fp-value">${fmtEur(income - expense)}</span></div>
      <div class="finance-preview-row"><span class="fp-label">💰 Poupança</span><span class="fp-value">${fmtEur(savings)}</span></div>`;
  }

  const lastNote = document.getElementById('lastNote');
  if (lastNote) {
    if (state.notes.length > 0) {
      const n = state.notes[0];
      lastNote.innerHTML = `<div style="display:flex;gap:0.75rem;align-items:flex-start;">
        ${n.images && n.images[0] ? `<img src="${n.images[0]}" style="width:60px;height:60px;object-fit:cover;border-radius:8px;flex-shrink:0;" />` : `<span style="font-size:1.5rem">${n.mood}</span>`}
        <div>
          <div style="font-family:'Cormorant Garamond',serif;font-size:1rem;color:var(--text);margin-bottom:0.2rem;">${n.title}</div>
          <div style="font-size:0.75rem;color:var(--text3);margin-bottom:0.4rem;">${new Date(n.date).toLocaleDateString('pt-PT')}</div>
          <div style="font-family:'Cormorant Garamond',serif;font-style:italic;color:var(--text2);font-size:0.92rem;line-height:1.6;">${n.content ? n.content.slice(0, 160) + (n.content.length > 160 ? '…' : '') : ''}</div>
        </div></div>`;
    } else {
      lastNote.textContent = 'Nenhuma nota ainda. Começa a registar os teus pensamentos ✦';
    }
  }
}

function renderAll() {
  // Sempre actualiza o dashboard (está visível no overview)
  renderDashboard();
  // Só renderiza o módulo da página activa para evitar lag
  const activePage = document.querySelector('.page.active');
  if (!activePage) return;
  const id = activePage.id.replace('page-', '');
  switch (id) {
    case 'planner':    renderTasks(); break;
    case 'finance':    renderFinance(); break;
    case 'goals':      renderGoals(); break;
    case 'notes':      renderNotes(); break;
    case 'habits':     renderHabits(); break;
    case 'calendar':   renderCalendar(); break;
    case 'morning':    renderMorningRoutine(); break;
    case 'dashboard':
      renderTasks(); renderFinance(); renderGoals(); renderNotes(); renderHabits();
      break;
  }
}

// ===== MODO FOCO NOTURNO =====
let focusTimer = null;
let focusSeconds = 25 * 60;
let focusRunning = false;
let focusTotalSeconds = 25 * 60;

function openFocusMode() {
  const overlay = document.getElementById('focusOverlay');
  overlay.classList.add('open');
  spawnFocusParticles();
  rotateFocusQuote();
}
function closeFocusMode() {
  document.getElementById('focusOverlay').classList.remove('open');
  if (focusTimer) { clearInterval(focusTimer); focusTimer = null; }
  focusRunning = false;
  const btn = document.getElementById('focusStartBtn');
  if (btn) btn.textContent = '▶ Iniciar';
}
function toggleFocusTimer() {
  const btn = document.getElementById('focusStartBtn');
  if (focusRunning) {
    clearInterval(focusTimer); focusTimer = null;
    focusRunning = false;
    if (btn) btn.textContent = '▶ Continuar';
  } else {
    focusRunning = true;
    if (btn) btn.textContent = '⏸ Pausar';
    focusTimer = setInterval(() => {
      focusSeconds--;
      renderFocusTimer();
      if (focusSeconds <= 0) {
        clearInterval(focusTimer); focusTimer = null;
        focusRunning = false;
        if (btn) btn.textContent = '▶ Iniciar';
        toast('Sessão concluída! ✦');
      }
    }, 1000);
  }
}
function resetFocusTimer() {
  if (focusTimer) { clearInterval(focusTimer); focusTimer = null; }
  focusRunning = false;
  focusSeconds = focusTotalSeconds;
  renderFocusTimer();
  const btn = document.getElementById('focusStartBtn');
  if (btn) btn.textContent = '▶ Iniciar';
}
function setFocusMode(minutes, label, btn) {
  document.querySelectorAll('.focus-mode-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (focusTimer) { clearInterval(focusTimer); focusTimer = null; }
  focusRunning = false;
  focusTotalSeconds = minutes * 60;
  focusSeconds = focusTotalSeconds;
  const lbl = document.getElementById('focusTimerLabel');
  if (lbl) lbl.textContent = label;
  const startBtn = document.getElementById('focusStartBtn');
  if (startBtn) startBtn.textContent = '▶ Iniciar';
  renderFocusTimer();
}
function renderFocusTimer() {
  const m = Math.floor(focusSeconds / 60).toString().padStart(2, '0');
  const s = (focusSeconds % 60).toString().padStart(2, '0');
  const el = document.getElementById('focusTimer');
  if (el) el.textContent = `${m}:${s}`;
}
function rotateFocusQuote() {
  const quotes = state.focusQuotes || ['respira fundo ✦'];
  const el = document.getElementById('focusQuote');
  if (!el) return;
  let i = 0;
  el.textContent = quotes[i];
  setInterval(() => {
    i = (i + 1) % quotes.length;
    el.style.opacity = '0';
    setTimeout(() => { el.textContent = quotes[i]; el.style.opacity = '1'; }, 400);
  }, 8000);
}
function spawnFocusParticles() {
  const container = document.getElementById('focusParticles');
  if (!container) return;
  container.innerHTML = '';
  for (let i = 0; i < 25; i++) {
    const p = document.createElement('div');
    p.className = 'focus-particle';
    const left = Math.random() * 100;
    const drift = (Math.random() - 0.5) * 120;
    const duration = 8 + Math.random() * 12;
    const delay = Math.random() * 8;
    p.style.cssText = `left:${left}%;bottom:0;--drift:${drift}px;animation-duration:${duration}s;animation-delay:${delay}s;`;
    container.appendChild(p);
  }
}

// ===== JARDIM DE HÁBITOS =====
const GARDEN_STAGES = [
  { min: 0, label: 'Semente', emojis: ['🌰','🫘','🌑'] },
  { min: 1, label: 'A crescer', emojis: ['🌱','🌿','☘️'] },
  { min: 3, label: 'A crescer', emojis: ['🌿','🪴','🌾'] },
  { min: 7, label: 'Florescida', emojis: ['🌸','🌺','🌻','🌼','💐'] },
  { min: 21, label: 'Florescida', emojis: ['🌳','🌲','🎋'] },
];

function getHabitStreak(habit) {
  let streak = 0;
  const d = new Date();
  while (true) {
    const dateStr = d.toISOString().split('T')[0];
    if ((habit.counts[dateStr] || 0) >= habit.goal) { streak++; d.setDate(d.getDate() - 1); }
    else break;
  }
  return streak;
}

function getGardenStage(streak) {
  let stage = GARDEN_STAGES[0];
  for (const s of GARDEN_STAGES) { if (streak >= s.min) stage = s; }
  return stage;
}

function getPlantEmoji(habit, streak) {
  const stage = getGardenStage(streak);
  // Use habit id as a stable seed for emoji selection
  const seed = habit.id.charCodeAt(0) + habit.id.charCodeAt(1);
  return stage.emojis[seed % stage.emojis.length];
}

function renderGarden() {
  const grid = document.getElementById('gardenGrid');
  if (!grid) return;

  if (!state.habits.length) {
    grid.innerHTML = '<div class="empty-state">Cria hábitos na página de Hábitos para ver o teu jardim crescer 🌱</div>';
    setText('gardenTotalPlants', 0);
    setText('gardenBlooming', 0);
    setText('gardenStreak', 0);
    return;
  }

  const todayStr = today();
  let blooming = 0;
  let maxStreak = 0;

  grid.innerHTML = state.habits.map(h => {
    const streak = getHabitStreak(h);
    const stage = getGardenStage(streak);
    const emoji = getPlantEmoji(h, streak);
    const isWatered = (h.counts[todayStr] || 0) >= h.goal;
    const stageClass = stage.min >= 7 ? 'blooming' : stage.min >= 1 ? 'growing' : 'seed';
    if (isWatered) blooming++;
    if (streak > maxStreak) maxStreak = streak;
    return `
      <div class="garden-plant ${stageClass}">
        <div class="garden-plant-emoji">${emoji}</div>
        <div class="garden-plant-name">${h.title}</div>
        <div class="garden-plant-streak">${streak > 0 ? `${streak} dias seguidos 🔥` : 'Começa hoje'}</div>
        <span class="garden-plant-stage">${stage.label}</span>
        <button class="garden-water-btn ${isWatered ? 'watered' : ''}" onclick="waterPlant('${h.id}')">
          ${isWatered ? '✓ Regada hoje' : '💧 Regar'}
        </button>
      </div>`;
  }).join('');

  setText('gardenTotalPlants', state.habits.length);
  setText('gardenBlooming', blooming);
  setText('gardenStreak', maxStreak);
}

function waterPlant(habitId) {
  const h = state.habits.find(h => h.id === habitId);
  if (!h) return;
  const t = today();
  const current = h.counts[t] || 0;
  if (current >= h.goal) { toast('Já regaste esta planta hoje! 🌿'); return; }
  h.counts[t] = h.goal; // Mark as fully done
  save();
  renderGarden();
  renderHabits();
  renderDashboard();
  toast('Planta regada! 💧');
}

// ===== ROTINA MATINAL =====
const MORNING_QUOTES = [
  '"O modo como passas a manhã define o tom do dia." ✦',
  '"Pequenos rituais, grandes transformações." ✦',
  '"A manhã é uma segunda oportunidade de começar." ✦',
  '"Não tens de ser perfeita. Tens de ser consistente." ✦',
  '"O silêncio da manhã é sagrado. Honra-o." ✦',
  '"Um passo de cada vez. Isso chega." ✦',
];

function addMorningItem() {
  const title = document.getElementById('morningItemTitle').value.trim();
  if (!title) { toast('Dá um nome ao item!'); return; }
  state.morningItems.push({
    id: uid(),
    title,
    icon: document.getElementById('morningItemIcon').value.trim() || '✦',
    category: document.getElementById('morningItemCategory').value,
  });
  save();
  closeModal('morningItemModal');
  document.getElementById('morningItemTitle').value = '';
  document.getElementById('morningItemIcon').value = '';
  renderMorningRoutine();
  toast('Adicionado à rotina! 🌅');
}

function toggleMorningItem(id) {
  const t = today();
  if (!state.morningDone[t]) state.morningDone[t] = {};
  state.morningDone[t][id] = !state.morningDone[t][id];
  save();
  renderMorningRoutine();
}

function deleteMorningItem(id) {
  state.morningItems = state.morningItems.filter(i => i.id !== id);
  save();
  renderMorningRoutine();
  toast('Item removido.');
}

function resetMorningRoutine() {
  const t = today();
  state.morningDone[t] = {};
  save();
  renderMorningRoutine();
  toast('Rotina reiniciada ✦');
}

function renderMorningRoutine() {
  const list = document.getElementById('morningList');
  const bar = document.getElementById('morningProgressBar');
  const barLabel = document.getElementById('morningProgressLabel');
  const quoteEl = document.getElementById('morningQuote');
  const greetEl = document.getElementById('morningGreeting');

  if (quoteEl) {
    const q = MORNING_QUOTES[new Date().getDay() % MORNING_QUOTES.length];
    quoteEl.textContent = q;
  }
  if (greetEl) {
    const h = new Date().getHours();
    const g = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
    const name = state.settings.userName ? `, ${state.settings.userName}` : '';
    greetEl.textContent = `${g}${name}. Como começa o teu dia, começa a tua vida.`;
  }

  if (!list) return;
  const t = today();
  const done = state.morningDone[t] || {};
  const total = state.morningItems.length;
  const doneCount = state.morningItems.filter(i => done[i.id]).length;
  const pct = total > 0 ? (doneCount / total) * 100 : 0;

  if (bar) bar.style.width = pct + '%';
  if (barLabel) barLabel.textContent = `${doneCount} / ${total} concluídos`;

  if (!total) {
    list.innerHTML = '<div class="empty-state">Adiciona itens à tua rotina matinal ✦</div>';
    return;
  }

  const catLabels = { corpo: '🧘 Corpo', mente: '📖 Mente', nutricao: '🍵 Nutrição', movimento: '🏃 Movimento', outro: '✦ Outro' };

  list.innerHTML = state.morningItems.map(item => {
    const isDone = !!done[item.id];
    return `
      <div class="morning-item ${isDone ? 'done' : ''}" onclick="toggleMorningItem('${item.id}')">
        <div class="morning-item-check">${isDone ? '✓' : ''}</div>
        <div class="morning-item-icon">${item.icon}</div>
        <div class="morning-item-info">
          <div class="morning-item-title">${item.title}</div>
          <div class="morning-item-cat">${catLabels[item.category] || item.category}</div>
        </div>
        <button class="morning-item-del" onclick="event.stopPropagation();deleteMorningItem('${item.id}')">✕</button>
      </div>`;
  }).join('');
}

// ===== SPOTIFY WIDGET =====
function loadSpotifyWidget() {
  const input = document.getElementById('spotifyInput');
  const raw = (input ? input.value : '').trim();
  if (!raw) { toast('Cola um link do Spotify primeiro!'); return; }
  const match = raw.match(/open\.spotify\.com\/(track|album|playlist|artist|episode|show)\/([a-zA-Z0-9]+)/);
  if (!match) { toast('Link inválido. Usa um link do open.spotify.com'); return; }
  const [, type, id] = match;
  const embedSrc = `https://open.spotify.com/embed/${type}/${id}?utm_source=generator&theme=0`;
  const openLink = `https://open.spotify.com/${type}/${id}`;
  const iframe = document.getElementById('spotifyIframe');
  const wrap = document.getElementById('spotifyEmbedWrap');
  const empty = document.getElementById('spotifyEmpty');
  const openBtn = document.getElementById('spotifyOpenLink');
  if (iframe) iframe.src = embedSrc;
  if (wrap) wrap.style.display = 'block';
  if (empty) empty.style.display = 'none';
  if (openBtn) { openBtn.href = openLink; openBtn.style.display = 'inline-flex'; }
  state.settings.spotifyUrl = raw;
  save();
  if (input) input.value = '';
  toast('Spotify carregado ♫');
}
function restoreSpotifyWidget() {
  if (!state.settings.spotifyUrl) return;
  const raw = state.settings.spotifyUrl;
  const match = raw.match(/open\.spotify\.com\/(track|album|playlist|artist|episode|show)\/([a-zA-Z0-9]+)/);
  if (!match) return;
  const [, type, id] = match;
  const embedSrc = `https://open.spotify.com/embed/${type}/${id}?utm_source=generator&theme=0`;
  const openLink = `https://open.spotify.com/${type}/${id}`;
  const iframe = document.getElementById('spotifyIframe');
  const wrap = document.getElementById('spotifyEmbedWrap');
  const empty = document.getElementById('spotifyEmpty');
  const openBtn = document.getElementById('spotifyOpenLink');
  if (iframe) iframe.src = embedSrc;
  if (wrap) wrap.style.display = 'block';
  if (empty) empty.style.display = 'none';
  if (openBtn) { openBtn.href = openLink; openBtn.style.display = 'inline-flex'; }
}

// ===== AUTH =====
function checkAuth() {
  const raw = localStorage.getItem('lumen_user') || localStorage.getItem('eco_user');
  if (!raw) {
    window.location.href = 'login.html';
    return null;
  }
  return JSON.parse(raw);
}

function logout() {
  if (confirm('Tem a certeza que quer terminar a sessão?')) {
    localStorage.setItem('lumen_logged_out', '1');
    localStorage.removeItem('lumen_user');
    localStorage.removeItem('eco_user');
    const doSignOut = window._doFirebaseSignOut;
    if (typeof doSignOut === 'function') {
      doSignOut().finally(() => { window.location.href = 'login.html'; });
    } else {
      window.location.href = 'login.html';
    }
  }
}

function loadUserProfile() {
  const user = localStorage.getItem('lumen_user') || localStorage.getItem('eco_user');
  if (!user) return;
  const u = JSON.parse(user);
  if (!state.settings.userName && u.name) {
    state.settings.userName = u.name;
    save();
    const el = document.getElementById('userName');
    if (el) el.value = u.name;
  }
  if (!state.settings.profilePic && u.photo) {
    state.settings.profilePic = u.photo;
    const pic = document.getElementById('profilePic');
    if (pic) { pic.src = u.photo; pic.style.display = 'block'; }
  }
  updateGreeting();
}

// ===== INIT =====
async function init() {
  if (!checkAuth()) return;

  // Mostrar ecrã de loading enquanto aguarda dados da nuvem
  _showAppLoading(true);

  // Carregar localStorage como base inicial (dados offline/fallback)
  load();
  _applySettings();

  // Aplicar tema imediatamente para evitar flash
  if (state.settings.theme) {
    document.documentElement.setAttribute('data-theme', state.settings.theme);
  }

  document.querySelectorAll('input[type="date"]').forEach(el => { if (!el.value) el.value = today(); });
  setInterval(updateGreeting, 60000);

  // Registar callback que o Firebase chama quando o auth estiver pronto.
  // Se o Firebase já disparou antes deste código correr, _pendingFirebaseUid
  // tem o uid guardado — consumimo-lo imediatamente.
  window._onFirebaseReady = async (uid) => {
    console.log('[Lúmen] _onFirebaseReady chamado com uid:', uid);
    try {
      const loaded = await loadFromFirestore();
      if (loaded) {
        // Dados da nuvem carregados — renderizar tudo com dados actualizados
        _applySettings(); restoreBanners();
        updateAccountSelect(); updateCategorySelect();
        loadUserProfile(); restoreSpotifyWidget();
        renderAll();
        updateGreeting();
        _showAppLoading(false);
      } else {
        // Utilizador novo ou sem dados na nuvem — usar localStorage
        _bootFromLocal();
      }
    } catch(e) {
      console.warn('[Lúmen] sync erro:', e);
      // Falha de rede — usar dados locais
      _bootFromLocal();
    }
  };

  // Timeout de segurança: se o Firebase demorar mais de 6s, usa dados locais
  setTimeout(() => {
    const overlay = document.getElementById('appLoadingOverlay');
    if (overlay && overlay.style.display !== 'none') {
      console.warn('[Lúmen] Firebase timeout — a usar dados locais');
      _bootFromLocal();
    }
  }, 6000);

  // Consumir uid pendente: o Firebase disparou antes do app.js estar pronto
  if (typeof window._pendingFirebaseUid === 'string') {
    window._onFirebaseReady(window._pendingFirebaseUid);
    window._pendingFirebaseUid = undefined;
  } else if (window._currentUid && window._firestoreDb) {
    // Fallback: uid já disponível por outra via
    window._onFirebaseReady(window._currentUid);
  }
}

function _bootFromLocal() {
  restoreBanners();
  updateAccountSelect(); updateCategorySelect();
  loadUserProfile(); restoreSpotifyWidget();
  renderAll();
  updateGreeting();
  _showAppLoading(false);
}

function _showAppLoading(show) {
  let overlay = document.getElementById('appLoadingOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'appLoadingOverlay';
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:9999;
      background:var(--bg);
      display:flex;flex-direction:column;
      align-items:center;justify-content:center;
      gap:1.2rem;
      transition:opacity 0.4s ease;
    `;
    overlay.innerHTML = `
      <div style="position:relative;width:56px;height:56px;">
        <div style="position:absolute;inset:0;border-radius:50%;border:1.5px solid transparent;border-top-color:rgba(184,169,232,0.8);animation:spinRing 1.6s linear infinite;"></div>
        <div style="position:absolute;inset:8px;border-radius:50%;border:1px solid transparent;border-bottom-color:rgba(184,169,232,0.4);animation:spinRing 2.4s linear infinite reverse;"></div>
        <svg style="position:absolute;inset:0;margin:auto;width:22px;height:22px;display:block;" viewBox="0 0 22 22" fill="none">
          <circle cx="11" cy="11" r="4.5" fill="var(--accent3)" opacity="0.92"/>
          <circle cx="11" cy="11" r="8" stroke="var(--accent3)" stroke-width="1" fill="none" opacity="0.35"/>
        </svg>
      </div>
      <span style="font-family:'Cormorant Garamond',serif;font-size:1.4rem;letter-spacing:0.2em;color:var(--accent3);">Lúmen</span>
      <span style="font-size:0.72rem;color:var(--text3);letter-spacing:0.1em;">a sincronizar...</span>
      <style>@keyframes spinRing{to{transform:rotate(360deg)}}</style>
    `;
    document.body.appendChild(overlay);
  }
  if (show) {
    overlay.style.display = 'flex';
    overlay.style.opacity = '1';
  } else {
    overlay.style.opacity = '0';
    setTimeout(() => { overlay.style.display = 'none'; }, 420);
  }
}

function _applySettings() {
  if (state.settings.userName) { const el = document.getElementById('userName'); if (el) el.value = state.settings.userName; }
  if (state.settings.profilePic) { const pic = document.getElementById('profilePic'); if (pic) { pic.src = state.settings.profilePic; pic.style.display = 'block'; } }
  if (state.settings.greetingMedia) { const r = document.getElementById('removeGreetingBtn'); if (r) r.style.display = 'inline-flex'; }
  if (state.settings.theme) {
    document.documentElement.setAttribute('data-theme', state.settings.theme);
    document.querySelectorAll('.theme-btn').forEach(b => { if (b.getAttribute('onclick')?.includes(`'${state.settings.theme}'`)) b.classList.add('active'); });
  }
}

document.addEventListener('DOMContentLoaded', init);
