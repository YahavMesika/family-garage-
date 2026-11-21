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

const cars = (await db.collection('cars').get()).docs.map(d => d.data());
const lines = [];
for (const c of cars) {
  if (c.muted) continue; // רכב שכובו לו ההתראות
  const name = c.tabName || c.name || 'רכב';
  const check = (label, date, leads) => {
    const d = days(date);
    if (d == null) return;
    const hit = (leads || []).map(Number).includes(d) || (S.overdue && d < 0 && -d % 7 === 0);
    if (hit || (FORCE && d <= 30)) lines.push(`${name}: ${label} ${when(d)}`);
  };
  check('טסט', c.testDate, S.test);
  check('ביטוח', c.insuranceDate, S.insurance);
  check('טיפול', c.nextServiceDate, S.service);
  if (Number(S.km) > 0 && c.nextServiceKm && c.km !== '' && c.km != null) {
    const left = Number(c.nextServiceKm) - Number(c.km);
    if (left <= Number(S.km) && (weekday === 0 || FORCE))
      lines.push(left <= 0 ? `${name}: עבר את הטיפול ב-${num(-left)} ק״מ` : `${name}: עוד ${num(left)} ק״מ לטיפול`);
  }
}
if (!FORCE) await stateRef.set({ lastRun: today, lastCount: lines.length }, { merge: true });
if (!lines.length && FORCE) lines.push('בדיקה: ההתראות עובדות. אין כרגע שום דבר דחוף.');
console.log(today, hour, lines);
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
