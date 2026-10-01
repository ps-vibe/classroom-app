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
const FLAGS = [
  { key: "late", symbol: "L" },
  { key: "accuracy", symbol: "%" },
  { key: "clean", symbol: "C" },
];

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

function ReasonBadges({ item }) {
  const active = FLAGS.filter((f) => item[f.key]);
  if (active.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
      {active.map((f) => (
        <span
          key={f.key}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 26,
            height: 26,
            borderRadius: 8,
            background: COLORS.badgeBg,
            color: "#fff",
            fontWeight: 700,
            fontSize: 14,
          }}
        >
          {f.symbol}
        </span>
      ))}
    </div>
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
          grouped[subj.id] = aSnap.docs.map((d) => ({
            id: d.id,
            ...d.data(),
            score: scoreByAssignment[d.id] || null,
          }));
        }
        setAssignmentsBySubject(grouped);

        const attSnap = await getDocs(
          query(
            collection(db, "classrooms", classroomId, "attendance"),
            where("studentCode", "==", studentCode)
          )
        );
        setAttendance(attSnap.docs.map((d) => d.data()));
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
            <div style={{ fontSize: 13, color: COLORS.muted, marginBottom: 16, lineHeight: 1.8 }}>
              <b style={{ color: COLORS.badgeBg }}>%</b> = ความถูกต้อง-สมบูรณ์ของงานน้อยกว่าร้อยละ 70 , &nbsp;
              <b style={{ color: COLORS.badgeBg }}>L</b> = ส่งงานช้ากว่ากำหนด , &nbsp;
              <b style={{ color: COLORS.badgeBg }}>C</b> = งานไม่เป็นระเบียบเรียบร้อย-ไม่สะอาด
            </div>

            {subjects.map((subj) => (
              <div key={subj.id} style={cardStyle}>
                <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 12, color: COLORS.text }}>
                  {subj.code ? `${subj.code} ` : ""}
                  {subj.name}
                </div>
                {(assignmentsBySubject[subj.id] || []).length === 0 ? (
                  <p style={{ color: COLORS.muted, margin: 0 }}>ยังไม่มีใบงาน</p>
                ) : (
                  assignmentsBySubject[subj.id].map((a, i, arr) => (
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
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <ScoreBadge score={a.score?.score} maxScore={a.maxScore} />
                        {a.score && <ReasonBadges item={a.score} />}
                      </div>
                    </div>
                  ))
                )}
              </div>
            ))}
          </>
        )}

        {tab === "attendance" && (
          <div style={cardStyle}>
            <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 12, color: COLORS.text }}>
              ประวัติ สาย / ลา / ขาด
            </div>
            {attendance.length === 0 ? (
              <p style={{ color: COLORS.muted, margin: 0 }}>ไม่มีประวัติ</p>
            ) : (
              [...attendance]
                .sort((a, b) => (b.date + b.period).localeCompare(a.date + a.period))
                .map((r, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "12px 0",
                      borderTop: i === 0 ? "none" : `1px solid ${COLORS.border}`,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, color: COLORS.text }}>
                        {r.date} คาบ {r.period}
                      </div>
                      {r.reason && <div style={{ color: COLORS.muted, fontSize: 13 }}>{r.reason}</div>}
                    </div>
                                       <span
                      style={{
                        alignSelf: "center",
                        padding: "4px 14px",
                        borderRadius: 999,
                        fontWeight: 700,
                        fontSize: 14,
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
        )}
      </div>
    </div>
  );
}