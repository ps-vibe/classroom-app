import { Routes, Route, Navigate } from "react-router-dom";
import ProtectedRoute from "./ProtectedRoute";
import TeacherLogin from "./pages/TeacherLogin";
import TeacherHome from "./pages/TeacherHome";

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
      />
      <Route path="*" element={<Navigate to="/teacher/login" replace />} />
    </Routes>
  );
}