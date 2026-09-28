import { Routes, Route, Navigate } from "react-router-dom";
import ProtectedRoute from "./ProtectedRoute";
import TeacherLogin from "./pages/TeacherLogin";
import TeacherHome from "./pages/TeacherHome";
import Classrooms from "./pages/Classrooms";
import ClassroomDetail from "./pages/ClassroomDetail";
import SubjectDetail from "./pages/SubjectDetail";
import Students from "./pages/Students";
import ScoreEntry from "./pages/ScoreEntry";

export default function App() {
  return (
    <Routes>
      <Route path="/teacher/login" element={<TeacherLogin />} />
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
        <Route
          path="classroom/:classroomId/subject/:subjectId"
          element={<SubjectDetail />}       />

          <Route path="classroom/:classroomId/students" element={<Students />} />
        
        <Route
  path="classroom/:classroomId/subject/:subjectId/assignment/:assignmentId/scores"
  element={<ScoreEntry />}
/>
      </Route>
      <Route path="*" element={<Navigate to="/teacher/login" replace />} />
    </Routes>
  );
}