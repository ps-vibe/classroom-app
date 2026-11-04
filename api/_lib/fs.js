import { GoogleAuth } from "google-auth-library";
import { createRemoteJWKSet, jwtVerify } from "jose";

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
export const PROJECT_ID = serviceAccount.project_id;
const ROOT = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const auth = new GoogleAuth({
  credentials: serviceAccount,
  scopes: ["https://www.googleapis.com/auth/datastore"],
});

export async function accessToken() {
  const client = await auth.getClient();
  return (await client.getAccessToken()).token;
}

// ---------- แปลงค่า JS <-> Firestore REST ----------
export function enc(v) {
  if (v === undefined || v === null) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  if (typeof v === "object") {
    return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
  }
  return { stringValue: String(v) };
}

export function dec(f) {
  if ("stringValue" in f) return f.stringValue;
  if ("integerValue" in f) return Number(f.integerValue);
  if ("doubleValue" in f) return f.doubleValue;
  if ("booleanValue" in f) return f.booleanValue;
  if ("timestampValue" in f) return f.timestampValue;
  if ("arrayValue" in f) return (f.arrayValue.values || []).map(dec);
  if ("mapValue" in f) return decFields(f.mapValue.fields || {});
  return null;
}
export const decFields = (fields) =>
  Object.fromEntries(Object.entries(fields || {}).map(([k, v]) => [k, dec(v)]));

// ---------- อ่าน/เขียนเอกสาร ----------
export async function getDoc(token, path) {
  const res = await fetch(`${ROOT}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`get ${path} failed: ${res.status}`);
  return decFields((await res.json()).fields);
}

// สร้างเอกสารใหม่เท่านั้น ถ้ามีอยู่แล้วจะคืน false (ใช้กันการเริ่มสอนซ้ำ)
export async function createDoc(token, path, data) {
  const res = await fetch(`${ROOT}/${path}?currentDocument.exists=false`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, enc(v)])) }),
  });
  if (res.status === 409 || res.status === 400) return false;
  if (!res.ok) throw new Error(`create ${path} failed: ${res.status}`);
  return true;
}

// แก้เฉพาะฟิลด์ที่ระบุ ฟิลด์อื่นไม่แตะ
export async function updateDoc(token, path, data, { mustExist = false } = {}) {
  const mask = Object.keys(data).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
  const cond = mustExist ? "&currentDocument.exists=true" : "";
  const res = await fetch(`${ROOT}/${path}?${mask}${cond}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, enc(v)])) }),
  });
  if (mustExist && (res.status === 404 || res.status === 400)) return false;
  if (!res.ok) throw new Error(`update ${path} failed: ${res.status}`);
  return true;
}

// ---------- ตรวจนักเรียนจาก ID token ----------
const JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com")
);

export async function verifyStudent(req) {
  const h = req.headers.authorization || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!t) return null;
  try {
    const { payload } = await jwtVerify(t, JWKS, {
      issuer: `https://securetoken.google.com/${PROJECT_ID}`,
      audience: PROJECT_ID,
    });
    if (payload.role !== "student" || !payload.classroomId || !payload.studentCode) return null;
    return { classroomId: String(payload.classroomId), studentCode: String(payload.studentCode) };
  } catch {
    return null;
  }
}