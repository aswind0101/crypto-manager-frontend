// lib/withSalonAuth.js
import { useEffect, useState } from "react";
import { useRouter } from "next/router";

export default function withSalonAuth(WrappedComponent) {
  return function ProtectedRoute(props) {
    const router = useRouter();
    const [isAuthenticated, setIsAuthenticated] = useState(false);

    useEffect(() => {
      const token = localStorage.getItem("salon_token");  // 👈 check salon_token
      if (!token) {
        router.replace("/salon-login");  // 👈 nếu không có → redirect về salon-login
      } else {
        setIsAuthenticated(true);
      }
    }, []);

    if (!isAuthenticated) {
      return null;
    }

    return <WrappedComponent {...props} />;
  };
}
