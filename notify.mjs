// בדיקה יומית: שולח התראה לטלפון כשמתקרב טסט / ביטוח / טיפול
import admin from 'firebase-admin';

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();
const FORCE = process.env.FORCE === 'true';

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }); // YYYY-MM-DD
const weekday = new Date(today + 'T12:00:00Z').getUTCDay(); // 0 = ראשון
const days = d => d ? Math.round((Date.parse(d + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 864e5) : null;
const num = n => Number(n).toLocaleString('he-IL');
const when = d => d < 0 ? `פג לפני ${-d} ימים` : d === 0 ? 'היום!' : d === 1 ? 'מחר' : `בעוד ${d} ימים`;
// מתי מתריעים על תאריך: 30, 14, 7, 3, 1 ימים לפני, ביום עצמו, ואחרי זה פעם בשבוע
const milestone = d => [30, 14, 7, 3, 1, 0].includes(d) || (d < 0 && -d % 7 === 0);

const cars = (await db.collection('cars').get()).docs.map(d => d.data());
const lines = [];
for (const c of cars) {
  const name = c.tabName || c.name || 'רכב';
  const check = (label, date) => {
    const d = days(date);
    if (d == null) return;
    if (milestone(d) || (FORCE && d <= 30)) lines.push(`${name}: ${label} ${when(d)}`);
  };
  check('טסט', c.testDate);
  check('ביטוח', c.insuranceDate);
  check('טיפול', c.nextServiceDate);
  if (c.nextServiceKm && c.km !== '' && c.km != null) {
    const left = Number(c.nextServiceKm) - Number(c.km);
    if (left <= 1000 && (weekday === 0 || FORCE))
      lines.push(left <= 0 ? `${name}: עבר את הטיפול ב-${num(-left)} ק״מ` : `${name}: עוד ${num(left)} ק״מ לטיפול`);
  }
}
if (!lines.length && FORCE) lines.push('בדיקה: ההתראות עובדות. אין כרגע שום דבר דחוף.');
console.log(today, lines);
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
// ניקוי מכשירים שכבר לא רשומים
await Promise.all(res.responses.map((r, i) => {
  const code = r.error?.code || '';
  if (code.includes('registration-token-not-registered') || code.includes('invalid-registration-token') || code.includes('invalid-argument'))
    return tokSnap.docs.find(d => d.data().token === tokens[i])?.ref.delete();
}));
process.exit(0);
