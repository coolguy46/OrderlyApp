import { createRoot } from 'react-dom/client';
import Landing from '../../app/landing/page';
import Login from '../../app/auth/login/page';
import Register from '../../app/auth/register/page';
import Forgot from '../../app/auth/forgot-password/page';
import Reset from '../../app/auth/reset-password/page';
import Setup from '../../app/setup/page';
import Privacy from '../../app/privacy/page';
import Terms from '../../app/terms/page';
import { publicUiBoundary } from './public-ui-boundaries';

declare global { interface Window { publicUiFixture: typeof publicUiBoundary } }
window.publicUiFixture = publicUiBoundary;
const views = { landing: Landing, login: Login, register: Register, forgot: Forgot, reset: Reset, setup: Setup, privacy: Privacy, terms: Terms };
const view = new URLSearchParams(window.location.search).get('view') as keyof typeof views;
const Component = views[view] || Landing;
createRoot(document.getElementById('root')!).render(<Component />);
