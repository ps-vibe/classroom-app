import { useAuth } from "../AuthContext";
import Classrooms from "./Classrooms";

export default function TeacherHome() {
  const { user, logout } = useAuth();

  return (
    <div style={{ maxWidth: 700, margin: "40px auto", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>หน้าหลักของครู</h2>
        <div>
          <span style={{ marginRight: 12 }}>{user.email}</span>
          <button onClick={logout}>ออกจากระบบ</button>
        </div>
      </div>
      <Classrooms />
    </div>
  );
}