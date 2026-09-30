import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase";
import { parseStudentRows } from "../utils";
import { deleteStudentCascade } from "../deleteUtils";
import { theme, cardStyle, btnPrimary, btnSecondary, btnDanger, inputStyle } from "../theme";

const emptyForm = { no: "", studentCode: "", prefix: "", firstName: "", lastName: "" };

export default function Students() {
  const { classroomId } = useParams();
  const [room, setRoom] = useState(null);
  const [students, setStudents] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    getDoc(doc(db, "classrooms", classroomId)).then((snap) => {
      if (snap.exists()) setRoom(snap.data());
    });
  }, [classroomId]);

  useEffect(() => {
    const q = query(collection(db, "classrooms", classroomId, "students"), orderBy("no"));
    const unsub = onSnapshot(
      q,
      (snap) => setStudents(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setError("โหลดรายชื่อนักเรียนไม่สำเร็จ")
    );
    return unsub;
  }, [classroomId]);

  const change = (field) => (e) => setForm({ ...form, [field]: e.target.value });
  const resetForm = () => {
    setForm(emptyForm);
    setEditing(false);
  };

  const saveOne = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");
    const code = form.studentCode.trim();
    if (code.includes("/")) {
      setError("รหัสประจำตัวห้ามมีเครื่องหมาย /");
      return;
    }
    const exists = students.some((s) => s.id === code);
    if (exists && !editing) {
      setError(`รหัส ${code} มีอยู่ในห้องนี้แล้ว`);
      return;
    }
    try {
      await setDoc(doc(db, "classrooms", classroomId, "students", code), {
        no: Number(form.no) || 0,
        studentCode: code,
        prefix: form.prefix.trim(),
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
      });
      resetForm();
    } catch {
      setError("บันทึกไม่สำเร็จ");
    }
  };

  const startEdit = (s) => {
    setEditing(true);
    setForm({
      no: String(s.no),
      studentCode: s.studentCode,
      prefix: s.prefix,
      firstName: s.firstName,
      lastName: s.lastName,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const remove = async (s) => {
    if (
      !window.confirm(
        `ลบ ${s.prefix}${s.firstName} ${s.lastName} ใช่หรือไม่? คะแนนและการเช็คคาบเรียนของนักเรียนคนนี้จะถูกลบไปด้วย`
      )
    )
      return;
    setDeletingId(s.id);
    try {
      await deleteStudentCascade(classroomId, s.id);
    } catch (err) {
      console.error("delete student error:", err);
      alert("ลบนักเรียนไม่สำเร็จ: " + err.message);
    } finally {
      setDeletingId(null);
    }
  };

  const parsed = useMemo(() => parseStudentRows(bulkText), [bulkText]);
  const existingIds = useMemo(() => new Set(students.map((s) => s.id)), [students]);
  const updateCount = parsed.rows.filter((r) => existingIds.has(r.studentCode)).length;
  const newCount = parsed.rows.length - updateCount;

  const loadCsvFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setBulkText(String(reader.result));
    reader.readAsText(file, "UTF-8");
    e.target.value = "";
  };

  const importAll = async () => {
    setError("");
    setMessage("");
    if (parsed.rows.length === 0) return;
    setBusy(true);
    try {
      for (let i = 0; i < parsed.rows.length; i += 400) {
        const batch = writeBatch(db);
        parsed.rows.slice(i, i + 400).forEach((r) => {
          batch.set(doc(db, "classrooms", classroomId, "students", r.studentCode), r);
        });
        await batch.commit();
      }
      setMessage(`นำเข้าสำเร็จ ${parsed.rows.length} คน (ใหม่ ${newCount} / อัปเดต ${updateCount})`);
      setBulkText("");
    } catch {
      setError("นำเข้าไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const cell = { border: `1px solid ${theme.border}`, padding: 10, textAlign: "left" };

  return (
    <div>
      <Link to={`/teacher/classroom/${classroomId}`} style={{ color: theme.accent, fontSize: 14 }}>
        &larr; กลับไปหน้าห้องเรียน
      </Link>
      <h2 style={{ margin: "12px 0 20px", fontSize: 20 }}>รายชื่อนักเรียน ห้อง {room ? room.name : "..."}</h2>

      {error && <p style={{ color: theme.danger }}>{error}</p>}
      {message && <p style={{ color: theme.success }}>{message}</p>}

      <div style={{ ...cardStyle, marginBottom: 20 }}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>{editing ? "แก้ไขนักเรียน" : "เพิ่มนักเรียนทีละคน"}</h3>
        <form onSubmit={saveOne} style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <input placeholder="เลขที่" type="number" min="0" value={form.no} onChange={change("no")} required style={{ ...inputStyle, width: 70 }} />
          <input placeholder="รหัสประจำตัว" value={form.studentCode} onChange={change("studentCode")} required disabled={editing} style={{ ...inputStyle, width: 120 }} />
          <input placeholder="คำนำหน้า" value={form.prefix} onChange={change("prefix")} style={{ ...inputStyle, width: 90 }} />
          <input placeholder="ชื่อ" value={form.firstName} onChange={change("firstName")} required style={{ ...inputStyle, width: 120 }} />
          <input placeholder="นามสกุล" value={form.lastName} onChange={change("lastName")} style={{ ...inputStyle, width: 120 }} />
          <button type="submit" style={btnPrimary}>{editing ? "บันทึกการแก้ไข" : "เพิ่ม"}</button>
          {editing && <button type="button" style={btnSecondary} onClick={resetForm}>ยกเลิก</button>}
        </form>
      </div>

      <div style={{ ...cardStyle, marginBottom: 20 }}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>นำเข้าจำนวนมาก</h3>
        <p style={{ fontSize: 13, color: theme.muted }}>
          คัดลอกตารางจาก Excel มาวาง (5 คอลัมน์: เลขที่, รหัสประจำตัว, คำนำหน้า, ชื่อ, นามสกุล) หรือเลือกไฟล์ CSV
        </p>
        <input type="file" accept=".csv,.txt" onChange={loadCsvFile} style={{ marginBottom: 8 }} />
        <textarea
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          rows={6}
          placeholder={"1\t10001\tเด็กชาย\tสมชาย\tใจดี"}
          style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
        />
        {bulkText.trim() && (
          <div style={{ marginTop: 10 }}>
            <p style={{ fontSize: 13 }}>
              พร้อมนำเข้า {parsed.rows.length} คน (เพิ่มใหม่ {newCount} / อัปเดตทับ {updateCount})
            </p>
            {parsed.errors.length > 0 && (
              <ul style={{ color: theme.danger, fontSize: 13 }}>
                {parsed.errors.map((er) => (
                  <li key={er}>{er}</li>
                ))}
              </ul>
            )}
            <button style={btnPrimary} onClick={importAll} disabled={busy || parsed.rows.length === 0}>
              {busy ? "กำลังนำเข้า..." : `นำเข้า ${parsed.rows.length} คน`}
            </button>{" "}
            <button style={btnSecondary} onClick={() => setBulkText("")} disabled={busy}>
              ล้างช่อง
            </button>
          </div>
        )}
      </div>

      <h3 style={{ fontSize: 15 }}>รายชื่อทั้งหมด ({students.length} คน)</h3>
      {students.length === 0 ? (
        <p style={{ color: theme.muted }}>ยังไม่มีนักเรียนในห้องนี้</p>
      ) : (
        <div style={{ ...cardStyle, overflowX: "auto", padding: 0 }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr style={{ background: "#F9FAFB" }}>
                {["เลขที่", "รหัสประจำตัว", "ชื่อ-นามสกุล", ""].map((h) => (
                  <th key={h} style={cell}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id}>
                  <td style={cell}>{s.no}</td>
                  <td style={cell}>{s.studentCode}</td>
                  <td style={cell}>{s.prefix}{s.firstName} {s.lastName}</td>
                  <td style={cell}>
                    <button style={btnSecondary} onClick={() => startEdit(s)}>แก้ไข</button>{" "}
                    <button style={btnDanger} onClick={() => remove(s)} disabled={deletingId === s.id}>
                      {deletingId === s.id ? "กำลังลบ..." : "ลบ"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}