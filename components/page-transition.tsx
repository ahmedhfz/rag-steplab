"use client";

import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef } from "react";

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.dataset.page = "1";
    void element.offsetWidth;
    element.dataset.page = "2";
  }, [pathname]);
  // Only the current page is mounted: old lineage never survives an exit.
  return <div className="page-transition t-page-slide steplab-page-slide min-w-0" data-page="2" key={pathname} ref={ref}><div className="t-page" data-page-id="2">{children}</div></div>;
}
