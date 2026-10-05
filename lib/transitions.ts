/** Read the recipe tokens so orchestration follows CSS, including live tuning. */
export function transitionMs(name: string, fallback: number) {
  if (typeof document === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? (raw.endsWith("ms") ? value : value * 1000) : fallback;
}

export function reduceTransitions() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** New state is rendered immediately; only its visual entrance is animated. */
export function enterTransition(element: HTMLElement, startClass: string) {
  element.classList.remove(startClass);
  if (reduceTransitions()) return;
  element.classList.add(startClass);
  void element.offsetHeight;
  element.classList.remove(startClass);
}

export function revealPanel(element: HTMLElement) {
  element.dataset.open = "false";
  void element.offsetHeight;
  element.dataset.open = "true";
}

export function shakeValidation(element: HTMLElement | null) {
  if (!element) return;
  element.classList.add("t-input", "is-error");
  element.classList.remove("is-shaking");
  if (reduceTransitions()) return;
  void element.offsetWidth;
  element.classList.add("is-shaking");
}

/** The recipe's mirror/glow is decorative; React clears the actual value now. */
export function clearQuestionTransition(wrap: HTMLElement | null, text: string): () => void {
  if (!wrap || !text || reduceTransitions()) return () => {};
  const mirror = wrap.querySelector<HTMLElement>(".t-clear-mirror");
  const glow = wrap.querySelector<HTMLElement>(".t-clear-glow");
  if (!mirror?.animate || !glow) return () => {};
  mirror.textContent = text;
  wrap.classList.add("is-clearing");
  const rootStyle = getComputedStyle(document.documentElement);
  const ease = rootStyle.getPropertyValue("--clear-out-ease").trim() || "cubic-bezier(0.22, 1, 0.36, 1)";
  const fly = Number.parseFloat(rootStyle.getPropertyValue("--clear-out-fly")) || 12;
  const blur = Number.parseFloat(rootStyle.getPropertyValue("--clear-blur")) || 2;
  const rgb = document.documentElement.classList.contains("dark") ? "255,255,255" : "0,0,0";
  glow.style.background = text.split(/\s+/).slice(0, 24).map((word, i, words) => `radial-gradient(ellipse ${Math.max(8, word.length * 4)}px 7px at ${(i + 0.5) / words.length * 100}% 100%, rgba(${rgb},0.22), transparent)`).join(", ");
  const out = mirror.animate([{ transform: "translateY(0)", opacity: 1, filter: "blur(0)" }, { transform: `translateY(${fly}px)`, opacity: 0, filter: `blur(${blur}px)` }], { duration: transitionMs("--clear-out-dur", 400), easing: ease, fill: "both" });
  const streak = glow.animate([{ opacity: 0 }, { opacity: document.documentElement.classList.contains("dark") ? 0.85 : 0.42, offset: 0.15 }, { opacity: 0 }], { duration: transitionMs("--clear-dur", 1000), fill: "both" });
  const reset = () => { out.cancel(); streak.cancel(); wrap.classList.remove("is-clearing"); mirror.textContent = ""; glow.style.background = ""; };
  void streak.finished.then(reset, () => {});
  return reset;
}
