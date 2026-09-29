import { useAuth } from "../AuthContext";

export default function StudentHome() {
  const { claims, logout } = useAuth();

  return (
    <div style={{ maxWidth: 600, margin: "60px auto", fontFamily: "sans-serif" }}>
      <h2>หน้าหลักของนักเรียน</h2>
      <p>รหัสประจำตัว: {claims?.studentCode}</p>
      <p>เข้าสู่ระบบสำเร็จแล้ว ระบบดูข้อมูลจริงจะเพิ่มในขั้นถัดไป</p>
      <button onClick={logout}>ออกจากระบบ</button>
    </div>
  );
}