import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import QRCode from "qrcode";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase";
import { theme, cardStyle, btnPrimary, btnSecondary, inputStyle } from "../theme";

const LATE_MINUTES = 10;
const ROTATE_MS = 30000;
const todayLocal = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const randomCode = () => Math.random().toString(36).slice(2, 10);

export default function AttendanceQR() {
  const { classroomId, subjectId } = useParams();
  const [date, setDate] = useState(todayLocal());
  const [period, setPeriod] = useState(1);
  const [session, setSession] = useState(null);
  const [qrImg, setQrImg] = useState("");
  const [scannedCount, setScannedCount] = useState(0);
  const [totalStudents, setTotalStudents] = useState(0);
  const [busy, setBusy] = useState(false);
  const intervalRef = useRef(null);
  const [rotatedAt, setRotatedAt] = useState(Date.now());
  const [secondsLeft, setSecondsLeft] = useState(ROTATE_MS / 1000);

  const sessionId = `${subjectId}_${date}_${period}`;
  const sessionRef = doc(db, "classrooms", classroomId, "attendanceSessions", sessionId);

  // นับจำนวนนักเรียนทั้งหมดในห้อง (ครั้งเดียวตอนเปิดหน้า)
  useEffect(() => {
    getDocs(collection(db, "classrooms", classroomId, "students")).then((snap) =>
      setTotalStudents(snap.size)
    );
  }, [classroomId]);

  // ฟังจำนวนคนที่สแกนแล้วของรอบนี้แบบสด
  useEffect(() => {
    if (!session?.active) return;
    const q = query(
      collection(db, "classrooms", classroomId, "attendanceScans"),
      where("sessionId", "==", sessionId)
    );
    const unsub = onSnapshot(q, (snap) => setScannedCount(snap.size));
    return unsub;
  }, [classroomId, sessionId, session?.active]);

  // สร้าง QR ใหม่ทุกครั้งที่โค้ดปัจจุบันเปลี่ยน และเริ่มนับถอยหลังใหม่
  useEffect(() => {
    if (!session?.currentCode) return;
    const base = import.meta.env.VITE_STUDENT_SITE_URL || window.location.origin;
    const url = `${base}/student/scan?s=${sessionId}&c=${session.currentCode}`;
    QRCode.toDataURL(url, { width: 320 }).then(setQrImg);
    setRotatedAt(Date.now());
  }, [session?.currentCode, sessionId]);

  // ตัวนับถอยหลัง อัปเดตทุก 0.25 วินาทีให้เลขไม่กระโดด
  useEffect(() => {
    if (!session?.active) return;
    const tick = () =>
      setSecondsLeft(Math.max(0, Math.ceil((rotatedAt + ROTATE_MS - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [session?.active, rotatedAt]);

  const startRound = async () => {
    setBusy(true);
    const data = {
      subjectId,
      date,
      period,
      startedAt: serverTimestamp(),
      lateMinutes: LATE_MINUTES,
      active: true,
      currentCode: randomCode(),
      codeUpdatedAt: serverTimestamp(),
    };
    await setDoc(sessionRef, data);
    setSession({ ...data, startedAt: new Date() });
    setBusy(false);

    intervalRef.current = setInterval(async () => {
      const code = randomCode();
      await updateDoc(sessionRef, { currentCode: code, codeUpdatedAt: serverTimestamp() });
      setSession((prev) => (prev ? { ...prev, currentCode: code } : prev));
    }, ROTATE_MS);
  };

  const closeRound = async () => {
    if (!window.confirm("ปิดรอบสแกนและบันทึกผลการเช็คคาบเรียนใช่หรือไม่?")) return;
    setBusy(true);
    clearInterval(intervalRef.current);
    await updateDoc(sessionRef, { active: false });
    await setDoc(
      doc(db, "classrooms", classroomId, "attendanceLog", `${subjectId}_${date}_${period}`),
      { subjectId, date, period }
    );

    const [studentSnap, scanSnap] = await Promise.all([
      getDocs(collection(db, "classrooms", classroomId, "students")),
      getDocs(
        query(
          collection(db, "classrooms", classroomId, "attendanceScans"),
          where("sessionId", "==", sessionId)
        )
      ),
    ]);
    const scanByStudent = {};
    scanSnap.docs.forEach((d) => (scanByStudent[d.data().studentCode] = d.data()));
    const startedMs = session?.startedAt?.toDate ? session.startedAt.toDate().getTime() : Date.now();
    const lateAfter = startedMs + LATE_MINUTES * 60000;

    const students = studentSnap.docs.map((d) => d.id);
    for (let i = 0; i < students.length; i += 400) {
      const batch = writeBatch(db);
      students.slice(i, i + 400).forEach((code) => {
        const ref = doc(db, "classrooms", classroomId, "attendance", `${subjectId}_${date}_${period}_${code}`);
        const scan = scanByStudent[code];
        if (!scan) {
          batch.set(ref, {
            subjectId,
            date,
            period,
            studentCode: code,
            status: "absent",
            reason: "ไม่ได้สแกน QR",
            updatedAt: serverTimestamp(),
          });
        } else {
          const scannedMs = scan.scannedAt?.toDate ? scan.scannedAt.toDate().getTime() : startedMs;
          if (scannedMs > lateAfter) {
            batch.set(ref, {
              subjectId,
              date,
              period,
              studentCode: code,
              status: "late",
              reason: "สแกน QR ล่าช้า",
              updatedAt: serverTimestamp(),
            });
          } else {
            batch.delete(ref); // มาปกติ ไม่ต้องมีเอกสาร
          }
        }
      });
      await batch.commit();
    }
    setBusy(false);
    setSession(null);
    alert("บันทึกผลเรียบร้อย ตรวจสอบและแก้ไขเพิ่มเติมได้ที่หน้าเช็คคาบเรียน");
  };

  useEffect(() => () => clearInterval(intervalRef.current), []);

    return (
    <div>
      <Link to={`/teacher/classroom/${classroomId}/subject/${subjectId}/attendance`} style={{ color: theme.accent, fontSize: 14 }}>
        &larr; กลับไปหน้าเช็คคาบเรียน
      </Link>
      <h2 style={{ margin: "12px 0 20px", fontSize: 20 }}>เช็คคาบเรียนด้วย QR</h2>

      {!session?.active && (
        <div style={{ ...cardStyle, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ fontSize: 14 }}>
            วันที่ <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inputStyle, marginLeft: 6 }} />
          </label>
          <label style={{ fontSize: 14 }}>
            คาบที่{" "}
            <select value={period} onChange={(e) => setPeriod(Number(e.target.value))} style={{ ...inputStyle, marginLeft: 6 }}>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
          <button style={btnPrimary} onClick={startRound} disabled={busy}>เปิดรอบสแกน</button>
        </div>
      )}

      {session?.active && (
        <div style={{ ...cardStyle, textAlign: "center" }}>
          <p style={{ fontWeight: 600 }}>
            สแกนแล้ว {scannedCount} / {totalStudents} คน | สายหลัง {LATE_MINUTES} นาที
          </p>
          {qrImg && <img src={qrImg} alt="QR เช็คชื่อ" width={280} height={280} style={{ borderRadius: 12 }} />}
          <div style={{ margin: "12px auto 4px", maxWidth: 280 }}>
            <div style={{ fontSize: 32, fontWeight: 800, color: secondsLeft <= 5 ? theme.danger : theme.text }}>
              {secondsLeft}
            </div>
            <div style={{ fontSize: 13, color: theme.muted, marginBottom: 6 }}>วินาที ก่อน QR เปลี่ยน</div>
            <div style={{ height: 6, borderRadius: 999, background: theme.border, overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${(secondsLeft / (ROTATE_MS / 1000)) * 100}%`,
                  background: secondsLeft <= 5 ? theme.danger : theme.teal,
                  transition: "width 0.25s linear",
                }}
              />
            </div>
          </div>
          <p style={{ color: theme.muted, fontSize: 13 }}>
            QR เปลี่ยนอัตโนมัติทุก {ROTATE_MS / 1000} วินาที ห้ามปิดหน้านี้ระหว่างเช็คชื่อ
          </p>
          <button style={btnPrimary} onClick={closeRound} disabled={busy}>
            {busy ? "กำลังบันทึก..." : "ปิดรอบและบันทึกผล"}
          </button>
        </div>
      )}
    </div>
  );
}