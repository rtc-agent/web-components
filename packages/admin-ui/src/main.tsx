/**
 * Application Entry Point
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '@/App';
import '@/global.css';

// Import RTC Agent component (side-effect: registers custom element)
import '@rtc-agent/component';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element not found: #root');
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
