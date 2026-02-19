// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import { useState, useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import Chat from "./pages/Chat.jsx";
import EditProfile from "./pages/EditProfile.jsx";
import Landing from "./pages/Landing.jsx";
import { getToken, getTheme } from "./services/storage.js";

export default function App() {
  const location = useLocation();
  const [token, setTokenState] = useState(getToken());
  const [theme, setThemeState] = useState(getTheme());
  const [displayLocation, setDisplayLocation] = useState(location);
  const [displayPath, setDisplayPath] = useState(
    `${location.pathname}${location.search}${location.hash}`
  );
  const [routeTransitionState, setRouteTransitionState] = useState("route-enter");

  const activePath = `${location.pathname}${location.search}${location.hash}`;

  useEffect(() => {
    const handleTokenChange = () => {
      setTokenState(getToken());
    };

    window.addEventListener("tokenchange", handleTokenChange);
    return () => window.removeEventListener("tokenchange", handleTokenChange);
  }, []);

  // Apply theme and react to theme changes
  useEffect(() => {
    function applyTheme(t) {
      if (t === "dark") document.documentElement.classList.add("theme-dark");
      else document.documentElement.classList.remove("theme-dark");
    }

    applyTheme(theme);

    const handleTheme = () => setThemeState(getTheme());
    window.addEventListener("themechange", handleTheme);
    return () => window.removeEventListener("themechange", handleTheme);
  }, [theme]);

  useEffect(() => {
    if (activePath === displayPath) return undefined;

    setRouteTransitionState("route-exit");

    const transitionTimer = window.setTimeout(() => {
      setDisplayLocation(location);
      setDisplayPath(activePath);
      setRouteTransitionState("route-enter");
    }, 170);

    return () => window.clearTimeout(transitionTimer);
  }, [activePath, displayPath, location]);

  return (
    <div className={`route-transition-root ${routeTransitionState}`}>
      <div key={displayPath} className="route-transition-view">
        <Routes location={displayLocation}>
          <Route path="/" element={<Navigate to={token ? "/chat" : "/welcome"} replace />} />
          <Route path="/welcome" element={token ? <Navigate to="/chat" replace /> : <Landing />} />
          <Route path="/login" element={token ? <Navigate to="/chat" replace /> : <Login />} />
          <Route path="/register" element={token ? <Navigate to="/chat" replace /> : <Register />} />
          <Route path="/chat" element={token ? <Chat /> : <Navigate to="/welcome" replace />} />
          <Route path="/profile/edit" element={token ? <EditProfile /> : <Navigate to="/welcome" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}

