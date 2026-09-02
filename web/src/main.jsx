import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import Landing from "./Landing.jsx";
import "./styles.css";

// Routes: "" landing, "#/app" the product, "#/m/<id>" a shared challenge.
function parse() {
  const h = window.location.hash;
  const m = h.match(/^#\/m\/(\d+)$/);
  if (m) return { route: "app", focus: Number(m[1]) };
  if (h === "#/app") return { route: "app", focus: null };
  return { route: "landing", focus: null };
}

function Root() {
  const [state, setState] = useState(parse);
  useEffect(() => {
    const onHash = () => setState(parse());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [state.route]);

  const goApp = () => {
    window.location.hash = "#/app";
  };
  const goHome = () => {
    window.location.hash = "";
  };

  return state.route === "app" ? <App go={goHome} focusId={state.focus} /> : <Landing go={goApp} />;
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
