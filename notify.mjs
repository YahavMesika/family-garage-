// רץ כל שעה. שולח תזכורות פעם ביום, בשעה ולפי ההגדרות שנבחרו באתר (מסך "התראות")
import admin from 'firebase-admin';

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();
const FORCE = process.env.FORCE === 'true';

const DEF = { test: [30, 7, 1], insurance: [30, 7, 1], service: [14, 3], km: 1000, hour: 9, overdue: true };
const sdoc = await db.doc('settings/notify').get();
const S = { ...DEF, ...(sdoc.exists ? sdoc.data() : {}) };

const now = new Date();
const today = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }); // YYYY-MM-DD
const hour = Number(now.toLocaleString('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hourCycle: 'h23' }));
const stateRef = db.doc('settings/state');
const state = (await stateRef.get()).data() || {};

if (!FORCE) {
  if (state.lastRun === today) { console.log('כבר נבדק היום'); process.exit(0); }
  if (hour < Number(S.hour)) { console.log(`עוד לא ${S.hour}:00 (עכשיו ${hour})`); process.exit(0); }
}

const weekday = new Date(today + 'T12:00:00Z').getUTCDay(); // 0 = ראשון
const days = d => d ? Math.round((Date.parse(d + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 864e5) : null;
const num = n => Number(n).toLocaleString('he-IL');
const when = d => d < 0 ? `פג לפני ${-d} ימים` : d === 0 ? 'היום!' : d === 1 ? 'מחר' : d === 7 ? 'בעוד שבוע' : d === 14 ? 'בעוד שבועיים' : `בעוד ${d} ימים`;

const cars = (await db.collection('cars').get()).docs.map(d => ({ id: d.id, ...d.data() }));
const recs = (await db.collection('records').get()).docs.map(d => d.data());
const addM = (d, m) => { const [y, mo, da] = d.split('-').map(Number); const x = new Date(Date.UTC(y, mo - 1 + m, da)); return x.toISOString().slice(0, 10); };
const isService = t => (t || []).some(x => x === 'טיפול תקופתי' || x === 'שמן מנוע' || x === 'החלפת שמן');
// הטיפול הבא: ק״מ של הטיפול האחרון + מרווח, או תאריך הטיפול האחרון + חודשים (כמו באתר)
function svc(c) {
  const rs = recs.filter(r => r.carId === c.id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const last = rs.find(r => isService(r.types));
  const kms = rs.map(r => Number(r.km)).filter(n => n > 0);
  const cur = Math.max(Number(c.km) || 0, ...kms, 0) || null;
  if (!last) return { nextDate: c.nextServiceDate || '', nextKm: c.nextServiceKm ? Number(c.nextServiceKm) : null, cur };
  return { nextDate: addM(last.date, Number(c.serviceMonths) || 12), nextKm: last.km !== '' && last.km != null ? Number(last.km) + (Number(c.serviceKm) || 15000) : null, cur };
}
const lines = [];
const perCar = []; // לכל רכב: התזכורות שלו, בשביל המיילים
for (const c of cars) {
  if (c.muted) continue; // רכב שכובו לו ההתראות
  const name = c.tabName || c.name || 'רכב';
  const mine = [];
  const add = t => { lines.push(`${name}: ${t}`); mine.push(t); };
  const check = (label, date, leads) => {
    const d = days(date);
    if (d == null) return;
    const hit = (leads || []).map(Number).includes(d) || (S.overdue && d < 0 && -d % 7 === 0);
    if (hit || (FORCE && d <= 30)) add(`${label} ${when(d)}${d >= 0 ? ` (${date.split('-').reverse().join('/')})` : ''}`);
  };
  check('טסט', c.testDate, S.test);
  check('ביטוח', c.insuranceDate, S.insurance);
  const v = svc(c);
  check('טיפול', v.nextDate, S.service);
  if (Number(S.km) > 0 && v.nextKm && v.cur) {
    const left = v.nextKm - v.cur;
    if (left <= Number(S.km) && (weekday === 0 || FORCE))
      add(left <= 0 ? `עבר את הטיפול ב-${num(-left)} ק״מ` : `עוד ${num(left)} ק״מ לטיפול (ב-${num(v.nextKm)} ק״מ)`);
  }
  const emails = String(c.emails || '').split(/[,;\s]+/).map(e => e.trim()).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  if (emails.length && (mine.length || FORCE)) perCar.push({ name, model: c.name, plate: c.plate, emails, items: mine });
}
if (!FORCE) await stateRef.set({ lastRun: today, lastCount: lines.length }, { merge: true });
if (!lines.length && FORCE) lines.push('בדיקה: ההתראות עובדות. אין כרגע שום דבר דחוף.');
console.log(today, hour, lines);

/* ---- מיילים לבני משפחה (לכל רכב לפי שדה "מיילים לתזכורות") ---- */
if (perCar.length && process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
  const nodemailer = (await import('nodemailer')).default;
  const tr = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD.replace(/\s/g, '') } });
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  for (const p of perCar) {
    const items = p.items.length ? p.items : ['בדיקה: מיילי התזכורות עובדים. אין כרגע שום דבר דחוף לרכב הזה.'];
    const html = `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:16px;color:#141a22;max-width:520px">
      <div style="background:#0a4aa6;color:#fff;padding:14px 18px;border-radius:12px 12px 0 0;font-size:20px;font-weight:bold">תזכורת לרכב: ${esc(p.name)}</div>
      <div style="border:1px solid #e2e6ec;border-top:0;padding:16px 18px;border-radius:0 0 12px 12px">
        ${p.model || p.plate ? `<p style="margin:0 0 10px;color:#5b6675">${esc([p.model, p.plate].filter(Boolean).join(' · '))}</p>` : ''}
        <ul style="margin:0;padding-inline-start:20px">${items.map(t => `<li style="margin:6px 0">${esc(t)}</li>`).join('')}</ul>
        <p style="margin:16px 0 0;font-size:13px;color:#5b6675">נשלח אוטומטית מ"המוסך המשפחתי".</p>
      </div></div>`;
    try {
      await tr.sendMail({ from: `"המוסך המשפחתי" <${process.env.GMAIL_USER}>`, to: p.emails.join(','), subject: `תזכורת: ${p.name} · ${items[0]}`, html, text: items.join('\n') });
      console.log(`מייל נשלח: ${p.name} → ${p.emails.join(', ')}`);
    } catch (e) { console.log(`מייל נכשל (${p.name}): ${e.message}`); }
  }
} else if (perCar.length) console.log('יש מיילים לשלוח, אבל GMAIL_USER / GMAIL_APP_PASSWORD לא הוגדרו ב-GitHub Secrets');

/* ---- התראות לטלפונים ---- */
if (!lines.length) process.exit(0);
const tokSnap = await db.collection('tokens').get();
const tokens = tokSnap.docs.map(d => d.data().token).filter(Boolean);
if (!tokens.length) { console.log('אין מכשירים רשומים'); process.exit(0); }

const res = await admin.messaging().sendEachForMulticast({
  tokens,
  data: { title: lines.length === 1 ? 'המוסך המשפחתי' : `המוסך המשפחתי · ${lines.length} תזכורות`, body: lines.join('\n'), tag: 'garage-' + today },
  webpush: { headers: { Urgency: 'high', TTL: '86400' } }
});
console.log(`נשלח: ${res.successCount}, נכשל: ${res.failureCount}`);
await Promise.all(res.responses.map((r, i) => {
  const code = r.error?.code || '';
  if (code.includes('registration-token-not-registered') || code.includes('invalid-registration-token'))
    return tokSnap.docs.find(d => d.data().token === tokens[i])?.ref.delete();
}));
process.exit(0);
