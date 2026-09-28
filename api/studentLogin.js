import crypto from "node:crypto";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

if (getApps().length === 0) {
  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
}
const db = getFirestore();

const MAX_CODE_ATTEMPTS = 5; // จำนวนครั้งที่ลองได้ ต่อรหัสประจำตัว
const MAX_IP_FAILS = 60; // จำนวนครั้งที่ผิดได้ ต่อ IP (โรงเรียนใช้ IP ร่วมกัน จึงตั้งสูงกว่า)
const LOCK_MINUTES = 15;
const WINDOW_MS = LOCK_MINUTES * 60 * 1000;

const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");
const reply = (res, status, message) => res.status(status).json({ message });
const isLocked = (data) => !!data?.lockedUntil && data.lockedUntil.toMillis() > Date.now();

// บันทึกการกรอกผิดของ IP นี้ (นับในหน้าต่างเวลา 15 นาที)
async function recordIpFail(ipRef) {
  await db.runTransaction(async (tx) => {
    const data = (await tx.get(ipRef)).data();
    const expired = !data?.windowStart || Date.now() - data.windowStart.toMillis() > WINDOW_MS;
    const fails = expired ? 1 : (data.fails || 0) + 1;
    const windowStart = expired ? Timestamp.now() : data.windowStart;
    if (fails >= MAX_IP_FAILS) {
      tx.set(ipRef, {
        fails: 0,
        windowStart: Timestamp.now(),
        lockedUntil: Timestamp.fromMillis(Date.now() + WINDOW_MS),
      });
    } else {
      tx.set(ipRef, { fails, windowStart });
    }
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return reply(res, 405, "method not allowed");

  const studentCode = String(req.body?.studentCode ?? "").trim();
  const password = String(req.body?.password ?? "");
  if (!studentCode || !password || studentCode.length > 40 || password.length > 100) {
    return reply(res, 400, "กรุณากรอกรหัสประจำตัวและรหัสห้อง");
  }

  const tooMany = "กรอกผิดหลายครั้ง กรุณารอสักครู่แล้วลองใหม่";

  try {
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
    const ipRef = db.collection("loginAttempts").doc("ip_" + sha(ip));
    const codeRef = db.collection("loginAttempts").doc("code_" + sha(studentCode));

    // 1) IP นี้ถูกล็อกอยู่หรือไม่
    if (isLocked((await ipRef.get()).data())) return reply(res, 429, tooMany);

    // 2) นับความพยายามของรหัสประจำตัวนี้ล่วงหน้า (ใน transaction กันการยิงพร้อมกันหลายคำขอ)
    const allowed = await db.runTransaction(async (tx) => {
      const data = (await tx.get(codeRef)).data();
      if (isLocked(data)) return false;
      const fails = (data?.fails || 0) + 1;
      if (fails >= MAX_CODE_ATTEMPTS) {
        tx.set(codeRef, { fails: 0, lockedUntil: Timestamp.fromMillis(Date.now() + WINDOW_MS) });
      } else {
        tx.set(codeRef, { fails });
      }
      return true;
    });
    if (!allowed) return reply(res, 429, tooMany);

    // 3) หาห้องจากรหัสห้อง แล้วตรวจว่ามีรหัสประจำตัวนี้ในห้องนั้น
    let classroomId = null;
    const secretSnap = await db
      .collection("classroomSecrets")
      .where("password", "==", password)
      .limit(1)
      .get();
    if (!secretSnap.empty) {
      const id = secretSnap.docs[0].id;
      const studentSnap = await db
        .collection(`classrooms/${id}/students`)
        .where("studentCode", "==", studentCode)
        .limit(1)
        .get();
      if (!studentSnap.empty) classroomId = id;
    }

    if (!classroomId) {
      await recordIpFail(ipRef);
      return reply(res, 401, "รหัสประจำตัวหรือรหัสห้องไม่ถูกต้อง");
    }

    // 4) ผ่านแล้ว: ล้างตัวนับ และออกโทเคนล็อกอิน
    await codeRef.delete();
    const token = await getAuth().createCustomToken(`s_${classroomId}_${studentCode}`, {
      role: "student",
      classroomId,
      studentCode,
    });
    return res.status(200).json({ token });
  } catch (err) {
    console.error("studentLogin error", err);
    return reply(res, 500, "ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง");
  }
}