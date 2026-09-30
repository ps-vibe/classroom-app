import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import { theme, cardStyle, btnPrimary, btnSecondary, btnDanger, inputStyle } from "../theme";
import { deleteSubjectCascade } from "../deleteUtils";

export default function ClassroomDetail() {
  const { classroomId } = useParams();
  const [room, setRoom] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState(null);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    getDoc(doc(db, "classrooms", classroomId)).then((snap) => {
      if (snap.exists()) setRoom({ id: snap.id, ...snap.data() });
    });
  }, [classroomId]);

  useEffect(() => {
    const q = query(collection(db, "classrooms", classroomId, "subjects"), orderBy("name"));
    const unsub = onSnapshot(
      q,
      (snap) => setSubjects(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setError("โหลดข้อมูลวิชาไม่สำเร็จ")
    );
    return unsub;
  }, [classroomId]);

  const addSubject = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await addDoc(collection(db, "classrooms", classroomId, "subjects"), {
        name: name.trim(),
        code: code.trim(),
        createdAt: serverTimestamp(),
      });
      setName("");
      setCode("");
    } catch {
      setError("เพิ่มวิชาไม่สำเร็จ");
    }
  };

  const editSubject = async (subject) => {
    const newName = window.prompt("ชื่อวิชา:", subject.name);