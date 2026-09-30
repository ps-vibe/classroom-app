import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { collection, doc, getDoc, getDocs, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { theme, cardStyle } from "../theme";

export default function AttendanceSummary() {
  const { classroomId, subjectId } = useParams();
  const [subject, setSubject] = useState(null);
  const [rows, setRows] = useState([]);
  const [totalSessions, setTotalSessions] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [subjSnap, logSnap, studentSnap, attSnap] = await Promise.all([
        getDoc(doc(db, "classrooms", classroomId, "subjects", subjectId)),
        getDocs(
          query(collection(db, "classrooms", classroomId, "attendanceLog"), where("subjectId", "==", subjectId))
        ),
        getDocs(query(collection(db, "classrooms", classroomId, "students"), orderBy("no"))),
        getDocs(
          query(collection(db, "classrooms", classroomId, "attendance"), where("subjectId", "==", subjectId))
        ),
      ]);

      if (subjSnap.exists()) setSubject(subjSnap.data());
      const total = logSnap.size;
      setTotalSessions(total);

      const countsByStudent = {};
      attSnap.docs.forEach((d) => {
        const v = d.data();
        countsByStudent[v.studentCode] = countsByStudent[v.studentCode] || { late: 0, leave: 0, absent: 0 };
        countsByStudent[v.studentCode][v.status] = (countsByStudent[v.studentCode][v.status] || 0) + 1;
      });

      const result = studentSnap.docs.map((d) => {
        const s = d.data();
        const c = countsByStudent[d.id] || { late: 0, leave: 0, absent: 0 };
        const notPresent = c.late + c.leave + c.absent;
        const present = Math.max(total - notPresent, 0);
        const percent = total > 0 ? Math.round((present / total) * 1000) / 10 : 0;
        return { id: d.id, ...s, present, ...c, percent };
      });
      setRows(result);
      setLoading(false);
    }
    load();
  }, [classroomId, subjectId]);

  const cell = { border: "1px solid #ccc", padding: 8 };

  if (loading) return <p>กำลังโหลด...</p>;

    const cell = { border: `1px solid ${theme.border}`, padding: 10, textAlign: "left" };

  if (loading) return <p>กำลังโหลด...</p>;

  return (
    <div>
      <Link to={`/teacher/classroom/${classroomId}/subject/${subjectId}/attendance`} style={{ color: theme.accent, fontSize: 14 }}>
        &larr; กลับไปหน้าเช็คคาบเรียน
      </Link>
      <h2 style={{ margin: "12px 0 4px", fontSize: 20 }}>สรุปการเข้าเรียน วิชา {subject?.name}</h2>
      <p style={{ color: theme.muted, marginBottom: 16 }}>เช็คคาบเรียนไปแล้วทั้งหมด {totalSessions} คาบ</p>

      {totalSessions === 0 ? (
        <p style={{ color: theme.muted }}>ยังไม่เคยเช็คคาบเรียนของวิชานี้เลย</p>
      ) : (
        <div style={{ ...cardStyle, overflowX: "auto", padding: 0 }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr style={{ background: "#F9FAFB" }}>
                <th style={cell}>เลขที่</th>
                <th style={cell}>ชื่อ-นามสกุล</th>
                <th style={cell}>สาย</th>
                <th style={cell}>ลา</th>
                <th style={cell}>ขาด</th>
                <th style={cell}>มาเรียน / ทั้งหมด (%)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={r.percent < 80 ? { background: "#FEF2F2" } : undefined}>
                  <td style={cell}>{r.no}</td>
                  <td style={cell}>{r.prefix}{r.firstName} {r.lastName}</td>
                  <td style={cell}>{r.late}</td>
                  <td style={cell}>{r.leave}</td>
                  <td style={cell}>{r.absent}</td>
                  <td style={cell}>{r.present}/{totalSessions} ({r.percent}%)</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
    </div>
  );
}