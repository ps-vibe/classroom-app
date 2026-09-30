import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase";
import { theme, cardStyle, btnPrimary, btnSecondary, inputStyle } from "../theme";

const STATUS = [
  { value: "present", label: "มา" },
  { value: "late", label: "สาย" },
  { value: "leave", label: "ลา" },
  { value: "absent", label: "ขาด" },
];

const todayLocal = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

const emptyRow = { status: "present", reason: "" };

export default function AttendanceEntry() {
  const { classroomId, subjectId } = useParams();
  const [subject, setSubject] = useState(null);
  const [students, setStudents] = useState([]);
  const [studentsLoaded, setStudentsLoaded] = useState(false);
  const [date, setDate] = useState(todayLocal());
  const [period, setPeriod] = useState(1);
  const [rows, setRows] = useState({});
  const [dirty, setDirty] = useState(new Set());
  const [sessionLoading, setSessionLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    getDoc(doc(db, "classrooms", classroomId, "subjects", subjectId)).then((snap) => {
      if (snap.exists()) setSubject(snap.data());
    });
    getDocs(query(collection(db, "classrooms", classroomId, "students"), orderBy("no")))
      .then((snap) => {
        setStudents(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setStudentsLoaded(true);
      })
      .catch(() => setError("โหลดรายชื่อนักเรียนไม่สำเร็จ"));
  }, [classroomId, subjectId]);

  useEffect(() => {
    if (!studentsLoaded || !date) return;
    let cancelled = false;
    setSessionLoading(true);
    getDocs(
      query(
        collection(db, "classrooms", classroomId, "attendance"),
        where("subjectId", "==", subjectId),
        where("date", "==", date),
        where("period", "==", period)
      )
    )
      .then((snap) => {
        if (cancelled) return;
        const initial = {};
        students.forEach((s) => (initial[s.id] = { ...emptyRow }));
        snap.docs.forEach((d) => {
          const v = d.data();
          initial[v.studentCode] = { status: v.status, reason: v.reason || "" };
        });
        setRows(initial);
        setDirty(new Set());
        setMessage("");
        setError("");
      })
      .catch(() => !cancelled && setError("โหลดข้อมูลการเช็คชื่อไม่สำเร็จ"))
      .finally(() => !cancelled && setSessionLoading(false));
    return () => {
      cancelled = true;
    };
  }, [classroomId, subjectId, date, period, studentsLoaded, students]);

  const confirmLeave = () =>
    dirty.size === 0 || window.confirm("มีข้อมูลที่ยังไม่ได้บันทึก ต้องการเปลี่ยนวันที่/คาบโดยไม่บันทึกหรือไม่?");
  const changeDate = (e) => confirmLeave() && setDate(e.target.value);
  const changePeriod = (e) => confirmLeave() && setPeriod(Number(e.target.value));

  const updateRow = (code, patch) => {
    setRows((prev) => ({ ...prev, [code]: { ...prev[code], ...patch } }));
    setDirty((prev) => new Set(prev).add(code));
    setMessage("");
  };
  const setStatus = (code, status) =>
    updateRow(code, status === "present" ? { status, reason: "" } : { status });

  const save = async () => {
    setError("");
    setMessage("");
    const codes = [...dirty];
    setBusy(true);
    try {
      for (let i = 0; i < codes.length; i += 400) {
        const batch = writeBatch(db);
        codes.slice(i, i + 400).forEach((code) => {
          const r = rows[code];
          const ref = doc(db, "classrooms", classroomId, "attendance", `${subjectId}_${date}_${period}_${code}`);
          if (r.status === "present") {
            batch.delete(ref);
          } else {
            batch.set(ref, {
              subjectId, date, period, studentCode: code,
              status: r.status, reason: r.reason.trim(), updatedAt: serverTimestamp(),
            });
          }
        });
        await batch.commit();
      }
      await setDoc(
        doc(db, "classrooms", classroomId, "attendanceLog", `${subjectId}_${date}_${period}`),
        { subjectId, date, period }
      );
      setDirty(new Set());
      setMessage(`บันทึกแล้ว ${codes.length} รายการ`);
    } catch (err) {
      console.error("save attendance error:", err);
      setError("บันทึกไม่สำเร็จ: " + err.message);
    } finally {
      setBusy(false);
    }
  };

  const count = (status) => students.filter((s) => (rows[s.id] || emptyRow).status === status).length;
  const cell = { border: `1px solid ${theme.border}`, padding: 10, textAlign: "left" };

  return (
    <div>
      <Link to={`/teacher/classroom/${classroomId}/subject/${subjectId}`} style={{ color: theme.accent, fontSize: 14 }}>
        &larr; กลับไปหน้าวิชา
      </Link>
      <h2 style={{ margin: "12px 0 4px", fontSize: 20 }}>เช็คคาบเรียน วิชา {subject ? subject.name : "..."}</h2>
      <p style={{ margin: "0 0 16px", display: "flex", gap: 16, flexWrap: "wrap" }}>
        <Link to={`/teacher/classroom/${classroomId}/subject/${subjectId}/attendance/qr`} style={{ color: theme.accent }}>
          เช็คคาบเรียนด้วย QR
        </Link>
        <Link to={`/teacher/classroom/${classroomId}/subject/${subjectId}/attendance/summary`} style={{ color: theme.accent }}>
          สรุปการเข้าเรียนรายคน
        </Link>
      </p>

      <div style={{ ...cardStyle, marginBottom: 16, display: "flex", gap: 16, flexWrap: "wrap" }}>
        <label style={{ fontSize: 14 }}>
          วันที่ <input type="date" value={date} onChange={changeDate} style={{ ...inputStyle, marginLeft: 6 }} />
        </label>
        <label style={{ fontSize: 14 }}>
          คาบที่{" "}
          <select value={period} onChange={changePeriod} style={{ ...inputStyle, marginLeft: 6 }}>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
      </div>

      {studentsLoaded && students.length === 0 && <p style={{ color: theme.muted }}>ห้องนี้ยังไม่มีนักเรียน</p>}

      {students.length > 0 && (
        <>
          <div style={{ position: "sticky", top: 0, background: theme.bg, padding: "8px 0", zIndex: 1 }}>
            <button style={btnPrimary} onClick={save} disabled={busy || sessionLoading || dirty.size === 0}>
              {busy ? "กำลังบันทึก..." : `บันทึก${dirty.size ? ` (${dirty.size} รายการที่แก้)` : ""}`}
            </button>{" "}
            <span style={{ fontSize: 14 }}>
              สาย {count("late")} | ลา {count("leave")} | ขาด {count("absent")} | รวม {students.length} คน
            </span>
            {error && <div style={{ color: theme.danger, marginTop: 6 }}>{error}</div>}
            {message && <div style={{ color: theme.success, marginTop: 6 }}>{message}</div>}
          </div>

          {sessionLoading ? (
            <p>กำลังโหลด...</p>
          ) : (
            <div style={{ ...cardStyle, overflowX: "auto", padding: 0, marginTop: 12 }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr style={{ background: "#F9FAFB" }}>
                    <th style={cell}>เลขที่</th>
                    <th style={cell}>ชื่อ-นามสกุล</th>
                    <th style={cell}>สถานะ</th>
                    <th style={cell}>เหตุผล</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => {
                    const r = rows[s.id] || emptyRow;
                    return (
                      <tr key={s.id} style={r.status !== "present" ? { background: "#FFFBEB" } : undefined}>
                        <td style={cell}>{s.no}</td>
                        <td style={cell}>{s.prefix}{s.firstName} {s.lastName}</td>
                        <td style={cell}>
                          {STATUS.map((st) => (
                            <label key={st.value} style={{ marginRight: 10, whiteSpace: "nowrap", fontSize: 14 }}>
                              <input type="radio" name={`att-${s.id}`} checked={r.status === st.value} onChange={() => setStatus(s.id, st.value)} />{" "}
                              {st.label}
                            </label>
                          ))}
                        </td>
                        <td style={cell}>
                          <input
                            placeholder={r.status === "present" ? "-" : "ระบุเหตุผล"}
                            value={r.reason}
                            disabled={r.status === "present"}
                            onChange={(e) => updateRow(s.id, { reason: e.target.value })}
                            style={{ ...inputStyle, width: "100%", minWidth: 140, boxSizing: "border-box" }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}