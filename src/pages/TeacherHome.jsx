import { useAuth } from "../AuthContext";

export default function TeacherHome() {
  const { user, logout } = useAuth();

  return (
    <div style={{ maxWidth: 600, margin: "60px auto", fontFamily: "sans-serif" }}>
      <h2>หน้าหลักของครู</h2>
      <p>ล็อกอินอยู่ในชื่อ: {user.email}</p>
      <button onClick={logout}>ออกจากระบบ</button>
    </div>
  );
}
