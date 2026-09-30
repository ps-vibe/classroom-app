import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
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
import { theme, cardStyle, btnPrimary, btnSecondary, btnDanger, inputStyle } from "../theme";

export default function Classrooms() {
  const [rooms, setRooms] = useState([]);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState(null);
  const [showArchived, setShowArchived] = useState(false);

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

  const renameRoom = async (room) => {
    const newName = window.prompt("ชื่อห้องเรียนใหม่:", room.name);
    if (!newName || !newName.trim()) return;
    await updateDoc(doc(db, "classrooms", room.id), { name: newName.trim() });
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

  const archiveRoom = async (room) => {
    await updateDoc(doc(db, "classrooms", room.id), { archived: true });
  };
  const unarchiveRoom = async (room) => {
    await updateDoc(doc(db, "classrooms", room.id), { archived: false });
  };

  const deleteRoom = async (room) => {
    if (
      !window.confirm(
        `ลบห้อง ${room.name} ใช่หรือไม่? ข้อมูลวิชา ใบงาน นักเรียน คะแนน และการเช็คคาบเรียนทั้งหมดในห้องนี้จะถูกลบไปด้วย และไม่สามารถย้อนกลับได้`
      )
    )
      return;
    setDeletingId(room.id);
    try {
      const { deleteClassroomCascade } = await import("../deleteUtils");
      await deleteClassroomCascade(room.id);
    } catch {
      alert("ลบห้องเรียนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setDeletingId(null);
    }
  };

  const visibleRooms = rooms.filter((r) => !!r.archived === showArchived);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>ห้องเรียนของฉัน</h2>
        <button style={btnSecondary} onClick={() => setShowArchived(!showArchived)}>
          {showArchived ? "ดูห้องที่ใช้งานอยู่" : "ห้องที่เก็บถาวร"}
        </button>
      </div>

      {!showArchived && (
        <form onSubmit={addRoom} style={{ ...cardStyle, marginBottom: 20, display: "flex", flexWrap: "wrap", gap: 10 }}>
          <input
            placeholder="ชื่อห้อง เช่น ม.1/1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            style={{ ...inputStyle, flex: 1, minWidth: 160 }}
          />
          <input
            placeholder="รหัสผ่านห้อง"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ ...inputStyle, flex: 1, minWidth: 160 }}
          />
          <button type="submit" style={btnPrimary}>
            เพิ่มห้องเรียน
          </button>
        </form>
      )}

      {error && <p style={{ color: theme.danger }}>{error}</p>}
      {visibleRooms.length === 0 && (
        <p style={{ color: theme.muted }}>{showArchived ? "ไม่มีห้องที่เก็บถาวรไว้" : "ยังไม่มีห้องเรียน"}</p>
      )}

      <div style={{ display: "grid", gap: 12 }}>
        {visibleRooms.map((room) => (
          <div key={room.id} style={{ ...cardStyle, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <Link to={`/teacher/classroom/${room.id}`} style={{ fontWeight: 700, fontSize: 16, color: theme.primary, textDecoration: "none" }}>
              {room.name}
            </Link>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {!room.archived && (
                <>
                  <button style={btnSecondary} onClick={() => renameRoom(room)}>แก้ไขชื่อ</button>
                  <button style={btnSecondary} onClick={() => changePassword(room)}>เปลี่ยนรหัสผ่าน</button>
                </>
              )}
              {room.archived ? (
                <button style={btnSecondary} onClick={() => unarchiveRoom(room)}>กู้คืน</button>
              ) : (
                <button style={btnSecondary} onClick={() => archiveRoom(room)}>เก็บเข้าคลัง</button>
              )}
              <button
                style={btnDanger}
                onClick={() => deleteRoom(room)}
                disabled={deletingId === room.id}
              >
                {deletingId === room.id ? "กำลังลบ..." : "ลบห้อง"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}