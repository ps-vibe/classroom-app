import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  doc,
  getDoc,
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import { ASSIGNMENT_TYPES, typeLabel } from "../constants";
import { deleteAssignmentCascade } from "../deleteUtils";
import { theme, cardStyle, btnPrimary, btnSecondary, btnDanger, btnTeal, inputStyle } from "../theme";

const emptyForm = { title: "", type: "worksheet", maxScore: "", dueDate: "" };

export default function SubjectDetail() {
  const { classroomId, subjectId } = useParams();
  const [subject, setSubject] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState("");

  const colRef = collection(db, "classrooms", classroomId, "subjects", subjectId, "assignments");

  useEffect(() => {
    getDoc(doc(db, "classrooms", classroomId, "subjects", subjectId)).then((snap) => {
      if (snap.exists()) setSubject(snap.data());
    });
  }, [classroomId, subjectId]);

  useEffect(() => {
    const q = query(colRef, orderBy("dueDate"));
    const unsub = onSnapshot(
      q,
      (snap) => setAssignments(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setError("โหลดข้อมูลใบงานไม่สำเร็จ")
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const data = { title: form.title.trim(), type: form.type, maxScore, dueDate: form.dueDate };
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
    setForm({ title: a.title, type: a.type, maxScore: String(a.maxScore), dueDate: a.dueDate });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const remove = async (a) => {
    if (!window.confirm(`ลบ "${a.title}" ใช่หรือไม่? คะแนนของงานนี้จะถูกลบไปด้วย`)) return;
    setDeletingId(a.id);
    try {
      await deleteAssignmentCascade(classroomId, subjectId, a.id);
      if (editingId === a.id) resetForm();
    } catch {
      alert("ลบใบงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <Link to={`/teacher/classroom/${classroomId}`} style={{ color: theme.accent, fontSize: 14 }}>
        &larr; กลับไปหน้าห้องเรียน
      </Link>
      <h2 style={{ margin: "12px 0 4px", fontSize: 20 }}>วิชา {subject ? subject.name : "..."}</h2>
      <p style={{ margin: "0 0 20px" }}>
        <Link to={`/teacher/classroom/${classroomId}/subject/${subjectId}/attendance`} style={{ color: theme.accent }}>
          เช็คคาบเรียน
        </Link>
      </p>

      <div style={{ ...cardStyle, marginBottom: 20 }}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>{editingId ? "แก้ไขใบงาน" : "เพิ่มใบงาน"}</h3>
        <form onSubmit={submit} style={{ display: "grid", gap: 10, maxWidth: 420 }}>
          <input placeholder="ชื่องาน เช่น ใบงานที่ 1" value={form.title} onChange={change("title")} required style={inputStyle} />
          <select value={form.type} onChange={change("type")} style={inputStyle}>
            {ASSIGNMENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <input type="number" min="0" step="any" placeholder="คะแนนเต็ม" value={form.maxScore} onChange={change("maxScore")} required style={inputStyle} />
          <label style={{ fontSize: 14 }}>
            วันกำหนดส่ง <input type="date" value={form.dueDate} onChange={change("dueDate")} required style={{ ...inputStyle, marginLeft: 6 }} />
          </label>
          <div>
            <button type="submit" style={btnPrimary}>{editingId ? "บันทึกการแก้ไข" : "เพิ่มใบงาน"}</button>{" "}
            {editingId && <button type="button" style={btnSecondary} onClick={resetForm}>ยกเลิก</button>}
          </div>
        </form>
      </div>

      {error && <p style={{ color: theme.danger }}>{error}</p>}
      {assignments.length === 0 && <p style={{ color: theme.muted }}>ยังไม่มีใบงานในวิชานี้</p>}

      <div style={{ display: "grid", gap: 12 }}>
        {assignments.map((a) => (
          <div key={a.id} style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>
                  {a.title} <span style={{ color: theme.muted, fontWeight: 400 }}>[{typeLabel(a.type)}]</span>
                </div>
                <div style={{ color: theme.muted, fontSize: 13, marginTop: 2 }}>
                  คะแนนเต็ม {a.maxScore} | กำหนดส่ง {a.dueDate}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Link
                  to={`/teacher/classroom/${classroomId}/subject/${subjectId}/assignment/${a.id}/scores`}
                  style={{ ...btnTeal, textDecoration: "none", display: "inline-block" }}
                >
                  กรอกคะแนน
                </Link>
                <button style={btnSecondary} onClick={() => startEdit(a)}>แก้ไข</button>
                <button style={btnDanger} onClick={() => remove(a)} disabled={deletingId === a.id}>
                  {deletingId === a.id ? "กำลังลบ..." : "ลบ"}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}