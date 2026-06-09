import React from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'react-hot-toast';
import App from './App';
import './styles.css';
import { useDocument } from './stores/document';
import { useTools } from './stores/tools';
import { useAnnotations } from './stores/annotations';
import { pdfjsLib } from './lib/pdfjs';

// Debug exposure for smoke tests and runtime diagnostics.
// Safe to ship — gives users a way to verify state via DevTools.
(window as any).__app = {
  stores: {
    document: useDocument,
    tools: useTools,
    annotations: useAnnotations,
  },
  pdfjs: pdfjsLib,
  version: '0.1.0',
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <Toaster
      position="bottom-right"
      toastOptions={{
        duration: 3500,
        style: {
          background: '#FFFFFF',
          color: '#0F1111',
          border: '1px solid #D5D9D9',
          boxShadow: '0 4px 12px rgba(15, 17, 17, 0.15)',
          fontSize: '14px',
        },
        success: { iconTheme: { primary: '#FF9900', secondary: '#fff' } },
        error: { iconTheme: { primary: '#C40000', secondary: '#fff' } },
      }}
    />
  </React.StrictMode>,
);
