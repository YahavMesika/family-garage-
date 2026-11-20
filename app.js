import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, setDoc, deleteDoc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getMessaging, getToken, onMessage, isSupported } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js';

/* ---------- הגדרות הפרויקט ---------- */
const firebaseConfig = {
  apiKey: "AIzaSyA5iZApm2exIKN71QkT1Raq3fZVVXHq7Tg",
  authDomain: "family-garage-35d86.firebaseapp.com",
  projectId: "family-garage-35d86",
  storageBucket: "family-garage-35d86.firebasestorage.app",
  messagingSenderId: "187401871001",
  appId: "1:187401871001:web:e13c3933dcfe6b4cace208"
};
// מפתח Web Push (Cloud Messaging > Web Push certificates). ריק = התראות כבויות
const VAPID_KEY = "";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
let fs;
try { fs = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
catch (_) { fs = initializeFirestore(app, {}); }

/* ---------- עזרים ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TYPES = ['טיפול תקופתי', 'החלפת שמן', 'מים / נוזל קירור', 'פילטרים', 'בלמים', 'צמיגים', 'מצבר', 'טסט', 'תיקון', 'אחר'];
const LAST = ['החלפת שמן', 'מים / נוזל קירור', 'פילטרים', 'בלמים', 'צמיגים', 'מצבר'];
let user = null, cars = [], recs = [], status = 'loading', unsubs = [];
let view = (() => { try { const t = localStorage.getItem('tab'); return t ? { name: 'car', id: t } : { name: 'home' }; } catch (_) { return { name: 'home' }; } })();
const pad = n => String(n).padStart(2, '0');
const iso = x => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
const today = () => iso(new Date());
const pd = d => { const [a, b, c] = d.split('-').map(Number); return new Date(a, b - 1, c); };
const days = d => d ? Math.round((pd(d) - pd(today())) / 864e5) : null;
const addM = (d, m) => { const x = pd(d); x.setMonth(x.getMonth() + m); return iso(x); };
const fmtD = d => d ? d.split('-').reverse().join('/') : '—';
const num = n => Number(n).toLocaleString('he-IL');
const fmtK = n => (n || n === 0) && n !== '' ? num(n) + ' ק״מ' : '—';
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const lvl = d => d == null ? 'none' : d < 0 ? 'bad' : d <= 30 ? 'warn' : 'ok';
const dtxt = d => d == null ? 'לא הוזן' : d < 0 ? `פג לפני ${-d} ימים` : d === 0 ? 'היום' : d < 60 ? `בעוד ${d} ימים` : `בעוד ${Math.round(d / 30.4)} חודשים`;
const toast = t => { const e = $('#toast'); e.textContent = t; e.classList.add('on'); clearTimeout(e._t); e._t = setTimeout(() => e.classList.remove('on'), 2800); };
const tabName = c => c.tabName || c.name || 'רכב';

function items(c) {
  const t = days(c.testDate), i = days(c.insuranceDate);
  const kl = c.nextServiceKm ? Number(c.nextServiceKm) - Number(c.km || 0) : null, sd = days(c.nextServiceDate);
  let lv = 'none';
  if (kl != null || sd != null) { lv = 'ok'; if ((kl != null && kl <= 1000) || (sd != null && sd <= 30)) lv = 'warn'; if ((kl != null && kl <= 0) || (sd != null && sd < 0)) lv = 'bad'; }
  let st = 'לא הוזן';
  if (kl != null) st = kl <= 0 ? `עבר ב-${num(-kl)} ק״מ` : `עוד ${num(kl)} ק״מ`;
  else if (sd != null) st = dtxt(sd);
  if (kl != null && kl > 0 && sd != null && sd < 0) st = dtxt(sd);
  const ss = [c.nextServiceKm ? 'ב-' + fmtK(c.nextServiceKm) : '', c.nextServiceDate ? 'עד ' + fmtD(c.nextServiceDate) : ''].filter(Boolean).join(' או ');
  return [
    { k: 'טיפול הבא', lv, txt: st, sub: ss || 'הוסיפו טיפול כדי לחשב', rank: lv === 'bad' ? -1e4 : Math.min(kl != null ? kl / 50 : 1e4, sd != null ? sd : 1e4) },
    { k: 'טסט', lv: lvl(t), txt: dtxt(t), sub: fmtD(c.testDate), rank: t ?? 1e4 },
    { k: 'ביטוח', lv: lvl(i), txt: dtxt(i), sub: fmtD(c.insuranceDate) + (c.insurer ? ' · ' + c.insurer : ''), rank: i ?? 1e4 }];
}
const worst = c => { const l = items(c).map(i => i.lv); return l.includes('bad') ? 'bad' : l.includes('warn') ? 'warn' : 'ok'; };
const sorted = () => [...cars].sort((a, b) => (a.created || 0) - (b.created || 0) || tabName(a).localeCompare(tabName(b), 'he'));
const plate = p => p ? `<span class="plate"><i>IL</i><span>${esc(p)}</span></span>` : '';
const carRecs = id => recs.filter(r => r.carId === id).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (Number(b.km) || 0) - (Number(a.km) || 0));
const CAR_SVG = `<svg viewBox="0 0 260 110" aria-hidden="true"><rect x="10" y="96" width="240" height="6" rx="3" fill="currentColor" opacity=".25"/><path d="M40 78 L58 46 Q64 36 76 36 H170 Q182 36 190 46 L212 74 Q232 76 236 88 V92 H30 V86 Q30 80 40 78Z" fill="#0a4aa6"/><path d="M72 48 H118 V72 H60Z M126 48 H170 Q178 48 184 56 L196 72 H126Z" fill="#cfe0ff"/><circle cx="76" cy="92" r="14" fill="#141a22"/><circle cx="76" cy="92" r="6" fill="#b9c2cf"/><circle cx="194" cy="92" r="14" fill="#141a22"/><circle cx="194" cy="92" r="6" fill="#b9c2cf"/><rect x="108" y="80" width="44" height="11" rx="2" fill="#f6c700" stroke="#141a22" stroke-width="1.5"/></svg>`;

/* ---------- תצוגה ---------- */
function renderTabs() {
  if (!user || status === 'denied') { $('#tabs').innerHTML = ''; return; }
  const cur = view.name === 'car' ? view.id : 'home';
  $('#tabs').innerHTML = `<button class="tab" role="tab" aria-selected="${cur === 'home'}" data-act="home">סקירה</button>` +
    sorted().map(c => `<button class="tab" role="tab" aria-selected="${cur === c.id}" data-act="open" data-id="${esc(c.id)}"><span class="dot ${worst(c)}"></span>${esc(tabName(c))}</button>`).join('') +
    `<button class="tab add" data-act="newCar" aria-label="הוספת רכב">+ רכב</button>`;
  const a = $('#tabs [aria-selected=true]'); a && a.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function renderUser() {
  const u = $('#ubar');
  if (!user) { u.innerHTML = ''; return; }
  const nOn = notifState === 'on';
  u.innerHTML = `<span class="em">${esc(user.email)}</span>` +
    (status !== 'denied' ? `<button class="btn sm ${nOn ? 'on' : ''}" data-act="notif">${nOn ? 'התראות פעילות ✓' : 'הפעלת התראות'}</button>` : '') +
    `<button class="btn sm" data-act="logout">יציאה</button>`;
}
function render() {
  renderUser();
  const m = $('#main');
  if (status === 'auth') { $('#sub').textContent = 'מעקב טיפולים, טסט וביטוח לכל רכב במשפחה'; $('#tabs').innerHTML = ''; m.innerHTML = `<div class="login">${CAR_SVG}<h2>ברוכים הבאים</h2><p>התחברו עם חשבון Google כדי לראות את הרכבים של המשפחה.</p><button class="gbtn" data-act="login"><svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>התחברות עם Google</button></div>`; return; }
  if (status === 'denied') { $('#sub').textContent = 'אין גישה'; renderTabs(); m.innerHTML = `<div class="login">${CAR_SVG}<h2>לחשבון הזה אין גישה</h2><p>התחברת בתור <b>${esc(user.email)}</b>. רק כתובות שאושרו מראש יכולות לראות את הנתונים. בקשו מבעל האפליקציה להוסיף את הכתובת, או התחברו עם חשבון אחר.</p><button class="gbtn" data-act="logout">התחברות עם חשבון אחר</button></div>`; return; }
  $('#sub').textContent = status === 'loading' && !cars.length ? 'טוען…' : cars.length ? `${cars.length} רכבים · ${recs.length} טיפולים רשומים` : 'מעקב טיפולים, טסט וביטוח לכל רכב במשפחה';
  let h = status === 'slow' ? `<div class="note">החיבור איטי, ייתכן שהמידע לא עדכני.</div>` : '';
  if (status === 'loading' && !cars.length) { renderTabs(); m.innerHTML = '<div class="note">טוען נתונים…</div>'; return; }
  if (view.name === 'car' && !cars.find(x => x.id === view.id)) view = { name: 'home' };
  try { localStorage.setItem('tab', view.name === 'car' ? view.id : ''); } catch (_) { }
  renderTabs();
  const c = view.name === 'car' && cars.find(x => x.id === view.id);
  m.innerHTML = h + (c ? carView(c) : home());
}
function home() {
  if (!cars.length) return `<div class="empty">${CAR_SVG}<h2 style="margin:0 0 6px;color:var(--ink)">עוד אין רכבים</h2><p>הוסיפו את הרכב הראשון: של מי הוא, מספר רישוי, קילומטראז׳, ומתי הטסט והביטוח.</p><button class="btn pri" data-act="newCar">+ הוספת רכב</button></div>`;
  const all = []; cars.forEach(c => items(c).forEach(it => { if (it.lv === 'bad' || it.lv === 'warn') all.push({ ...it, c }); }));
  all.sort((a, b) => (a.lv === b.lv ? 0 : a.lv === 'bad' ? -1 : 1) || a.rank - b.rank);
  let h = `<h2>דורש תשומת לב</h2>`;
  h += all.length ? `<div class="alerts">${all.map(a => `<button class="al ${a.lv}" data-act="open" data-id="${esc(a.c.id)}"><span class="dot"></span><span><b>${esc(tabName(a.c))}</b> · ${a.k}<br><small style="color:var(--mut)">${esc(a.sub)}</small></span><span class="when">${esc(a.txt)}</span></button>`).join('')}</div>`
    : `<div class="note" style="color:var(--ok)">הכול מעודכן. אין טסט, ביטוח או טיפול בחודש הקרוב.</div>`;
  h += `<h2>הרכבים</h2><div class="grid">${sorted().map(c => `<button class="car" data-act="open" data-id="${esc(c.id)}"><div class="ch"><h3>${esc(tabName(c))}</h3>${plate(c.plate)}</div><div class="km">${c.tabName && c.name ? esc(c.name) + ' · ' : ''}${fmtK(c.km)}</div><div class="rows">${items(c).map(i => `<div class="row ${i.lv}"><span class="dot"></span><span class="k">${i.k}</span><span class="v">${esc(i.txt)}</span></div>`).join('')}</div></button>`).join('')}</div>`;
  return h;
}
function carView(c) {
  const rs = carRecs(c.id);
  const last = LAST.map(t => { const r = rs.find(r => (r.types || []).includes(t) || (t === 'החלפת שמן' && (r.types || []).includes('טיפול תקופתי'))); return `<div><small>${t}</small>${r ? `${fmtD(r.date)} · ${fmtK(r.km)}` : '<span style="color:var(--mut)">אין רישום</span>'}</div>`; }).join('');
  return `<div class="ch" style="margin-top:8px"><h2 style="margin:0;font-size:clamp(26px,6vw,36px)">${esc(tabName(c))}</h2>${plate(c.plate)}</div>
  <div class="km">${[c.tabName && c.name ? esc(c.name) : '', c.year ? 'שנת ' + esc(c.year) : '', c.owner ? 'נוהג: ' + esc(c.owner) : '', c.kmDate ? 'ק״מ עודכן ' + fmtD(c.kmDate) : ''].filter(Boolean).join(' · ')}</div>
  <form class="kmup" data-form="km"><label for="kmIn">קילומטראז׳ נוכחי</label><input id="kmIn" name="km" type="number" inputmode="numeric" value="${esc(c.km)}"><button class="btn">עדכון</button></form>
  <div class="tiles" style="margin-top:14px">${items(c).map(i => `<div class="tile ${i.lv}"><small>${i.k}</small><strong>${esc(i.txt)}</strong><div class="s">${esc(i.sub)}</div></div>`).join('')}</div>
  <div class="bar"><button class="btn pri" data-act="newRec">+ טיפול חדש</button><button class="btn" data-act="editCar">עריכת פרטי רכב</button></div>
  ${c.notes ? `<div class="note" style="margin-top:14px;white-space:pre-wrap">${esc(c.notes)}</div>` : ''}
  <h2>טיפול אחרון לפי סוג</h2><div class="last">${last}</div>
  <h2>היסטוריית טיפולים (${rs.length})</h2>
  <div class="hist">${rs.length ? rs.map(r => `<div class="rec"><div class="h"><span class="d">${fmtD(r.date)}</span><span class="km">${fmtK(r.km)}</span>${r.cost ? `<span class="cost">₪${num(r.cost)}</span>` : ''}</div><div class="tags">${(r.types || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>${r.garage ? `<p>מוסך: ${esc(r.garage)}</p>` : ''}${r.notes ? `<p>${esc(r.notes)}</p>` : ''}${r.by ? `<p style="font-size:13px">נרשם ע״י ${esc(r.by)}</p>` : ''}<div class="acts"><button class="btn ghost" data-act="editRec" data-id="${esc(r.id)}">עריכה</button><button class="btn ghost dan" data-act="del" data-col="records" data-id="${esc(r.id)}">מחיקה</button></div></div>`).join('') : '<div class="note">עוד לא נרשמו טיפולים לרכב הזה.</div>'}</div>
  <div class="bar" style="margin-top:30px"><button class="btn ghost dan" data-act="del" data-col="cars" data-id="${esc(c.id)}">מחיקת הרכב</button></div>`;
}

/* ---------- שמירה ---------- */
const put = (col, id, data) => setDoc(doc(fs, col, id), data);
const del = (col, id) => deleteDoc(doc(fs, col, id));
const strip = o => { const { id, ...r } = o; return r; };
async function safe(fn) {
  try { await fn(); return true; }
  catch (e) { console.error(e); toast(e && e.code === 'permission-denied' ? 'אין לחשבון הזה הרשאה לשמור.' : 'השמירה נכשלה, נסו שוב.'); return false; }
}

/* ---------- טפסים ---------- */
const ov = $('#ov'), sh = $('#sheet');
const open = html => { sh.innerHTML = html; ov.classList.add('on'); const f = sh.querySelector('input'); f && f.focus(); };
const close = () => { ov.classList.remove('on'); sh.innerHTML = ''; };
ov.addEventListener('click', e => { if (e.target === ov) close(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
const fld = (n, l, v, t = 'text', x = '') => `<label class="${x}">${l}<input name="${n}" type="${t}" value="${esc(v)}" ${t === 'number' ? 'inputmode="numeric"' : ''}></label>`;
function carForm(c) {
  c = c || { serviceKm: 15000, serviceMonths: 12 };
  open(`<h2>${c.id ? 'עריכת רכב' : 'רכב חדש'}</h2><form class="f" data-form="car" data-id="${esc(c.id || '')}">
  ${fld('tabName', 'שם הכרטיסייה: של מי הרכב (למשל: הרכב של יוסי)', c.tabName, 'text', 'w')}${fld('name', 'דגם הרכב (למשל: טויוטה קורולה)', c.name, 'text', 'w')}
  ${fld('plate', 'מספר רישוי', c.plate)}${fld('year', 'שנת ייצור', c.year, 'number')}
  ${fld('km', 'קילומטראז׳ נוכחי', c.km, 'number')}${fld('owner', 'נוהג עיקרי', c.owner)}
  ${fld('testDate', 'תוקף טסט / רישיון רכב', c.testDate, 'date')}${fld('insuranceDate', 'חידוש ביטוח', c.insuranceDate, 'date')}
  ${fld('insurer', 'חברת ביטוח / סוג', c.insurer, 'text', 'w')}
  ${fld('serviceKm', 'טיפול כל (ק״מ)', c.serviceKm, 'number')}${fld('serviceMonths', 'או כל (חודשים)', c.serviceMonths, 'number')}
  ${fld('nextServiceKm', 'טיפול הבא ב-(ק״מ)', c.nextServiceKm, 'number')}${fld('nextServiceDate', 'טיפול הבא עד תאריך', c.nextServiceDate, 'date')}
  <label class="w">הערות (שמן מומלץ, מידות צמיגים…)<textarea name="notes">${esc(c.notes)}</textarea></label>
  <div class="bar w"><button class="btn pri">שמירה</button><button type="button" class="btn" data-act="close">ביטול</button></div></form>`);
}
function recForm(car, r) {
  const nw = !r; r = r || { date: today(), km: car.km || '', types: [] };
  open(`<h2>${nw ? 'טיפול חדש' : 'עריכת טיפול'} · ${esc(tabName(car))}</h2><form class="f" data-form="rec" data-id="${esc(r.id || '')}">
  ${fld('date', 'תאריך', r.date, 'date')}${fld('km', 'קילומטראז׳ בטיפול', r.km, 'number')}
  <div class="w"><div style="font-size:14px;color:var(--mut);margin-bottom:6px">מה נעשה</div><div class="chips">${TYPES.map(t => `<label class="chip"><input type="checkbox" name="types" value="${t}" ${(r.types || []).includes(t) ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div></div>
  ${fld('garage', 'מוסך / מי ביצע', r.garage)}${fld('cost', 'עלות (₪)', r.cost, 'number')}
  <label class="w">פירוט / הערות<textarea name="notes">${esc(r.notes)}</textarea></label>
  <label class="ck"><input type="checkbox" name="apply" ${nw ? 'checked' : ''}> לעדכן ברכב את הטיפול הבא${car.serviceKm ? ` (+${num(car.serviceKm)} ק״מ)` : ''}, ואת תוקף הטסט אם סומן טסט</label>
  <div class="bar w"><button class="btn pri">שמירה</button><button type="button" class="btn" data-act="close">ביטול</button></div></form>`);
}

/* ---------- התראות ---------- */
let notifState = 'off';
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
async function checkNotif() {
  try { if (Notification.permission === 'granted' && localStorage.getItem('fcmToken')) notifState = 'on'; } catch (_) { }
}
async function enableNotif() {
  if (!VAPID_KEY) { toast('ההתראות עוד לא הוגדרו באתר (חסר מפתח Web Push).'); return; }
  if (isIOS && !standalone) { open(`<h2>התראות באייפון</h2><p>באייפון אפשר לקבל התראות רק מאפליקציה שנוספה למסך הבית:</p><ol><li>לוחצים על כפתור השיתוף בספארי (ריבוע עם חץ למעלה).</li><li>בוחרים "הוספה למסך הבית".</li><li>פותחים את "המוסך" מהמסך הבית ולוחצים שם "הפעלת התראות".</li></ol><div class="bar"><button class="btn pri" data-act="close">הבנתי</button></div>`); return; }
  if (!(await isSupported().catch(() => false)) || !('Notification' in window)) { toast('הדפדפן הזה לא תומך בהתראות.'); return; }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('ההתראות נחסמו. אפשר לאשר אותן בהגדרות הדפדפן.'); return; }
  try {
    const reg = await navigator.serviceWorker.register('./firebase-messaging-sw.js');
    await navigator.serviceWorker.ready;
    const token = await getToken(getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    if (!token) throw new Error('no token');
    await setDoc(doc(fs, 'tokens', token.replace(/\//g, '_')), { token, email: user.email, device: navigator.userAgent.slice(0, 120), updated: Date.now() });
    try { localStorage.setItem('fcmToken', token); } catch (_) { }
    notifState = 'on'; render(); toast('ההתראות הופעלו במכשיר הזה');
  } catch (e) { console.error(e); toast('לא הצלחתי להפעיל התראות. נסו שוב.'); }
}
async function listenForeground() {
  try {
    if (!VAPID_KEY || !(await isSupported())) return;
    onMessage(getMessaging(app), p => { const d = p.data || {}; toast((d.title ? d.title + ': ' : '') + (d.body || '')); });
  } catch (_) { }
}

/* ---------- אירועים ---------- */
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return; const a = b.dataset.act;
  if (a === 'login') {
    const p = new GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' });
    try { await signInWithPopup(auth, p); }
    catch (err) { if (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment') await signInWithRedirect(auth, p); else if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') toast('ההתחברות נכשלה: ' + err.code); }
  }
  else if (a === 'logout') { await signOut(auth); }
  else if (a === 'notif') { if (notifState === 'on') toast('ההתראות כבר פעילות במכשיר הזה'); else enableNotif(); }
  else if (a === 'newCar') carForm();
  else if (a === 'close') close();
  else if (a === 'home') { view = { name: 'home' }; render(); scrollTo(0, 0); }
  else if (a === 'open') { view = { name: 'car', id: b.dataset.id }; render(); scrollTo(0, 0); }
  else if (a === 'editCar') carForm(cars.find(c => c.id === view.id));
  else if (a === 'newRec') recForm(cars.find(c => c.id === view.id));
  else if (a === 'editRec') recForm(cars.find(c => c.id === view.id), recs.find(r => r.id === b.dataset.id));
  else if (a === 'del') {
    if (!b.dataset.armed) { b.dataset.armed = 1; const t = b.textContent; b.textContent = 'ללחוץ שוב למחיקה'; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = t; } }, 3500); return; }
    const col = b.dataset.col, id = b.dataset.id;
    if (col === 'cars') { view = { name: 'home' }; if (await safe(async () => { for (const r of recs.filter(r => r.carId === id)) await del('records', r.id); await del('cars', id); })) toast('הרכב נמחק'); }
    else if (await safe(() => del('records', id))) toast('הטיפול נמחק');
  }
});
document.addEventListener('submit', async e => {
  const f = e.target.closest('[data-form]'); if (!f) return; e.preventDefault();
  const fd = new FormData(f), g = k => (fd.get(k) || '').toString().trim(), n = k => g(k) === '' ? '' : Number(g(k));
  const btn = f.querySelector('.btn.pri,button:not([type])'); if (btn) btn.disabled = true;
  const car = cars.find(c => c.id === view.id);
  const by = user && (user.displayName || user.email);
  if (f.dataset.form === 'km') {
    if (car && g('km') !== '' && await safe(() => put('cars', car.id, { ...strip(car), km: n('km'), kmDate: today() }))) toast('הקילומטראז׳ עודכן');
  } else if (f.dataset.form === 'car') {
    if (!g('name') && !g('tabName')) { toast('צריך שם לכרטיסייה או דגם'); if (btn) btn.disabled = false; return; }
    const id = f.dataset.id || uid('c'), old = cars.find(c => c.id === id) || {};
    const d = { ...strip(old), tabName: g('tabName'), name: g('name'), created: old.created || Date.now(), plate: g('plate'), year: n('year'), km: n('km'), owner: g('owner'), testDate: g('testDate'), insuranceDate: g('insuranceDate'), insurer: g('insurer'), serviceKm: n('serviceKm'), serviceMonths: n('serviceMonths'), nextServiceKm: n('nextServiceKm'), nextServiceDate: g('nextServiceDate'), notes: g('notes') };
    if (d.km !== old.km) d.kmDate = today();
    const isNew = !f.dataset.id;
    close(); if (isNew) { view = { name: 'car', id }; }
    if (await safe(() => put('cars', id, d))) toast('נשמר');
  } else if (f.dataset.form === 'rec' && car) {
    const types = fd.getAll('types');
    if (!g('date') || !types.length) { toast('בחרו תאריך ולפחות סוג טיפול אחד'); if (btn) btn.disabled = false; return; }
    const id = f.dataset.id || uid('r'), old = recs.find(r => r.id === id) || {};
    const r = { ...strip(old), carId: car.id, date: g('date'), km: n('km'), types, garage: g('garage'), cost: n('cost'), notes: g('notes'), by: old.by || by || '' };
    const apply = fd.get('apply');
    close();
    if (await safe(async () => {
      await put('records', id, r);
      const u = { ...strip(car) }; let ch = false;
      if (r.km !== '' && r.km > (Number(car.km) || 0)) { u.km = r.km; u.kmDate = r.date; ch = true; }
      if (apply) {
        if (types.includes('טיפול תקופתי') || types.includes('החלפת שמן')) {
          if (r.km !== '' && car.serviceKm) { u.nextServiceKm = r.km + Number(car.serviceKm); ch = true; }
          if (car.serviceMonths) { u.nextServiceDate = addM(r.date, Number(car.serviceMonths)); ch = true; }
        }
        if (types.includes('טסט')) { u.testDate = addM(r.date, 12); ch = true; }
      }
      if (ch) await put('cars', car.id, u);
    })) toast('הטיפול נשמר');
  }
  if (btn) btn.disabled = false;
});

/* ---------- חיבור ---------- */
function subscribe() {
  unsubs.forEach(u => u()); unsubs = [];
  status = 'loading'; render();
  const slow = setTimeout(() => { if (status === 'loading') { status = 'slow'; render(); } }, 10000);
  let got = 0;
  const onErr = e => { clearTimeout(slow); console.error(e); status = e.code === 'permission-denied' ? 'denied' : 'ready'; if (status !== 'denied') toast('בעיה בטעינת הנתונים'); render(); };
  const sub = (col, set, bit) => onSnapshot(collection(fs, col), s => {
    set(s.docs.map(d => ({ ...d.data(), id: d.id })));
    if (!s.metadata.fromCache) { got |= bit; if (got === 3) { clearTimeout(slow); status = 'ready'; } }
    else if (s.size && status === 'loading') status = 'ready';
    render();
  }, onErr);
  unsubs.push(sub('cars', v => cars = v, 1), sub('records', v => recs = v, 2));
}
onAuthStateChanged(auth, u => {
  user = u;
  if (!u) { unsubs.forEach(x => x()); unsubs = []; cars = []; recs = []; status = 'auth'; render(); return; }
  checkNotif(); subscribe(); listenForeground();
});
render();
