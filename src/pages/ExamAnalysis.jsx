import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import * as XLSX from "xlsx";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { theme, cardStyle, btnSecondary } from "../theme";

const round2 = (n) => Math.round(n * 100) / 100;
const avg = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0);

const pLabel = (p) =>
  p > 0.8 ? "ง่ายมาก" : p > 0.6 ? "ค่อนข้างง่าย" : p >= 0.4 ? "ปานกลาง" : p >= 0.2 ? "ค่อนข้างยาก" : "ยากมาก";
const dLabel = (d) =>
  d === null ? "-" : d >= 0.4 ? "ดีมาก" : d >= 0.3 ? "ดี" : d >= 0.2 ? "พอใช้" : d >= 0 ? "ต่ำ" : "ผิดปกติ";

function analyze(items, scoreDocs) {
  // นักเรียนที่มีคะแนนอย่างน้อย 1 ข้อ (ช่องที่ว่างบางข้อถือว่าได้ 0 ส่วนคนที่ว่างทั้งแถวไม่นับ)
  const rows = scoreDocs
    .map((d) => ({ id: d.id, scores: d.scores || {} }))
    .filter((r) => Object.values(r.scores).some((x) => x !== null && x !== undefined))
    .map((r) => {
      const byItem = {};
      let total = 0;
      items.forEach((it) => {
        const x = Number(r.scores[it.no]);
        const val = Number.isFinite(x) ? x : 0;
        byItem[it.no] = val;
        total += val;
      });
      return { id: r.id, byItem, total: round2(total) };
    });

  const N = rows.length;
  if (N === 0) return null;

  const maxTotal = round2(items.reduce((s, it) => s + Number(it.maxScore || 0), 0));
  const totals = rows.map((r) => r.total);
  const mean = avg(totals);
  const sd = N > 1 ? Math.sqrt(totals.reduce((s, x) => s + (x - mean) ** 2, 0) / (N - 1)) : 0;
  const belowHalf = rows.filter((r) => r.total < maxTotal / 2).length;

  // กลุ่มสูง/กลุ่มต่ำ 27%
  const sorted = [...rows].sort((a, b) => b.total - a.total);
  const k = Math.max(1, Math.round(N * 0.27));
  const upper = sorted.slice(0, k);
  const lower = sorted.slice(N - k);
  const discOk = N >= 6;

  const itemStats = items.map((it) => {
    const max = Number(it.maxScore) || 1;
    const m = avg(rows.map((r) => r.byItem[it.no]));
    const p = m / max;
    const D = discOk
      ? (avg(upper.map((r) => r.byItem[it.no])) - avg(lower.map((r) => r.byItem[it.no]))) / max
      : null;
    const flags = [];
    if (p > 0.8) flags.push("ง่ายเกินไป");
    if (p < 0.2) flags.push("ยากเกินไป");
    if (D !== null && D < 0) flags.push("กลุ่มคะแนนต่ำทำได้ดีกว่ากลุ่มสูง (ตรวจเฉลยและตัวโจทย์)");
    else if (D !== null && D < 0.2) flags.push("อำนาจจำแนกต่ำ");
    return {
      no: it.no,
      topic: (it.topic || "").trim(),
      bankId: it.bankId || "",
      max,
      mean: m,
      p,
      pLabel: pLabel(p),
      D,
      dLabel: dLabel(D),
      flags,
    };
  });

  // รายเรื่อง/ตัวชี้วัด
  const groups = {};
  items.forEach((it) => {
    const key = (it.topic || "").trim() || "ไม่ระบุเรื่อง";
    if (!groups[key]) groups[key] = { topic: key, nos: [], max: 0 };
    groups[key].nos.push(it.no);
    groups[key].max += Number(it.maxScore) || 0;
  });
  const topics = Object.values(groups).map((g) => {
    const perStudent = rows.map((r) => g.nos.reduce((s, n) => s + r.byItem[n], 0) / (g.max || 1));
    return {
      topic: g.topic,
      items: g.nos.join(", "),
      pct: avg(perStudent),
      low: perStudent.filter((x) => x < 0.5).length,
    };
  });

  return { N, maxTotal, mean, sd, max: Math.max(...totals), min: Math.min(...totals), belowHalf, discOk, items: itemStats, topics };
}

function Bar({ value, color }) {
  return (
    <div style={{ height: 8, background: theme.border, borderRadius: 999, minWidth: 80 }}>
      <div
        style={{
          width: `${Math.max(0, Math.min(100, Math.round(value * 100)))}%`,
          height: "100%",
          background: color,
          borderRadius: 999,
        }}
      />
    </div>
  );
}

const topicColor = (p) => (p < 0.5 ? theme.danger : p < 0.7 ? "#B45309" : theme.success);

export default function ExamAnalysis() {
  const { classroomId, subjectId, assignmentId } = useParams();
  const [assignment, setAssignment] = useState(null);
  const [items, setItems] = useState([]);
  const [scoreDocs, setScoreDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const base = ["classrooms", classroomId, "subjects", subjectId, "assignments", assignmentId];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [aSnap, cSnap, sSnap] = await Promise.all([
          getDoc(doc(db, ...base)),
          getDoc(doc(db, ...base, "itemAnalysis", "config")),
          getDocs(collection(db, ...base, "itemScores")),
        ]);
        if (cancelled) return;
        if (aSnap.exists()) setAssignment(aSnap.data());
        if (cSnap.exists()) setItems(cSnap.data().items || []);
        setScoreDocs(sSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch {
        if (!cancelled) setError("โหลดข้อมูลไม่สำเร็จ");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroomId, subjectId, assignmentId]);

  if (loading) return <p>กำลังโหลด...</p>;

  const result = items.length > 0 ? analyze(items, scoreDocs) : null;
  const assignmentPath = `/teacher/classroom/${classroomId}/subject/${subjectId}/assignment/${assignmentId}`;
  const th = { padding: "6px 10px", textAlign: "left", color: theme.muted, fontWeight: 600, whiteSpace: "nowrap" };
  const td = { padding: "6px 10px", verticalAlign: "middle" };
  const flagged = result ? result.items.filter((r) => r.flags.length > 0) : [];

  const exportXlsx = () => {
    const itemRows = result.items.map((r) => ({
      ข้อ: r.no,
      "เรื่อง/ตัวชี้วัด": r.topic,
      "รหัสข้อในคลัง": r.bankId,
      คะแนนเต็ม: r.max,
      คะแนนเฉลี่ย: round2(r.mean),
      "ความยาก (p)": round2(r.p),
      ระดับความยาก: r.pLabel,
      "อำนาจจำแนก (D)": r.D === null ? "" : round2(r.D),
      การแปลผล: r.dLabel,
      ข้อสังเกต: r.flags.join(", "),
    }));
    const topicRows = result.topics.map((t) => ({
      "เรื่อง/ตัวชี้วัด": t.topic,
      ข้อที่เกี่ยวข้อง: t.items,
      "ห้องทำได้เฉลี่ย (%)": Math.round(t.pct * 100),
      "นักเรียนที่ได้ต่ำกว่า 50% (คน)": t.low,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(itemRows), "รายข้อ");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(topicRows), "รายเรื่อง");
    XLSX.writeFile(wb, `วิเคราะห์ผลสอบ_${assignment?.title || "ข้อสอบ"}.xlsx`);
  };

  const exportStatsJson = () => {
    const linked = result.items.filter((r) => r.bankId);
    if (linked.length === 0) {
      alert('ยังไม่มีข้อที่ผูกรหัสข้อในคลัง (กรอกที่ช่อง "รหัสข้อในคลัง" ในหน้าโครงข้อ)');
      return;
    }
    const term = window.prompt("ปีการศึกษา/ภาคเรียนของข้อสอบนี้ (เช่น 2569/1)", "");
    if (term === null) return;
    const payload = {
      format: "item-stats-v1",
      exportedAt: new Date().toISOString(),
      term: term.trim(),
      classroomId,
      subjectId,
      assignmentId,
      assignmentTitle: assignment?.title || "",
      n: result.N,
      items: linked.map((r) => ({
        bankId: r.bankId,
        no: r.no,
        topic: r.topic,
        maxScore: r.max,
        mean: round2(r.mean),
        p: round2(r.p),
        D: r.D === null ? null : round2(r.D),
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `สถิติรายข้อ_${assignment?.title || "ข้อสอบ"}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div>
      <Link to={`/teacher/classroom/${classroomId}/subject/${subjectId}`} style={{ color: theme.accent, fontSize: 14 }}>
        &larr; กลับไปหน้าวิชา
      </Link>
      <h2 style={{ margin: "12px 0 4px", fontSize: 20 }}>วิเคราะห์ผลสอบ{assignment ? `: ${assignment.title}` : ""}</h2>
      {error && <p style={{ color: theme.danger }}>{error}</p>}

      {items.length === 0 && (
        <p style={{ color: theme.muted }}>
          ยังไม่มีโครงข้อ <Link to={`${assignmentPath}/items`}>ไปสร้างโครงข้อก่อน</Link>
        </p>
      )}
      {items.length > 0 && !result && (
        <p style={{ color: theme.muted }}>
          ยังไม่มีคะแนนรายข้อ <Link to={`${assignmentPath}/item-scores`}>ไปนำเข้าคะแนนรายข้อ</Link>
        </p>
      )}

      {result && (
        <>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "12px 0 16px" }}>
            {[
              ["ผู้เข้าสอบ", `${result.N} คน`],
              ["คะแนนเฉลี่ย", `${round2(result.mean)} / ${result.maxTotal}`],
              ["ส่วนเบี่ยงเบนมาตรฐาน", round2(result.sd)],
              ["สูงสุด / ต่ำสุด", `${result.max} / ${result.min}`],
              ["ต่ำกว่า 50%", `${result.belowHalf} คน`],
            ].map(([label, value]) => (
              <div key={label} style={{ ...cardStyle, padding: "10px 14px", minWidth: 120 }}>
                <div style={{ fontSize: 12, color: theme.muted }}>{label}</div>
                <div style={{ fontWeight: 700, fontSize: 17 }}>{value}</div>
              </div>
            ))}
          </div>

          {result.N < 20 && (
            <p style={{ color: "#B45309", fontSize: 13 }}>
              ผู้เข้าสอบ {result.N} คน ค่าความยากและอำนาจจำแนกใช้เป็นแนวทางเท่านั้น ยังไม่แม่นเท่าข้อมูลหลายห้องหลายปี
              {!result.discOk && " (ผู้เข้าสอบน้อยกว่า 6 คน จึงไม่คำนวณอำนาจจำแนก)"}
            </p>
          )}

          <div style={{ ...cardStyle, marginBottom: 16 }}>
            <h3 style={{ marginTop: 0, fontSize: 15 }}>รายเรื่อง/ตัวชี้วัด (ห้องนี้อ่อนตรงไหน)</h3>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%", minWidth: 420 }}>
                <thead>
                  <tr>
                    <th style={th}>เรื่อง/ตัวชี้วัด</th>
                    <th style={th}>ข้อ</th>
                    <th style={th}>ทำได้เฉลี่ย</th>
                    <th style={th}></th>
                    <th style={th}>ต่ำกว่า 50%</th>
                  </tr>
                </thead>
                <tbody>
                  {[...result.topics]
                    .sort((a, b) => a.pct - b.pct)
                    .map((t) => (
                      <tr key={t.topic} style={{ borderTop: `1px solid ${theme.border}` }}>
                        <td style={td}>{t.topic}</td>
                        <td style={td}>{t.items}</td>
                        <td style={{ ...td, fontWeight: 700, color: topicColor(t.pct) }}>{Math.round(t.pct * 100)}%</td>
                        <td style={{ ...td, width: 140 }}>
                          <Bar value={t.pct} color={topicColor(t.pct)} />
                        </td>
                        <td style={td}>{t.low} คน</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <p style={{ margin: "8px 0 0", fontSize: 12, color: theme.muted }}>เรียงจากเรื่องที่ห้องทำได้น้อยที่สุดขึ้นก่อน</p>
          </div>

          <div style={{ ...cardStyle, marginBottom: 16 }}>
            <h3 style={{ marginTop: 0, fontSize: 15 }}>ข้อที่ควรทบทวน</h3>
            {flagged.length === 0 ? (
              <p style={{ margin: 0, color: theme.success, fontSize: 14 }}>ไม่พบข้อที่ผิดปกติ</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, display: "grid", gap: 4 }}>
                {flagged.map((r) => (
                  <li key={r.no}>
                    <b>ข้อ {r.no}</b>
                    {r.topic ? ` (${r.topic})` : ""}
                    {r.bankId ? ` [${r.bankId}]` : ""}: {r.flags.join(" · ")} (p = {round2(r.p)}
                    {r.D !== null ? `, D = ${round2(r.D)}` : ""})
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div style={{ ...cardStyle, marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 15 }}>รายข้อ</h3>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" style={btnSecondary} onClick={exportXlsx}>
                  ส่งออก Excel
                </button>
                <button type="button" style={btnSecondary} onClick={exportStatsJson}>
                  ส่งออกสถิติไปคลังข้อสอบ
                </button>
              </div>
            </div>
            <div style={{ overflowX: "auto", marginTop: 10 }}>
              <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%", minWidth: 640 }}>
                <thead>
                  <tr>
                    <th style={th}>ข้อ</th>
                    <th style={th}>เรื่อง</th>
                    <th style={th}>เฉลี่ย/เต็ม</th>
                    <th style={th}>ความยาก (p)</th>
                    <th style={th}></th>
                    <th style={th}>ระดับ</th>
                    <th style={th}>อำนาจจำแนก (D)</th>
                    <th style={th}>แปลผล</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((r) => (
                    <tr key={r.no} style={{ borderTop: `1px solid ${theme.border}`, background: r.flags.length ? "#FFFBEB" : undefined }}>
                      <td style={{ ...td, fontWeight: 700 }}>{r.no}</td>
                      <td style={td}>{r.topic || "-"}</td>
                      <td style={td}>{round2(r.mean)} / {r.max}</td>
                      <td style={td}>{round2(r.p)}</td>
                      <td style={{ ...td, width: 90 }}>
                        <Bar value={r.p} color={r.p > 0.8 || r.p < 0.2 ? "#B45309" : theme.teal} />
                      </td>
                      <td style={td}>{r.pLabel}</td>
                      <td style={td}>{r.D === null ? "-" : round2(r.D)}</td>
                      <td style={td}>{r.dLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <details style={{ ...cardStyle, fontSize: 13 }}>
            <summary style={{ cursor: "pointer", fontWeight: 700 }}>วิธีอ่านค่าและข้อควรระวัง</summary>
            <ul style={{ margin: "8px 0 0", paddingLeft: 20, display: "grid", gap: 4 }}>
              <li>ความยาก (p) คือสัดส่วนคะแนนที่ห้องทำได้ในข้อนั้น ยิ่งสูงยิ่งง่าย ช่วงที่ยอมรับได้คือ 0.20-0.80</li>
              <li>อำนาจจำแนก (D) เทียบคะแนนเฉลี่ยของกลุ่มคะแนนสูง 27% กับกลุ่มต่ำ 27% ถ้าต่ำหรือติดลบ แปลว่าข้อนี้แยกคนเก่งกับคนอ่อนไม่ได้ ควรตรวจเฉลยและตัวโจทย์</li>
              <li>ช่องที่ว่างบางข้อของนักเรียนที่มีคะแนนข้ออื่น นับเป็น 0 ส่วนนักเรียนที่ว่างทั้งแถว (ขาดสอบ) ไม่นับ</li>
              <li>ข้อที่ง่ายหรือยากเกินไปไม่ได้แปลว่าเป็นข้อสอบที่ไม่ดีเสมอไป เช่น ข้อวัดความรู้พื้นฐานที่ทุกคนควรทำได้</li>
            </ul>
          </details>
        </>
      )}
    </div>
  );
}