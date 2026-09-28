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
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase";
import { ASSIGNMENT_TYPES, typeLabel } from "../constants";

const FLAGS = [
  { key: "late", symbol: "L", title: "ส่งช้า" },
  { key: "accuracy", symbol: "%", title: "ความถูกต้องสมบูรณ์ของงาน" },
  { key: "clean", symbol: "C", title: "ความสะอาดและเป็นระเบียบเรียบร้อย" },
];

const emptyRow = { score: "", late: false, accuracy: false, clean: false, retake: "" };

export default function ScoreEntry() {
  const { classroomId, subjectId, assignmentId } = useParams();
  const [assignment, setAssignment] = useState(null);
  const [students, setStudents] = useState([]);
  const [rows, setRows] = useState({});
  const [dirty, setDirty] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const [aSnap, sSnap, scSnap] = await Promise.all([
          getDoc(
            doc(db, "classrooms", classroomId, "subjects", subjectId, "assignments", assignmentId)
          ),
          getDocs(query(collection(db, "classrooms", classroomId, "students"), orderBy("no"))),
          getDocs(
            query(
              collection(db, "classrooms", classroomId, "scores"),
              where("assignmentId", "==", assignmentId)
            )
          ),
        ]);
        if (aSnap.exists()) setAssignment(aSnap.data());
        const list = sSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setStudents(list);

        const initial = {};
        list.forEach((s) => {
          initial[s.id] = { ...emptyRow };
        });
        scSnap.docs.forEach((d) => {
          const v = d.data();
          initial[v.studentCode] = {
            score: v.score ?? "",
            late: !!v.late,
            accuracy: !!v.accuracy,
            clean: !!v.clean,
            retake: v.retakeScore ?? "",
          };
        });
        setRows(initial);
      } catch {
        setError("โหลดข้อมูลไม่สำเร็จ");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [classroomId, subjectId, assignmentId]);

  if (loading) return <p>กำลังโหลด...</p>;
  if (!assignment) return <p>ไม่พบใบงานนี้</p>;

  const max = assignment.maxScore;
  const isExam = !!ASSIGNMENT_TYPES.find((t) => t.value === assignment.type)?.isExam;
  const belowHalf = (score) => isExam && score !== "" && Number(score) < max / 2;

  const updateRow = (code, patch) => {
    setRows((prev) => ({ ...prev, [code]: { ...prev[code], ...patch } }));
    setDirty((prev) => new Set(prev).add(code));
    setMessage("");
  };

  const onScore = (code, value) => {
    const patch = { score: value };
    if (!belowHalf(value)) patch.retake = "";
    updateRow(code, patch);
  };

  const inRange = (value) => {
    const n = Number(value);
    return !isNaN(n) && n >= 0 && n <= max;
  };

  const save = async () => {
    setError("");
    setMessage("");
    const codes = [...dirty];
    for (const code of codes) {
      const r = rows[code];
      if (r.score !== "" && !inRange(r.score)) {
        setError(`รหัส ${code}: คะแนนต้องอยู่ระหว่าง 0 ถึง ${max}`);
        return;
      }
      if (r.retake !== "" && !inRange(r.retake)) {
        setError(`รหัส ${code}: คะแนนซ่อมต้องอยู่ระหว่าง 0 ถึง ${max}`);
        return;
      }
    }
    setBusy(true);
    try {
      for (let i = 0; i < codes.length; i += 400) {
        const batch = writeBatch(db);
        codes.slice(i, i + 400).forEach((code) => {
          const r = rows[code];
          const ref = doc(db, "classrooms", classroomId, "scores", `${assignmentId}_${code}`);
          const empty =
            r.score === "" && !r.late && !r.accuracy && !r.clean && r.retake === "";
          if (empty) {
            batch.delete(ref);
          } else {
            batch.set(ref, {
              assignmentId,
              subjectId,
              studentCode: code,
              score: r.score === "" ? null : Number(r.score),
              late: r.late,
              accuracy: r.accuracy,
              clean: r.clean,
              retakeScore: r.retake === "" ? null : Number(r.retake),
              updatedAt: serverTimestamp(),
            });
          }
        });
        await batch.commit();
      }
      setDirty(new Set());
      setMessage(`บันทึกแล้ว ${codes.length} รายการ`);
    } catch {
      setError("บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const cell = { border: "1px solid #ccc", padding: 8 };

  return (
    <div>
      <Link to={`/teacher/classroom/${classroomId}/subject/${subjectId}`}>
        &larr; กลับไปหน้าวิชา
      </Link>
      <h3>
        {assignment.title} [{typeLabel(assignment.type)}]
      </h3>
      <p>
        คะแนนเต็ม {max} | กำหนดส่ง {assignment.dueDate}
      </p>
      <p style={{ fontSize: 14 }}>
        L = ส่งช้า &nbsp; % = ความถูกต้องสมบูรณ์ของงาน &nbsp; C = ความสะอาดและเป็นระเบียบเรียบร้อย
        (กดปุ่มเพื่อระบุเหตุผลที่ไม่ได้คะแนนเต็ม)
      </p>

      {students.length === 0 ? (
        <p>ห้องนี้ยังไม่มีนักเรียน ไปเพิ่มรายชื่อก่อนที่หน้าห้องเรียน</p>
      ) : (
        <>
          <div style={{ position: "sticky", top: 0, background: "white", padding: "8px 0" }}>
            <button onClick={save} disabled={busy || dirty.size === 0}>
              {busy ? "กำลังบันทึก..." : `บันทึกคะแนน${dirty.size ? ` (${dirty.size} รายการที่แก้)` : ""}`}
            </button>
            {error && <span style={{ color: "red", marginLeft: 12 }}>{error}</span>}
            {message && <span style={{ color: "green", marginLeft: 12 }}>{message}</span>}
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={cell}>เลขที่</th>
                  <th style={cell}>ชื่อ-นามสกุล</th>
                  <th style={cell}>คะแนน</th>
                  <th style={cell}>เหตุผลที่ไม่ได้เต็ม</th>
                  {isExam && <th style={cell}>ซ่อม</th>}
                </tr>
              </thead>
              <tbody>
                {students.map((s) => {
                  const r = rows[s.id] || emptyRow;
                  const low = belowHalf(r.score);
                  return (
                    <tr key={s.id} style={low ? { background: "#fff4f4" } : undefined}>
                      <td style={cell}>{s.no}</td>
                      <td style={cell}>
                        {s.prefix}
                        {s.firstName} {s.lastName}
                      </td>
                      <td style={cell}>
                        <input
                          type="number"
                          min="0"
                          max={max}
                          step="any"
                          value={r.score}
                          onChange={(e) => onScore(s.id, e.target.value)}
                          style={{ width: 70, padding: 6 }}
                        />{" "}
                        / {max}
                      </td>
                      <td style={cell}>
                        {FLAGS.map((f) => (
                          <button
                            key={f.key}
                            type="button"
                            title={f.title}
                            onClick={() => updateRow(s.id, { [f.key]: !r[f.key] })}
                            style={{
                              marginRight: 4,
                              width: 36,
                              padding: 6,
                              fontWeight: "bold",
                              cursor: "pointer",
                              border: "1px solid #888",
                              borderRadius: 4,
                              background: r[f.key] ? "#d33" : "white",
                              color: r[f.key] ? "white" : "#333",
                            }}
                          >
                            {f.symbol}
                          </button>
                        ))}
                      </td>
                      {isExam && (
                        <td style={cell}>
                          {low ? (
                            <input
                              type="number"
                              min="0"
                              max={max}
                              step="any"
                              placeholder="คะแนนซ่อม"
                              value={r.retake}
                              onChange={(e) => updateRow(s.id, { retake: e.target.value })}
                              style={{ width: 90, padding: 6 }}
                            />
                          ) : (
                            "-"
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}