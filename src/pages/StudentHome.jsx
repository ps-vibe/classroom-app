import { useEffect, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../AuthContext";
import { typeLabel } from "../constants";

const STATUS_LABEL = { late: "สาย", leave: "ลา", absent: "ขาด" };
const todayStr = () => new Date().toISOString().slice(0, 10);

export default function StudentHome() {
  const { claims, logout } = useAuth();
  const classroomId = claims?.classroomId;
  const studentCode = claims?.studentCode;

  const [me, setMe] = useState(null);
  const [room, setRoom] = useState(null);
  const [subjects, setSubjects] = useState({});
  const [assignments, setAssignments] = useState([]);
  const [scores, setScores] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const [meSnap, roomSnap, subjSnap] = await Promise.all([
          getDoc(doc(db, "classrooms", classroomId, "students", studentCode)),
          getDoc(doc(db, "classrooms", classroomId)),
          getDocs(collection(db, "classrooms", classroomId, "subjects")),
        ]);
        if (meSnap.exists()) setMe(meSnap.data());
        if (roomSnap.exists()) setRoom(roomSnap.data());

        const subjMap = {};
        subjSnap.docs.forEach((d) => (subjMap[d.id] = d.data()));
        setSubjects(subjMap);

        // ดึงใบงานของทุกวิชาในห้อง (ใช้แสดงชื่องานคู่กับคะแนน/งานค้าง)
        const allAssignments = [];
        for (const subjId of Object.keys(subjMap)) {
          const aSnap = await getDocs(
            query(
              collection(db, "classrooms", classroomId, "subjects", subjId, "assignments"),
              orderBy("dueDate")
            )
          );
          aSnap.docs.forEach((d) =>
            allAssignments.push({ id: d.id, subjectId: subjId, ...d.data() })
          );
        }
        setAssignments(allAssignments);

        const [scoreSnap, attSnap] = await Promise.all([
          getDocs(
            query(
              collection(db, "classrooms", classroomId, "scores"),
              where("studentCode", "==", studentCode)
            )
          ),
          getDocs(
            query(
              collection(db, "classrooms", classroomId, "attendance"),
              where("studentCode", "==", studentCode)
            )
          ),
        ]);
        setScores(scoreSnap.docs.map((d) => d.data()));
        setAttendance(attSnap.docs.map((d) => d.data()));
      } catch {
        setError("โหลดข้อมูลไม่สำเร็จ");
      } finally {
        setLoading(false);
      }
    }
    if (classroomId && studentCode) load();
  }, [classroomId, studentCode]);

  if (loading) return <p style={{ margin: 40 }}>กำลังโหลด...</p>;

  const scoreByAssignment = Object.fromEntries(scores.map((s) => [s.assignmentId, s]));
  const today = todayStr();
  const pending = assignments.filter(
    (a) => !scoreByAssignment[a.id] && a.dueDate >= today
  );
  const overdue = assignments.filter(
    (a) => !scoreByAssignment[a.id] && a.dueDate < today
  );
  const graded = assignments.filter((a) => scoreByAssignment[a.id]);

  const cell = { border: "1px solid #ccc", padding: 8 };
  const card = { border: "1px solid #ddd", borderRadius: 8, padding: 16, marginBottom: 20 };

  return (
    <div style={{ maxWidth: 800, margin: "30px auto", fontFamily: "sans-serif", padding: "0 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>
            {me ? `${me.prefix}${me.firstName} ${me.lastName}` : "นักเรียน"}
          </h2>
          <p style={{ margin: 0, color: "#666" }}>
            ห้อง {room?.name || "..."} | รหัสประจำตัว {studentCode}
          </p>
        </div>
        <button onClick={logout}>ออกจากระบบ</button>
      </div>

      {error && <p style={{ color: "red" }}>{error}</p>}

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>งานที่ยังไม่ถึงกำหนดส่ง ({pending.length})</h3>
        {pending.length === 0 ? (
          <p>ไม่มีงานค้าง</p>
        ) : (
          <ul>
            {pending.map((a) => (
              <li key={a.id}>
                {subjects[a.subjectId]?.name} - {a.title} [{typeLabel(a.type)}] กำหนดส่ง {a.dueDate}
              </li>
            ))}
          </ul>
        )}
      </div>

      {overdue.length > 0 && (
        <div style={{ ...card, background: "#fff4f4" }}>
          <h3 style={{ marginTop: 0 }}>งานเลยกำหนดส่งแล้วและยังไม่มีคะแนน ({overdue.length})</h3>
          <ul>
            {overdue.map((a) => (
              <li key={a.id}>
                {subjects[a.subjectId]?.name} - {a.title} [{typeLabel(a.type)}] กำหนดส่ง {a.dueDate}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>คะแนนที่ได้รับ</h3>
        {graded.length === 0 ? (
          <p>ยังไม่มีคะแนน</p>
        ) : (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={cell}>วิชา</th>
                <th style={cell}>งาน</th>
                <th style={cell}>คะแนน</th>
                <th style={cell}>หมายเหตุ</th>
              </tr>
            </thead>
            <tbody>
              {graded.map((a) => {
                const s = scoreByAssignment[a.id];
                const flags = [
                  s.late && "L",
                  s.accuracy && "%",
                  s.clean && "C",
                ].filter(Boolean);
                return (
                  <tr key={a.id}>
                    <td style={cell}>{subjects[a.subjectId]?.name}</td>
                    <td style={cell}>
                      {a.title} [{typeLabel(a.type)}]
                    </td>
                    <td style={cell}>
                      {s.score ?? "-"} / {a.maxScore}
                      {s.retakeScore != null && ` (ซ่อม: ${s.retakeScore})`}
                    </td>
                    <td style={cell}>{flags.join(" ") || "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>การเช็คคาบเรียน (เฉพาะที่ไม่ได้มาปกติ)</h3>
        {attendance.length === 0 ? (
          <p>ไม่มีประวัติ สาย / ลา / ขาด</p>
        ) : (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={cell}>วันที่</th>
                <th style={cell}>คาบที่</th>
                <th style={cell}>วิชา</th>
                <th style={cell}>สถานะ</th>
                <th style={cell}>เหตุผล</th>
              </tr>
            </thead>
            <tbody>
              {[...attendance]
                .sort((a, b) => (a.date + a.period).localeCompare(b.date + b.period))
                .map((r, i) => (
                  <tr key={i}>
                    <td style={cell}>{r.date}</td>
                    <td style={cell}>{r.period}</td>
                    <td style={cell}>{subjects[r.subjectId]?.name || "-"}</td>
                    <td style={cell}>{STATUS_LABEL[r.status] || r.status}</td>
                    <td style={cell}>{r.reason || "-"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}