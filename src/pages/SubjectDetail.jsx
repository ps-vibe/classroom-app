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
import { ASSIGNMENT_TYPES, typeLabel } from "../constants";

const emptyForm = { title: "", type: "worksheet", maxScore: "", dueDate: "" };

export default function SubjectDetail() {
  const { classroomId, subjectId } = useParams();
  const [subject, setSubject] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");

  const colRef = collection(
    db,
    "classrooms",
    classroomId,
    "subjects",
    subjectId,
    "assignments"
  );

  useEffect(() => {
    getDoc(doc(db, "classrooms", classroomId, "subjects", subjectId)).then((snap) => {
      if (snap.exists()) setSubject(snap.data());
    });
  }, [classroomId, subjectId]);

  useEffect(() => {
    const q = query(
      collection(db, "classrooms", classroomId, "subjects", subjectId, "assignments"),
      orderBy("dueDate")
    );
    const unsub = onSnapshot(
      q,
      (snap) => setAssignments(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setError("โหลดข้อมูลใบงานไม่สำเร็จ")
    );
    return unsub;
  }, [classroomId, subjectId]);

  const change = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    const maxScore = Number(form.maxScore);
    if (!(maxScore > 0)) {
      setError("คะแนนเต็มต้องมากกว่า 0");
      return;
    }
    const data = {
      title: form.title.trim(),
      type: form.type,
      maxScore,
      dueDate: form.dueDate,
    };
    try {
      if (editingId) {
        await updateDoc(
          doc(db, "classrooms", classroomId, "subjects", subjectId, "assignments", editingId),
          data
        );
      } else {
        await addDoc(colRef, { ...data, createdAt: serverTimestamp() });
      }
      resetForm();
    } catch {
      setError("บันทึกไม่สำเร็จ");
    }
  };

  const startEdit = (a) => {
    setEditingId(a.id);
    setForm({
      title: a.title,
      type: a.type,
      maxScore: String(a.maxScore),
      dueDate: a.dueDate,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const remove = async (a) => {
    if (!window.confirm(`ลบ "${a.title}" ใช่หรือไม่?`)) return;
    await deleteDoc(
      doc(db, "classrooms", classroomId, "subjects", subjectId, "assignments", a.id)
    );
    if (editingId === a.id) resetForm();
  };

  return (
    <div>
      <Link to={`/teacher/classroom/${classroomId}`}>&larr; กลับไปหน้าห้องเรียน</Link>
      <h3>วิชา {subject ? subject.name : "..."}</h3>

      <h4>{editingId ? "แก้ไขใบงาน" : "เพิ่มใบงาน"}</h4>
      <form onSubmit={submit} style={{ marginBottom: 20, display: "grid", gap: 8, maxWidth: 420 }}>
        <input
          placeholder="ชื่องาน เช่น ใบงานที่ 1"
          value={form.title}
          onChange={change("title")}
          required
          style={{ padding: 8 }}
        />
        <select value={form.type} onChange={change("type")} style={{ padding: 8 }}>
          {ASSIGNMENT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <input
          type="number"
          min="0"
          step="any"
          placeholder="คะแนนเต็ม"
          value={form.maxScore}
          onChange={change("maxScore")}
          required
          style={{ padding: 8 }}
        />
        <label>
          วันกำหนดส่ง{" "}
          <input type="date" value={form.dueDate} onChange={change("dueDate")} required />
        </label>
        <div>
          <button type="submit">{editingId ? "บันทึกการแก้ไข" : "เพิ่มใบงาน"}</button>{" "}
          {editingId && (
            <button type="button" onClick={resetForm}>
              ยกเลิก
            </button>
          )}
        </div>
      </form>

      {error && <p style={{ color: "red" }}>{error}</p>}
      {assignments.length === 0 && <p>ยังไม่มีใบงานในวิชานี้</p>}

      <ul style={{ listStyle: "none", padding: 0 }}>
        {assignments.map((a) => (
          <li
            key={a.id}
            style={{ border: "1px solid #ccc", padding: 12, marginBottom: 8, borderRadius: 6 }}
          >
            <strong>{a.title}</strong> <span>[{typeLabel(a.type)}]</span>
            <div>
              คะแนนเต็ม {a.maxScore} | กำหนดส่ง {a.dueDate}
            </div>
            <div style={{ marginTop: 8 }}>
              <Link
  to={`/teacher/classroom/${classroomId}/subject/${subjectId}/assignment/${a.id}/scores`}
  style={{ marginRight: 8 }}
>
  กรอกคะแนน
</Link>
              <button onClick={() => startEdit(a)}>แก้ไข</button>{" "}
              <button onClick={() => remove(a)} style={{ color: "red" }}>
                ลบ
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}