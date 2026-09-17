"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const STORAGE_KEY = "screen-time-include-unattended";

const UsageMode = createContext<{ include: boolean; setInclude: (value: boolean) => void }>({
  include: false,
  setInclude: () => {},
});

export const useUsageMode = () => useContext(UsageMode);

/** Remembers whether unattended time counts towards the headline number. */
export function UsageModeProvider({ children }: { children: ReactNode }) {
  const [include, setInclude] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Reading localStorage must wait until after hydration, so the first render matches the server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInclude(window.localStorage.getItem(STORAGE_KEY) === "true");
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) window.localStorage.setItem(STORAGE_KEY, String(include));
  }, [include, loaded]);

  return <UsageMode.Provider value={{ include, setInclude }}>{children}</UsageMode.Provider>;
}

export function UnattendedSwitch() {
  const { include, setInclude } = useUsageMode();
  return (
    <label className="switch">
      <input type="checkbox" checked={include} onChange={(event) => setInclude(event.target.checked)} />
      <span className="track" aria-hidden="true"><span className="knob" /></span>
      Count unattended as usage
    </label>
  );
}
