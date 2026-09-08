/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated hook browser harness. */
import React, { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useCanvasSyncSupabase } from '../../lib/integrations/useCanvasSyncSupabase';
import { getCanvasSettings } from '../../lib/supabase/services';
import { controls } from './canvas-settings-boundary';

function Fixture() {
  const [owner, setOwner] = useState('alex');
  const result = useCanvasSyncSupabase({ userId: owner });
  useEffect(() => {
    (window as any).canvasFixture = { controls, getCanvasSettings, switchUser: setOwner, state: result };
  }, [result]);
  return <main><output data-testid="state">{JSON.stringify({ owner, loading: result.isLoading, error: result.error, url: result.settings.icalUrl, syncing: result.isSyncing })}</output>
    <button onClick={() => void result.syncNow()}>Sync</button></main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>);
