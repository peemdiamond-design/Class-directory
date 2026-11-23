/**
 * CN25 Class Directory — Photo API (Google Apps Script)
 *
 * เก็บรูปโปรไฟล์ในโฟลเดอร์ Google Drive โดยตั้งชื่อไฟล์เป็น <เลขนศ>.<นามสกุล>
 *
 *   GET  <web app url>           -> { ok, photos: { "6910616249": "<driveFileId>", ... } }
 *   POST <web app url>  (text/plain JSON body)
 *        { idToken, studentId, mimeType, data }  data = base64 (ไม่มี "data:...;base64,")
 *        -> { ok, fileId }
 *
 * POST ตรวจ Firebase ID token ของคนที่ล็อกอินอยู่: อัปรูปได้เฉพาะของตัวเอง
 * ส่วนแอดมิน (ADMIN_IDS) อัปให้ใครก็ได้
 *
 * Script properties ที่ต้องตั้ง (Project Settings > Script properties):
 *   FOLDER_ID         id ของโฟลเดอร์ Drive ที่เก็บรูป
 *   FIREBASE_API_KEY  apiKey จาก firebaseConfig ในหน้าเว็บ
 *   ADMIN_IDS         เลขนศ.แอดมิน คั่นด้วย , เช่น 6910616249
 *   SITE_ORIGIN       (ไม่บังคับ) เช่น https://cn25.peemcn25.dev ใช้เป็น Referer ตอนตรวจ token
 */

/**
 * รันครั้งเดียวจาก editor (เลือก setup แล้วกด Run):
 * สร้างโฟลเดอร์ CN25-photos ที่แชร์แบบ "ทุกคนที่มีลิงก์ดูได้" และตั้ง script properties ที่ยังว่าง
 * ส่วน FIREBASE_API_KEY ต้องใส่เองใน Project Settings > Script properties
 */
function setup() {
  const props = PropertiesService.getScriptProperties();
  let folderId = props.getProperty('FOLDER_ID');
  if (!folderId) {
    const folder = DriveApp.createFolder('CN25-photos');
    folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    folderId = folder.getId();
    props.setProperty('FOLDER_ID', folderId);
  }
  if (!props.getProperty('ADMIN_IDS')) props.setProperty('ADMIN_IDS', '6910616249');
  if (!props.getProperty('SITE_ORIGIN')) props.setProperty('SITE_ORIGIN', 'https://cn25.peemcn25.dev');
  Logger.log('FOLDER_ID = ' + folderId);
  Logger.log('https://drive.google.com/drive/folders/' + folderId);
  if (!props.getProperty('FIREBASE_API_KEY')) Logger.log('ยังไม่ได้ใส่ FIREBASE_API_KEY');
}

const CACHE_KEY = 'photo-map-v1';
const CACHE_SECONDS = 300;
const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const ID_RE = /^\d{10}$/;

function prop_(name) {
  return PropertiesService.getScriptProperties().getProperty(name) || '';
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** คืน map เลขนศ -> fileId (ถ้ามีหลายไฟล์ เลือกไฟล์ที่แก้ล่าสุด) */
function buildPhotoMap_() {
  const folder = DriveApp.getFolderById(prop_('FOLDER_ID'));
  const files = folder.getFiles();
  const best = {};
  while (files.hasNext()) {
    const f = files.next();
    if (f.isTrashed()) continue;
    const m = /^(\d{10})\.[a-z0-9]+$/i.exec(f.getName());
    if (!m) continue;
    const id = m[1];
    const t = f.getLastUpdated().getTime();
    if (!best[id] || t > best[id].t) best[id] = { fileId: f.getId(), t: t };
  }
  const photos = {};
  Object.keys(best).forEach(function (id) { photos[id] = best[id].fileId; });
  return photos;
}

function doGet() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(CACHE_KEY);
  if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);
  const body = JSON.stringify({ ok: true, photos: buildPhotoMap_() });
  if (body.length < 90000) cache.put(CACHE_KEY, body, CACHE_SECONDS);
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

/** ตรวจ Firebase ID token แล้วคืนเลขนศ. ของคนที่ล็อกอิน (หรือ null) */
function verifyCaller_(idToken) {
  if (!idToken) return null;
  const headers = {};
  const origin = prop_('SITE_ORIGIN');
  if (origin) headers.Referer = origin.replace(/\/?$/, '/');
  const res = UrlFetchApp.fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + encodeURIComponent(prop_('FIREBASE_API_KEY')),
    { method: 'post', contentType: 'application/json', payload: JSON.stringify({ idToken: idToken }),
      headers: headers, muteHttpExceptions: true }
  );
  if (res.getResponseCode() !== 200) return null;
  const users = JSON.parse(res.getContentText()).users || [];
  const email = (users[0] && users[0].email) || '';
  const m = /^(\d{10})@dome\.tu\.ac\.th$/i.exec(email);
  return m ? m[1] : null;
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad-json' }); }

  const target = String(req.studentId || '');
  const ext = ALLOWED_TYPES[req.mimeType];
  if (!ID_RE.test(target)) return json_({ ok: false, error: 'bad-student-id' });
  if (!ext) return json_({ ok: false, error: 'bad-type' });

  const caller = verifyCaller_(req.idToken);
  if (!caller) return json_({ ok: false, error: 'not-signed-in' });
  const admins = prop_('ADMIN_IDS').split(',').map(function (s) { return s.trim(); });
  if (caller !== target && admins.indexOf(caller) === -1) return json_({ ok: false, error: 'forbidden' });

  let bytes;
  try { bytes = Utilities.base64Decode(String(req.data || '')); } catch (err) { return json_({ ok: false, error: 'bad-data' }); }
  if (!bytes.length || bytes.length > MAX_BYTES) return json_({ ok: false, error: 'too-large' });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const folder = DriveApp.getFolderById(prop_('FOLDER_ID'));
    // ย้ายรูปเก่าของคนนี้ไปถังขยะ (กู้คืนได้ 30 วัน)
    const old = folder.getFiles();
    while (old.hasNext()) {
      const f = old.next();
      if (f.getName().indexOf(target + '.') === 0) f.setTrashed(true);
    }
    const file = folder.createFile(Utilities.newBlob(bytes, req.mimeType, target + '.' + ext));
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (err) { /* โฟลเดอร์แชร์ไว้แล้วก็พอ */ }
    CacheService.getScriptCache().remove(CACHE_KEY);
    return json_({ ok: true, fileId: file.getId(), by: caller });
  } finally {
    lock.releaseLock();
  }
}
