/* ===== Учёт Долгов — Web App ===== */

const STORAGE_KEY = 'debt_tracker_v1';

let debts = [];
let currentFilter = 'all';
let editingId = null;
let photoDataUrl = null;
let isOwedToMe = true;
let deferredPrompt = null;

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', () => {
  loadDebts();
  render();
  bindEvents();
  requestNotificationPermission();
  checkDueReminders();
  setupPWA();
});

// ---------- Storage ----------
function loadDebts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    debts = raw ? JSON.parse(raw) : [];
  } catch {
    debts = [];
  }
}

function saveDebts() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(debts));
}

// ---------- Render ----------
function render() {
  updateBalance();
  renderList();
}

function updateBalance() {
  const active = debts.filter(d => !d.isReturned);
  const owedToMe = active.filter(d => d.isOwedToMe).reduce((s, d) => s + d.amount, 0);
  const iOwe = active.filter(d => !d.isOwedToMe).reduce((s, d) => s + d.amount, 0);
  const balance = owedToMe - iOwe;

  document.getElementById('balance-value').textContent = formatMoney(balance);
  document.getElementById('owed-to-me').textContent = formatMoney(owedToMe);
  document.getElementById('i-owe').textContent = formatMoney(iOwe);
}

function getFiltered() {
  switch (currentFilter) {
    case 'active': return debts.filter(d => !d.isReturned);
    case 'owed':   return debts.filter(d => d.isOwedToMe && !d.isReturned);
    case 'owe':    return debts.filter(d => !d.isOwedToMe && !d.isReturned);
    default:       return debts;
  }
}

function renderList() {
  const list = document.getElementById('debt-list');
  const empty = document.getElementById('empty-state');
  const filtered = getFiltered();

  if (filtered.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    const texts = {
      all: 'Нет долгов.<br>Нажмите + чтобы добавить.',
      active: 'Нет активных долгов',
      owed: 'Вам никто не должен',
      owe: 'Вы никому не должны'
    };
    document.getElementById('empty-text').innerHTML = texts[currentFilter] || texts.all;
    return;
  }

  empty.classList.add('hidden');
  list.innerHTML = filtered
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(d => debtCardHTML(d))
    .join('');
}

function debtCardHTML(d) {
  const typeClass = d.isOwedToMe ? 'owed' : 'owe';
  const typeLabel = d.isOwedToMe ? 'Мне должны' : 'Я должен';
  const returnedClass = d.isReturned ? 'returned' : '';

  const phoneHTML = d.phone
    ? `<a class="debt-phone" href="tel:${d.phone.replace(/[\s\-()]/g, '')}">📞 ${escapeHtml(d.phone)}</a>`
    : '';

  const descHTML = d.description
    ? `<div class="debt-desc">${escapeHtml(d.description)}</div>`
    : '';

  const photoHTML = d.photo
    ? `<div class="debt-photo-label">🧾 Расписка / чек</div>
       <img class="debt-photo" src="${d.photo}" alt="Расписка" data-id="${d.id}" onclick="openPhotoViewer('${d.id}')" />`
    : '';

  const dueHTML = d.dueDate
    ? `<div>Вернуть до: ${formatDate(d.dueDate)}</div>`
    : '';

  const actionsHTML = d.isReturned
    ? ''
    : `<div class="debt-actions">
         <button class="btn-returned" onclick="markReturned('${d.id}')">Вернули</button>
         <button class="btn-icon" onclick="openEdit('${d.id}')" title="Редактировать">✏️</button>
         <button class="btn-icon delete" onclick="deleteDebt('${d.id}')" title="Удалить">🗑️</button>
       </div>`;

  return `
    <article class="debt-card ${returnedClass}">
      <div class="debt-top">
        <div>
          <div class="debt-name ${returnedClass}">${escapeHtml(d.personName)}</div>
          <span class="debt-badge ${typeClass}">${typeLabel}</span>
        </div>
        <div class="debt-amount ${typeClass}">${formatMoney(d.amount)}</div>
      </div>
      ${phoneHTML}
      ${descHTML}
      ${photoHTML}
      <div class="debt-meta">
        <div>Создано: ${formatDateTime(d.createdAt)}</div>
        ${dueHTML}
      </div>
      ${actionsHTML}
    </article>
  `;
}

// ---------- Events ----------
function bindEvents() {
  // Filters
  document.getElementById('filters').addEventListener('click', e => {
    const btn = e.target.closest('.filter-chip');
    if (!btn) return;
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderList();
  });

  // FAB
  document.getElementById('btn-add').addEventListener('click', () => openAdd());

  // Modal close
  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel').addEventListener('click', closeModal);
  document.getElementById('modal').addEventListener('click', e => {
    if (e.target.id === 'modal') closeModal();
  });

  // Type toggle
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      isOwedToMe = btn.dataset.type === 'owed';
    });
  });

  // Photo
  document.getElementById('btn-photo').addEventListener('click', () => {
    document.getElementById('input-photo').click();
  });
  document.getElementById('input-photo').addEventListener('change', handlePhotoSelect);
  document.getElementById('btn-remove-photo').addEventListener('click', clearPhoto);

  // Clear due date
  document.getElementById('btn-clear-due').addEventListener('click', () => {
    document.getElementById('input-due').value = '';
  });

  // Save
  document.getElementById('btn-save').addEventListener('click', saveDebt);

  // Photo viewer
  document.getElementById('btn-close-viewer').addEventListener('click', () => {
    document.getElementById('photo-viewer').classList.add('hidden');
  });
  document.getElementById('photo-viewer').addEventListener('click', e => {
    if (e.target.id === 'photo-viewer') {
      document.getElementById('photo-viewer').classList.add('hidden');
    }
  });
}

// ---------- Modal ----------
function openAdd() {
  editingId = null;
  photoDataUrl = null;
  isOwedToMe = true;
  document.getElementById('modal-title').textContent = 'Новый долг';
  document.getElementById('input-name').value = '';
  document.getElementById('input-amount').value = '';
  document.getElementById('input-phone').value = '';
  document.getElementById('input-desc').value = '';
  document.getElementById('input-due').value = '';
  document.getElementById('error-name').textContent = '';
  document.getElementById('error-amount').textContent = '';
  document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.type-btn[data-type="owed"]').classList.add('active');
  clearPhotoUI();
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('input-name').focus();
}

function openEdit(id) {
  const d = debts.find(x => x.id === id);
  if (!d) return;

  editingId = id;
  photoDataUrl = d.photo || null;
  isOwedToMe = d.isOwedToMe;

  document.getElementById('modal-title').textContent = 'Редактировать';
  document.getElementById('input-name').value = d.personName;
  document.getElementById('input-amount').value = d.amount;
  document.getElementById('input-phone').value = d.phone || '';
  document.getElementById('input-desc').value = d.description || '';
  document.getElementById('input-due').value = d.dueDate ? d.dueDate.slice(0, 10) : '';
  document.getElementById('error-name').textContent = '';
  document.getElementById('error-amount').textContent = '';

  document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.type-btn[data-type="${d.isOwedToMe ? 'owed' : 'owe'}"]`).classList.add('active');

  if (photoDataUrl) {
    document.getElementById('photo-img').src = photoDataUrl;
    document.getElementById('photo-preview').classList.remove('hidden');
    document.getElementById('btn-photo').classList.add('hidden');
  } else {
    clearPhotoUI();
  }

  document.getElementById('modal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
}

function saveDebt() {
  const name = document.getElementById('input-name').value.trim();
  const amountStr = document.getElementById('input-amount').value;
  const amount = parseFloat(amountStr);
  const phone = document.getElementById('input-phone').value.trim();
  const desc = document.getElementById('input-desc').value.trim();
  const dueVal = document.getElementById('input-due').value;

  let valid = true;
  if (!name) {
    document.getElementById('error-name').textContent = 'Введите имя';
    valid = false;
  } else {
    document.getElementById('error-name').textContent = '';
  }
  if (!amountStr || isNaN(amount) || amount <= 0) {
    document.getElementById('error-amount').textContent = 'Введите сумму больше 0';
    valid = false;
  } else {
    document.getElementById('error-amount').textContent = '';
  }
  if (!valid) return;

  const dueDate = dueVal ? new Date(dueVal + 'T09:00:00').toISOString() : null;

  if (editingId) {
    const idx = debts.findIndex(d => d.id === editingId);
    if (idx !== -1) {
      debts[idx] = {
        ...debts[idx],
        personName: name,
        amount,
        isOwedToMe,
        phone: phone || null,
        description: desc,
        dueDate,
        photo: photoDataUrl
      };
    }
    showToast('Долг обновлён');
  } else {
    debts.push({
      id: crypto.randomUUID(),
      personName: name,
      amount,
      isOwedToMe,
      phone: phone || null,
      description: desc,
      dueDate,
      photo: photoDataUrl,
      createdAt: Date.now(),
      isReturned: false
    });
    showToast('Долг добавлен');
  }

  saveDebts();
  closeModal();
  render();
  checkDueReminders();
}

function markReturned(id) {
  const d = debts.find(x => x.id === id);
  if (!d) return;
  d.isReturned = true;
  saveDebts();
  render();
  showToast('Отмечено как возвращённое');
}

function deleteDebt(id) {
  if (!confirm('Удалить этот долг?')) return;
  debts = debts.filter(d => d.id !== id);
  saveDebts();
  render();
  showToast('Долг удалён');
}

// ---------- Photo ----------
function handlePhotoSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (file.size > 2 * 1024 * 1024) {
    showToast('Фото слишком большое (макс. 2 МБ)');
    return;
  }

  const reader = new FileReader();
  reader.onload = ev => {
    // Compress a bit via canvas
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxW = 800;
      let w = img.width;
      let h = img.height;
      if (w > maxW) {
        h = Math.round(h * maxW / w);
        w = maxW;
      }
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      photoDataUrl = canvas.toDataURL('image/jpeg', 0.7);

      document.getElementById('photo-img').src = photoDataUrl;
      document.getElementById('photo-preview').classList.remove('hidden');
      document.getElementById('btn-photo').classList.add('hidden');
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function clearPhoto() {
  photoDataUrl = null;
  clearPhotoUI();
  document.getElementById('input-photo').value = '';
}

function clearPhotoUI() {
  document.getElementById('photo-preview').classList.add('hidden');
  document.getElementById('btn-photo').classList.remove('hidden');
  document.getElementById('photo-img').src = '';
}

function openPhotoViewer(id) {
  const d = debts.find(x => x.id === id);
  if (!d || !d.photo) return;
  document.getElementById('viewer-img').src = d.photo;
  document.getElementById('photo-viewer').classList.remove('hidden');
}

// ---------- Notifications ----------
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function checkDueReminders() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  debts.forEach(d => {
    if (d.isReturned || !d.dueDate) return;
    const due = new Date(d.dueDate);
    due.setHours(0, 0, 0, 0);

    if (due.getTime() === today.getTime()) {
      const key = `notified_${d.id}_${today.toISOString().slice(0, 10)}`;
      if (!localStorage.getItem(key)) {
        new Notification('Напоминание о долге', {
          body: `${d.personName} — ${formatMoney(d.amount)}`,
          icon: 'icons/icon-192.png'
        });
        localStorage.setItem(key, '1');
      }
    }
  });
}

// ---------- PWA ----------
function setupPWA() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    document.getElementById('btn-install').classList.remove('hidden');
  });

  document.getElementById('btn-install').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    document.getElementById('btn-install').classList.add('hidden');
  });
}

// ---------- Helpers ----------
function formatMoney(n) {
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽';
}

function formatDateTime(ts) {
  return new Date(ts).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 2200);
}
