import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) return <p>กำลังโหลด...</p>;
  if (!user) return <Navigate to="/teacher/login" replace />;

  return children;
}