import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import Landing from "./Landing.jsx";
import "./styles.css";

function Root() {
  const [route, setRoute] = useState(window.location.hash === "#/app" ? "app" : "landing");
  useEffect(() => {
    const onHash = () => setRoute(window.location.hash === "#/app" ? "app" : "landing");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);
  const goApp = () => { window.location.hash = "#/app"; };
  const goHome = () => { window.location.hash = ""; };
  return route === "app" ? <App go={goHome} /> : <Landing go={goApp} />;
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
