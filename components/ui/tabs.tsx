"use client";

import { createContext, useContext, type ReactNode } from "react";
import {
  Tab as AriaTab,
  TabList as AriaTabList,
  TabPanel as AriaTabPanel,
  Tabs as AriaTabs,
  type TabListProps as AriaTabListProps,
  type TabPanelProps as AriaTabPanelProps,
  type TabProps as AriaTabProps,
  type TabsProps as AriaTabsProps,
} from "react-aria-components";

import { AppIcon, type SemanticIconName } from "@/components/ui/app-icon";
import { useSlidingIndicator } from "@/components/ui/use-sliding-indicator";
import { cn } from "@/lib/utils";

/*
 * Tabs — Untitled UI React `components/application/tabs/tabs.tsx` (MIT) on React Aria Tabs
 * (role="tablist"/"tab"/"tabpanel", arrow keys, aria-controls). The selection indicator slides
 * between tabs (useSlidingIndicator + transitions.dev tab timing). Horizontal only.
 *  - `underline`: page-level sections (brand underline = "you are here").
 *  - `pill`: compact in-panel switching on a tinted track.
 * For a form-like single choice (theme, strategy) use SegmentedControl instead.
 */

export type TabsType = "underline" | "pill";

const TabsTypeContext = createContext<{ type: TabsType; size: "sm" | "md" }>({ type: "underline", size: "sm" });

export function Tabs({ className, ...props }: AriaTabsProps) {
  return <AriaTabs {...props} className={(state) => cn("flex w-full flex-col", state.orientation === "vertical" && "flex-row", typeof className === "function" ? className(state) : className)} />;
}

export type TabListProps<T extends object> = AriaTabListProps<T> & {
  type?: TabsType;
  size?: "sm" | "md";
  fullWidth?: boolean;
};

export function TabList<T extends object>({ type = "underline", size = "sm", fullWidth, className, ...props }: TabListProps<T>) {
  const { containerRef, indicatorRef } = useSlidingIndicator<HTMLDivElement>('[role="tab"][aria-selected="true"]', type === "underline" ? "underline" : "fill");
  return (
    <TabsTypeContext.Provider value={{ type, size }}>
      <div
        className={cn(
          "relative",
          type === "underline" && "before:absolute before:inset-x-0 before:bottom-0 before:h-px before:bg-border-secondary",
          type === "pill" && "w-fit max-w-full rounded-lg bg-tertiary p-0.5 ring-1 ring-secondary ring-inset dark:bg-secondary_alt",
          fullWidth && "w-full",
        )}
        ref={containerRef}
      >
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute top-0 left-0 opacity-0 transition-[translate,width,opacity] duration-(--tabs-dur) ease-(--tabs-ease)",
            type === "underline" ? "rounded-full bg-fg-brand-primary" : "rounded-md bg-primary shadow-sm ring-1 ring-secondary_alt dark:bg-quaternary",
          )}
          ref={indicatorRef}
        />
        <AriaTabList
          {...props}
          className={(state) =>
            cn(
              "relative flex",
              type === "underline" ? "gap-4" : "gap-0.5",
              state.orientation === "vertical" && "flex-col",
              typeof className === "function" ? className(state) : className,
            )
          }
        />
      </div>
    </TabsTypeContext.Provider>
  );
}

export type TabProps = Omit<AriaTabProps, "children"> & {
  children: ReactNode;
  icon?: SemanticIconName;
  /** Count shown after the label (tabular). */
  badge?: number | string;
};

export function Tab({ children, icon, badge, className, ...props }: TabProps) {
  const { type, size } = useContext(TabsTypeContext);
  const underline = type === "underline";
  return (
    <AriaTab
      {...props}
      className={(state) =>
        cn(
          "group/tab relative z-10 flex cursor-pointer items-center justify-center gap-1.5 font-semibold whitespace-nowrap text-quaternary outline-none select-none",
          "transition-colors duration-150 ease-out hover:text-secondary data-selected:text-primary",
          "data-focus-visible:outline-2 data-focus-visible:outline-focus-ring data-disabled:cursor-not-allowed data-disabled:text-disabled",
          size === "md" ? "text-md" : "text-sm",
          underline ? cn("rounded-sm pb-2.5", size === "md" ? "pt-1" : "pt-0.5", "data-selected:text-brand-secondary data-focus-visible:outline-offset-2") : cn("rounded-md px-3 data-focus-visible:-outline-offset-2", size === "md" ? "h-9" : "h-8", "text-tertiary"),
          typeof className === "function" ? className(state) : className,
        )
      }
    >
      {icon ? <AppIcon className="size-4 shrink-0 text-fg-quaternary transition-colors group-data-selected/tab:text-current" name={icon} /> : null}
      {children}
      {badge !== undefined ? (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-utility-gray-50 px-1.5 text-xs font-medium text-utility-gray-700 tabular-nums ring-1 ring-utility-gray-200 ring-inset group-data-selected/tab:bg-utility-brand-50 group-data-selected/tab:text-utility-brand-700 group-data-selected/tab:ring-utility-brand-200">
          {badge}
        </span>
      ) : null}
    </AriaTab>
  );
}

export function TabPanel({ className, ...props }: AriaTabPanelProps) {
  return <AriaTabPanel {...props} className={(state) => cn("outline-none data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-focus-ring", typeof className === "function" ? className(state) : className)} />;
}
