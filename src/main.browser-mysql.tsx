import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { BrowserRouter } from 'react-router-dom';
import AppMySQL from "./App.mysql";

// This is a completely browser-safe entry point with no Node.js dependencies

console.log('Starting application with browser-safe MySQL implementation');

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true
      }}
    >
      <AppMySQL />
    </BrowserRouter>
  </React.StrictMode>
);
