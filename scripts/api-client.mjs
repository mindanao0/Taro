// Thin client for taro-api. Never throws on HTTP errors: callers get {ok, status, data}. Cookies travel with credentials:'include'.
export function createApi(base, doFetch = (...a) => fetch(...a)) {
  async function call(method, path, body) {
    try {
      const res = await doFetch(base + path, {method, credentials: 'include', headers: body === undefined ? undefined : {'content-type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)});
      let data = null;
      if ((res.headers.get('content-type') || '').includes('json')) { try { data = await res.json(); } catch { data = null; } }
      return {ok: res.ok, status: res.status, data};
    } catch { return {ok: false, status: 0, data: {error: 'network'}}; }
  }
  return {get: p => call('GET', p), post: (p, b = {}) => call('POST', p, b), put: (p, b = {}) => call('PUT', p, b), del: p => call('DELETE', p)};
}

const MESSAGES = {
  network: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง',
  invalid_email: 'อีเมลไม่ถูกต้อง',
  password_too_short: 'รหัสผ่านต้องยาวอย่างน้อย 10 ตัวอักษร',
  password_too_long: 'รหัสผ่านยาวเกินไป (ไม่เกิน 128 ตัวอักษร)',
  password_is_email: 'รหัสผ่านต้องไม่ใช่อีเมลของคุณ',
  invalid_credentials: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
  too_many_attempts: 'ลองผิดหลายครั้งเกินไป รอสักครู่แล้วลองใหม่',
  rate_limited: 'ส่งคำขอบ่อยเกินไป รอสักครู่แล้วลองใหม่',
  too_many_requests: 'ขอบ่อยเกินไป รอสักครู่แล้วลองใหม่',
  invalid_or_expired_token: 'ลิงก์นี้ใช้ไม่ได้แล้ว หมดอายุหรือเคยใช้ไปแล้ว',
  wrong_current_password: 'รหัสผ่านปัจจุบันไม่ถูกต้อง',
  wrong_password: 'รหัสผ่านไม่ถูกต้อง',
  email_in_use: 'อีเมลนี้ถูกใช้ไปแล้ว',
  last_login_method: 'ต้องมีวิธีเข้าสู่ระบบอย่างน้อยหนึ่งวิธี ตั้งรหัสผ่านหรือผูกบัญชีอื่นก่อนแล้วค่อยเลิกผูกอันนี้',
  consent_required: 'ต้องให้ความยินยอมก่อน',
  terms_required: 'ต้องรับทราบข้อกำหนดการใช้งานและนโยบายความเป็นส่วนตัวก่อนสมัคร',
  line_not_linked: 'ต้องผูกบัญชี LINE ก่อน',
  daily_limit: 'บันทึกครบจำนวนต่อวันแล้ว',
  already_verified: 'อีเมลนี้ยืนยันแล้ว',
  no_email: 'บัญชีนี้ยังไม่มีอีเมล',
  not_signed_in: 'กรุณาเข้าสู่ระบบ',
  confirmation_required: 'กรุณาพิมพ์ DELETE เพื่อยืนยัน',
  // social login redirects (#error=...)
  cancelled: 'ยกเลิกการเข้าสู่ระบบ',
  provider_error: 'เข้าสู่ระบบกับผู้ให้บริการไม่สำเร็จ ลองใหม่อีกครั้ง',
  session_expired: 'หมดเวลา กรุณาเริ่มเข้าสู่ระบบใหม่',
  bad_state: 'คำขอไม่ถูกต้อง กรุณาเริ่มใหม่',
  identity_in_use: 'บัญชีนี้ถูกผูกกับสมาชิกคนอื่นแล้ว',
  account_deleted: 'บัญชีนี้ถูกลบแล้ว',
  email_exists_login_first: 'มีบัญชีที่ใช้อีเมลนี้อยู่แล้ว เข้าสู่ระบบด้วยวิธีเดิมก่อน แล้วผูกบัญชีนี้ได้จากหน้าตั้งค่า'
};
// Short, human label for a stored User-Agent string, e.g. "Chrome · Android".
export function deviceLabel(ua) {
  ua = String(ua || '');
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) || /FxiOS/.test(ua) ? 'Firefox' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return [browser, os].filter(Boolean).join(' · ') || 'อุปกรณ์ที่ไม่ทราบชนิด';
}

export const errorText = code => MESSAGES[code] || 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง';
