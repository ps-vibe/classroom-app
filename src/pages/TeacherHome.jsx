import { Outlet } from "react-router-dom";
import { useAuth } from "../AuthContext";

export default function TeacherHome() {
  const { user, logout } = useAuth();

  return (
    <div style={{ maxWidth: 700, margin: "40px auto", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>ระบบจัดการการเรียนการสอน</h2>
        <div>
          <span style={{ marginRight: 12 }}>{user.email}</span>
          <button onClick={logout}>ออกจากระบบ</button>
        </div>
      </div>
      <Outlet />
    </div>
  );
}