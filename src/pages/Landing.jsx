import { Link } from "react-router-dom";

export default function Landing() {
  return (
    <div style={{ maxWidth: 420, margin: "100px auto", textAlign: "center", fontFamily: "sans-serif" }}>
      <h2 style={{ marginBottom: 32 }}>ระบบจัดการการเรียนการสอน</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Link
          to="/teacher/login"
          style={{
            padding: "16px",
            border: "1px solid #333",
            borderRadius: 8,
            textDecoration: "none",
            color: "#333",
            fontSize: 18,
          }}
        >
          เข้าสู่ระบบสำหรับครู
        </Link>
        <Link
          to="/student/login"
          style={{
            padding: "16px",
            border: "1px solid #333",
            borderRadius: 8,
            textDecoration: "none",
            color: "#333",
            fontSize: 18,
          }}
        >
          เข้าสู่ระบบสำหรับนักเรียน
        </Link>
      </div>
    </div>
  );
}