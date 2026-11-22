import { useEffect, useState } from 'react';

import {
  createTodayMemory,
  loadTodayLocations,
  refreshToday,
  type TodayLocation,
  type TodayState,
} from '@/lib/reports/today';
import { session, type Me } from '@/lib/session';

/** Server data of "Hoy" lives only in this process memory (never persisted: that is SP5). */
const memory = createTodayMemory();
const lastLocations = new Map<string, TodayLocation[]>();

// A session that ends (logout, revocation) takes its server data with it.
session.subscribe(() => {
  if (session.getState().status === 'signedOut') {
    memory.clear();
    lastLocations.clear();
  }
});

export type TodayLocationsState =
  | { status: 'loading' }
  | { status: 'ready'; locations: TodayLocation[]; offline: boolean }
  | { status: 'offline' };

export function useTodayReport(me: Me) {
  const userId = me.user.id;
  const [locations, setLocations] = useState<TodayLocationsState>(() => {
    const last = lastLocations.get(userId);
    return last ? { status: 'ready', locations: last, offline: false } : { status: 'loading' };
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [state, setState] = useState<TodayState>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    void loadTodayLocations(session.api, me).then((result) => {
      if (!active) return;
      if (result.ok) {
        lastLocations.set(userId, result.locations);
        // Without a location there is no report to wait for.
        if (result.locations.length === 0) setRefreshing(false);
        setLocations({ status: 'ready', locations: result.locations, offline: false });
        return;
      }
      const last = lastLocations.get(userId);
      if (!last) setRefreshing(false);
      setLocations(last ? { status: 'ready', locations: last, offline: true } : { status: 'offline' });
    });
    return () => {
      active = false;
    };
  }, [me, userId, reload]);

  const available = locations.status === 'ready' ? locations.locations : [];
  const selected = available.find((l) => l.id === selectedId) ?? available[0] ?? null;

  useEffect(() => {
    if (!selected) return;
    let active = true;
    setState((current) => (current.status === 'ready' ? current : { status: 'loading' }));
    void refreshToday(session.api, memory, userId, selected)
      .then((next) => {
        if (active) setState(next);
      })
      .finally(() => {
        if (active) setRefreshing(false);
      });
    return () => {
      active = false;
    };
    // `selected` is a fresh object on every render; its id and permission decide the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.canViewLocation, userId, reload]);

  return {
    locations,
    selected,
    select: (id: string) => {
      setState({ status: 'loading' });
      setSelectedId(id);
    },
    state,
    refreshing,
    refresh: () => {
      setRefreshing(true);
      setReload((n) => n + 1);
    },
  };
}
