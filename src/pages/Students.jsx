import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  collection,
  deleteDoc,
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

  // ---------- เพิ่ม/แก้ไขทีละคน ----------
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

  const [deletingId, setDeletingId] = useState(null);

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

  // ---------- นำเข้าจำนวนมาก ----------
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
      // Firestore รับได้สูงสุด 500 รายการต่อ batch จึงแบ่งทีละ 400
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

  return (
    <div>
      <Link to={`/teacher/classroom/${classroomId}`}>&larr; กลับไปหน้าห้องเรียน</Link>
      <h3>รายชื่อนักเรียน ห้อง {room ? room.name : "..."}</h3>

      {error && <p style={{ color: "red" }}>{error}</p>}
      {message && <p style={{ color: "green" }}>{message}</p>}

      <h4>{editing ? "แก้ไขนักเรียน" : "เพิ่มนักเรียนทีละคน"}</h4>
      <form onSubmit={saveOne} style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24 }}>
        <input placeholder="เลขที่" type="number" min="0" value={form.no} onChange={change("no")} required style={{ padding: 8, width: 70 }} />
        <input
          placeholder="รหัสประจำตัว"
          value={form.studentCode}
          onChange={change("studentCode")}
          required
          disabled={editing}
          style={{ padding: 8, width: 120 }}
        />
        <input placeholder="คำนำหน้า" value={form.prefix} onChange={change("prefix")} style={{ padding: 8, width: 90 }} />
        <input placeholder="ชื่อ" value={form.firstName} onChange={change("firstName")} required style={{ padding: 8, width: 120 }} />
        <input placeholder="นามสกุล" value={form.lastName} onChange={change("lastName")} style={{ padding: 8, width: 120 }} />
        <button type="submit">{editing ? "บันทึกการแก้ไข" : "เพิ่ม"}</button>
        {editing && (
          <button type="button" onClick={resetForm}>
            ยกเลิก
          </button>
        )}
      </form>

      <h4>นำเข้าจำนวนมาก</h4>
      <p style={{ fontSize: 14 }}>
        คัดลอกตารางจาก Excel มาวางในช่องด้านล่าง (5 คอลัมน์ตามลำดับ: เลขที่, รหัสประจำตัว, คำนำหน้า, ชื่อ, นามสกุล)
        หรือเลือกไฟล์ CSV ก็ได้
      </p>
      <input type="file" accept=".csv,.txt" onChange={loadCsvFile} style={{ marginBottom: 8 }} />
      <textarea
        value={bulkText}
        onChange={(e) => setBulkText(e.target.value)}
        rows={8}
        placeholder={"1\t10001\tเด็กชาย\tสมชาย\tใจดี\n2\t10002\tเด็กหญิง\tสมหญิง\tรักเรียน"}
        style={{ width: "100%", padding: 8, boxSizing: "border-box" }}
      />

      {bulkText.trim() && (
        <div style={{ margin: "8px 0" }}>
          <p>
            พร้อมนำเข้า {parsed.rows.length} คน (เพิ่มใหม่ {newCount} / อัปเดตทับ {updateCount})
          </p>
          {parsed.errors.length > 0 && (
            <ul style={{ color: "red" }}>
              {parsed.errors.map((er) => (
                <li key={er}>{er}</li>
              ))}
            </ul>
          )}
          <button onClick={importAll} disabled={busy || parsed.rows.length === 0}>
            {busy ? "กำลังนำเข้า..." : `นำเข้า ${parsed.rows.length} คน`}
          </button>{" "}
          <button onClick={() => setBulkText("")} disabled={busy}>
            ล้างช่อง
          </button>
        </div>
      )}

      <h4>รายชื่อทั้งหมด ({students.length} คน)</h4>
      {students.length === 0 ? (
        <p>ยังไม่มีนักเรียนในห้องนี้</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                {["เลขที่", "รหัสประจำตัว", "ชื่อ-นามสกุล", ""].map((h) => (
                  <th key={h} style={{ border: "1px solid #ccc", padding: 8, textAlign: "left" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id}>
                  <td style={{ border: "1px solid #ccc", padding: 8 }}>{s.no}</td>
                  <td style={{ border: "1px solid #ccc", padding: 8 }}>{s.studentCode}</td>
                  <td style={{ border: "1px solid #ccc", padding: 8 }}>
                    {s.prefix}
                    {s.firstName} {s.lastName}
                  </td>
                  <td style={{ border: "1px solid #ccc", padding: 8 }}>
                    <button onClick={() => startEdit(s)}>แก้ไข</button>{" "}
<button onClick={() => remove(s)} disabled={deletingId === s.id} style={{ color: "red" }}>
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