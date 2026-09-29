import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import { deleteSubjectCascade } from "../deleteUtils";

export default function ClassroomDetail() {
  const { classroomId } = useParams();
  const [room, setRoom] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    getDoc(doc(db, "classrooms", classroomId)).then((snap) => {
      if (snap.exists()) setRoom({ id: snap.id, ...snap.data() });
    });
  }, [classroomId]);

  useEffect(() => {
    const q = query(
      collection(db, "classrooms", classroomId, "subjects"),
      orderBy("name")
    );
    const unsub = onSnapshot(
      q,
      (snap) => setSubjects(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setError("โหลดข้อมูลวิชาไม่สำเร็จ")
    );
    return unsub;
  }, [classroomId]);

  const addSubject = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await addDoc(collection(db, "classrooms", classroomId, "subjects"), {
        name: name.trim(),
        code: code.trim(),
        createdAt: serverTimestamp(),
      });
      setName("");
      setCode("");
    } catch {
      setError("เพิ่มวิชาไม่สำเร็จ");
    }
  };

  const editSubject = async (subject) => {
    const newName = window.prompt("ชื่อวิชา:", subject.name);
    if (!newName || !newName.trim()) return;
    const newCode = window.prompt("รหัสวิชา:", subject.code || "");
    await updateDoc(doc(db, "classrooms", classroomId, "subjects", subject.id), {
      name: newName.trim(),
      code: (newCode || "").trim(),
    });
  };

  const [deletingId, setDeletingId] = useState(null);

  const deleteSubject = async (subject) => {
    if (
      !window.confirm(
        `ลบวิชา ${subject.name} ใช่หรือไม่? ใบงาน คะแนน และการเช็คคาบเรียนของวิชานี้จะถูกลบไปด้วย`
      )
    )
      return;
    setDeletingId(subject.id);
    try {
      await deleteSubjectCascade(classroomId, subject.id);
    } catch {
      alert("ลบวิชาไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <Link to="/teacher">&larr; กลับไปหน้าห้องเรียน</Link>
      <h3>ห้อง {room ? room.name : "..."}</h3>
      <p>
  <Link to={`/teacher/classroom/${classroomId}/students`}>จัดการรายชื่อนักเรียน</Link>
</p>

      <h4>วิชา</h4>
      <form onSubmit={addSubject} style={{ marginBottom: 20 }}>
        <input
          placeholder="ชื่อวิชา เช่น วิทยาศาสตร์"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          style={{ padding: 8, marginRight: 8 }}
        />
        <input
          placeholder="รหัสวิชา (ถ้ามี)"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          style={{ padding: 8, marginRight: 8 }}
        />
        <button type="submit">เพิ่มวิชา</button>
      </form>

      {error && <p style={{ color: "red" }}>{error}</p>}
      {subjects.length === 0 && <p>ยังไม่มีวิชาในห้องนี้</p>}

      <ul style={{ listStyle: "none", padding: 0 }}>
        {subjects.map((s) => (
          <li
            key={s.id}
            style={{ border: "1px solid #ccc", padding: 12, marginBottom: 8, borderRadius: 6 }}
          >
           <Link to={`/teacher/classroom/${classroomId}/subject/${s.id}`}>
          <strong>{s.name}</strong>
          </Link>{" "}
          {s.code && <span>({s.code})</span>}
            <div style={{ marginTop: 8 }}>
              <button onClick={() => editSubject(s)}>แก้ไข</button>{" "}
<button
  onClick={() => deleteSubject(s)}
  disabled={deletingId === s.id}
  style={{ color: "red" }}
>
  {deletingId === s.id ? "กำลังลบ..." : "ลบวิชา"}
</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}