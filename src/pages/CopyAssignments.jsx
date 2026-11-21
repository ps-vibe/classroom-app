import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { collection, doc, getDoc, getDocs, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import { typeLabel } from "../constants";
import { theme, cardStyle, btnPrimary, btnSecondary, inputStyle } from "../theme";

export default function CopyAssignments() {
  const { classroomId, subjectId } = useParams();
  const [subject, setSubject] = useState(null);
  const [existing, setExisting] = useState([]);
  const [sources, setSources] = useState([]);
  const [sourceKey, setSourceKey] = useState("");
  const [items, setItems] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [newDue, setNewDue] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [subjSnap, aSnap, classSnap] = await Promise.all([
          getDoc(doc(db, "classrooms", classroomId, "subjects", subjectId)),
          getDocs(collection(db, "classrooms", classroomId, "subjects", subjectId, "assignments")),
          getDocs(collection(db, "classrooms")),
        ]);
        if (cancelled) return;
        const cur = subjSnap.exists() ? subjSnap.data() : null;
        setSubject(cur);
        setExisting(aSnap.docs.map((d) => ({ title: d.data().title, type: d.data().type })));

        const list = [];
        for (const c of classSnap.docs) {
          if (c.id === classroomId) continue;
          const sj = await getDocs(collection(db, "classrooms", c.id, "subjects"));
          sj.docs.forEach((s) => {
            const v = s.data();
            const same =
              !!cur &&
              ((cur.code && v.code && cur.code === v.code) || (cur.name && v.name && cur.name === v.name));
            list.push({
              key: `${c.id}/${s.id}`,
              classroomId: c.id,
              subjectId: s.id,
              same: !!same,
              label: `${c.data().name || c.id} › ${v.code ? v.code + " " : ""}${v.name || s.id}`,
            });
          });
        }
        list.sort((a, b) => Number(b.same) - Number(a.same) || a.label.localeCompare(b.label));
        if (!cancelled) {
          setSources(list);
          setSourceKey(list[0]?.key || "");
        }
      } catch {
        if (!cancelled) setError("โหลดข้อมูลไม่สำเร็จ");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [classroomId, subjectId]);

  const isDup = (a) => existing.some((e) => e.title === a.title && e.type === a.type);

  const loadItems = async () => {
    const src = sources.find((s) => s.key === sourceKey);
    if (!src) return;
    setLoadingItems(true);
    setError("");
    setMsg("");
    setItems(null);
    try {
      const aSnap = await getDocs(
        collection(db, "classrooms", src.classroomId, "subjects", src.subjectId, "assignments")
      );
      const list = await Promise.all(
        aSnap.docs.map(async (d) => {
          const base = ["classrooms", src.classroomId, "subjects", src.subjectId, "assignments", d.id];
          const [rb, it] = await Promise.all([
            getDoc(doc(db, ...base, "rubric", "config")),
            getDoc(doc(db, ...base, "itemAnalysis", "config")),
          ]);
          const v = d.data();
          const rubric = rb.exists() ? rb.data().criteria || [] : [];
          const itemCfg = it.exists() && (it.data().items || []).length > 0 ? it.data() : null;
          return {
            id: d.id,
            title: v.title,
            type: v.type,
            maxScore: v.maxScore,
            dueDate: v.dueDate || "",
            rubric: rubric.length > 0 ? rubric : null,
            itemCfg,
          };
        })
      );
      list.sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
      setItems(list);
      setPicked(new Set(list.filter((a) => !isDup(a)).map((a) => a.id)));
    } catch {
      setError("โหลดใบงานของวิชาต้นทางไม่สำเร็จ");
    } finally {
      setLoadingItems(false);
    }
  };

  const toggle = (id) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const copy = async () => {
    const chosen = (items || []).filter((a) => picked.has(a.id));
    if (chosen.length === 0) {
      setError("เลือกใบงานอย่างน้อย 1 ใบ");
      return;
    }
    const dupCount = chosen.filter(isDup).length;
    if (
      dupCount > 0 &&
      !window.confirm(`มี ${dupCount} ใบที่ชื่อและประเภทซ้ำกับใบงานที่มีอยู่แล้วในวิชานี้ ต้องการคัดลอกซ้ำหรือไม่?`)
    )
      return;
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const targetCol = collection(db, "classrooms", classroomId, "subjects", subjectId, "assignments");
      for (let i = 0; i < chosen.length; i += 100) {
        const batch = writeBatch(db);
        chosen.slice(i, i + 100).forEach((a) => {
          const ref = doc(targetCol);
          batch.set(ref, {
            title: a.title,
            type: a.type,
            maxScore: a.maxScore,
            dueDate: newDue || a.dueDate || "",
            createdAt: serverTimestamp(),
          });
          if (a.rubric) {
            batch.set(doc(ref, "rubric", "config"), { criteria: a.rubric, updatedAt: serverTimestamp() });
          }
          if (a.itemCfg) {
            batch.set(doc(ref, "itemAnalysis", "config"), {
              items: a.itemCfg.items,
              totalMax: a.itemCfg.totalMax ?? null,
              updatedAt: serverTimestamp(),
            });
          }
        });
        await batch.commit();
      }
      const withRubric = chosen.filter((a) => a.rubric).length;
      const withItems = chosen.filter((a) => a.itemCfg).length;
      setExisting((prev) => [...prev, ...chosen.map((a) => ({ title: a.title, type: a.type }))]);
      setPicked(new Set());
      setMsg(`คัดลอกแล้ว ${chosen.length} ใบ (รวมเกณฑ์ประเมิน ${withRubric} ใบ, โครงข้อสอบ ${withItems} ใบ)`);
    } catch (e) {
      setError("คัดลอกไม่สำเร็จ: " + e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Link to={`/teacher/classroom/${classroomId}/subject/${subjectId}`} style={{ color: theme.accent, fontSize: 14 }}>
        &larr; กลับไปหน้าวิชา
      </Link>
      <h2 style={{ margin: "12px 0 4px", fontSize: 20 }}>คัดลอกใบงานจากห้องอื่น</h2>
      <p style={{ margin: "0 0 16px", color: theme.muted, fontSize: 13 }}>
        คัดลอกมาเป็นวิชา {subject?.name || "..."} ของห้องนี้ ไม่คัดลอกคะแนนนักเรียน
      </p>

      {loading && <p style={{ color: theme.muted }}>กำลังโหลดรายการห้องและวิชา...</p>}
      {error && <p style={{ color: theme.danger }}>{error}</p>}
      {msg && <p style={{ color: theme.success }}>{msg}</p>}

      {!loading && sources.length === 0 && !error && (
        <p style={{ color: theme.muted }}>ยังไม่มีห้องอื่นที่มีวิชาให้คัดลอก</p>
      )}

      {sources.length > 0 && (
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <h3 style={{ marginTop: 0, fontSize: 15 }}>1. เลือกวิชาต้นทาง</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select
              value={sourceKey}
              onChange={(e) => {
                setSourceKey(e.target.value);
                setItems(null);
              }}
              style={{ ...inputStyle, maxWidth: "100%" }}
            >
              {sources.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                  {s.same ? " (วิชาเดียวกัน)" : ""}
                </option>
              ))}
            </select>
            <button type="button" style={btnSecondary} onClick={loadItems} disabled={loadingItems}>
              {loadingItems ? "กำลังโหลด..." : "ดูใบงาน"}
            </button>
          </div>
        </div>
      )}

      {items !== null && (
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <h3 style={{ marginTop: 0, fontSize: 15 }}>2. เลือกใบงานที่จะคัดลอก</h3>
          {items.length === 0 ? (
            <p style={{ margin: 0, color: theme.muted }}>วิชาต้นทางยังไม่มีใบงาน</p>
          ) : (
            <>
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <button type="button" style={{ ...btnSecondary, padding: "4px 10px", fontSize: 13 }} onClick={() => setPicked(new Set(items.map((a) => a.id)))}>
                  เลือกทั้งหมด
                </button>
                <button type="button" style={{ ...btnSecondary, padding: "4px 10px", fontSize: 13 }} onClick={() => setPicked(new Set())}>
                  ไม่เลือกเลย
                </button>
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {items.map((a) => (
                  <label
                    key={a.id}
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "flex-start",
                      padding: "8px 10px",
                      border: `1px solid ${theme.border}`,
                      borderRadius: 10,
                      cursor: "pointer",
                    }}
                  >
                    <input type="checkbox" checked={picked.has(a.id)} onChange={() => toggle(a.id)} style={{ marginTop: 3 }} />
                    <span style={{ fontSize: 14 }}>
                      <b>{a.title}</b>{" "}
                      <span style={{ color: theme.muted }}>
                        [{typeLabel(a.type)}] เต็ม {a.maxScore} · ส่ง {a.dueDate || "-"}
                      </span>
                      <span style={{ display: "block", fontSize: 12, color: theme.muted }}>
                        {a.rubric ? "มีเกณฑ์ประเมิน" : ""}
                        {a.rubric && a.itemCfg ? " · " : ""}
                        {a.itemCfg ? "มีโครงข้อสอบ" : ""}
                        {isDup(a) && <span style={{ color: "#B45309" }}> {a.rubric || a.itemCfg ? "· " : ""}มีใบงานชื่อและประเภทเดียวกันในวิชานี้แล้ว</span>}
                      </span>
                    </span>
                  </label>
                ))}
              </div>

              <div style={{ marginTop: 14, fontSize: 14 }}>
                <label>
                  วันกำหนดส่งใหม่ (ใช้กับทุกใบที่คัดลอก){" "}
                  <input type="date" value={newDue} onChange={(e) => setNewDue(e.target.value)} style={{ ...inputStyle, marginLeft: 6 }} />
                </label>
                <div style={{ color: theme.muted, fontSize: 12, marginTop: 4 }}>เว้นว่างไว้ เพื่อใช้วันกำหนดส่งเดิมของแต่ละใบ แก้รายใบทีหลังได้ที่ปุ่ม "แก้ไข"</div>
              </div>

              <div style={{ marginTop: 14 }}>
                <button type="button" style={btnPrimary} onClick={copy} disabled={busy || picked.size === 0}>
                  {busy ? "กำลังคัดลอก..." : `คัดลอก ${picked.size} ใบมาที่วิชานี้`}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}