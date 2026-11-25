// อ่านวันเกิดและวางแผนนำเข้า CSV (ไม่มีการเขียนฐานข้อมูลในไฟล์นี้)

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

/** "17/8/2007", "17-08-2550", "2007-08-17" -> { y, m, d } (ปี ค.ศ.) หรือ null; แบบมีเครื่องหมายคั่นถือเป็น วัน/เดือน/ปี */
export function parseBirth(value) {
  const s = String(value ?? '').replace(/[๐-๙]/g, (c) => THAI_DIGITS.indexOf(c)).trim();
  let y, m, d, hit;
  if ((hit = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:T.*)?$/.exec(s))) [, y, m, d] = hit.map(Number);
  else if ((hit = /^(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4})$/.exec(s))) [, d, m, y] = hit.map(Number);
  else return null;
  if (y >= 2400) y -= 543; // พ.ศ. -> ค.ศ.
  const t = new Date(y, m - 1, d);
  return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d ? { y, m, d } : null;
}

/** คืน YYYY-MM-DD (รูปแบบที่ช่อง date ใช้) หรือ '' */
export function toISODate(value) {
  const b = parseBirth(value);
  return b ? `${b.y}-${String(b.m).padStart(2, '0')}-${String(b.d).padStart(2, '0')}` : '';
}

const cell = (row, ...names) => {
  const want = names.map((n) => n.toLowerCase());
  for (const [k, v] of Object.entries(row)) {
    const key = k.replace(/[﻿​\s]/g, '').toLowerCase();
    if (want.includes(key) && String(v ?? '').trim()) return String(v).trim();
  }
  return '';
};

/**
 * ตัดสินว่าจะทำอะไรกับแถวหนึ่ง โดย existing คือข้อมูลที่มีอยู่แล้ว (หรือ null)
 * -> { id, action: 'add' | 'birthdate' | 'skip' | 'invalid', data?, issue? }
 * คนที่มีอยู่แล้วจะเติมเฉพาะวันเกิดที่ยังว่าง ไม่ทับข้อมูลเดิม
 */
export function planRow(row, existing, thisYear = new Date().getFullYear()) {
  const id = cell(row, 'รหัสนักศึกษา', 'studentId');
  if (!/^\d{10}$/.test(id)) return { id, action: 'invalid' };

  // 'วันกิด' คือหัวคอลัมน์ที่สะกดตกในฟอร์มของรุ่น
  const raw = cell(row, 'วันเกิด', 'วันกิด', 'วันเดือนปีเกิด', 'birthdate', 'birthday');
  const b = parseBirth(raw);
  let birthdate = '', issue = '';
  if (raw && !b) issue = `อ่านวันเกิด “${raw}” ไม่ได้`;
  else if (b && (b.y > thisYear - 10 || b.y < 1950)) issue = `ปีเกิดไม่น่าถูกต้อง “${raw}”`;
  else if (b) birthdate = toISODate(raw);

  if (existing) {
    if (parseBirth(existing.birthdate)) return { id, action: 'skip' };
    if (birthdate) return { id, action: 'birthdate', data: { birthdate } };
    return { id, action: 'skip', issue };
  }
  const tags = [cell(row, 'แท็ก', 'tags'), cell(row, 'สายรหัส')].filter(Boolean).join(',');
  return {
    id, action: 'add', issue,
    data: {
      studentId: id, firstName: cell(row, 'ชื่อ', 'name'), lastName: cell(row, 'นามสกุล'), nickname: cell(row, 'ชื่อเล่น'),
      birthdate, tags, lineId: cell(row, 'IDLine'), instagram: cell(row, 'Instagram'),
      position: 'สมาชิก', status: '', givenNicknames: {}
    }
  };
}
