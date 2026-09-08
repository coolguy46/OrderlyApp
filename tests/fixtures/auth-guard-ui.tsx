import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthGuard } from '../../components/auth/AuthGuard';

createRoot(document.getElementById('root')!).render(
  <StrictMode><AuthGuard><h1>Protected application content</h1></AuthGuard></StrictMode>,
);
