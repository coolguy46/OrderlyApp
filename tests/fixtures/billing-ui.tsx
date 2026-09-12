import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BillingPanel } from '../../components/billing/BillingPanel';
import { AssistantSubscriptionGate } from '../../components/billing/AssistantSubscriptionGate';
function Fixture() {
  const [saved, setSaved] = useState(false);
  const [undone, setUndone] = useState(false);
  return <main className="mx-auto max-w-6xl p-4"><h1 className="text-2xl mb-5">Assistant</h1>{location.search.includes('gate')
    ? <><AssistantSubscriptionGate recoveryActions={<button onClick={() => setUndone(true)}>Undo previous change</button>}><div><p>AI chat available</p><input aria-label="Private AI message" /><button>Send AI message</button></div></AssistantSubscriptionGate><section aria-label="Free calendar" className="workspace-panel mt-5 p-5"><p>Free calendar available</p><button onClick={() => setSaved(true)}>Create manual task</button>{saved && <p>Manual task saved</p>}{undone && <p>Previous change undone</p>}</section></>
    : <BillingPanel returnState={new URLSearchParams(location.search).get('checkout') || ''} />}</main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
