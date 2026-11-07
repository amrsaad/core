import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ClipPage } from './ClipPage';
import { decodePayload } from '../share/link';
import '../design/fonts.css';
import '../design/tokens.css';
import '../components/components.css';
import '../components/clip.css';
import './clip-page.css';
import '../index.css';

// Eigener Eingang (clip.html, Brief 05): kein Service Worker, kein Schlüssel, kein Pool. Der Inhalt kommt nur aus dem Hash des Links.
const root = createRoot(document.getElementById('root')!);
// key am Hash: ein neuer Link in derselben Seite beginnt mit frischem Player, kein Stand vom vorigen Clip bleibt stehen
const render = () => root.render(<StrictMode><ClipPage key={location.hash} clip={decodePayload(location.hash)} /></StrictMode>);
render();
window.addEventListener('hashchange', render);
