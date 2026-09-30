import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../firebase";
import { theme, cardStyle, btnPrimary, inputStyle, pageStyle } from "../theme";

export default function TeacherLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigate("/teacher");
    } catch (err) {
      console.error("login error:", err.code, err.message);
      const wrongCredentials = [
        "auth/invalid-credential",
        "auth/wrong-password",
        "auth/user-not-found",
        "auth/invalid-email",
      ];
      setError(
        wrongCredentials.includes(err.code)
          ? "อีเมลหรือรหัสผ่านไม่ถูกต้อง"
          : `เข้าสู่ระบบไม่สำเร็จ (${err.code || "unknown"})`
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ ...pageStyle, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ ...cardStyle, width: 360 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 22 }}>เข้าสู่ระบบสำหรับครู</h2>
        <p style={{ margin: "0 0 20px", color: theme.muted, fontSize: 14 }}>
          ระบบจัดการการเรียนการสอน
        </p>
        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
          <input
            type="email"
            placeholder="อีเมล"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={inputStyle}
          />
          <input
            type="password"
            placeholder="รหัสผ่าน"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={inputStyle}
          />
          {error && <p style={{ color: "#B91C1C", fontSize: 13, margin: 0 }}>{error}</p>}
          <button type="submit" disabled={busy} style={{ ...btnPrimary, width: "100%" }}>
            {busy ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
          </button>
        </form>
      </div>
    </div>
  );
}