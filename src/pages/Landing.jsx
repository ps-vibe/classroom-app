import { Link } from "react-router-dom";
import { theme, cardStyle, pageStyle } from "../theme";

export default function Landing() {
  return (
    <div style={{ ...pageStyle, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ ...cardStyle, width: 380, textAlign: "center" }}>
        <h2 style={{ margin: "0 0 6px", fontSize: 22 }}>ระบบจัดการการเรียนการสอน</h2>
        <p style={{ margin: "0 0 28px", color: theme.muted, fontSize: 14 }}>
          เลือกประเภทบัญชีที่ต้องการเข้าสู่ระบบ
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Link
            to="/teacher/login"
            style={{
              padding: "14px",
              borderRadius: 10,
              textDecoration: "none",
              background: theme.primary,
              color: "#fff",
              fontWeight: 700,
              fontSize: 15,
            }}
          >
            เข้าสู่ระบบสำหรับครู
          </Link>
          <Link
            to="/student/login"
            style={{
              padding: "14px",
              borderRadius: 10,
              textDecoration: "none",
              background: "#fff",
              color: theme.text,
              fontWeight: 700,
              fontSize: 15,
              border: `1px solid ${theme.border}`,
            }}
          >
            เข้าสู่ระบบสำหรับนักเรียน
          </Link>
        </div>
      </div>
    </div>
  );
}