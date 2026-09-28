import { useEffect, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase";
import { Link } from "react-router-dom";

export default function Classrooms() {
  const [rooms, setRooms] = useState([]);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const q = query(collection(db, "classrooms"), orderBy("name"));
    const unsub = onSnapshot(
      q,
      (snap) => setRooms(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setError("โหลดข้อมูลไม่สำเร็จ (ตรวจสอบ Security Rules)")
    );
    return unsub;
  }, []);
  const passwordInUse = async (pw, exceptRoomId) => {
    const snap = await getDocs(
      query(collection(db, "classroomSecrets"), where("password", "==", pw))
    );
    return snap.docs.some((d) => d.id !== exceptRoomId);
  };

    const addRoom = async (e) => {
    e.preventDefault();
    setError("");
    if (password.length < 6) {
      setError("รหัสผ่านห้องต้องมีอย่างน้อย 6 ตัวอักษร");
      return;
    }
    try {
      if (await passwordInUse(password)) {
        setError("รหัสผ่านนี้ถูกใช้กับห้องอื่นแล้ว กรุณาตั้งรหัสที่ไม่ซ้ำ");
        return;
      }
      const ref = doc(collection(db, "classrooms"));
      const batch = writeBatch(db);
      batch.set(ref, { name: name.trim(), createdAt: serverTimestamp() });
      batch.set(doc(db, "classroomSecrets", ref.id), { password });
      await batch.commit();
      setName("");
      setPassword("");
    } catch {
      setError("เพิ่มห้องเรียนไม่สำเร็จ");
    }
  };

  const changePassword = async (room) => {
    const newPass = window.prompt(`รหัสผ่านใหม่ของห้อง ${room.name} (อย่างน้อย 6 ตัว):`);
    if (!newPass) return;
    if (newPass.length < 6) {
      alert("รหัสผ่านสั้นเกินไป");
      return;
    }
    try {
      if (await passwordInUse(newPass, room.id)) {
        alert("รหัสผ่านนี้ถูกใช้กับห้องอื่นแล้ว กรุณาตั้งรหัสที่ไม่ซ้ำ");
        return;
      }
      await updateDoc(doc(db, "classroomSecrets", room.id), { password: newPass });
      alert("เปลี่ยนรหัสผ่านเรียบร้อย");
    } catch {
      alert("เปลี่ยนรหัสผ่านไม่สำเร็จ");
    }
  };

  const deleteRoom = async (room) => {
    if (!window.confirm(`ลบห้อง ${room.name} ใช่หรือไม่? การลบไม่สามารถย้อนกลับได้`)) return;
    const batch = writeBatch(db);
    batch.delete(doc(db, "classrooms", room.id));
    batch.delete(doc(db, "classroomSecrets", room.id));
    await batch.commit();
  };

  return (
    <div>
      <h3>ห้องเรียนของฉัน</h3>

      <form onSubmit={addRoom} style={{ marginBottom: 20 }}>
        <input
          placeholder="ชื่อห้อง เช่น ม.1/1"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          style={{ padding: 8, marginRight: 8 }}
        />
        <input
          placeholder="รหัสผ่านห้อง"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={{ padding: 8, marginRight: 8 }}
        />
        <button type="submit">เพิ่มห้องเรียน</button>
      </form>

      {error && <p style={{ color: "red" }}>{error}</p>}

      {rooms.length === 0 && <p>ยังไม่มีห้องเรียน</p>}

      <ul style={{ listStyle: "none", padding: 0 }}>
        {rooms.map((room) => (
          <li
            key={room.id}
            style={{ border: "1px solid #ccc", padding: 12, marginBottom: 8, borderRadius: 6 }}
          >
            <Link to={`/teacher/classroom/${room.id}`}>
            <strong>{room.name}</strong>
            </Link>
            
            <div style={{ marginTop: 8 }}>
              <button onClick={() => renameRoom(room)}>แก้ไขชื่อ</button>{" "}
              <button onClick={() => changePassword(room)}>เปลี่ยนรหัสผ่าน</button>{" "}
              <button onClick={() => deleteRoom(room)} style={{ color: "red" }}>
                ลบห้อง
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}