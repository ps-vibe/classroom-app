import { Routes, Route, Navigate } from "react-router-dom";
import ProtectedRoute from "./ProtectedRoute";
import StudentProtectedRoute from "./StudentProtectedRoute";
import TeacherLogin from "./pages/TeacherLogin";
import TeacherHome from "./pages/TeacherHome";
import Classrooms from "./pages/Classrooms";
import ClassroomDetail from "./pages/ClassroomDetail";
import SubjectDetail from "./pages/SubjectDetail";
import Students from "./pages/Students";
import ScoreEntry from "./pages/ScoreEntry";
import ExamItems from "./pages/ExamItems";
import RetakeSetup from "./pages/RetakeSetup";
import StudentRetake from "./pages/StudentRetake";
import ExamItemScores from "./pages/ExamItemScores";
import RubricLibrary from "./pages/RubricLibrary";
import RubricSetup from "./pages/RubricSetup";
import RubricScoring from "./pages/RubricScoring";
import OrphanCleanup from "./pages/OrphanCleanup";
import ExamAnalysis from "./pages/ExamAnalysis";
import CopyAssignments from "./pages/CopyAssignments";
import BackupExport from "./pages/BackupExport";
import AtRiskStudents from "./pages/AtRiskStudents";
import ClassroomImport from "./pages/ClassroomImport";

import AttendanceEntry from "./pages/AttendanceEntry";
import AttendanceQR from "./pages/AttendanceQR";
import AttendanceSummary from "./pages/AttendanceSummary";
import StudentLogin from "./pages/StudentLogin";
import StudentHome from "./pages/StudentHome";
import StudentScan from "./pages/StudentScan";
import Landing from "./pages/Landing";


// "teacher" = เว็บครู, "student" = เว็บนักเรียน, ไม่ตั้งค่า = แสดงทั้งสองฝั่ง (ใช้ตอนทดสอบบนเครื่อง)
const MODE = import.meta.env.VITE_APP_MODE;
const showTeacher = MODE !== "student";
const showStudent = MODE !== "teacher";
const home = MODE === "teacher" ? "/teacher/login" : MODE === "student" ? "/student/login" : "/";

export default function App() {
  return (
    <Routes>
      {showTeacher && <Route path="/teacher/login" element={<TeacherLogin />} />}
      {showTeacher && (
        <Route
          path="/teacher"
          element={
            <ProtectedRoute>
              <TeacherHome />
            </ProtectedRoute>
          }
        >
          <Route index element={<Classrooms />} />
          <Route path="classroom/:classroomId" element={<ClassroomDetail />} />
          <Route path="classroom/:classroomId/students" element={<Students />} />
          <Route path="classroom/:classroomId/subject/:subjectId" element={<SubjectDetail />} />
          <Route path="classroom/:classroomId/subject/:subjectId/attendance"  element={<AttendanceEntry />} />
          <Route path="classroom/:classroomId/subject/:subjectId/attendance/qr" element={<AttendanceQR />} />
          <Route path="classroom/:classroomId/subject/:subjectId/attendance/summary" element={<AttendanceSummary />} />
          <Route path="classroom/:classroomId/subject/:subjectId/assignment/:assignmentId/scores" element={<ScoreEntry />} />
          <Route path="classroom/:classroomId/subject/:subjectId/assignment/:assignmentId/items" element={<ExamItems />} />
          <Route path="classroom/:classroomId/subject/:subjectId/assignment/:assignmentId/item-scores" element={<ExamItemScores />} />
          <Route path="rubric-criteria" element={<RubricLibrary />} />
          <Route path="classroom/:classroomId/subject/:subjectId/assignment/:assignmentId/rubric"  element={<RubricSetup />} />
          <Route path="classroom/:classroomId/subject/:subjectId/assignment/:assignmentId/rubric-scoring" element={<RubricScoring />} />
          <Route path="cleanup" element={<OrphanCleanup />} />
          <Route path="classroom/:classroomId/subject/:subjectId/assignment/:assignmentId/analysis" element={<ExamAnalysis />} />
          <Route path="classroom/:classroomId/subject/:subjectId/copy-assignments" element={<CopyAssignments />} />
          <Route path="backup" element={<BackupExport />} />
          <Route path="classroom/:classroomId/risk" element={<AtRiskStudents />} />
          <Route path="classroom/:classroomId/gc-import" element={<ClassroomImport />} />
          
          <Route path="classroom/:classroomId/subject/:subjectId/assignment/:assignmentId/retake" element={<RetakeSetup />} />

        </Route>
      )}

      {showStudent && <Route path="/student/login" element={<StudentLogin />} />}
      {showStudent && (
        <Route
          path="/student/scan"
          element={
            <StudentProtectedRoute>
              <StudentScan />
            </StudentProtectedRoute>
          }
        />
      )}
      {showStudent && (
        <Route
          path="/student"
          element={
            <StudentProtectedRoute>
              <StudentHome />
            </StudentProtectedRoute>
          }
        />
      )}

            {showStudent && (
        <Route
          path="/student/retake/:examId"
          element={
            <StudentProtectedRoute>
              <StudentRetake />
            </StudentProtectedRoute>
          }
        />
      )}

      <Route path="/" element={MODE ? <Navigate to={home} replace /> : <Landing />} />
      <Route path="*" element={<Navigate to={home} replace />} />
    </Routes>
  );
}