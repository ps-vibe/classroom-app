import { Outlet } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { theme, pageStyle } from "../theme";

export default function TeacherHome() {
  const { user, logout } = useAuth();

  return (
    <div style={pageStyle}>
      <div
        style={{
          background: theme.primary,
          color: "#fff",
          padding: "14px 24px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 16 }}>ระบบจัดการการเรียนการสอน</span>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 13, opacity: 0.85 }}>{user.email}</span>
          <button
            onClick={logout}
            style={{
              background: "rgba(255,255,255,0.15)",
              color: "#fff",
              border: "1px solid rgba(255,255,255,0.3)",
              borderRadius: 8,
              padding: "6px 12px",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            ออกจากระบบ
          </button>
        </div>
      </div>
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "24px 16px" }}>
        <Outlet />
      </div>
    </div>
  );
}