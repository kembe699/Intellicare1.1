import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';

// Import ONLY the browser-safe MySQL app version
import AppMySQL from './App.mysql';

console.log('Starting clean MySQL application without any Sequelize imports');

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true
      }}
    >
      <AppMySQL />
      <Toaster />
    </BrowserRouter>
  </React.StrictMode>
);
