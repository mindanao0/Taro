// Sends mail through Resend's HTTP API. Tests (and local dev) replace it with env.MAILER.
export async function sendMail(env, {to, subject, text}) {
  if (env.MAILER) return env.MAILER({to, subject, text});
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) { console.warn('mail not configured; dropped a message'); return; }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json'},
    body: JSON.stringify({from: env.EMAIL_FROM, to: [to], subject, text})
  });
  if (!r.ok) console.warn('mail send failed', r.status);   // status only: never log addresses or links
}

const SITE = 'Ivory Rose Tarot';
export const verifyMail = link => ({
  subject: `ยืนยันอีเมลของคุณ - ${SITE}`,
  text: `กดลิงก์นี้เพื่อยืนยันอีเมล (ใช้ได้ 24 ชั่วโมง)\n${link}\n\nถ้าคุณไม่ได้สมัคร ไม่ต้องทำอะไร ข้ามอีเมลนี้ได้เลย`
});
export const existsMail = link => ({
  subject: `มีบัญชีนี้อยู่แล้ว - ${SITE}`,
  text: `มีคนพยายามสมัครด้วยอีเมลนี้ แต่อีเมลนี้มีบัญชีอยู่แล้ว\nถ้าเป็นคุณ เข้าสู่ระบบได้เลย หรือถ้าลืมรหัสผ่านให้ตั้งใหม่ที่ลิงก์นี้\n${link}\n\nถ้าคุณเคยลบบัญชีนี้ไปไม่เกิน 30 วัน การเข้าสู่ระบบด้วยรหัสผ่านเดิมหรือตั้งรหัสผ่านใหม่จากลิงก์นี้จะกู้บัญชีคืนให้\n\nถ้าไม่ใช่คุณ ไม่ต้องทำอะไร`
});
export const resetMail = link => ({
  subject: `ตั้งรหัสผ่านใหม่ - ${SITE}`,
  text: `กดลิงก์นี้เพื่อตั้งรหัสผ่านใหม่ (ใช้ได้ 30 นาที ใช้ได้ครั้งเดียว)\n${link}\n\nถ้าคุณไม่ได้ขอ ไม่ต้องทำอะไร รหัสผ่านเดิมยังใช้ได้`
});
