import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase";
import { parseStudentRows } from "../utils";
import { deleteStudentCascade } from "../deleteUtils";
import { theme, cardStyle, btnPrimary, btnSecondary, btnDanger, inputStyle } from "../theme";

const emptyForm = { no: "", studentCode: "", prefix: "", firstName: "", lastName: "" };

export default function Students() {
  const { classroomId } = useParams();
  const [room, setRoom] = useState(null);
  const [students, setStudents] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    getDoc(doc(db, "classrooms", classroomId)).then((snap) => {
      if (snap.exists()) setRoom(snap.data());
    });
  }, [classroomId]);

  useEffect(() => {
    const q = query(collection(db, "classrooms", classroomId, "students"), orderBy("no"));
    const unsub = onSnapshot(
      q,
      (snap) => setStudents(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setError("โหลดรายชื่อนักเรียนไม่สำเร็จ")
    );
    return unsub;
  }, [classroomId]);

  const change = (field) => (e) => setForm({ ...form, [field]: e.target.value });
  const resetForm = () => {
    setForm(emptyForm);
    setEditing(false);
  };

  const saveOne = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");
    const code = form.studentCode.trim();
    if (code.includes("/")) {
      setError("รหัสประจำตัวห้ามมีเครื่องหมาย /");
      return;
    }
    const exists = students.some((s) => s.id === code);
    if (exists && !editing) {
      setError(`รหัส ${code} มีอยู่ในห้องนี้แล้ว`);
      return;
    }
    try {
      await setDoc(doc(db, "classrooms", classroomId, "students", code), {
        no: Number(form.no) || 0,
        studentCode: code,
        prefix: form.prefix.trim(),
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
      });
      resetForm();
    } catch {
      setError("บันทึกไม่สำเร็จ");
    }
  };

  const startEdit = (s) => {
    setEditing(true);
    setForm({
      no: String(s.no),
      studentCode: s.studentCode,
      prefix: s.prefix,
      firstName: s.firstName,
      lastName: s.lastName,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const remove = async (s) => {
    if (
      !window.confirm(
        `ลบ ${s.prefix}${s.firstName} ${s.lastName} ใช่หรือไม่? คะแนนและการเช็คคาบเรียนของนักเรียนคนนี้จะถูกลบไปด้วย`
      )
    )
      return;
    setDeletingId(s.id);
    try {
      await deleteStudentCascade(classroomId, s.id);
    } catch (err) {
      console.error("delete student error:", err);
      alert("ลบนักเรียนไม่สำเร็จ: " + err.message);
    } finally {
      setDeletingId(null);
    }
  };

  const parsed = useMemo(() => parseStudentRows(bulkText), [bulkText]);
  const existingIds = useMemo(() => new Set(students.map((s) => s.id)), [students]);
  const updateCount = parsed.rows.filter((r) => existingIds.has(r.studentCode)).length;
  const newCount = parsed.rows.length - updateCount;

  const loadCsvFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setBulkText(String(reader.result));
    reader.readAsText(file, "UTF-8");
    e.target.value = "";
  };

  const importAll = async () => {
    setError("");
    setMessage("");
    if (parsed.rows.length === 0) return;
    setBusy(true);
    try {
      for (let i = 0; i < parsed.rows.length; i += 400) {
        const batch = writeBatch(db);
        parsed.rows.slice(i, i + 400).forEach((r) => {
          batch.set(doc(db, "classrooms",