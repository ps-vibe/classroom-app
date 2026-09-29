import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { signInWithCustomToken } from "firebase/auth";
import { auth } from "../firebase";

export default function StudentLogin() {
  const [studentCode, setStudentCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

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
      navigate("/student");
    } catch {
      setError("ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 360, margin: "80px auto", fontFamily: "sans-serif" }}>
      <h2>เข้าสู่ระบบสำหรับนักเรียน</h2>
      <form onSubmit={handleSubmit}>
        <input
          placeholder="รหัสประจำตัว"
          value={studentCode}
          onChange={(e) => setStudentCode(e.target.value)}
          required
          style={{ display: "block", width: "100%", marginBottom: 12, padding: 8 }}
        />
        <input
          type="password"
          placeholder="รหัสห้อง"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={{ display: "block", width: "100%", marginBottom: 12, padding: 8 }}
        />
        {error && <p style={{ color: "red" }}>{error}</p>}
        <button type="submit" disabled={busy} style={{ padding: "8px 16px" }}>
          {busy ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
        </button>
      </form>
    </div>
  );
}