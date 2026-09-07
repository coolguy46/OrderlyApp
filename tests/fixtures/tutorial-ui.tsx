import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Header } from '../../components/layout/Header';
import { TutorialProvider, TutorialInvitation } from '../../components/tutorial/Tutorial';
import CanvasGuide from '../../components/tutorial/CanvasGuide';
import { tutorialBoundary, useAppStore } from './tutorial-ui-runtime';

function Harness() {
  const [userId, setUserId] = useState('tutorial-test-alex');
  const [counter, setCounter] = useState(0);
  const [showCanvasGuide, setShowCanvasGuide] = useState(false);
  Object.assign(window, { tutorialFixture: {
    ...tutorialBoundary,
    switchUser: (id: string) => {
      useAppStore.setState({ user: { ...useAppStore.getState().user, id } });
      setUserId(id);
    },
  } });
  return <TutorialProvider userId={userId}>
    <Header />
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <TutorialInvitation />
      <h1 className="text-2xl font-semibold">Fictional tutorial test account</h1>
      <p>This fixture has no backend connection. Tutorial clicks must not modify its records.</p>
      <button className="rounded-lg border px-4 py-2" onClick={() => setCounter(value => value + 1)}>
        Ordinary page action: {counter}
      </button>
      <button className="ml-2 rounded-lg border px-4 py-2" onClick={() => setShowCanvasGuide(value => !value)}>
        Fixture Canvas instructions
      </button>
      {showCanvasGuide && <section aria-label="Canvas connection instructions"><CanvasGuide /></section>}
    </main>
  </TutorialProvider>;
}

createRoot(document.getElementById('root')!).render(<Harness />);
