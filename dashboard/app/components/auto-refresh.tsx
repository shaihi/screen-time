"use client";

import { useEffect } from "react";

export function AutoRefresh() {
  useEffect(() => {
    const id = window.setInterval(() => window.location.reload(), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return null;
}

