import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import App from './App';
import './styles/app.css';
import './styles/market.css';
import './styles/editor.css';

createRoot(document.getElementById('root')!).render(<App />);
