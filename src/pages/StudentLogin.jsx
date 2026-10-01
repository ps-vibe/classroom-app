import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { auth } from "../firebase";
import { signInWithCustomToken } from "firebase/auth";

const COLORS = {
  bg: "#F7F3EC",
  card: "#FFFFFF",
  text: "#2B2B2B",
  muted: "#8A8A8A",
  border: "#EFE9DF",
  primary: "#3F7A6F",
  primaryHover: "#346459",
  danger: "#C0392B",
};

export default function StudentLogin() {
  const [studentCode, setStudentCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/studentLogin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentCode: studentCode.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "เข้าสู่ระบบไม่สำเร็จ");
        return;
      }
      await signInWithCustomToken(auth, data.token);
      navigate(searchParams.get("next") || "/student");
    } catch {
      setError("ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        background: COLORS.bg,
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          background: COLORS.card,
          borderRadius: 20,
          padding: "32px 28px",
          width: 340,
          boxShadow: "0 2px 10px rgba(0,0,0,0.04)",
        }}
      >
        <h2 style={{ margin: "0 0 4px", fontSize: 20, color: COLORS.text }}>เข้าสู่ระบบสำหรับนักเรียน</h2>
        <p style={{ margin: "0 0 20px", color: COLORS.muted, fontSize: 13 }}>
          กรอกรหัสประจำตัวและรหัสห้องของคุณ
        </p>
        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
          <input
            placeholder="รหัสประจำตัว"
            value={studentCode}
            onChange={(e) => setStudentCode(e.target.value)}
            required
            style={{
              padding: "12px 14px",
              borderRadius: 12,
              border: `1px solid ${COLORS.border}`,
              fontSize: 15,
              outline: "none",
            }}
          />
          <input
            type="password"
            placeholder="รหัสห้อง"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{
              padding: "12px 14px",
              borderRadius: 12,
              border: `1px solid ${COLORS.border}`,
              fontSize: 15,
              outline: "none",
            }}
          />
          {error && <p style={{ color: COLORS.danger, fontSize: 13, margin: 0 }}>{error}</p>}
          <button
            type="submit"
            disabled={busy}
            style={{
              padding: "12px",
              borderRadius: 999,
              border: "none",
              background: COLORS.primary,
              color: "#fff",
              fontWeight: 700,
              fontSize: 15,
              cursor: "pointer",
              marginTop: 4,
            }}
          >
            {busy ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
          </button>
        </form>
      </div>
    </div>
  );
}