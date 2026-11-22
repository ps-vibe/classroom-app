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
import { typeLabel, ASSIGNMENT_TYPES } from "../constants";
import { Link } from "react-router-dom";
import { LEVEL_LABEL } from "../rubricUtils";

const STATUS_LABEL = { late: "สาย", leave: "ลา", absent: "ขาด" };
const COLORS = {
  bg: "#F7F3EC",
  card: "#FFFFFF",
  text: "#2B2B2B",
  muted: "#8A8A8A",
  border: "#EFE9DF",
  fullBg: "#DCEEE0",
  fullText: "#2F7D4F",
  partialBg: "#FBE3D0",
  partialText: "#B9631B",
  badgeBg: "#B9631B",
  tabActive: "#3F7A6F",
};

// ใบงานสอบที่ได้คะแนนต่ำกว่าครึ่ง จะแสดงบรรทัดสอบซ่อมใต้คะแนน
const needsRetake = (a) =>
  !!ASSIGNMENT_TYPES.find((t) => t.value === a.type)?.isExam &&
  a.score?.score != null &&
  Number(a.score.score) < Number(a.maxScore) / 2;

function ScoreBadge({ score, maxScore }) {
  if (score == null) return <span style={{ color: COLORS.muted, fontSize: 14 }}>ยังไม่ให้คะแนน</span>;
  const full = score >= maxScore;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 14px",
        borderRadius: 999,
        fontWeight: 700,
        fontSize: 14,
        background: full ? COLORS.fullBg : COLORS.partialBg,
        color: full ? COLORS.fullText : COLORS.partialText,
        whiteSpace: "nowrap",
      }}
    >
      {score} / {maxScore}
    </span>
  );
}

export default function StudentHome() {
  const { claims, logout } = useAuth();
  const classroomId = claims?.classroomId;
  const studentCode = claims?.studentCode;

  const [tab, setTab] = useState("scores");
  const [me, setMe] = useState(null);
  const [room, setRoom] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [assignmentsBySubject, setAssignmentsBySubject] = useState({});
  const [attendance, setAttendance] = useState([]);
  const [logTotals, setLogTotals] = useState({});
  const [retakes, setRetakes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const [meSnap, roomSnap, subjSnap] = await Promise.all([
          getDoc(doc(db, "classrooms", classroomId, "students", studentCode)),
          getDoc(doc(db, "classrooms", classroomId)),
          getDocs(query(collection(db, "classrooms", classroomId, "subjects"), orderBy("name"))),
        ]);
        if (meSnap.exists()) setMe(meSnap.data());
        if (roomSnap.exists()) setRoom(roomSnap.data());

        const subjList = subjSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setSubjects(subjList);

        const scoreSnap = await getDocs(
          query(
            collection(db, "classrooms", classroomId, "scores"),
            where("studentCode", "==", studentCode)
          )
        );
        const scoreByAssignment = {};
        scoreSnap.docs.forEach((d) => (scoreByAssignment[d.data().assignmentId] = d.data()));

        const grouped = {};
        for (const subj of subjList) {
          const aSnap = await getDocs(
            query(
              collection(db, "classrooms", classroomId, "subjects", subj.id, "assignments"),
              orderBy("dueDate")
            )
          );
          const list = aSnap.docs.map((d) => ({
            id: d.id,
            ...d.data(),
            score: scoreByAssignment[d.id] || null,
          }));
          // ใบงานที่ให้คะแนนตามเกณฑ์แล้ว: ดึงชื่อเกณฑ์มาแสดงคู่กับระดับของนักเรียน
          await Promise.all(
            list.map(async (a) => {
              if (a.score?.rubricLevels) {
                try {
                  const cfg = await getDoc(
                    doc(db, "classrooms", classroomId, "subjects", subj.id, "assignments", a.id, "rubric", "config")
                  );
                  if (cfg.exists()) a.rubricCriteria = cfg.data().criteria || [];
                } catch {
                  /* อ่านเกณฑ์ไม่ได้ ข้ามไป แสดงแค่คะแนนรวม */
                }
              }
            })
          );
          grouped[subj.id] = list;
        }
        setAssignmentsBySubject(grouped);

        const [attSnap, logSnap] = await Promise.all([
          getDocs(
            query(
              collection(db, "classrooms", classroomId, "attendance"),
              where("studentCode", "==", studentCode)
            )
          ),
          getDocs(collection(db, "classrooms", classroomId, "attendanceLog")),
        ]);
        setAttendance(attSnap.docs.map((d) => d.data()));
        const totals = {};
        logSnap.docs.forEach((d) => {
          const subjId = d.data().subjectId;
          totals[subjId] = (totals[subjId] || 0) + 1;
        });
        setLogTotals(totals);

        try {
          const rtSnap = await getDocs(
            query(
              collection(db, "classrooms", classroomId, "retakeAttempts"),
              where("studentCode", "==", studentCode)
            )
          );
          setRetakes(rtSnap.docs.map((d) => d.data()));
        } catch {
          /* ยังไม่มีข้อสอบซ่อม หรือกฎยังไม่เปิดให้อ่าน ข้ามไป */
        }
      } catch {
        setError("โหลดข้อมูลไม่สำเร็จ");
      } finally {
        setLoading(false);
      }
    }
    if (classroomId && studentCode) load();
  }, [classroomId, studentCode]);

  if (loading)
    return (
      <div style={{ background: COLORS.bg, minHeight: "100vh", padding: 24 }}>
        <p style={{ color: COLORS.text }}>กำลังโหลด...</p>
      </div>
    );

  const todayStr = new Date().toISOString().slice(0, 10);
  const in3DaysStr = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const dueSoon = subjects
    .flatMap((subj) =>
      (assignmentsBySubject[subj.id] || [])
        .filter((a) => !a.score && a.dueDate >= todayStr && a.dueDate <= in3DaysStr)
        .map((a) => ({ ...a, subjectName: subj.name }))
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const fmt = (iso) => new Date(iso).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
  const nowMs = Date.now();
  const retakeCards = retakes.filter(
    (r) => r.status !== "assigned" || nowMs <= Date.parse(r.closesAt)
  );
  const retakeBtn = {
    display: "inline-block", padding: "10px 18px", borderRadius: 999, fontWeight: 700,
    fontSize: 14, textDecoration: "none", background: COLORS.tabActive, color: "#fff",
  };

  const tabBtn = (key, label) => (
    <button
      onClick={() => setTab(key)}
      style={{
        padding: "10px 20px",
        borderRadius: 999,
        border: "none",
        fontWeight: 700,
        fontSize: 14,
        cursor: "pointer",
        background: tab === key ? COLORS.tabActive : "#fff",
        color: tab === key ? "#fff" : COLORS.text,
        boxShadow: tab === key ? "none" : "0 0 0 1px " + COLORS.border,
      }}
    >
      {label}
    </button>
  );

  const cardStyle = {
    background: COLORS.card,
    borderRadius: 20,
    padding: "20px 18px",
    marginBottom: 16,
    boxShadow: "0 2px 10px rgba(0,0,0,0.04)",
  };

  return (
    <div style={{ background: COLORS.bg, minHeight: "100vh", fontFamily: "sans-serif" }}>
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "20px 16px 60px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 20, color: COLORS.text }}>
              {me ? `${me.prefix}${me.firstName} ${me.lastName}` : "นักเรียน"}
            </div>
            <div style={{ color: COLORS.muted, fontSize: 14 }}>
              ห้อง {room?.name || "..."} | {studentCode}
            </div>
          </div>
          <button
            onClick={logout}
            style={{
              border: "none",
              background: "transparent",
              color: COLORS.muted,
              fontSize: 13,
              textDecoration: "underline",
              cursor: "pointer",
            }}
          >
            ออกจากระบบ
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          {tabBtn("scores", "คะแนน & งาน")}
          {tabBtn("attendance", "การเข้าเรียน")}
        </div>

        {error && <p style={{ color: "#C0392B" }}>{error}</p>}
        {dueSoon.length > 0 && (
          <div
            style={{
              ...cardStyle,
              background: "#FFF6E9",
              border: "1px solid #F3D9A8",
              marginBottom: 16,
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 15, color: "#8A5A00", marginBottom: 8 }}>
              ⏰ งานใกล้ถึงกำหนดส่ง ({dueSoon.length})
            </div>
            {dueSoon.map((a) => (
              <div
                key={a.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "6px 0",
                  fontSize: 14,
                  color: COLORS.text,
                }}
              >
                <span>
                  {a.subjectName} - {a.title}
                </span>
                <span style={{ color: "#8A5A00", fontWeight: 700, whiteSpace: "nowrap" }}>
                  {a.dueDate === todayStr ? "วันนี้" : a.dueDate}
                </span>
              </div>
            ))}
          </div>
        )}

        {tab === "scores" && (
          <>
            {retakeCards.map((r) => (
              <div key={r.examId} style={{ ...cardStyle, border: `1px solid ${COLORS.partialBg}` }}>
                <div style={{ fontWeight: 800, fontSize: 16, color: COLORS.badgeBg }}>📝 สอบซ่อม: {r.title}</div>
                <div style={{ color: COLORS.muted, fontSize: 13, margin: "6px 0 10px" }}>
                  เปิดสอบ {fmt(r.opensAt)} ถึง {fmt(r.closesAt)} | ทำได้ {r.durationMin} นาที
                </div>
                {r.status === "submitted" ? (
                  <b style={{ color: COLORS.fullText }}>ส่งแล้ว ได้คะแนนซ่อม {r.retakeScore} / {r.maxScore}</b>
                ) : nowMs < Date.parse(r.opensAt) ? (
                  <span style={{ color: COLORS.muted }}>ยังไม่ถึงเวลาเปิดสอบ</span>
                ) : (
                  <Link to={`/student/retake/${r.examId}`} style={retakeBtn}>
                    {r.status === "started" ? "ทำข้อสอบต่อ" : "เริ่มทำข้อสอบ"}
                  </Link>
                )}
              </div>
            ))}

            {subjects.map((subj) => (
              <div key={subj.id} style={cardStyle}>
                <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 12, color: COLORS.text }}>
                  {subj.code ? `${subj.code} ` : ""}
                  {subj.name}
                </div>
                {(assignmentsBySubject[subj.id] || []).length === 0 ? (
                  <p style={{ color: COLORS.muted, margin: 0 }}>ยังไม่มีใบงาน</p>
                ) : (
                  assignmentsBySubject[subj.id].map((a, i) => (
                    <div
                      key={a.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: 12,
                        padding: "12px 0",
                        borderTop: i === 0 ? "none" : `1px solid ${COLORS.border}`,
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ color: COLORS.text, fontWeight: 600, fontSize: 15 }}>
                          ({typeLabel(a.type)}) {a.title}
                        </div>
                        {!a.score && (
                          <div style={{ color: COLORS.muted, fontSize: 12, marginTop: 2 }}>
                            กำหนดส่ง {a.dueDate}
                          </div>
                        )}
                        {a.rubricCriteria && a.score?.rubricLevels && (
                          <div style={{ marginTop: 6, display: "grid", gap: 3 }}>
                            {a.rubricCriteria.map((c) => {
                              const lv = a.score.rubricLevels[c.criterionId];
                              if (lv === null || lv === undefined) return null;
                              return (
                                <div
                                  key={c.criterionId}
                                  style={{ fontSize: 13, color: COLORS.muted, display: "flex", justifyContent: "space-between", gap: 8 }}
                                >
                                  <span>{c.name}</span>
                                  <b style={{ color: lv >= 3 ? COLORS.fullText : COLORS.partialText, whiteSpace: "nowrap" }}>
                                    {LEVEL_LABEL[lv]}
                                  </b>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <div style={{ textAlign: "right" }}>
                        <ScoreBadge score={a.score?.score} maxScore={a.maxScore} />
                        {needsRetake(a) && (
                          <div style={{ marginTop: 4, fontSize: 13, fontWeight: 700, color: COLORS.partialText }}>
                            {a.score.retakeScore != null ? (
                              `สอบซ่อม ${a.score.retakeScore} / ${a.maxScore}`
                            ) : (
                              <span style={{ color: COLORS.muted, fontWeight: 400 }}>สอบซ่อม: ยังไม่มีคะแนน</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            ))}
          </>
        )}

        {tab === "attendance" &&
          subjects.map((subj) => {
            const records = attendance
              .filter((r) => r.subjectId === subj.id)
              .sort((a, b) => (b.date + b.period).localeCompare(a.date + a.period));
            const total = logTotals[subj.id] || 0;
            const c = { late: 0, leave: 0, absent: 0 };
            records.forEach((r) => (c[r.status] = (c[r.status] || 0) + 1));
            const effectiveTotal = Math.max(total - c.leave, 0);
            const present = Math.max(effectiveTotal - c.absent, 0);
            const percent = effectiveTotal > 0 ? Math.round((present / effectiveTotal) * 1000) / 10 : 100;

            if (total === 0) return null;

            return (
              <div key={subj.id} style={cardStyle}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 12,
                    flexWrap: "wrap",
                    gap: 8,
                  }}
                >
                  <div style={{ fontWeight: 800, fontSize: 17, color: COLORS.text }}>
                    {subj.code ? `${subj.code} ` : ""}
                    {subj.name}
                  </div>
                  <span
                    style={{
                      padding: "4px 14px",
                      borderRadius: 999,
                      fontWeight: 700,
                      fontSize: 14,
                      background: percent >= 80 ? COLORS.fullBg : COLORS.partialBg,
                      color: percent >= 80 ? COLORS.fullText : COLORS.partialText,
                    }}
                  >
                    เข้าเรียน {percent}%
                  </span>
                </div>
                <div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 8 }}>
                  สาย {c.late} | ลา {c.leave} | ขาด {c.absent} (จากทั้งหมด {total} คาบ)
                </div>

                {records.length === 0 ? (
                  <p style={{ color: COLORS.muted, margin: 0, fontSize: 14 }}>มาเรียนครบทุกคาบ</p>
                ) : (
                  records.map((r, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "10px 0",
                        borderTop: `1px solid ${COLORS.border}`,
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, color: COLORS.text, fontSize: 14 }}>
                          {r.date} คาบ {r.period}
                        </div>
                        {r.reason && <div style={{ color: COLORS.muted, fontSize: 12 }}>{r.reason}</div>}
                      </div>
                      <span
                        style={{
                          alignSelf: "center",
                          padding: "3px 12px",
                          borderRadius: 999,
                          fontWeight: 700,
                          fontSize: 13,
                          background: COLORS.partialBg,
                          color: COLORS.partialText,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {STATUS_LABEL[r.status] || r.status}
                      </span>
                    </div>
                  ))
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}