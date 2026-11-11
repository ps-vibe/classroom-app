import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { collection, doc, getDoc, getDocs, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { theme, cardStyle } from "../theme";
import { exportAttendanceSummary } from "../exportUtils";

const STATUS_LABEL = { late: "สาย", leave: "ลา", absent: "ขาด" };

export default function AttendanceSummary() {
  const { classroomId, subjectId } = useParams();
  const [subject, setSubject] = useState(null);
  const [rows, setRows] = useState([]);
  const [totalSessions, setTotalSessions] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(new Set());

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

      const recordsByStudent = {};
      attSnap.docs.forEach((d) => {
        const v = d.data();
        if (!recordsByStudent[v.studentCode]) recordsByStudent[v.studentCode] = [];
        recordsByStudent[v.studentCode].push(v);
      });

      const result = studentSnap.docs.map((d) => {
        const s = d.data();
        const records = (recordsByStudent[d.id] || []).sort((a, b) =>
          (a.date + a.period).localeCompare(b.date + b.period)
        );
        const c = { late: 0, leave: 0, absent: 0 };
        records.forEach((r) => (c[r.status] = (c[r.status] || 0) + 1));

        // "ลา" ไม่นับเข้าตัวหาร (ไม่กระทบ %), "สาย" ยังถือว่ามาเรียน, มีแต่ "ขาด" ที่กระทบ %
        const effectiveTotal = Math.max(total - c.leave, 0);
        const present = Math.max(effectiveTotal - c.absent, 0);
        const percent = effectiveTotal > 0 ? Math.round((present / effectiveTotal) * 1000) / 10 : 100;

        return { id: d.id, ...s, ...c, present, effectiveTotal, percent, records };
      });
      setRows(result);
      setLoading(false);
    }
    load();
  }, [classroomId, subjectId]);

  const cell = { border: `1px solid ${theme.border}`, padding: 10, textAlign: "left" };

  const toggle = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  if (loading) return <p>กำลังโหลด...</p>;

  return (
    <div>
      <Link to={`/teacher/classroom/${classroomId}/subject/${subjectId}/attendance`} style={{ color: theme.accent, fontSize: 14 }}>
        &larr; กลับไปหน้าเช็คคาบเรียน
      </Link>
      <h2 style={{ margin: "12px 0 4px", fontSize: 20 }}>สรุปการเข้าเรียน วิชา {subject?.name}</h2>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        <p style={{ color: theme.muted, margin: 0 }}>เช็คคาบเรียนไปแล้วทั้งหมด {totalSessions} คาบ</p>
        {totalSessions > 0 && (
          <button
            style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${theme.border}`, background: "#fff", cursor: "pointer" }}
            onClick={() => exportAttendanceSummary(subject?.name || "วิชา", rows, totalSessions)}
          >
            ดาวน์โหลด Excel
          </button>
        )}
      </div>
      <p style={{ color: theme.muted, fontSize: 13, marginBottom: 16 }}>
        % คำนวณจาก (คาบทั้งหมด − จำนวนครั้งที่ลา) โดย "ลา" ไม่นับว่าขาดเรียนและไม่กระทบ % ส่วน "สาย" ยังถือว่ามาเรียน
      </p>

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
                <th style={cell}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <>
                  <tr key={r.id} style={r.percent < 80 ? { background: "#FEF2F2" } : undefined}>
                    <td style={cell}>{r.no}</td>
                    <td style={cell}>{r.prefix}{r.firstName} {r.lastName}</td>
                    <td style={cell}>{r.late}</td>
                    <td style={cell}>{r.leave}</td>
                    <td style={cell}>{r.absent}</td>
                    <td style={cell}>{r.present}/{r.effectiveTotal} ({r.percent}%)</td>
                    <td style={cell}>
                      {r.records.length > 0 && (
                        <button
                          onClick={() => toggle(r.id)}
                          style={{ fontSize: 13, color: theme.accent, background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
                        >
                          {expanded.has(r.id) ? "ซ่อนรายละเอียด" : "ดูรายละเอียด"}
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded.has(r.id) && (
                    <tr key={`${r.id}-detail`}>
                      <td colSpan={7} style={{ ...cell, background: "#FAFAFA" }}>
                        <table style={{ borderCollapse: "collapse", width: "100%" }}>
                          <thead>
                            <tr>
                              <th style={{ ...cell, fontSize: 12 }}>วันที่</th>
                              <th style={{ ...cell, fontSize: 12 }}>คาบที่</th>
                              <th style={{ ...cell, fontSize: 12 }}>สถานะ</th>
                              <th style={{ ...cell, fontSize: 12 }}>เหตุผล</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.records.map((rec, i) => (
                              <tr key={i}>
                                <td style={{ ...cell, fontSize: 13 }}>{rec.date}</td>
                                <td style={{ ...cell, fontSize: 13 }}>{rec.period}</td>
                                <td style={{ ...cell, fontSize: 13 }}>{STATUS_LABEL[rec.status] || rec.status}</td>
                                <td style={{ ...cell, fontSize: 13 }}>{rec.reason || "-"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}