import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { Preview } from './design/Preview';
import './design/fonts.css';
import './design/tokens.css';
import './components/components.css';
import './components/feed.css';
import './components/sheets.css';
import './components/saved.css';
import './components/settings.css';
import './components/clip.css';
import './components/desk.css';
import './index.css';

registerSW({ immediate: true });

const design = new URLSearchParams(location.search).get('design');
createRoot(document.getElementById('root')!).render(<StrictMode>{design ? <Preview which={design} /> : <App />}</StrictMode>);
