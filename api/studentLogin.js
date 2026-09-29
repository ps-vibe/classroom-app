import crypto from "node:crypto";
import { SignJWT } from "jose";
import { GoogleAuth } from "google-auth-library";

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const PROJECT_ID = serviceAccount.project_id;
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const auth = new GoogleAuth({
  credentials: serviceAccount,
  scopes: [
    "https://www.googleapis.com/auth/datastore",
    "https://www.googleapis.com/auth/identitytoolkit",
  ],
});

async function accessToken() {
  const client = await auth.getClient();
  const res = await client.getAccessToken();
  return res.token;
}

const val = (v) => {
  if (v === undefined || v === null) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "number") return { integerValue: String(Math.trunc(v)) };
  if (typeof v === "boolean") return { booleanValue: v };
  return { stringValue: String(v) };
};

// อ่านเอกสารเดียวด้วย path ตรงๆ เช่น "classrooms/xxx/students/10001"
async function getDoc(token, path) {
  const res = await fetch(`${FIRESTORE_BASE}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore get failed: ${res.status}`);
  return res.json();
}

// ค้นหาเอกสารในคอลเลกชันด้วยเงื่อนไข field == value ผ่าน runQuery
async function queryDocs(token, collectionId, field, value, parentPath = "") {
  const url = `${FIRESTORE_BASE}${parentPath}:runQuery`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        where: {
          fieldFilter: { field: { fieldPath: field }, op: "EQUAL", value: val(value) },
        },
        limit: 1,
      },
    }),
  });
  if (!res.ok) throw new Error(`Firestore query failed: ${res.status}`);
  const rows = await res.json();
  const doc = rows.find((r) => r.document)?.document;
  return doc || null;
}

async function setDoc(token, path, fields) {
  const body = { fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, val(v)])) };
  const res = await fetch(`${FIRESTORE_BASE}/${path}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Firestore set failed: ${res.status}`);
}

async function deleteDoc(token, path) {
  await fetch(`${FIRESTORE_BASE}/${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");
const reply = (res, status, message) => res.status(status).json({ message });
const nowSec = () => Math.floor(Date.now() / 1000);

const MAX_CODE_ATTEMPTS = 5;
const MAX_IP_FAILS = 60;
const LOCK_MINUTES = 15;
const WINDOW_SEC = LOCK_MINUTES * 60;

const isLocked = (fields) => {
  const until = fields?.lockedUntil?.integerValue;
  return until && Number(until) > nowSec();
};

// สร้าง custom token แบบเดียวกับที่ Firebase Admin SDK ทำ (เซ็นด้วยกุญแจของ service account)
async function createCustomToken(uid, claims) {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const iat = nowSec();
  return await new SignJWT({
    uid,
    claims,
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt(iat)
    .setExpirationTime(iat + 3600)
    .setIssuer(serviceAccount.client_email)
    .setSubject(serviceAccount.client_email)
    .setAudience("https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit")
    .sign(key);
}

function pemToArrayBuffer(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const binary = Buffer.from(b64, "base64");
  return binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength);
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
    const token = await accessToken();
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
    const ipPath = `loginAttempts/ip_${sha(ip)}`;
    const codePath = `loginAttempts/code_${sha(studentCode)}`;

    const ipDoc = await getDoc(token, ipPath);
    if (isLocked(ipDoc?.fields)) return reply(res, 429, tooMany);

    const codeDoc = await getDoc(token, codePath);
    if (isLocked(codeDoc?.fields)) return reply(res, 429, tooMany);

    const prevFails = Number(codeDoc?.fields?.fails?.integerValue || 0);
    const fails = prevFails + 1;

    const fail = async () => {
      if (fails >= MAX_CODE_ATTEMPTS) {
        await setDoc(token, codePath, { fails: 0, lockedUntil: nowSec() + WINDOW_SEC });
      } else {
        await setDoc(token, codePath, { fails });
      }
      const prevIpFails = Number(ipDoc?.fields?.fails?.integerValue || 0) + 1;
      if (prevIpFails >= MAX_IP_FAILS) {
        await setDoc(token, ipPath, { fails: 0, lockedUntil: nowSec() + WINDOW_SEC });
      } else {
        await setDoc(token, ipPath, { fails: prevIpFails });
      }
      return reply(res, 401, "รหัสประจำตัวหรือรหัสห้องไม่ถูกต้อง");
    };

    const secretDoc = await queryDocs(token, "classroomSecrets", "password", password);
    if (!secretDoc) return await fail();
    const classroomId = secretDoc.name.split("/").pop();

    const studentDoc = await queryDocs(
      token,
      "students",
      "studentCode",
      studentCode,
      `/classrooms/${classroomId}`
    );
    if (!studentDoc) return await fail();

    await deleteDoc(token, codePath);

    const customToken = await createCustomToken(`s_${classroomId}_${studentCode}`, {
      role: "student",
      classroomId,
      studentCode,
    });

    return res.status(200).json({ token: customToken });
  } catch (err) {
    console.error("studentLogin error", err);
    return reply(res, 500, "ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง");
  }
}