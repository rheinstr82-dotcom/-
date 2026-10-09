/* ===== Учёт Долгов — Web App ===== */

const STORAGE_KEY = 'debt_tracker_v1';
const CURRENCY_SYMBOL = { MDL: 'L', USD: '$', EUR: '€' };

let debts = [];
let currentFilter = 'all';
let editingId = null;
let photoDataUrl = null;
let isOwedToMe = true;
let selectedCurrency = 'MDL';
let deferredPrompt = null;
let modalMode = 'debt';
let currentClientName = null;

document.addEventListener('DOMContentLoaded', () => {
  loadDebts();
  migrateData();
  render();
  bindEvents();
  requestNotificationPermission();
  checkDueReminders();
  setupPWA();
});

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

function migrateData() {
  let changed = false;
  debts = debts.map(d => {
    if (d.isPayment === undefined) {
      changed = true;
      return { ...d, isPayment: false };
    }
    return d;
  });
  if (changed) saveDebts();
}

function formatMoney(n, currency) {
  const cur = currency || 'MDL';
  const sym = CURRENCY_SYMBOL[cur] || 'L';
  return Number(n).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + sym;
}

function normName(name) {
  return (name || '').trim().toLowerCase();
}

function personBalances(personName) {
  const key = normName(personName);
  const byCur = {};
  debts.forEach(d => {
    if (normName(d.personName) !== key) return;
    const c = d.currency || 'MDL';
    if (!byCur[c]) byCur[c] = { owed: 0, owe: 0 };
    const sign = d.isPayment ? -1 : 1;
    if (d.isOwedToMe) byCur[c].owed += sign * d.amount;
    else byCur[c].owe += sign * d.amount;
  });
  Object.keys(byCur).forEach(c => {
    byCur[c].owed = Math.round(byCur[c].owed * 100) / 100;
    byCur[c].owe = Math.round(byCur[c].owe * 100) / 100;
    if (Math.abs(byCur[c].owed) < 0.005) byCur[c].owed = 0;
    if (Math.abs(byCur[c].owe) < 0.005) byCur[c].owe = 0;
  });
  return byCur;
}

function personHasActivity(personName, filter) {
  const bal = personBalances(personName);
  const curs = Object.keys(bal);
  if (curs.length === 0) return false;
  const anyOwed = curs.some(c => bal[c].owed > 0);
  const anyOwe = curs.some(c => bal[c].owe > 0);
  const anyActive = anyOwed || anyOwe;
  switch (filter) {
    case 'active': return anyActive;
    case 'owed': return anyOwed;
    case 'owe': return anyOwe;
    default: return true;
  }
}

function getPersonNames() {
  const map = new Map();
  debts.forEach(d => {
    const k = normName(d.personName);
    if (!k) return;
    if (!map.has(k)) {
      map.set(k, {
        displayName: d.personName.trim(),
        phone: d.phone || null,
        lastAt: d.createdAt || 0
      });
    } else {
      const p = map.get(k);
      if (d.createdAt > p.lastAt) p.lastAt = d.createdAt;
      if (d.phone && !p.phone) p.phone = d.phone;
      if (!d.isPayment && d.personName) p.displayName = d.personName.trim();
    }
  });
  return [...map.values()].sort((a, b) => b.lastAt - a.lastAt);
}

function updateBalance() {
  const names = getPersonNames();
  const byCur = {};
  names.forEach(p => {
    const bal = personBalances(p.displayName);
    Object.keys(bal).forEach(c => {
      if (!byCur[c]) byCur[c] = { owed: 0, owe: 0 };
      byCur[c].owed += Math.max(0, bal[c].owed);
      byCur[c].owe += Math.max(0, bal[c].owe);
    });
  });
  const currencies = Object.keys(byCur);
  if (!currencies.length) {
    document.getElementById('balance-value').textContent = formatMoney(0, 'MDL');
    const o = document.getElementById('owed-to-me');
    const i = document.getElementById('i-owe');
    o.textContent = formatMoney(0, 'MDL');
    i.textContent = formatMoney(0, 'MDL');
    o.classList.remove('red'); o.classList.add('green');
    i.classList.remove('red'); i.classList.add('green');
    return;
  }
  document.getElementById('balance-value').textContent = currencies.map(c => formatMoney(byCur[c].owed - byCur[c].owe, c)).join(' · ');
  const owedEl = document.getElementById('owed-to-me');
  const iOweEl = document.getElementById('i-owe');
  owedEl.textContent = currencies.map(c => formatMoney(byCur[c].owed, c)).join(' · ');
  iOweEl.textContent = currencies.map(c => formatMoney(byCur[c].owe, c)).join(' · ');

  // Долг — красный; ноль по «Я должен» — зелёный
  const totalOwed = currencies.reduce((s, c) => s + byCur[c].owed, 0);
  const totalIOwe = currencies.reduce((s, c) => s + byCur[c].owe, 0);
  owedEl.classList.toggle('red', totalOwed > 0);
  owedEl.classList.toggle('green', totalOwed <= 0);
  iOweEl.classList.toggle('red', totalIOwe > 0);
  iOweEl.classList.toggle('green', totalIOwe <= 0);
}

function render() {
  updateBalance();
  renderList();
}

function renderList() {
  const list = document.getElementById('debt-list');
  const empty = document.getElementById('empty-state');
  let people = getPersonNames();
  if (currentFilter !== 'all') {
    people = people.filter(p => personHasActivity(p.displayName, currentFilter));
  }

  if (people.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    const texts = {
      all: 'Нет долгов.<br>Нажмите + чтобы добавить.',
      active: 'Нет активных долгов',
      owed: 'Вам больше никто не должен',
      owe: 'Вы никому не должны'
    };
    document.getElementById('empty-text').innerHTML = texts[currentFilter] || texts.all;
    return;
  }

  empty.classList.add('hidden');
  list.innerHTML = people.map(p => personCardHTML(p)).join('');
}

function personCardHTML(p) {
  const bal = personBalances(p.displayName);
  const curs = Object.keys(bal);
  const owedParts = [];
  const oweParts = [];
  let fullySettled = true;

  curs.forEach(c => {
    if (bal[c].owed > 0) { owedParts.push(formatMoney(bal[c].owed, c)); fullySettled = false; }
    if (bal[c].owe > 0) { oweParts.push(formatMoney(bal[c].owe, c)); fullySettled = false; }
  });
  if (curs.length === 0) fullySettled = true;

  const phoneHTML = p.phone
    ? `<a class="debt-phone" href="tel:${p.phone.replace(/[\s\-()]/g, '')}" onclick="event.stopPropagation()">📞 ${escapeHtml(p.phone)}</a>`
    : '';

  const statusHTML = fullySettled
    ? `<span class="status-settled">✓ Вернули</span>`
    : '';

  const amountsHTML = `
    <div class="person-amounts">
      ${owedParts.length ? `<div class="amt-owed">Мне ещё: <strong>${owedParts.join(' · ')}</strong></div>` : ''}
      ${oweParts.length ? `<div class="amt-owe">Я должен: <strong>${oweParts.join(' · ')}</strong></div>` : ''}
      ${fullySettled ? statusHTML : ''}
    </div>`;

  return `
    <article class="debt-card ${fullySettled ? 'returned' : ''}" data-person="${escapeHtml(p.displayName)}" role="button" tabindex="0">
      <div class="debt-top">
        <div>
          <div class="debt-name clickable-name">${escapeHtml(p.displayName)}</div>
          ${fullySettled ? '<div class="tap-hint">Нажмите, чтобы открыть</div>' : ''}
        </div>
        ${amountsHTML}
      </div>
      ${phoneHTML}
    </article>
  `;
}

function openClient(name) {
  currentClientName = name;
  document.getElementById('client-name').textContent = name;
  document.getElementById('client-body').innerHTML = clientBodyHTML(name);
  document.getElementById('client-modal').classList.remove('hidden');
}

function closeClient() {
  document.getElementById('client-modal').classList.add('hidden');
  currentClientName = null;
  render();
}

function clientBodyHTML(name) {
  const bal = personBalances(name);
  const curs = Object.keys(bal);
  const items = debts
    .filter(d => normName(d.personName) === normName(name))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  // Суммы долгов (без погашений) и остатки
  const totals = {};
  debts.filter(d => normName(d.personName) === normName(name)).forEach(d => {
    const c = d.currency || 'MDL';
    if (!totals[c]) totals[c] = { debtToMe: 0, myDebt: 0, payToMe: 0, myPay: 0 };
    if (d.isPayment) {
      if (d.isOwedToMe) totals[c].payToMe += d.amount;
      else totals[c].myPay += d.amount;
    } else {
      if (d.isOwedToMe) totals[c].debtToMe += d.amount;
      else totals[c].myDebt += d.amount;
    }
  });

  let balHTML = '<div class="client-balance-stack">';
  const allCur = Object.keys(totals).length ? Object.keys(totals) : curs;
  if (!allCur.length) {
    balHTML += '<div class="client-bal-card bal-gray"><div class="client-bal-row">Нет операций</div></div>';
  } else {
    allCur.forEach(c => {
      const t = totals[c] || { debtToMe: 0, myDebt: 0, payToMe: 0, myPay: 0 };
      const remainOwed = Math.max(0, Math.round((t.debtToMe - t.payToMe) * 100) / 100);
      const remainOwe = Math.max(0, Math.round((t.myDebt - t.myPay) * 100) / 100);

      // Серое окошко «Долг мне» — сверху
      if (t.debtToMe > 0) {
        balHTML += `<div class="client-bal-card bal-gray">
          <div class="client-bal-row"><span>Долг мне</span><strong class="text-debt">${formatMoney(t.debtToMe, c)}</strong></div>
        </div>`;
      }
      // Светло-жёлтое «Мне ещё должны»
      if (t.debtToMe > 0 || remainOwed > 0 || (t.payToMe > 0 && remainOwed === 0)) {
        const label = remainOwed > 0 ? 'Мне ещё должны' : 'Мне ещё должны';
        const val = remainOwed > 0
          ? formatMoney(remainOwed, c)
          : ('0 ' + (CURRENCY_SYMBOL[c] || 'L') + ' — Вернули');
        const cls = remainOwed > 0 ? 'text-debt' : 'text-pay';
        balHTML += `<div class="client-bal-card bal-yellow">
          <div class="client-bal-row"><span>${label}</span><strong class="${cls}">${val}</strong></div>
        </div>`;
      }

      // Мой долг (серый) и остаток
      if (t.myDebt > 0) {
        balHTML += `<div class="client-bal-card bal-gray">
          <div class="client-bal-row"><span>Я должен (всего)</span><strong class="text-debt">${formatMoney(t.myDebt, c)}</strong></div>
        </div>`;
      }
      if (t.myDebt > 0 || remainOwe > 0) {
        const val = remainOwe > 0
          ? formatMoney(remainOwe, c)
          : ('0 ' + (CURRENCY_SYMBOL[c] || 'L') + ' — Вернул');
        const cls = remainOwe > 0 ? 'text-debt' : 'text-pay';
        balHTML += `<div class="client-bal-card bal-yellow">
          <div class="client-bal-row"><span>Осталось мне платить</span><strong class="${cls}">${val}</strong></div>
        </div>`;
      }

      if (t.debtToMe <= 0 && t.myDebt <= 0) {
        balHTML += `<div class="client-bal-card bal-gray"><div class="client-bal-row">Нет операций (${c})</div></div>`;
      }
    });
  }
  balHTML += '</div>';

  const phone = items.map(d => d.phone).find(Boolean);
  const phoneHTML = phone
    ? `<a class="debt-phone client-phone" href="tel:${phone.replace(/[\s\-()]/g, '')}">📞 ${escapeHtml(phone)}</a>`
    : '';

  let historyHTML = '<div class="history-title">История расчётов</div><div class="history-list">';
  if (!items.length) {
    historyHTML += '<div class="history-empty">Пока нет записей</div>';
  } else {
    items.forEach(d => {
      const isPay = !!d.isPayment;
      const typeLabel = isPay
        ? (d.isOwedToMe ? 'Погашение (мне)' : 'Погашение (я)')
        : (d.isOwedToMe ? 'Долг мне' : 'Я должен');
      const colorClass = isPay ? 'hist-pay' : 'hist-debt';
      const sign = isPay ? '−' : '+';
      historyHTML += `
        <div class="history-item ${colorClass}">
          <div class="hist-left">
            <div class="hist-type">${typeLabel}</div>
            <div class="hist-date">${formatDateTime(d.createdAt)}</div>
            ${d.description ? `<div class="hist-note">${escapeHtml(d.description)}</div>` : ''}
            ${d.photo ? `<button class="btn-link" onclick="event.stopPropagation(); openPhotoById('${d.id}')">📷 Фото</button>` : ''}
          </div>
          <div class="hist-right">
            <div class="hist-amount">${sign}${formatMoney(d.amount, d.currency || 'MDL')}</div>
            <div class="hist-actions">
              <button class="btn-icon" onclick="event.stopPropagation(); openEdit('${d.id}')" title="Изменить">✏️</button>
              <button class="btn-icon delete" onclick="event.stopPropagation(); deleteDebt('${d.id}')" title="Удалить">🗑️</button>
            </div>
          </div>
        </div>`;
    });
  }
  historyHTML += '</div>';

  const anyActive = curs.some(c => bal[c].owed > 0 || bal[c].owe > 0);

  return `
    ${phoneHTML}
    ${balHTML}
    <div class="client-actions">
      <button class="btn-primary btn-block" onclick="openAddDebtForClient()">+ Долг</button>
      <button class="btn-pay btn-block" onclick="openAddPayment()" ${anyActive ? '' : 'disabled'}>− Погашение</button>
    </div>
    ${historyHTML}
  `;
}

function openAddDebtForClient() {
  openAdd();
  document.getElementById('input-name').value = currentClientName || '';
}

function openAddPayment() {
  if (!currentClientName) return;
  modalMode = 'payment';
  editingId = null;
  photoDataUrl = null;
  isOwedToMe = true;
  selectedCurrency = 'MDL';

  const bal = personBalances(currentClientName);
  const curs = Object.keys(bal);
  let preferOwed = true;
  for (const c of curs) {
    if (bal[c].owe > 0 && bal[c].owed <= 0) { preferOwed = false; break; }
    if (bal[c].owed > 0) { preferOwed = true; break; }
  }
  isOwedToMe = preferOwed;
  if (curs.length) selectedCurrency = curs.find(c => bal[c].owed > 0 || bal[c].owe > 0) || curs[0];

  document.getElementById('modal-title').textContent = 'Погашение';
  document.getElementById('input-name').value = currentClientName;
  document.getElementById('group-name').classList.add('hidden');
  document.getElementById('input-amount').value = '';
  document.getElementById('input-phone').value = '';
  document.getElementById('group-phone').classList.add('hidden');
  document.getElementById('input-desc').value = '';
  document.getElementById('input-due').value = '';
  document.getElementById('group-due').classList.add('hidden');
  document.getElementById('group-photo').classList.add('hidden');
  document.getElementById('error-name').textContent = '';
  document.getElementById('error-amount').textContent = '';

  document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.type-btn[data-type="' + (isOwedToMe ? 'owed' : 'owe') + '"]').classList.add('active');
  document.querySelectorAll('.currency-btn').forEach(b => b.classList.remove('active'));
  const cb = document.querySelector('.currency-btn[data-currency="' + selectedCurrency + '"]');
  if (cb) cb.classList.add('active');
  document.getElementById('amount-suffix').textContent = CURRENCY_SYMBOL[selectedCurrency] || 'L';

  clearPhotoUI();
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('input-amount').focus();
}

function openAdd() {
  modalMode = 'debt';
  editingId = null;
  photoDataUrl = null;
  isOwedToMe = true;
  selectedCurrency = 'MDL';
  document.getElementById('modal-title').textContent = 'Новый долг';
  document.getElementById('input-name').value = '';
  document.getElementById('group-name').classList.remove('hidden');
  document.getElementById('input-amount').value = '';
  document.getElementById('input-phone').value = '';
  document.getElementById('group-phone').classList.remove('hidden');
  document.getElementById('input-desc').value = '';
  document.getElementById('input-due').value = '';
  document.getElementById('group-due').classList.remove('hidden');
  document.getElementById('group-photo').classList.remove('hidden');
  document.getElementById('error-name').textContent = '';
  document.getElementById('error-amount').textContent = '';
  document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.type-btn[data-type="owed"]').classList.add('active');
  document.querySelectorAll('.currency-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.currency-btn[data-currency="MDL"]').classList.add('active');
  document.getElementById('amount-suffix').textContent = 'L';
  clearPhotoUI();
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('input-name').focus();
}

function openEdit(id) {
  const d = debts.find(x => x.id === id);
  if (!d) return;

  modalMode = 'edit';
  editingId = id;
  photoDataUrl = d.photo || null;
  isOwedToMe = d.isOwedToMe;
  selectedCurrency = d.currency || 'MDL';

  document.getElementById('modal-title').textContent = d.isPayment ? 'Редактировать погашение' : 'Редактировать долг';
  document.getElementById('input-name').value = d.personName;
  document.getElementById('group-name').classList.remove('hidden');
  document.getElementById('input-amount').value = d.amount;
  document.getElementById('input-phone').value = d.phone || '';
  document.getElementById('group-phone').classList.toggle('hidden', !!d.isPayment);
  document.getElementById('input-desc').value = d.description || '';
  document.getElementById('input-due').value = d.dueDate ? String(d.dueDate).slice(0, 10) : '';
  document.getElementById('group-due').classList.toggle('hidden', !!d.isPayment);
  document.getElementById('group-photo').classList.toggle('hidden', !!d.isPayment);
  document.getElementById('error-name').textContent = '';
  document.getElementById('error-amount').textContent = '';

  document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.type-btn[data-type="' + (d.isOwedToMe ? 'owed' : 'owe') + '"]').classList.add('active');
  document.querySelectorAll('.currency-btn').forEach(b => b.classList.remove('active'));
  const curBtn = document.querySelector('.currency-btn[data-currency="' + selectedCurrency + '"]');
  if (curBtn) curBtn.classList.add('active');
  document.getElementById('amount-suffix').textContent = CURRENCY_SYMBOL[selectedCurrency] || 'L';

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
  document.getElementById('group-name').classList.remove('hidden');
  document.getElementById('group-phone').classList.remove('hidden');
  document.getElementById('group-due').classList.remove('hidden');
  document.getElementById('group-photo').classList.remove('hidden');
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
  const isPayment = modalMode === 'payment' || (editingId && debts.find(d => d.id === editingId)?.isPayment);

  if (editingId) {
    const idx = debts.findIndex(d => d.id === editingId);
    if (idx !== -1) {
      debts[idx] = {
        ...debts[idx],
        personName: name,
        amount,
        isOwedToMe,
        currency: selectedCurrency,
        phone: phone || debts[idx].phone || null,
        description: desc,
        dueDate: debts[idx].isPayment ? null : dueDate,
        photo: debts[idx].isPayment ? debts[idx].photo : photoDataUrl
      };
    }
    showToast('Сохранено');
  } else {
    debts.push({
      id: crypto.randomUUID(),
      personName: name,
      amount,
      isOwedToMe,
      currency: selectedCurrency,
      phone: phone || null,
      description: desc,
      dueDate: isPayment ? null : dueDate,
      photo: isPayment ? null : photoDataUrl,
      createdAt: Date.now(),
      isPayment: modalMode === 'payment',
      isReturned: false
    });
    showToast(modalMode === 'payment' ? 'Погашение добавлено' : 'Долг добавлен');
  }

  saveDebts();
  closeModal();

  if (currentClientName) {
    openClient(currentClientName);
  } else {
    render();
  }
  checkDueReminders();
}

function deleteDebt(id) {
  if (!confirm('Удалить эту запись?')) return;
  debts = debts.filter(d => d.id !== id);
  saveDebts();
  showToast('Удалено');
  if (currentClientName) {
    const still = debts.some(d => normName(d.personName) === normName(currentClientName));
    if (still) openClient(currentClientName);
    else closeClient();
  } else {
    render();
  }
}

function bindEvents() {
  document.getElementById('filters').addEventListener('click', e => {
    const btn = e.target.closest('.filter-chip');
    if (!btn) return;
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderList();
  });

  // Клик по карточке клиента (в т.ч. неактивной / «Вернули»)
  document.getElementById('debt-list').addEventListener('click', e => {
    if (e.target.closest('a.debt-phone')) return;
    const card = e.target.closest('.debt-card[data-person]');
    if (!card) return;
    const name = card.getAttribute('data-person');
    if (name) openClient(name);
  });

  document.getElementById('btn-add').addEventListener('click', () => openAdd());
  document.getElementById('btn-export').addEventListener('click', exportData);
  document.getElementById('btn-import').addEventListener('click', () => document.getElementById('input-import').click());
  document.getElementById('input-import').addEventListener('change', importData);

  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel').addEventListener('click', closeModal);
  document.getElementById('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

  document.getElementById('btn-close-client').addEventListener('click', closeClient);
  document.getElementById('client-modal').addEventListener('click', e => { if (e.target.id === 'client-modal') closeClient(); });

  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      isOwedToMe = btn.dataset.type === 'owed';
    });
  });

  document.querySelectorAll('.currency-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.currency-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedCurrency = btn.dataset.currency;
      document.getElementById('amount-suffix').textContent = CURRENCY_SYMBOL[selectedCurrency] || 'L';
    });
  });

  document.getElementById('btn-photo').addEventListener('click', () => document.getElementById('input-photo').click());
  document.getElementById('input-photo').addEventListener('change', handlePhotoSelect);
  document.getElementById('btn-remove-photo').addEventListener('click', clearPhoto);
  document.getElementById('btn-clear-due').addEventListener('click', () => { document.getElementById('input-due').value = ''; });
  document.getElementById('btn-save').addEventListener('click', saveDebt);

  document.getElementById('btn-close-viewer').addEventListener('click', () => document.getElementById('photo-viewer').classList.add('hidden'));
  document.getElementById('photo-viewer').addEventListener('click', e => {
    if (e.target.id === 'photo-viewer') document.getElementById('photo-viewer').classList.add('hidden');
  });
}

function handlePhotoSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    showToast('Фото слишком большое (макс. 2 МБ)');
    return;
  }
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxW = 800;
      let w = img.width, h = img.height;
      if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
      canvas.width = w; canvas.height = h;
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

function openPhotoById(id) {
  const d = debts.find(x => x.id === id);
  if (!d || !d.photo) return;
  document.getElementById('viewer-img').src = d.photo;
  document.getElementById('photo-viewer').classList.remove('hidden');
}

function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
}

function checkDueReminders() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  debts.forEach(d => {
    if (d.isPayment || !d.dueDate) return;
    const bal = personBalances(d.personName);
    const c = d.currency || 'MDL';
    const remaining = d.isOwedToMe ? (bal[c] && bal[c].owed || 0) : (bal[c] && bal[c].owe || 0);
    if (remaining <= 0) return;
    const due = new Date(d.dueDate);
    due.setHours(0, 0, 0, 0);
    if (due.getTime() === today.getTime()) {
      const key = 'notified_' + d.id + '_' + today.toISOString().slice(0, 10);
      if (!localStorage.getItem(key)) {
        new Notification('Напоминание о долге', {
          body: d.personName + ' — ' + formatMoney(remaining, c),
          icon: 'icon-192.png'
        });
        localStorage.setItem(key, '1');
      }
    }
  });
}

function setupPWA() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
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

function exportData() {
  const payload = { version: 2, exportedAt: new Date().toISOString(), debts };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'dolgi-backup-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Копия сохранена');
}

function importData(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const list = Array.isArray(data) ? data : (data && Array.isArray(data.debts) ? data.debts : null);
      if (!list) { showToast('Неверный файл'); return; }
      if (!confirm('Восстановить ' + list.length + ' записей?\nТекущие данные будут заменены.')) {
        e.target.value = '';
        return;
      }
      debts = list.map(d => ({
        id: d.id || crypto.randomUUID(),
        personName: d.personName || 'Без имени',
        amount: Number(d.amount) || 0,
        isOwedToMe: !!d.isOwedToMe,
        currency: d.currency || 'MDL',
        phone: d.phone || null,
        description: d.description || '',
        dueDate: d.dueDate || null,
        photo: d.photo || null,
        createdAt: d.createdAt || Date.now(),
        isPayment: !!d.isPayment,
        isReturned: !!d.isReturned
      }));
      saveDebts();
      render();
      showToast('Данные восстановлены');
    } catch (err) {
      console.error(err);
      showToast('Ошибка чтения файла');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
}

function formatDateTime(ts) {
  return new Date(ts).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 2200);
}
