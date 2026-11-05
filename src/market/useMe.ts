// Shared "who am I on the marketplace" state (one request, many components).
import { useEffect, useState } from 'react';
import { market, MarketUser } from './api';

type State = { user: MarketUser | null; loaded: boolean; offline: boolean };
let state: State = { user: null, loaded: false, offline: false };
const subs = new Set<(s: State) => void>();
const set = (s: Partial<State>) => {
  state = { ...state, ...s };
  subs.forEach((f) => f(state));
};

let inflight: Promise<void> | null = null;
export function refreshMe(): Promise<void> {
  inflight ??= market
    .me()
    .then((user) => set({ user, loaded: true, offline: false }))
    .catch(() => set({ user: null, loaded: true, offline: true }))
    .finally(() => (inflight = null));
  return inflight;
}

export function setMe(user: MarketUser | null) {
  set({ user, loaded: true, offline: false });
}

export function useMe(): State {
  const [s, setS] = useState(state);
  useEffect(() => {
    subs.add(setS);
    if (!state.loaded) refreshMe();
    return () => void subs.delete(setS);
  }, []);
  return s;
}
