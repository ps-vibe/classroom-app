import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../AuthContext";

export default function StudentScan() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("s");
  const code = searchParams.get("c");
  const { claims } = useAuth();
  const [status, setStatus] = useState("กำลังเช็คชื่อ...");

  useEffect(() => {
    async function run() {
      if (!sessionId || !code) {
        setStatus("ลิงก์ไม่ถูกต้อง กรุณาสแกน QR ใหม่อีกครั้ง");
        return;
      }
      const scanRef = doc(
        db,
        "classrooms",
        claims.classroomId,
        "attendanceScans",
        `${sessionId}_${claims.studentCode}`
      );
      const existing = await getDoc(scanRef);
      if (existing.exists()) {
        setStatus("คุณเช็คชื่อคาบนี้ไปแล้ว");
        return;
      }
      try {
        await setDoc(scanRef, {
          studentCode: claims.studentCode,
          sessionId,
          code,
          scannedAt: serverTimestamp(),
        });
        setStatus("เช็คชื่อสำเร็จ");
      } catch {
        setStatus("รหัสหมดอายุแล้ว กรุณาสแกน QR ใหม่อีกครั้ง (QR เปลี่ยนทุก 15 วินาที)");
      }
    }
    run();
  }, [sessionId, code, claims]);

  return (
    <div style={{ maxWidth: 360, margin: "100px auto", textAlign: "center", fontFamily: "sans-serif" }}>
      <h2>{status}</h2>
      <Link to="/student">กลับหน้าหลัก</Link>
    </div>
  );
}