import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getAuth } from "firebase/auth";
import { useAuth } from "../AuthContext";
import RetakeMath from "../RetakeMath";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";

const C = { bg: "#F7F3EC", card: "#fff", text: "#2B2B2B", muted: "#8A8A8A", border: "#EFE9DF", accent: "#3F7A6F", warn: "#B9631B", danger: "#C0392B" };
const NUM = /^-?\d+(\.\d{1,2})?$/;
const thaiToArabic = (s) => s.replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0e50));


async function callApi(path, body) {
  const user = getAuth().currentUser;
  if (!user) throw new Error("no-user");
  const token = await user.getIdToken();
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

const imgCache = new Map();
function loadRetakeImage(classroomId, imageId) {
  const key = `${classroomId}/${imageId}`;
  if (!imgCache.has(key)) {
    imgCache.set(
      key,
      getDoc(doc(db, "classrooms", classroomId, "retakeImages", imageId))
        .then((s) => (s.exists() ? s.data().data : null))
        .catch(() => { imgCache.delete(key); return null; })
    );
  }
  return imgCache.get(key);
}

function Img({ im, classroomId }) {
  const [src, setSrc] = useState(null);
  const [stage, setStage] = useState(0);
  useEffect(() => {
    let alive = true;
    if (im?.imageId) loadRetakeImage(classroomId, im.imageId).then((d) => alive && setSrc(d || "missing"));
    return () => { alive = false; };
  }, [im?.imageId, classroomId]);
  if (!im) return null;
  const style = { maxWidth: "100%", maxHeight: 320, display: "block", margin: "8px 0" };
  if (im.imageId) {
    if (!src) return <span style={{ color: C.muted }}>กำลังโหลดรูป...</span>;
    if (src === "missing") return <span style={{ color: C.danger }}>โหลดรูปไม่สำเร็จ</span>;
    return <img src={src} alt="" style={style} />;
  }
  if (im.fileId) {
    const urls = [
      `https://drive.google.com/thumbnail?id=${im.fileId}&sz=w800`,
      `https://lh3.googleusercontent.com/d/${im.fileId}=w800`,
    ];
    if (stage >= urls.length) return <a href={im.url} target="_blank" rel="noreferrer">เปิดรูป</a>;
    return <img src={urls[stage]} alt="" referrerPolicy="no-referrer" onError={() => setStage((s) => s + 1)} style={style} />;
  }
  return null;
}

const fmtTime = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

export default function StudentRetake() {
  const { examId } = useParams();
  const { claims } = useAuth();
  const storeKey = `retake_${claims?.classroomId}_${claims?.studentCode}_${examId}`;

  const [phase, setPhase] = useState("intro"); // intro | exam | done | blocked
  const [paper, setPaper] = useState(null);
  const [answers, setAnswers] = useState({});
  const [deadline, setDeadline] = useState(0);
  const [offset, setOffset] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState(null);
  const sentRef = useRef(false);
  const submitRef = useRef(null);

  function setAnswer(no, value) {
    setAnswers((old) => {
      const next = { ...old, [no]: value };
      try { localStorage.setItem(storeKey, JSON.stringify(next)); } catch { /* เก็บไม่ได้ก็ข้าม */ }
      return next;
    });
  }

  async function start() {
    setErr("");
    setBusy(true);
    try {
      const r = await callApi("/api/retakeStart", { examId });
      if (!r.ok) {
        setErr(r.data.message || "เริ่มสอบไม่สำเร็จ");
        if ([403, 409, 410].includes(r.status)) setPhase("blocked");
      } else {
        setPaper(r.data);
        setDeadline(Date.parse(r.data.deadlineAt));
        setOffset(Date.parse(r.data.serverNow) - Date.now());
        try {
          setAnswers(JSON.parse(localStorage.getItem(storeKey) || "{}"));
        } catch { /* ignore */ }
        setRemaining(Math.max(0, Math.floor((Date.parse(r.data.deadlineAt) - Date.parse(r.data.serverNow)) / 1000)));
        setPhase("exam");
      }
    } catch {
      setErr("เชื่อมต่อไม่ได้ ตรวจสอบอินเทอร์เน็ตหรือเข้าสู่ระบบใหม่");
    }
    setBusy(false);
  }

  async function submit(auto = false) {
    if (sentRef.current || !paper) return;
    const ans = { ...answers };
    if (!auto) {
      const bad = paper.items.filter((it) => it.type === "fill" && ans[it.no] && !NUM.test(ans[it.no]));
      if (bad.length) {
        return setErr(`ข้อ ${bad.map((b) => b.no).join(", ")}: ตอบเป็นจำนวนเต็มหรือทศนิยมไม่เกิน 2 ตำแหน่งเท่านั้น`);
      }
      const blank = paper.items.filter((it) => !ans[it.no]).length;
      const msg = blank
        ? `ยังไม่ได้ตอบ ${blank} ข้อ ต้องการส่งข้อสอบหรือไม่? ส่งแล้วแก้ไม่ได้`
        : "ต้องการส่งข้อสอบหรือไม่? ส่งแล้วแก้ไม่ได้";
      if (!window.confirm(msg)) return;
    } else {
      paper.items.forEach((it) => {
        if (it.type === "fill" && ans[it.no] && !NUM.test(ans[it.no])) delete ans[it.no];
      });
    }
    sentRef.current = true;
    setBusy(true);
    setErr("");
    try {
      const r = await callApi("/api/retakeSubmit", { examId, answers: ans });
      if (r.ok) {
        try { localStorage.removeItem(storeKey); } catch { /* ignore */ }
        setResult(r.data);
        setPhase("done");
      } else if ([409, 410].includes(r.status)) {
        setErr(r.data.message || "ส่งข้อสอบไม่ได้");
        setPhase("blocked");
      } else {
        sentRef.current = false;
        setErr(r.data.message || "ส่งไม่สำเร็จ ลองใหม่อีกครั้ง");
      }
    } catch {
      sentRef.current = false;
      setErr("ส่งไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่ (คำตอบยังอยู่ในเครื่อง)");
    }
    setBusy(false);
  }
  submitRef.current = submit;

  useEffect(() => {
    if (phase !== "exam") return;
    const t = setInterval(() => {
      const left = Math.max(0, Math.floor((deadline - (Date.now() + offset)) / 1000));
      setRemaining(left);
      if (left === 0) submitRef.current(true);
    }, 1000);
    return () => clearInterval(t);
  }, [phase, deadline, offset]);

  const wrap = (children) => (
    <div style={{ background: C.bg, minHeight: "100vh", fontFamily: "sans-serif" }}>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "20px 16px 80px" }}>{children}</div>
    </div>
  );
  const card = { background: C.card, borderRadius: 20, padding: "18px 16px", marginBottom: 14, boxShadow: "0 2px 10px rgba(0,0,0,0.04)" };
  const btn = { padding: "12px 24px", borderRadius: 999, border: "none", fontWeight: 700, fontSize: 15, cursor: "pointer", background: C.accent, color: "#fff" };

  if (phase === "intro") {
    return wrap(
      <div style={card}>
        <h2 style={{ marginTop: 0 }}>ข้อสอบซ่อม</h2>
        <ul style={{ lineHeight: 1.9, paddingLeft: 20 }}>
          <li>กดเริ่มแล้ว <b>เวลาจะเดินทันที</b> และไม่หยุดแม้ปิดหน้าจอ</li>
          <li>ส่งข้อสอบได้ <b>ครั้งเดียว</b> หมดเวลาระบบส่งให้อัตโนมัติ</li>
          <li>ข้อเติมคำตอบ ตอบเป็น <b>จำนวนเต็ม หรือทศนิยม 2 ตำแหน่ง</b> เท่านั้น</li>
          <li>คำตอบถูกเก็บไว้ในเครื่อง ถ้าหน้าจอหลุดให้เปิดกลับมาทำต่อได้ภายในเวลาเดิม</li>
        </ul>
        {err && <p style={{ color: C.danger }}>{err}</p>}
        <button style={btn} onClick={start} disabled={busy}>{busy ? "กำลังโหลด..." : "เริ่มทำข้อสอบ"}</button>{" "}
        <Link to="/student" style={{ color: C.muted }}>กลับ</Link>
      </div>
    );
  }

  if (phase === "blocked") {
    return wrap(
      <div style={card}>
        <p style={{ color: C.danger, fontWeight: 700 }}>{err || "ไม่สามารถทำข้อสอบนี้ได้"}</p>
        <Link to="/student" style={{ color: C.accent }}>กลับหน้าหลัก</Link>
      </div>
    );
  }

  if (phase === "done") {
    return wrap(
      <div style={card}>
        <h2 style={{ marginTop: 0 }}>ส่งข้อสอบแล้ว</h2>
        <p style={{ fontSize: 18 }}>
          ได้ <b>{result.earned}</b> / {result.totalScore} คะแนน (ตอบถูก {result.correct} จาก {result.count} ข้อ)
        </p>
        <Link to="/student" style={{ color: C.accent }}>กลับหน้าหลัก</Link>
      </div>
    );
  }

  return wrap(
    <>
      <div style={{ position: "sticky", top: 0, background: C.bg, padding: "8px 0", zIndex: 5, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <b>{paper.title} (ชุด {paper.setLabel})</b>
        <b style={{ color: remaining <= 300 ? C.danger : C.text, fontSize: 18 }}>⏱ {fmtTime(remaining)}</b>
      </div>

      {paper.items.map((it) => {
        const val = answers[it.no] ?? "";
        const badFill = it.type === "fill" && val && !NUM.test(val);
        return (
          <div key={it.no} style={card}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>ข้อ {it.no} <small style={{ color: C.muted, fontWeight: 400 }}>({it.score} คะแนน)</small></div>
            <div><RetakeMath text={it.stem} /></div>
            {(it.images || []).map((im, k) => <Img key={k} im={im} classroomId={claims?.classroomId} />)}

            {it.type === "mcq" &&
              it.choices.map((c) => (
                <label key={c.label} style={{ display: "block", padding: "8px 10px", margin: "6px 0", border: `1px solid ${val === c.label ? C.accent : C.border}`, borderRadius: 10, background: val === c.label ? "#EAF4F1" : "#fff", cursor: "pointer" }}>
                  <input type="radio" name={`q${it.no}`} checked={val === c.label} onChange={() => setAnswer(it.no, c.label)} />{" "}
                  <b>{c.label}.</b> <RetakeMath text={c.text} />
                  <Img im={c.image} classroomId={claims?.classroomId} />
                </label>
              ))}

            {it.type === "fill" && (
              <div style={{ marginTop: 10 }}>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="คำตอบ (จำนวนเต็ม หรือทศนิยม 2 ตำแหน่ง)"
                  value={val}
                  onChange={(e) => setAnswer(it.no, thaiToArabic(e.target.value).replace(/[^0-9.\-]/g, ""))}
                  style={{ width: "100%", boxSizing: "border-box", padding: 10, fontSize: 16, borderRadius: 10, border: `1px solid ${badFill ? C.danger : C.border}` }}
                />
                {badFill && <div style={{ color: C.danger, fontSize: 13, marginTop: 4 }}>ตอบเป็นจำนวนเต็มหรือทศนิยมไม่เกิน 2 ตำแหน่ง</div>}
              </div>
            )}
          </div>
        );
      })}

      {err && <p style={{ color: C.danger }}>{err}</p>}
      <button style={btn} onClick={() => submit(false)} disabled={busy}>{busy ? "กำลังส่ง..." : "ส่งข้อสอบ"}</button>
    </>
  );
}