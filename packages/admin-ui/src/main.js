import { jsx as _jsx } from "react/jsx-runtime";
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
ReactDOM.createRoot(root).render(_jsx(React.StrictMode, { children: _jsx(App, {}) }));
//# sourceMappingURL=main.js.map