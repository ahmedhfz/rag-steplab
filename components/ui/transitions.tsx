"use client";

import { Children, cloneElement, createElement, isValidElement, useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type HTMLAttributes, type ReactNode, type RefObject } from "react";

import { cn } from "@/lib/utils";
import { enterTransition, reduceTransitions, revealPanel, transitionMs } from "@/lib/transitions";

export function TransitionText({ children, className }: { children: string | number | null; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (ref.current) enterTransition(ref.current, "is-enter-start");
  }, [children]);
  return <span className={cn("t-text-swap", className)} ref={ref}>{children}</span>;
}

export function ThinkingText({ children }: { children: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (ref.current) enterTransition(ref.current, "is-enter-start");
  }, [children]);
  return <span className="t-think steplab-thinking"><span aria-hidden="true" className="t-think-sizer">{children}</span><span className="t-think-text" data-text={children} ref={ref}>{children}</span></span>;
}

export function TransitionNumber({ children }: { children: string | number }) {
  const value = String(children);
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.classList.remove("is-animating");
    if (reduceTransitions()) return;
    void element.offsetWidth;
    element.classList.add("is-animating");
  }, [value]);
  return <span className="t-digit-group" ref={ref}><span className="sr-only">{value}</span><span aria-hidden="true">{Array.from(value).map((digit, index) => <span className="t-digit" data-stagger={Math.min(index, 2)} key={index}>{digit}</span>)}</span></span>;
}

export function IconSwap({ active, first, second }: { active: boolean; first: ReactNode; second: ReactNode }) {
  return <span aria-hidden="true" className="t-icon-swap" data-state={active ? "b" : "a"}><span className="t-icon" data-icon="a">{first}</span><span className="t-icon" data-icon="b">{second}</span></span>;
}

export function SuccessCheck({ className }: { className?: string }) {
  const ref = useRef<SVGPathElement>(null);
  useLayoutEffect(() => {
    const path = ref.current;
    if (!path?.getTotalLength) return;
    const length = Math.ceil(path.getTotalLength()) + 1;
    path.style.strokeDasharray = String(length);
    path.style.strokeDashoffset = String(length);
  }, []);
  return <span aria-hidden="true" className="t-success-check steplab-success" data-state="in"><svg className={className} fill="none" viewBox="0 0 24 24"><path d="M5 12l4 4L19 6" ref={ref} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg></span>;
}

/** Never retain a previous run/document merely to animate its exit. */
export function TransitionPanel({ children, className, transitionKey, as = "div", ...props }: HTMLAttributes<HTMLElement> & { transitionKey?: string | number | null; as?: "div" | "section" | "article" | "span" }) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (ref.current) revealPanel(ref.current);
  }, [transitionKey]);
  return createElement(as, { ...props, className: cn("t-panel-slide steplab-panel", className), "data-open": "true", ref }, children);
}

/** Closing retains only the surface, with interaction disabled immediately. */
export function TransitionSurface({ open, kind, children, className, as = "div", surfaceRef, ...props }: HTMLAttributes<HTMLElement> & { open: boolean; kind: "modal" | "dropdown" | "panel"; as?: "div" | "aside"; surfaceRef?: RefObject<HTMLElement | null>; "data-origin"?: string }) {
  const [present, setPresent] = useState(open);
  const ref = useRef<HTMLElement>(null);
  if (open && !present) setPresent(true);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.inert = !open;
    element.classList.remove("is-open", "is-closing");
    if (kind === "panel") {
      if (open) revealPanel(element);
      else element.dataset.open = "false";
    } else {
      if (open) void element.offsetWidth;
      element.classList.add(open ? "is-open" : "is-closing");
    }
    if (open) return;
    const fallback = kind === "panel" ? 350 : 150;
    const timer = setTimeout(() => setPresent(false), reduceTransitions() ? 0 : transitionMs(`--${kind}-close-dur`, fallback));
    return () => clearTimeout(timer);
  }, [open, kind, present]);
  if (!open && !present) return null;
  return createElement(as, { ...props, ref: (element: HTMLElement | null) => { ref.current = element; if (surfaceRef) surfaceRef.current = element; }, className: cn(kind === "panel" ? "t-panel-slide steplab-panel" : `t-${kind}`, className) }, children);
}

/** Native summary keyboard behaviour is retained, including controlled open. */
export function TransitionDetails({ children, className, open, onToggle, variant = "accordion", ...props }: ComponentProps<"details"> & { variant?: "accordion" | "dropdown" }) {
  const nodes = Children.toArray(children);
  const summary = nodes[0];
  const [nativeOpen, setNativeOpen] = useState(Boolean(open));
  const [closing, setClosing] = useState(false);
  const expanded = open ?? nativeOpen;
  const panelRef = useRef<HTMLDivElement>(null);
  const cleanupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (cleanupTimer.current) clearTimeout(cleanupTimer.current); }, []);
  const header = isValidElement<ComponentProps<"summary">>(summary)
    ? cloneElement(summary, { className: cn(summary.props.className, "t-acc-head") }, Children.map(summary.props.children, (child) => isValidElement<{ name?: string; className?: string }>(child) && child.props.name === "chevronDown" ? cloneElement(child, { className: cn(child.props.className, "t-acc-chevron") }) : child)) : summary;
  return <details {...props} className={cn("steplab-disclosure", variant === "accordion" && "t-acc", className)} data-open={String(expanded)} open={expanded} onToggle={(event) => {
    const next = event.currentTarget.open;
    const panel = panelRef.current;
    if (panel && variant === "dropdown") {
      if (cleanupTimer.current) clearTimeout(cleanupTimer.current);
      panel.classList.remove("is-open", "is-closing");
      void panel.offsetWidth;
      panel.classList.add(next ? "is-open" : "is-closing");
      setClosing(!next);
      if (!next) cleanupTimer.current = setTimeout(() => setClosing(false), reduceTransitions() ? 0 : transitionMs("--dropdown-close-dur", 150));
    } else if (panel) {
      // Flush the collapsed grid before the native toggle updates data-open.
      void panel.offsetHeight;
    }
    setNativeOpen(next);
    onToggle?.(event);
  }}>{header}{variant === "accordion"
    ? <div className="t-acc-panel" inert={!expanded} ref={panelRef}><div className="t-acc-panel-inner">{nodes.slice(1)}</div></div>
    : <div inert={!expanded}>{nodes.slice(1).map((node, index) => isValidElement<HTMLAttributes<HTMLElement>>(node) ? cloneElement(node, { className: cn(node.props.className, "t-dropdown", expanded && "is-open", closing && "is-closing"), "data-origin": "top-right", ref: panelRef } as HTMLAttributes<HTMLElement>, node.props.children) : <span key={index}>{node}</span>)}</div>}
  </details>;
}

/** Measures the existing controls; the recipe pill owns the width/position tween. */
export function SlidingTabs({ children, value, className, underline = false, ref: forwardedRef, ...props }: ComponentProps<"div"> & { value: string; underline?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    const bar = ref.current;
    const pill = pillRef.current;
    if (!bar || !pill) return;
    const move = (animate: boolean) => {
      const tab = bar.querySelector<HTMLElement>('[aria-selected="true"], [aria-pressed="true"], [aria-checked="true"], label:has(input:checked), label:has([data-state="checked"])');
      if (!tab) { pill.style.visibility = "hidden"; return; }
      const target = tab.closest<HTMLElement>("label") ?? tab;
      pill.style.visibility = "visible";
      const previousTransition = pill.style.transition;
      if (!animate) pill.style.transition = "none";
      pill.style.transform = `translate(${target.offsetLeft}px, ${target.offsetTop}px)`;
      pill.style.width = `${target.offsetWidth}px`;
      pill.style.height = underline ? "2px" : `${target.offsetHeight}px`;
      pill.style.top = underline ? `${target.offsetHeight - 2}px` : "0px";
      if (!animate) { void pill.offsetWidth; pill.style.transition = previousTransition; }
    };
    const firstPaint = !mounted.current;
    move(!firstPaint);
    mounted.current = true;
    let observed = false;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => { if (observed) move(false); observed = true; });
    observer?.observe(bar);
    bar.querySelectorAll<HTMLElement>("button, label").forEach((tab) => observer?.observe(tab));
    const onResize = () => move(false);
    window.addEventListener("resize", onResize);
    let alive = true;
    if (firstPaint) void document.fonts?.ready.then(() => { if (alive) move(false); });
    return () => { alive = false; observer?.disconnect(); window.removeEventListener("resize", onResize); };
  }, [value, underline]);
  return <div {...props} className={cn("t-tabs steplab-tabs", underline && "steplab-tabs-underline", className)} ref={(element) => { ref.current = element; if (typeof forwardedRef === "function") forwardedRef(element); else if (forwardedRef) forwardedRef.current = element; }}><span aria-hidden="true" className="t-tabs-pill" ref={pillRef} />{Children.map(children, (child) => isValidElement<HTMLAttributes<HTMLElement>>(child) ? cloneElement(child, { className: cn(child.props.className, "t-tab") }) : child)}</div>;
}

export function TransitionCheckbox({ className, ...props }: ComponentProps<"input">) {
  return <span className="steplab-checkbox"><input {...props} className={cn("steplab-checkbox-input", className)} type="checkbox" /><span aria-checked={Boolean(props.checked)} aria-hidden="true" className="t-check steplab-checkbox-mark"><svg fill="none" viewBox="0 0 12 12"><path d="M2 6l3 3 5-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></svg></span></span>;
}
