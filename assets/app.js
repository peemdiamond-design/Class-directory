import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection, onSnapshot, addDoc, deleteDoc, increment, arrayUnion } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

/* ================= config ================= */
const firebaseConfig = {
  apiKey: "AIzaSyDx5NGRp1zwvOwZ9bsU7euppT8ofglptvU",
  authDomain: "class-directory-3b8c9.firebaseapp.com",
  projectId: "class-directory-3b8c9",
  storageBucket: "class-directory-3b8c9.firebasestorage.app",
  messagingSenderId: "571082825613",
  appId: "1:571082825613:web:de6921e521caef79be67c4",
  measurementId: "G-NP07FSMQ51"
};
const APP_ID = 'class-directory-cn25';
const USERS_PATH = `artifacts/${APP_ID}/public/data/users`;
const MEMORIES_PATH = `artifacts/${APP_ID}/public/data/memories`;
const STATS_PATH = `artifacts/${APP_ID}/public/data/stats`;
const ADMIN_ID = '6910616249';
// Apps Script web app (ดู apps-script/SETUP.md)
const PHOTO_API_URL = 'https://script.google.com/macros/s/AKfycbyU3dfsbrAq6N_FSWnFg2x8gLsVGw9yNFouuhhdYqCPx-n4cOxiBlyRjl79WGe-t0VR/exec';

const POS_PRES = 'ประธานรุ่น';
const POS_VP = 'รองประธาน';
const POS_MEMBER = 'สมาชิก';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* ================= state ================= */
let currentUser = null;          // { uid, studentId, isAdmin }
let members = [];
let memories = [];
let photoMap = {};
let membersLoaded = false;
let profileId = null;
let authMode = 'login';

/* ================= helpers ================= */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (v) => String(v ?? '').replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
const icon = (name, cls = 'icon icon-sm') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const fullName = (m) => `${m.firstName || ''} ${m.lastName || ''}`.trim() || 'ไม่ระบุชื่อ';
const byId = (id) => members.find((m) => m.studentId === id);
const isOwner = (id) => !!currentUser && currentUser.studentId === id;
const canEditPhoto = (id) => !!currentUser && (currentUser.studentId === id || currentUser.isAdmin);

function avatarUrl(m) {
  const ch = m?.firstName ? encodeURIComponent(m.firstName.charAt(0)) : String(m?.studentId || '').slice(-2);
  const dark = document.documentElement.dataset.theme === 'dark';
  return `https://ui-avatars.com/api/?name=${ch}&background=${dark ? '2b2e32' : 'd6d5cb'}&color=${dark ? 'eeede6' : '22221e'}&size=256&font-size=0.45&bold=true`;
}
function photoSrc(m, w = 480) {
  const fid = photoMap[m.studentId];
  return fid ? `https://lh3.googleusercontent.com/d/${encodeURIComponent(fid)}=w${w}` : avatarUrl(m);
}
// รูปที่โหลดไม่ได้ -> ตัวอักษรย่อ; โหลดเสร็จ -> เฟดเข้า
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.sid || img.dataset.fallback) return;
  img.dataset.fallback = '1';
  img.src = avatarUrl(byId(img.dataset.sid) || { studentId: img.dataset.sid });
}, true);
document.addEventListener('load', (e) => {
  const img = e.target;
  if (img instanceof HTMLImageElement && img.closest('.idcard-photo')) {
    img.classList.add('is-loaded');
    img.closest('.idcard-photo').classList.add('is-loaded');
  }
}, true);

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
const isBirthday = (s) => { const d = parseDate(s); const t = new Date(); return !!d && d.getDate() === t.getDate() && d.getMonth() === t.getMonth(); };
const fmtBday = (s) => { const d = parseDate(s); return d ? d.toLocaleDateString('th-TH', { day: 'numeric', month: 'long' }) : '—'; };
function relTime(iso) {
  const d = new Date(iso); if (isNaN(d)) return '';
  const s = (Date.now() - d.getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat('th', { numeric: 'auto' });
  if (s < 60) return 'เมื่อสักครู่';
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute');
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
  if (s < 86400 * 7) return rtf.format(-Math.round(s / 86400), 'day');
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
}
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const setSeg = (el, n, width) => { if (el) el.innerHTML = String(n).padStart(width, '0').split('').map((d) => `<span>${d}</span>`).join(''); };

async function withBusy(btn, label, fn) {
  if (!btn) return fn();
  const html = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner" aria-hidden="true"></span><span>${esc(label)}</span>`;
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = html; }
}

/* ================= toast ================= */
function toast(msg, type = 'ok') {
  const box = $('[data-toasts]');
  const el = document.createElement('div');
  el.className = `toast ${type === 'error' ? 'error' : ''}`;
  el.innerHTML = `${icon(type === 'error' ? 'alert' : 'check', 'icon')}<span>${esc(msg)}</span>`;
  box.appendChild(el);
  const ttl = type === 'error' ? 5000 : 3000;
  setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 180); }, ttl);
}

/* ================= dialogs ================= */
const openers = new WeakMap();
function openDialog(dlg) {
  openers.set(dlg, document.activeElement);
  if (!dlg.open) dlg.showModal();
}
function closeDialog(dlg) { if (dlg.open) dlg.close(); }
$$('dialog').forEach((dlg) => {
  dlg.addEventListener('close', () => {
    const o = openers.get(dlg);
    if (o && document.contains(o)) o.focus({ preventScroll: true });
    if (dlg.id === 'dlg-profile') onProfileClosed();
  });
  // คลิกพื้นหลังเพื่อปิด
  dlg.addEventListener('click', (e) => { if (e.target === dlg) closeDialog(dlg); });
});

function confirmDialog(title, msg, okLabel = 'ยืนยัน') {
  const dlg = $('#dlg-confirm');
  $('#c-title').textContent = title;
  $('#c-msg').textContent = msg;
  const ok = $('[data-confirm-ok]', dlg);
  ok.textContent = okLabel;
  return new Promise((resolve) => {
    const done = (v) => { ok.removeEventListener('click', onOk); dlg.removeEventListener('close', onClose); resolve(v); };
    const onOk = () => { done(true); closeDialog(dlg); };
    const onClose = () => done(false);
    ok.addEventListener('click', onOk);
    dlg.addEventListener('close', onClose);
    openDialog(dlg);
    $('[data-close]', dlg).focus();
  });
}

/* ================= theme ================= */
function applyThemeIcon() {
  const dark = document.documentElement.dataset.theme === 'dark';
  $$('[data-theme-icon]').forEach((u) => u.setAttribute('href', dark ? '#i-sun' : '#i-moon'));
  $$('[data-action="theme"]').forEach((b) => b.setAttribute('aria-label', dark ? 'สลับเป็นโหมดสว่าง' : 'สลับเป็นโหมดมืด'));
}
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('cn25-theme', next); } catch (e) {}
  applyThemeIcon();
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  let stored = null; try { stored = localStorage.getItem('cn25-theme'); } catch (err) {}
  if (!stored) { document.documentElement.dataset.theme = e.matches ? 'dark' : 'light'; applyThemeIcon(); }
});
applyThemeIcon();

/* ================= router ================= */
// #/            directory
// #/memories    memory board
// #/login       sign in
// #/admin       admin (admin only)
// #/m/<id>      profile over directory
function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  const [seg, arg] = h.split('/');
  if (seg === 'm' && /^\d{10}$/.test(arg || '')) return { view: 'directory', profile: arg };
  if (['memories', 'login', 'admin'].includes(seg)) return { view: seg };
  return { view: 'directory' };
}
let lastView = null;
function route() {
  const r = parseRoute();
  let view = r.view;
  if (view === 'admin' && !(currentUser && currentUser.isAdmin)) view = currentUser ? 'directory' : 'login';
  if (view === 'login' && currentUser) view = 'directory';

  $$('[data-view]').forEach((v) => { v.hidden = v.dataset.view !== view; });
  $$('[data-nav]').forEach((a) => {
    if (a.dataset.nav === view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const titles = { directory: 'ทำเนียบรุ่น CN25', memories: 'กระดานความทรงจำ · CN25', login: 'เข้าสู่ระบบ · CN25', admin: 'แอดมิน · CN25' };
  document.title = titles[view];

  if (view !== lastView) {
    if (lastView !== null) { window.scrollTo({ top: 0 }); $('#main').focus({ preventScroll: true }); }
    lastView = view;
  }
  if (view === 'memories') renderMemories();
  if (view === 'admin') renderAdmin();
  if (view === 'login') setTimeout(() => $('#auth-id').focus(), 50);

  if (r.profile) { if (membersLoaded) openProfile(r.profile, false); }
  else if ($('#dlg-profile').open) closeDialog($('#dlg-profile'));
}
window.addEventListener('hashchange', route);
const go = (hash) => { if (location.hash !== hash) location.hash = hash; else route(); };

/* ================= barcode (Interleaved 2 of 5 — scannable) ================= */
const ITF = ['nnwwn', 'wnnnw', 'nwnnw', 'wwnnn', 'nnwnw', 'wnwnn', 'nwwnn', 'nnnww', 'wnnwn', 'nwnwn'];
function barcodeSVG(digits, h = 22) {
  let d = String(digits || '').replace(/\D/g, '');
  if (d.length % 2) d = '0' + d;
  if (!d) return '';
  const N = 1, W = 2.5;
  const seq = ['n', 'n', 'n', 'n']; // start: bar space bar space
  for (let i = 0; i < d.length; i += 2) {
    const a = ITF[+d[i]], b = ITF[+d[i + 1]];
    for (let k = 0; k < 5; k++) seq.push(a[k], b[k]);
  }
  seq.push('w', 'n', 'n'); // stop: wide bar, space, bar
  let x = 0, rects = '';
  seq.forEach((s, i) => {
    const w = s === 'w' ? W : N;
    if (i % 2 === 0) rects += `<rect x="${x.toFixed(1)}" width="${w}" height="${h}"/>`;
    x += w;
  });
  return { w: x, h, inner: `<g fill="currentColor">${rects}</g>` };
}
function barcodeMarkup(digits, h) {
  const b = barcodeSVG(digits, h); if (!b) return '';
  return `<svg class="barcode" viewBox="0 0 ${b.w.toFixed(1)} ${b.h}" preserveAspectRatio="none" aria-hidden="true">${b.inner}</svg>`;
}

/* ================= directory ================= */
let activeFilter = 'all';
const isLeader = (m) => m.position === POS_PRES || m.position === POS_VP;
const bdayThisMonth = (m) => { const d = parseDate(m.birthdate); return !!d && d.getMonth() === new Date().getMonth(); };
const FILTERS = {
  all: () => true,
  leaders: isLeader,
  bday: bdayThisMonth,
  status: (m) => !!(m.status || '').trim()
};

function memberCard(m) {
  const pos = m.position || POS_MEMBER;
  const lead = isLeader(m);
  const roleTag = pos === POS_PRES ? `<span class="role-tag">${icon('award')}ประธานรุ่น</span>`
    : pos === POS_VP ? `<span class="role-tag vp">รองประธาน</span>` : '';
  const bday = isBirthday(m.birthdate)
    ? `<span class="badge-bday" title="วันนี้วันเกิด">${icon('cake')}<span class="sr-only">วันนี้วันเกิด</span></span>` : '';
  return `
    <button class="idcard${lead ? ' is-leader' : ''}" type="button" data-open="${esc(m.studentId)}"
            aria-label="${esc(fullName(m))}${m.nickname ? ` ชื่อเล่น ${esc(m.nickname)}` : ''}, ${esc(pos)}">
      <span class="idcard-band" aria-hidden="true"><span>THAMMASAT · CN25</span><span class="dot"></span></span>
      ${bday}
      <span class="idcard-photo">${roleTag}<img src="${esc(photoSrc(m))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-sid="${esc(m.studentId)}" width="240" height="300"></span>
      <span class="idcard-body">
        <span class="idcard-name">${esc(fullName(m))}</span>
        <span class="idcard-nick">${m.nickname ? esc(m.nickname) : '&nbsp;'}</span>
        ${m.status ? `<span class="idcard-status"><span>${esc(m.status)}</span></span>` : ''}
      </span>
      <span class="idcard-foot" aria-hidden="true"><span class="mono">${esc(m.studentId)}</span>${barcodeMarkup(m.studentId, 22)}</span>
    </button>`;
}

function matches(m, q) {
  if (!q) return true;
  const hay = [m.firstName, m.lastName, m.nickname, m.studentId, m.tags, m.status, ...Object.values(m.givenNicknames || {})].join(' ').toLowerCase();
  return q.split(/\s+/).every((t) => hay.includes(t));
}

function renderFilterCounts() {
  Object.keys(FILTERS).forEach((k) => {
    const el = $(`[data-filter-n="${k}"]`);
    if (el) el.textContent = members.filter(FILTERS[k]).length;
  });
  $$('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === activeFilter)));
}

function renderDirectory() {
  const q = ($('#search').value || '').trim().toLowerCase();
  const list = members.filter(FILTERS[activeFilter]).filter((m) => matches(m, q));
  const leaders = [...list.filter((m) => m.position === POS_PRES), ...list.filter((m) => m.position === POS_VP)];
  const rest = list.filter((m) => !isLeader(m)).sort((a, b) => String(a.studentId).localeCompare(String(b.studentId)));

  const box = $('[data-directory]');
  $('[data-action="clear-search"]').hidden = !q;
  $('[data-kbd]').hidden = !!q;
  const filtered = q || activeFilter !== 'all';
  $('[data-search-status]').textContent = filtered && list.length ? `แสดง ${list.length} จาก ${members.length} คน` : '';

  if (!list.length) {
    const why = q ? `ไม่พบ “${esc(q)}”` : 'ยังไม่มีใครในหมวดนี้';
    box.innerHTML = `
      <div class="panel empty" style="margin-top:32px">
        ${icon('search', 'icon')}
        <strong>${why}</strong>
        <span>${q ? 'ลองค้นด้วยชื่อเล่น รหัสบางส่วน หรือแท็ก เช่น สายรหัส' : 'ลองเลือกหมวดอื่น หรือดูทั้งหมด'}</span>
        <button class="btn btn-sm" type="button" data-action="reset-filters">ดูทั้งหมด</button>
      </div>`;
    return;
  }
  let html = '';
  if (leaders.length) {
    html += `<div class="section-head"><h2>คณะกรรมการรุ่น</h2><span class="count">${leaders.length} คน</span></div>
             <div class="grid grid-leaders">${leaders.map(memberCard).join('')}</div>`;
  }
  if (rest.length) {
    html += `<div class="section-head"><h2>สมาชิก</h2><span class="count">${rest.length} คน</span></div>
             <div class="grid">${rest.map(memberCard).join('')}</div>`;
  }
  box.innerHTML = html;
}

/* hero: stats + faces marquee */
function setStat(key, value) {
  const el = $(`[data-stat="${key}"]`); if (!el) return;
  const small = el.querySelector('small');
  el.textContent = Number(value).toLocaleString('th-TH');
  if (small) el.appendChild(small);
}
function renderHero() {
  setStat('members', members.length);
  setStat('bdays', members.filter(bdayThisMonth).length);
  const withPhoto = members.filter((m) => photoMap[m.studentId]);

  // การ์ดซ้อนใน hero: เพื่อนสุ่ม 2 คน (ด้านหลัง) + ประธานรุ่น (ด้านหน้า)
  const stack = $('[data-hero-stack]');
  const pres = members.find((m) => m.position === POS_PRES);
  const others = withPhoto.filter((m) => m !== pres).sort(() => Math.random() - .5).slice(0, pres ? 2 : 3);
  const trio = pres ? [...others, pres] : others;
  stack.innerHTML = trio.length === 3 ? trio.map(memberCard).join('') : '';

  const box = $('[data-faces]');
  if (withPhoto.length < 6) { box.hidden = true; $('[data-action="toggle-faces"]').hidden = true; return; }
  const shuffled = [...withPhoto].sort(() => Math.random() - .5);
  const half = Math.ceil(shuffled.length / 2);
  const row = (arr) => { const items = arr.map((m) => `<span class="face"><img src="${esc(photoSrc(m, 200))}" alt="" decoding="async" referrerpolicy="no-referrer" data-sid="${esc(m.studentId)}"></span>`).join(''); return items + items; };
  box.innerHTML = `<div class="faces-row">${row(shuffled.slice(0, half))}</div><div class="faces-row rev">${row(shuffled.slice(half).concat(shuffled.slice(0, Math.max(0, half - (shuffled.length - half)))))}</div>`;
  box.hidden = false;
  $('[data-action="toggle-faces"]').hidden = false;
}

function renderBirthdays() {
  const today = members.filter((m) => isBirthday(m.birthdate));
  const banner = $('[data-bday-banner]');
  banner.hidden = !today.length;
  if (!today.length) return;
  $('[data-bday-text]').innerHTML = `วันนี้วันเกิด ${today.map((m) =>
    `<a href="#/m/${esc(m.studentId)}" style="color:inherit">${esc(m.nickname || m.firstName || m.studentId)}</a>`).join(', ')} — ไปอวยพรกัน!`;
}

$('#search').addEventListener('input', debounce(renderDirectory, 120));
// กด "/" เพื่อค้นหา (เมื่อไม่ได้พิมพ์อยู่ในช่องอื่น)
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = (document.activeElement?.tagName || '').toLowerCase();
  if (['input', 'textarea', 'select'].includes(tag) || document.querySelector('dialog[open]')) return;
  if (parseRoute().view !== 'directory') return;
  e.preventDefault();
  $('#search').focus();
});
$('[data-search-form]').addEventListener('submit', (e) => { e.preventDefault(); $('#search').blur(); });

/* ================= profile ================= */
function openProfile(id, push = true) {
  const m = byId(id);
  if (!m) { if (membersLoaded) { toast('ไม่พบสมาชิกรหัสนี้', 'error'); go('#/'); } return; }
  profileId = id;
  if (push && location.hash !== `#/m/${id}`) { history.pushState(null, '', `#/m/${id}`); }
  fillProfile(m);
  const dlg = $('#dlg-profile');
  if (!dlg.open) { openDialog(dlg); $('.dialog-scroll', dlg).scrollTop = 0; }
}
function onProfileClosed() {
  profileId = null;
  if (/^#\/m\//.test(location.hash)) history.replaceState(null, '', '#/');
}

function fillProfile(m) {
  const img = $('#p-photo');
  img.dataset.sid = m.studentId; delete img.dataset.fallback;
  img.src = photoSrc(m, 720);
  img.alt = `รูปของ ${fullName(m)}`;
  $('#p-name').textContent = fullName(m);
  $('#p-nick').textContent = m.nickname ? `“${m.nickname}”` : '';
  const st = $('#p-status'); st.hidden = !m.status; st.textContent = m.status || '';

  const tags = String(m.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
  $('#p-tags').innerHTML = tags.map((t) => `<span class="chip">${icon('tag')}&nbsp;${esc(t)}</span>`).join('');

  $('#p-id').textContent = m.studentId;
  $('#p-card-id').textContent = m.studentId;
  const bc = barcodeSVG(m.studentId, 30);
  const bcEl = $('#p-barcode');
  if (bc) { bcEl.setAttribute('viewBox', `0 0 ${bc.w.toFixed(1)} ${bc.h}`); bcEl.setAttribute('preserveAspectRatio', 'none'); bcEl.innerHTML = bc.inner; }
  $('#p-position').textContent = m.position || POS_MEMBER;
  $('#p-role-led').className = `role-dot ${m.position === POS_PRES ? 'pres' : m.position === POS_VP ? 'vp' : ''}`;
  $('#p-bday').innerHTML = esc(fmtBday(m.birthdate)) + (isBirthday(m.birthdate) ? ` ${icon('cake')}` : '');

  const line = (m.lineId || '').trim();
  const ig = (m.instagram || '').trim().replace(/^@/, '');
  $('#p-line').textContent = line || '—';
  $('#p-ig').textContent = ig ? `@${ig}` : '—';
  $('[data-copy-from="p-line"]').hidden = !line;
  $('[data-copy-from="p-ig"]').hidden = !ig;
  const igLink = $('#p-ig-link');
  igLink.hidden = !ig;
  if (ig) igLink.href = `https://www.instagram.com/${encodeURIComponent(ig)}/`;

  const nicks = Object.values(m.givenNicknames || {}).map((n) => String(n || '').trim()).filter(Boolean);
  $('#p-nicknames').innerHTML = nicks.length
    ? nicks.map((n) => `<span class="chip chip-nick">${esc(n)}</span>`).join('')
    : '<span class="muted" style="font-size:.875rem">ยังไม่มีฉายา</span>';

  const owner = isOwner(m.studentId);
  const nickForm = $('[data-nickname-form]');
  nickForm.hidden = !currentUser || owner;
  if (!nickForm.hidden && document.activeElement !== $('#peer-nickname')) {
    $('#peer-nickname').value = (m.givenNicknames && m.givenNicknames[currentUser.studentId]) || '';
  }
  $('[data-owner-tools]').hidden = !owner;
  if (owner && document.activeElement !== $('#status-input')) $('#status-input').value = m.status || '';
  $('[data-photo-btn]').hidden = !canEditPhoto(m.studentId);
}

$('[data-status-form]').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!profileId || !isOwner(profileId)) return;
  const btn = e.submitter;
  await withBusy(btn, 'กำลังบันทึก', async () => {
    try { await updateDoc(doc(db, USERS_PATH, profileId), { status: $('#status-input').value.trim() }); toast('อัปเดตสถานะแล้ว'); }
    catch (err) { toast('อัปเดตสถานะไม่สำเร็จ ลองใหม่อีกครั้ง', 'error'); }
  });
});

$('[data-nickname-form]').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser || !profileId || isOwner(profileId)) return;
  const value = $('#peer-nickname').value.trim();
  await withBusy(e.submitter, 'กำลังบันทึก', async () => {
    try {
      await updateDoc(doc(db, USERS_PATH, profileId), { [`givenNicknames.${currentUser.studentId}`]: value });
      toast(value ? 'บันทึกฉายาแล้ว' : 'ลบฉายาของคุณแล้ว');
    } catch (err) { toast('ตั้งฉายาไม่สำเร็จ', 'error'); }
  });
});

/* ================= edit dialog ================= */
let editMode = 'self';
function openEdit(id, mode) {
  const m = byId(id); if (!m) return;
  editMode = mode;
  const form = $('[data-edit-form]');
  $('#edit-title').textContent = mode === 'admin' ? `แก้ไขข้อมูล · ${fullName(m)}` : 'แก้ไขข้อมูลส่วนตัว';
  form.studentId.value = m.studentId;
  ['firstName', 'lastName', 'nickname', 'birthdate', 'tags', 'lineId', 'instagram'].forEach((k) => { form[k].value = m[k] || ''; });
  form.position.value = m.position || POS_MEMBER;
  $('[data-admin-field]', form).hidden = mode !== 'admin';
  openDialog($('#dlg-edit'));
  setTimeout(() => form.firstName.focus(), 30);
}
$('[data-edit-form]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const id = form.studentId.value;
  if (!currentUser || !(currentUser.isAdmin || currentUser.studentId === id)) return;
  const data = {};
  ['firstName', 'lastName', 'nickname', 'tags', 'lineId', 'instagram'].forEach((k) => { data[k] = form[k].value.trim(); });
  data.birthdate = form.birthdate.value;
  if (editMode === 'admin' && currentUser.isAdmin) data.position = form.position.value;
  await withBusy(e.submitter, 'กำลังบันทึก', async () => {
    try { await updateDoc(doc(db, USERS_PATH, id), data); closeDialog($('#dlg-edit')); toast('บันทึกข้อมูลแล้ว'); }
    catch (err) { toast('บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง', 'error'); }
  });
});

/* ================= photos (Google Drive via Apps Script) ================= */
async function loadPhotoMap() {
  try {
    const res = await fetch(PHOTO_API_URL, { redirect: 'follow' });
    const data = await res.json();
    if (data && data.ok) {
      photoMap = data.photos || {};
      if (membersLoaded) { renderDirectory(); renderHero(); }
      if (profileId) fillProfile(byId(profileId));
      renderMe();
      if (!$('#view-memories').hidden) renderMemories();
      if (!$('#view-admin').hidden) renderAdmin();
    }
  } catch (e) { console.error('Photo map error', e); }
}

function resizeToJpegBase64(file, maxSide = 1000, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality).split(',')[1]);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}

async function uploadPhoto(studentId, file) {
  if (!auth.currentUser) throw new Error('กรุณาเข้าสู่ระบบก่อน');
  let data;
  try { data = await resizeToJpegBase64(file); } catch (e) { throw new Error('เปิดไฟล์รูปนี้ไม่ได้ ลองใช้ JPG หรือ PNG'); }
  const idToken = await auth.currentUser.getIdToken();
  // ไม่ใส่ Content-Type เพื่อเป็น simple request (Apps Script ไม่รองรับ CORS preflight)
  const res = await fetch(PHOTO_API_URL, { method: 'POST', redirect: 'follow', body: JSON.stringify({ idToken, studentId, mimeType: 'image/jpeg', data }) });
  const out = await res.json();
  if (!out.ok) {
    const msgs = { forbidden: 'ไม่มีสิทธิ์เปลี่ยนรูปของคนนี้', 'not-signed-in': 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่', 'too-large': 'ไฟล์ใหญ่เกินไป' };
    throw new Error(msgs[out.error] || `อัปโหลดไม่สำเร็จ (${out.error})`);
  }
  photoMap[studentId] = out.fileId;
  return out.fileId;
}

$('#photo-file-input').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  const id = profileId;
  if (!file || !id) return;
  await withBusy($('[data-photo-btn]'), 'กำลังอัปโหลด', async () => {
    try { await uploadPhoto(id, file); fillProfile(byId(id)); renderDirectory(); renderMe(); toast('เปลี่ยนรูปแล้ว'); }
    catch (err) { toast(err.message, 'error'); }
  });
});

async function bulkUpload(btn) {
  if (!currentUser?.isAdmin) return;
  const input = $('#bulk-photo-input');
  const files = [...(input.files || [])];
  if (!files.length) { toast('เลือกรูปก่อน', 'error'); return; }
  const log = $('[data-bulk-log]');
  log.textContent = '';
  const failed = []; let ok = 0;
  btn.disabled = true;
  const orig = btn.innerHTML;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    btn.innerHTML = `<span class="spinner" aria-hidden="true"></span><span>${i + 1}/${files.length}</span>`;
    const m = /^(\d{10})\./.exec(f.name);
    if (!m) { failed.push(`${f.name}: ชื่อไฟล์ต้องเป็นรหัส 10 หลัก`); continue; }
    try { await uploadPhoto(m[1], f); ok++; } catch (err) { failed.push(`${f.name}: ${err.message}`); }
  }
  btn.disabled = false; btn.innerHTML = orig; input.value = '';
  log.textContent = failed.join('\n');
  renderDirectory();
  toast(`อัปโหลดสำเร็จ ${ok} รูป${failed.length ? ` · ไม่สำเร็จ ${failed.length}` : ''}`, failed.length ? 'error' : 'ok');
}

/* ================= auth ================= */
function setAuthMode(mode) {
  authMode = mode;
  $$('[data-auth-mode]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.authMode === mode)));
  $('[data-auth-submit]').textContent = mode === 'login' ? 'เข้าสู่ระบบ' : 'ลงทะเบียน';
  $('#auth-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('[data-auth-error]').hidden = true;
}
function authError(msg, field) {
  const box = $('[data-auth-error]');
  box.textContent = msg; box.hidden = false;
  $$('#auth-id, #auth-password').forEach((i) => i.removeAttribute('aria-invalid'));
  if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
}
$('[data-auth-form]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const idEl = $('#auth-id'), pwEl = $('#auth-password');
  const id = idEl.value.trim();
  if (!/^\d{10}$/.test(id)) return authError('รหัสนักศึกษาต้องเป็นตัวเลข 10 หลัก', idEl);
  if (pwEl.value.length < 6) return authError('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร', pwEl);
  $('[data-auth-error]').hidden = true;
  const email = `${id}@dome.tu.ac.th`;
  await withBusy(e.submitter, authMode === 'login' ? 'กำลังเข้าสู่ระบบ' : 'กำลังลงทะเบียน', async () => {
    try {
      if (authMode === 'register') await createUserWithEmailAndPassword(auth, email, pwEl.value);
      else await signInWithEmailAndPassword(auth, email, pwEl.value);
      e.target.reset();
      toast(authMode === 'register' ? 'ลงทะเบียนเรียบร้อย ยินดีต้อนรับ!' : 'เข้าสู่ระบบแล้ว');
      go('#/');
    } catch (err) {
      const map = {
        'auth/email-already-in-use': 'รหัสนี้ลงทะเบียนแล้ว ใช้แท็บ “เข้าสู่ระบบ” แทน',
        'auth/weak-password': 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร',
        'auth/too-many-requests': 'ลองหลายครั้งเกินไป รอสักครู่แล้วลองใหม่',
        'auth/network-request-failed': 'เชื่อมต่อไม่ได้ ตรวจสอบอินเทอร์เน็ต'
      };
      authError(map[err.code] || (authMode === 'login' ? 'รหัสนักศึกษาหรือรหัสผ่านไม่ถูกต้อง หรือยังไม่ได้ลงทะเบียน' : 'ลงทะเบียนไม่สำเร็จ ลองใหม่อีกครั้ง'));
    }
  });
});
$('#auth-id').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10); });

function renderMe() {
  const signedIn = !!currentUser;
  $$('[data-signed-in]').forEach((el) => { el.hidden = !signedIn; });
  $$('[data-signed-out]').forEach((el) => { el.hidden = signedIn; });
  $$('[data-admin-only]').forEach((el) => { el.hidden = !(currentUser && currentUser.isAdmin); });
  $('[data-composer]').hidden = !signedIn;
  $('[data-login-prompt]').hidden = signedIn;
  if (!signedIn) return;
  const me = byId(currentUser.studentId) || { studentId: currentUser.studentId };
  $$('[data-me-avatar]').forEach((av) => { av.dataset.sid = me.studentId; delete av.dataset.fallback; av.src = photoSrc(me, 96); });
  $('[data-me-name]').textContent = me.nickname || me.firstName || me.studentId;
}

onAuthStateChanged(auth, (user) => {
  if (user) {
    const sid = (user.email || '').split('@')[0];
    currentUser = { uid: user.uid, studentId: sid, isAdmin: sid === ADMIN_ID };
  } else {
    currentUser = null;
  }
  renderMe();
  route();
  if (profileId) fillProfile(byId(profileId));
  if (!$('#view-memories').hidden) renderMemories();
});

/* ================= memory board ================= */
function authorOf(id) {
  const m = byId(id);
  return m ? `${m.firstName || ''}${m.nickname ? ` (${m.nickname})` : ''}`.trim() : id;
}
function renderMemories() {
  const box = $('[data-posts]');
  if (!memories.length) {
    box.innerHTML = `<div class="panel empty">${icon('message', 'icon')}<strong>ยังไม่มีความทรงจำ</strong><span>${currentUser ? 'เริ่มเขียนโพสต์แรกของรุ่นด้านบนเลย' : 'เข้าสู่ระบบแล้วมาเขียนโพสต์แรกกัน'}</span></div>`;
    return;
  }
  const isAdmin = !!currentUser?.isAdmin;
  const sorted = [...memories].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  box.innerHTML = sorted.map((mem) => {
    const author = byId(mem.authorId);
    const canDel = currentUser && (currentUser.studentId === mem.authorId || isAdmin);
    const replies = (mem.replies || []).map((r) => {
      const ra = byId(r.authorId);
      const rDel = currentUser && (currentUser.studentId === r.authorId || isAdmin);
      return `<div class="reply">
        <div class="post-head">
          <img class="avatar avatar-sm" src="${esc(ra ? photoSrc(ra, 96) : avatarUrl({ studentId: r.authorId }))}" alt="" referrerpolicy="no-referrer" data-sid="${esc(r.authorId)}" loading="lazy">
          <div style="min-width:0;flex:1"><div class="post-author" style="font-size:.875rem">${esc(r.authorName || authorOf(r.authorId))}</div><div class="post-time"><time datetime="${esc(r.timestamp)}">${esc(relTime(r.timestamp))}</time></div></div>
          ${rDel ? `<button class="btn-text danger" type="button" data-del-reply="${esc(r.id)}" data-mid="${esc(mem.id)}" aria-label="ลบการตอบกลับ">${icon('trash')}</button>` : ''}
        </div>
        <p class="post-body">${esc(r.message)}</p>
      </div>`;
    }).join('');
    return `<article class="panel post" aria-label="โพสต์ของ ${esc(mem.authorName || authorOf(mem.authorId))}">
      <div class="post-head">
        <img class="avatar" src="${esc(author ? photoSrc(author, 96) : avatarUrl({ studentId: mem.authorId }))}" alt="" referrerpolicy="no-referrer" data-sid="${esc(mem.authorId)}" loading="lazy">
        <div style="min-width:0;flex:1">
          <div class="post-author">${author ? `<a href="#/m/${esc(mem.authorId)}" style="color:inherit;text-decoration:none">${esc(mem.authorName || authorOf(mem.authorId))}</a>` : esc(mem.authorName || mem.authorId)}</div>
          <div class="post-time"><time datetime="${esc(mem.timestamp)}" title="${esc(new Date(mem.timestamp).toLocaleString('th-TH'))}">${esc(relTime(mem.timestamp))}</time></div>
        </div>
        ${canDel ? `<button class="btn-text danger" type="button" data-del-post="${esc(mem.id)}" aria-label="ลบโพสต์">${icon('trash')}</button>` : ''}
      </div>
      <p class="post-body">${esc(mem.message)}</p>
      <div class="post-actions">
        ${currentUser ? `<button class="btn-text" type="button" data-reply-toggle="${esc(mem.id)}" aria-expanded="false" aria-controls="rf-${esc(mem.id)}">${icon('reply')}ตอบกลับ</button>` : ''}
        ${(mem.replies || []).length ? `<span class="muted" style="font-size:.875rem;align-self:center">${(mem.replies || []).length} การตอบกลับ</span>` : ''}
      </div>
      ${replies ? `<div class="replies">${replies}</div>` : ''}
      <form class="reply-form" id="rf-${esc(mem.id)}" data-reply-form="${esc(mem.id)}" hidden>
        <label class="sr-only" for="ri-${esc(mem.id)}">ข้อความตอบกลับ</label>
        <textarea class="textarea" id="ri-${esc(mem.id)}" maxlength="200" required placeholder="ตอบกลับ..." style="min-height:72px"></textarea>
        <div class="form-actions"><button class="btn btn-sm" type="button" data-reply-toggle="${esc(mem.id)}">ยกเลิก</button><button class="btn btn-sm btn-primary" type="submit">${icon('send')}ส่ง</button></div>
      </form>
    </article>`;
  }).join('');
}

function myAuthorName() {
  const me = byId(currentUser.studentId);
  return me ? `${me.firstName || ''} (${me.nickname || currentUser.studentId})` : currentUser.studentId;
}
$('[data-composer]').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser) return;
  const input = $('#memory-input');
  const msg = input.value.trim();
  if (!msg) { input.focus(); return; }
  await withBusy(e.submitter, 'กำลังโพสต์', async () => {
    try {
      await addDoc(collection(db, MEMORIES_PATH), { authorId: currentUser.studentId, authorName: myAuthorName(), message: msg, timestamp: new Date().toISOString(), replies: [] });
      input.value = ''; updateCount(input); toast('โพสต์แล้ว');
    } catch (err) { toast('โพสต์ไม่สำเร็จ ตรวจสอบการเข้าสู่ระบบ', 'error'); }
  });
});
function updateCount(input) {
  const c = $(`[data-count-for="${input.id}"]`);
  if (c) c.textContent = `${input.value.length}/${input.maxLength}`;
}
$('#memory-input').addEventListener('input', (e) => updateCount(e.target));

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('[data-reply-form]');
  if (!form) return;
  e.preventDefault();
  if (!currentUser) return;
  const mid = form.dataset.replyForm;
  const ta = $('textarea', form);
  const msg = ta.value.trim();
  if (!msg) return;
  const reply = { id: 'reply_' + Math.random().toString(36).slice(2, 11), authorId: currentUser.studentId, authorName: myAuthorName(), message: msg, timestamp: new Date().toISOString() };
  await withBusy(e.submitter, 'กำลังส่ง', async () => {
    try { await updateDoc(doc(db, MEMORIES_PATH, mid), { replies: arrayUnion(reply) }); toast('ตอบกลับแล้ว'); }
    catch (err) { toast('ตอบกลับไม่สำเร็จ', 'error'); }
  });
});

/* ================= admin ================= */
function renderAdmin() {
  if (!currentUser?.isAdmin) return;
  const q = ($('#admin-filter').value || '').trim().toLowerCase();
  const rows = [...members].sort((a, b) => String(a.studentId).localeCompare(String(b.studentId))).filter((m) => matches(m, q));
  $('[data-admin-count]').textContent = `(${members.length})`;
  $('[data-admin-rows]').innerHTML = rows.map((m) => `
    <tr>
      <td><div class="cell-person"><img class="avatar avatar-sm" src="${esc(photoSrc(m, 96))}" alt="" referrerpolicy="no-referrer" data-sid="${esc(m.studentId)}" loading="lazy"><span>${esc(fullName(m))}${m.nickname ? ` <span class="muted">(${esc(m.nickname)})</span>` : ''}</span></div></td>
      <td class="mono">${esc(m.studentId)}</td>
      <td><span class="pill${isLeader(m) ? ' lead' : ''}">${esc(m.position || POS_MEMBER)}</span></td>
      <td style="text-align:right;white-space:nowrap">
        <button class="icon-btn" type="button" data-open="${esc(m.studentId)}" aria-label="ดูโปรไฟล์ ${esc(fullName(m))}">${icon('eye')}</button>
        <button class="icon-btn" type="button" data-admin-edit="${esc(m.studentId)}" aria-label="แก้ไข ${esc(fullName(m))}">${icon('pencil')}</button>
      </td>
    </tr>`).join('') || `<tr><td colspan="4" class="muted" style="text-align:center;padding:24px">ไม่พบรายชื่อที่ตรงกัน</td></tr>`;
}
$('#admin-filter').addEventListener('input', debounce(renderAdmin, 120));

$('[data-add-form]').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser?.isAdmin) return;
  const f = e.currentTarget;
  const id = f.studentId.value.trim();
  if (!/^\d{10}$/.test(id)) { toast('รหัสนักศึกษาต้องเป็นตัวเลข 10 หลัก', 'error'); f.studentId.focus(); return; }
  await withBusy(e.submitter, 'กำลังเพิ่ม', async () => {
    try {
      const ref = doc(db, USERS_PATH, id);
      if ((await getDoc(ref)).exists()) { toast(`มีรหัส ${id} อยู่แล้ว`, 'error'); return; }
      await setDoc(ref, {
        studentId: id, firstName: f.firstName.value.trim(), lastName: f.lastName.value.trim(), nickname: f.nickname.value.trim(),
        birthdate: f.birthdate.value, tags: f.tags.value.trim(), lineId: f.lineId.value.trim(), instagram: f.instagram.value.trim(),
        position: f.position.value, status: '', givenNicknames: {}
      });
      f.reset(); toast(`เพิ่ม ${id} แล้ว`);
    } catch (err) { toast('เพิ่มสมาชิกไม่สำเร็จ', 'error'); }
  });
});

function exportCSV() {
  if (!currentUser?.isAdmin) return;
  if (!members.length) { toast('ยังไม่มีข้อมูลสมาชิก', 'error'); return; }
  const csv = window.Papa.unparse(members.map(({ givenNicknames, ...rest }) => ({ ...rest, givenNicknames: JSON.stringify(givenNicknames || {}) })), { quotes: true });
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `CN25_Directory_${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.appendChild(a); a.click(); a.remove();
  toast('ดาวน์โหลดไฟล์ CSV แล้ว');
}

function importCSV(btn) {
  if (!currentUser?.isAdmin) return;
  const input = $('#csv-file');
  if (!input.files.length) { toast('เลือกไฟล์ CSV ก่อน', 'error'); return; }
  withBusy(btn, 'กำลังนำเข้า', () => new Promise((resolve) => {
    window.Papa.parse(input.files[0], {
      header: true, skipEmptyLines: true,
      complete: async ({ data }) => {
        let added = 0, skipped = 0;
        for (const row of data) {
          const id = String(row['รหัสนักศึกษา'] || row.studentId || '').trim();
          if (!/^\d{10}$/.test(id)) { skipped++; continue; }
          try {
            const ref = doc(db, USERS_PATH, id);
            if ((await getDoc(ref)).exists()) { skipped++; continue; }
            let tags = row['แท็ก'] || row.tags || '';
            if (row['สายรหัส']) tags += (tags ? ',' : '') + row['สายรหัส'];
            await setDoc(ref, {
              studentId: id, firstName: (row['ชื่อ'] || row.name || '').trim(), lastName: (row['นามสกุล'] || '').trim(),
              nickname: (row['ชื่อเล่น'] || '').trim(), birthdate: (row['วันเกิด'] || row.birthdate || '').trim(), tags,
              lineId: (row['ID Line'] || '').trim(), instagram: (row['Instagram'] || '').trim(),
              position: POS_MEMBER, status: '', givenNicknames: {}
            });
            added++;
          } catch (err) { skipped++; }
        }
        input.value = '';
        toast(`นำเข้า ${added} รายการ · ข้าม ${skipped}`);
        resolve();
      }
    });
  }));
}

/* ================= random ================= */
function randomMember() {
  if (!members.length) return;
  const pool = members.filter((m) => m.studentId !== profileId);
  const m = pool[Math.floor(Math.random() * pool.length)] || members[0];
  if (parseRoute().view !== 'directory') history.pushState(null, '', '#/');
  route();
  openProfile(m.studentId);
}

/* ================= global click delegation ================= */
document.addEventListener('click', async (e) => {
  const t = e.target.closest('button, a');
  if (!t) return;

  if (t.dataset.open) { e.preventDefault(); openProfile(t.dataset.open); return; }
  if (t.hasAttribute('data-close')) { closeDialog(t.closest('dialog')); return; }
  if (t.dataset.authMode) { setAuthMode(t.dataset.authMode); return; }
  if (t.dataset.adminEdit) { openEdit(t.dataset.adminEdit, 'admin'); return; }
  if (t.dataset.filter) { activeFilter = t.dataset.filter; renderFilterCounts(); renderDirectory(); return; }

  if (t.dataset.replyToggle) {
    const form = $(`[data-reply-form="${CSS.escape(t.dataset.replyToggle)}"]`);
    if (!form) return;
    form.hidden = !form.hidden;
    $$(`[data-reply-toggle="${CSS.escape(t.dataset.replyToggle)}"][aria-expanded]`).forEach((b) => b.setAttribute('aria-expanded', String(!form.hidden)));
    if (!form.hidden) $('textarea', form).focus();
    return;
  }
  if (t.dataset.delPost) {
    if (await confirmDialog('ลบโพสต์นี้?', 'การตอบกลับทั้งหมดจะถูกลบไปด้วย และกู้คืนไม่ได้', 'ลบโพสต์')) {
      try { await deleteDoc(doc(db, MEMORIES_PATH, t.dataset.delPost)); toast('ลบโพสต์แล้ว'); } catch (err) { toast('ลบไม่สำเร็จ', 'error'); }
    }
    return;
  }
  if (t.dataset.delReply) {
    if (await confirmDialog('ลบการตอบกลับนี้?', 'กู้คืนไม่ได้', 'ลบ')) {
      try {
        const ref = doc(db, MEMORIES_PATH, t.dataset.mid);
        const snap = await getDoc(ref);
        if (snap.exists()) await updateDoc(ref, { replies: (snap.data().replies || []).filter((r) => r.id !== t.dataset.delReply) });
        toast('ลบการตอบกลับแล้ว');
      } catch (err) { toast('ลบไม่สำเร็จ', 'error'); }
    }
    return;
  }

  switch (t.dataset.action) {
    case 'random': randomMember(); break;
    case 'theme': toggleTheme(); renderMe(); break;
    case 'logout':
      try { await signOut(auth); toast('ออกจากระบบแล้ว'); go('#/'); } catch (err) { toast('ออกจากระบบไม่สำเร็จ', 'error'); }
      break;
    case 'open-me': if (currentUser) openProfile(currentUser.studentId); break;
    case 'clear-search': $('#search').value = ''; renderDirectory(); $('#search').focus(); break;
    case 'reset-filters': $('#search').value = ''; activeFilter = 'all'; renderFilterCounts(); renderDirectory(); break;
    case 'toggle-faces': {
      const box = $('[data-faces]');
      const paused = box.dataset.paused !== 'true';
      box.dataset.paused = String(paused);
      t.setAttribute('aria-pressed', String(paused));
      $('use', t).setAttribute('href', paused ? '#i-play' : '#i-pause');
      $('span', t).textContent = paused ? 'เล่นภาพเลื่อน' : 'หยุดภาพเลื่อน';
      break;
    }
    case 'copy-link': {
      if (!profileId) return;
      const url = `${location.origin}${location.pathname}#/m/${profileId}`;
      try { await navigator.clipboard.writeText(url); toast('คัดลอกลิงก์โปรไฟล์แล้ว'); } catch (err) { toast('คัดลอกไม่ได้', 'error'); }
      break;
    }
    case 'pick-photo': $('#photo-file-input').click(); break;
    case 'edit-self': if (profileId) openEdit(profileId, 'self'); break;
    case 'copy': {
      const text = $('#' + t.dataset.copyFrom).textContent.trim();
      if (!text || text === '—') return;
      try { await navigator.clipboard.writeText(text); toast(`คัดลอก ${text} แล้ว`); }
      catch (err) { toast('คัดลอกไม่ได้ ลองกดค้างที่ข้อความแทน', 'error'); }
      break;
    }
    case 'toggle-password': {
      const pw = $('#auth-password');
      const show = pw.type === 'password';
      pw.type = show ? 'text' : 'password';
      t.setAttribute('aria-pressed', String(show));
      t.setAttribute('aria-label', show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน');
      $('use', t).setAttribute('href', show ? '#i-eye-off' : '#i-eye');
      break;
    }
    case 'export-csv': exportCSV(); break;
    case 'import-csv': importCSV(t); break;
    case 'bulk-upload': bulkUpload(t); break;
  }
});

/* ================= data ================= */
onSnapshot(collection(db, USERS_PATH), (snap) => {
  members = [];
  snap.forEach((d) => members.push({ ...d.data() }));
  const first = !membersLoaded;
  membersLoaded = true;
  renderFilterCounts();
  renderDirectory();
  if (first || !$('[data-faces]').children.length) renderHero(); else { setStat('members', members.length); setStat('bdays', members.filter(bdayThisMonth).length); }
  renderBirthdays();
  renderMe();
  if (!$('#view-admin').hidden) renderAdmin();
  if (!$('#view-memories').hidden) renderMemories();
  if (profileId) fillProfile(byId(profileId));
  else if (first) { const r = parseRoute(); if (r.profile) openProfile(r.profile, false); }
}, (err) => {
  console.error(err);
  $('[data-directory]').innerHTML = `<div class="panel empty" style="margin-top:24px">${icon('alert', 'icon')}<strong>โหลดรายชื่อไม่สำเร็จ</strong><span>ตรวจสอบอินเทอร์เน็ตแล้วรีเฟรชหน้า</span><button class="btn btn-sm" type="button" onclick="location.reload()">รีเฟรช</button></div>`;
});

onSnapshot(collection(db, MEMORIES_PATH), (snap) => {
  memories = [];
  snap.forEach((d) => memories.push({ id: d.id, ...d.data() }));
  setStat('posts', memories.length);
  if (!$('#view-memories').hidden) renderMemories();
});

/* visitor counter: นับ 1 ครั้งต่อ session */
(async () => {
  const ref = doc(db, STATS_PATH, 'visitorCount');
  try {
    let seen = false; try { seen = !!sessionStorage.getItem('visited_cn25'); } catch (e) {}
    if (!seen) {
      const snap = await getDoc(ref);
      if (!snap.exists()) await setDoc(ref, { count: 1 }); else await updateDoc(ref, { count: increment(1) });
      try { sessionStorage.setItem('visited_cn25', '1'); } catch (e) {}
    }
  } catch (e) { console.error('Visitor count error', e); }
  onSnapshot(ref, (d) => { if (d.exists()) setStat('visitors', d.data().count || 0); });
})();

/* refresh relative times every minute */
// อัปเดตแค่ข้อความเวลา ไม่ re-render ทั้งบอร์ด (กันข้อความที่กำลังพิมพ์หาย)
setInterval(() => { $$('[data-posts] time[datetime]').forEach((t) => { t.textContent = relTime(t.getAttribute('datetime')); }); }, 60000);

loadPhotoMap();
route();
