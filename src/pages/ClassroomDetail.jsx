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
import { theme, cardStyle, btnPrimary, btnSecondary, btnDanger, inputStyle } from "../theme";
import { deleteSubjectCascade } from "../deleteUtils";

export default function ClassroomDetail() {
  const { classroomId } = useParams();
  const [room, setRoom] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState(null);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    getDoc(doc(db, "classrooms", classroomId)).then((snap) => {
      if (snap.exists()) setRoom({ id: snap.id, ...snap.data() });
    });
  }, [classroomId]);

  useEffect(() => {
    const q = query(collection(db, "classrooms", classroomId, "subjects"), orderBy("name"));
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

  const archiveSubject = async (subject) => {
    await updateDoc(doc(db, "classrooms", classroomId, "subjects", subject.id), { archived: true });
  };
  const unarchiveSubject = async (subject) => {
    await updateDoc(doc(db, "classrooms", classroomId, "subjects", subject.id), { archived: false });
  };

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
    } catch (err) {
      console.error("delete subject error:", err);
      alert("ลบวิชาไม่สำเร็จ: " + err.message);
    } finally {
      setDeletingId(null);
    }
  };

  const visibleSubjects = subjects.filter((s) => !!s.archived === showArchived);

  return (
    <div>
      <Link to="/teacher" style={{ color: theme.accent, fontSize: 14 }}>
        &larr; กลับไปหน้าห้องเรียน
      </Link>
      <h2 style={{ margin: "12px 0 4px", fontSize: 20 }}>ห้อง {room ? room.name : "..."}</h2>
      <p style={{ margin: "0 0 20px" }}>
        <Link to={`/teacher/classroom/${classroomId}/students`} style={{ color: theme.accent }}>
          จัดการรายชื่อนักเรียน
        </Link>
      </p>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 17 }}>วิชา</h3>
        <button style={btnSecondary} onClick={() => setShowArchived(!showArchived)}>
          {showArchived ? "ดูวิชาที่ใช้งานอยู่" : "วิชาที่เก็บถาวร"}
        </button>
      </div>

      {!showArchived && (
        <form onSubmit={addSubject} style={{ ...cardStyle, marginBottom: 20, display: "flex", flexWrap: "wrap", gap: 10 }}>
          <input
            placeholder="ชื่อวิชา เช่น วิทยาศาสตร์"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            style={{ ...inputStyle, flex: 1, minWidth: 160 }}
          />
          <input
            placeholder="รหัสวิชา (ถ้ามี)"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            style={{ ...inputStyle, flex: 1, minWidth: 140 }}
          />
          <button type="submit" style={btnPrimary}>
            เพิ่มวิชา
          </button>
        </form>
      )}

      {error && <p style={{ color: theme.danger }}>{error}</p>}
      {visibleSubjects.length === 0 && (
        <p style={{ color: theme.muted }}>{showArchived ? "ไม่มีวิชาที่เก็บถาวรไว้" : "ยังไม่มีวิชาในห้องนี้"}</p>
      )}

      <div style={{ display: "grid", gap: 12 }}>
        {visibleSubjects.map((s) => (
          <div key={s.id} style={{ ...cardStyle, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <Link
              to={`/teacher/classroom/${classroomId}/subject/${s.id}`}
              style={{ fontWeight: 700, fontSize: 16, color: theme.primary, textDecoration: "none" }}
            >
              {s.code ? `${s.code} ` : ""}
              {s.name}
            </Link>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {!s.archived && <button style={btnSecondary} onClick={() => editSubject(s)}>แก้ไข</button>}
              {s.archived ? (
                <button style={btnSecondary} onClick={() => unarchiveSubject(s)}>กู้คืน</button>
              ) : (
                <button style={btnSecondary} onClick={() => archiveSubject(s)}>เก็บเข้าคลัง</button>
              )}
              <button style={btnDanger} onClick={() => deleteSubject(s)} disabled={deletingId === s.id}>
                {deletingId === s.id ? "กำลังลบ..." : "ลบวิชา"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}