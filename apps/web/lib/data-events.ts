"use client";

/**
 * Lightweight app-wide data change bus (no extra deps).
 * CRM mutations call emitDataChanged(); dashboards/lists subscribe.
 */

import { useEffect, useState } from "react";

export type DataChangeEvent = {
  module:
    | "contact"
    | "deal"
    | "task"
    | "meeting"
    | "document"
    | "finance"
    | "notification"
    | "all";
  action?: "create" | "update" | "delete" | "import" | "refresh";
};

type Listener = (event: DataChangeEvent) => void;

const listeners = new Set<Listener>();

export function emitDataChanged(event: DataChangeEvent = { module: "all" }) {
  listeners.forEach((fn) => {
    try {
      fn(event);
    } catch {
      /* ignore subscriber errors */
    }
  });
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new CustomEvent("mm-data-changed", { detail: event }));
    } catch {
      /* ignore */
    }
  }
}

export function subscribeDataChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React hook: version increments on any CRM/data mutation */
export function useDataVersion(filterModule?: DataChangeEvent["module"]): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    return subscribeDataChanged((ev) => {
      if (
        !filterModule ||
        filterModule === "all" ||
        ev.module === "all" ||
        ev.module === filterModule
      ) {
        setVersion((v) => v + 1);
      }
    });
  }, [filterModule]);
  return version;
}
