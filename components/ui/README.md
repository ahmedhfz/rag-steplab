# StepLab UI kit

The only building blocks screens may use. If a pattern is not here, add it to `components/ui/` first
instead of styling it inside a screen.

Built on **Untitled UI React** (free MIT components, github.com/untitleduico/react), adapted to StepLab
tokens. Interactive internals come from **React Aria Components** (Apache-2.0) or **Radix** (MIT,
already used); toasts are **Sonner** (MIT); animated numbers are **NumberFlow** (MIT); small charts are
derived from **Tremor Raw** (Apache-2.0, modified files are marked in their headers). Motion stays on the
existing transitions.dev recipes (`app/transitions.css`, `app/transition-adapters.css`).

## Runtime setup (already done)

- Tokens: `app/theme.css` (Untitled theme format). Legacy aliases + base styles: `app/globals.css`.
- Dark mode = `.dark` on `<html>` from `lib/theme.ts` bootstrap + `PreferencesProvider` (System / Light / Dark,
  no FOUC). Untitled's `.dark-mode` is not used. Use the `dark:` variant only when a token cannot express it.
- `UiProvider` (in `app/layout.tsx`): React Aria locale follows the app locale, and mounts the one `<Toaster/>`.
- Fonts: Geist Sans (`font-sans`, default) and Geist Mono (`font-mono`, ids/hashes/JSON/code only).
- `cn()` (`lib/utils.ts`) knows the custom type scale and shadows; always merge classes with it.

## Tokens

Five colour families only: `gray` (warm mauve), `brand` (Dark Cherry, 600 = `#711f3a`, 300 = `#de8eaa`),
`success`, `warning`, `error`, each 25–950. Tailwind's default palette is removed (`bg-blue-500` does not
exist). Use **semantic** tokens in components; raw steps only for charts/swatches.

| Purpose | Light | Dark | Utilities |
| --- | --- | --- | --- |
| Page background | gray-50 | gray-950 | `bg-canvas` |
| Panels, inputs, menus | white | gray-900 | `bg-primary` |
| Raised menus/popovers | white | gray-800 | `bg-primary_alt` |
| Wells, table header, hover | gray-50 | gray-800 | `bg-secondary`, `bg-primary_hover` |
| Tracks, chips, selected row | gray-100 | gray-800 | `bg-tertiary`, `bg-active` |
| Progress/slider track | gray-200 | gray-700 | `bg-quaternary` |
| Tooltip | gray-900 | gray-700 | `bg-primary-solid` |
| Brand fill (primary action, checked) | brand-600 | brand-600 → 500 hover | `bg-brand-solid` |
| Brand tint (sparingly) | brand-50 | brand-950 | `bg-brand-primary` |
| Status tints | *-50 | *-950 | `bg-success-primary`, `bg-warning-primary`, `bg-error-primary` |
| Text: headings/values | gray-900 | gray-50 | `text-primary` |
| Text: body/labels | gray-700 | gray-300 | `text-secondary` |
| Text: descriptions | gray-600 | gray-400 | `text-tertiary` |
| Text: meta/captions/placeholder | gray-500 | gray-400 | `text-quaternary`, `text-placeholder` |
| Text: disabled | gray-500 | gray-500 | `text-disabled` |
| Text: active/link | brand-600 | brand-300 | `text-brand-secondary` |
| Text: status | success-600 / warning-700 / error-600 | *-400 | `text-success-primary` … |
| Icons | gray-400 … 900 | | `text-fg-quaternary`, `text-fg-tertiary`, `text-fg-secondary`, `text-fg-brand-primary` |
| Hairlines (cards, dividers) | gray-200 | gray-800 | `border-secondary`, `ring-secondary`, `divide-secondary` |
| Stronger hairline (secondary button) | gray-300 | gray-700 | `ring-primary`, `border-primary` |
| Form-control boundary (≥ 3:1) | gray-400 | gray-500 | `ring-control`, `border-control` (+ `_hover`) |
| Focus | brand-500 | brand-400 | `outline-focus-ring` (global), fields: `ring-brand` |

Contrast rules are enforced by `test/theme-tokens.test.ts`: every text token ≥ 4.5:1 on `bg-canvas`,
`bg-primary`, `bg-primary_alt` and `bg-secondary`; control borders and focus ≥ 3:1; dark surfaces lighten
with elevation. On `bg-tertiary` (tracks, chips) use `text-tertiary` or stronger — `text-quaternary` is 4.2:1 there.

**Type** (Untitled scale; body = `text-sm`): `text-xs` 12/18 · `text-sm` 14/20 · `text-md` 16/24 · `text-lg` 18/28 ·
`text-xl` 20/30 · `text-display-xs` 24/32 · `text-display-sm` 30/38 · `text-display-md` 36/44 (… `-2xl`).
Weights: 400 body, 500 labels, 600 headings/buttons. Numbers: `tabular-nums` (or `MetricValue`).

**Radius** (Tailwind/Untitled default): `rounded-sm` 4 tags · `rounded-md` 6 badges/inner items · `rounded-lg` 8
controls · `rounded-xl` 12 panels · `rounded-2xl` 16 modals/sheets · `rounded-full` pills. Nested radius =
outer − padding (segmented: track `rounded-lg` + `p-0.5`, pill `rounded-md`).

**Shadow**: `shadow-xs` panels, `shadow-xs-skeuomorphic` buttons/featured icons, `shadow-lg` menus/toasts,
`shadow-xl` modals. Spacing: Tailwind 4px scale; sections `gap-6`, chapters `gap-16+`.

**Motion**: reuse `TransitionPanel`, `TransitionText`, `TransitionNumber`, `SlidingTabs`, `IconSwap`, `SuccessCheck`
(`components/ui/transitions.tsx`) and the CSS duration/easing variables (`--tabs-dur`, `--modal-ease`, …).
`prefers-reduced-motion` is honoured globally.

## Legacy → new token map

Legacy names still compile (aliases in `app/globals.css`) so un-migrated screens stay coherent. Migrate to
the right-hand column; do not use the left column in new code.

| Legacy | Use instead | Note |
| --- | --- | --- |
| `bg-background` | `bg-canvas` | |
| `bg-card`, `bg-popover` | `bg-primary` / `bg-primary_alt` | |
| `bg-muted`, `bg-surface-subtle`, `bg-technical` | `bg-secondary` (or `Panel tone="inset"`) | |
| `bg-secondary` | `bg-secondary` / `bg-tertiary` | **Now Untitled's**: light gray-50 (was gray-100), dark gray-800 |
| `bg-accent`, `bg-brand-subtle` | `bg-brand-primary` | brand tint, rarely |
| `bg-brand`, `text-brand` | `bg-brand-solid`, `text-brand-secondary` | |
| `bg-foreground` (ink button) | `Button variant="primary"` / `"pearl"` | |
| `bg-overlay/…` | `bg-overlay/…` | **Now Untitled's** `bg-overlay` (gray-950 / black) |
| `text-foreground`, `text-card-foreground` | `text-primary` | |
| `text-muted-foreground` | `text-tertiary` | |
| `text-subtle-foreground` | `text-quaternary` | |
| `text-accent-foreground` | `text-brand-secondary` | |
| `text-destructive` / `text-success` / `text-warning` | `text-error-primary` / `text-success-primary` / `text-warning-primary` | |
| `bg-destructive-subtle` / `bg-success-subtle` / `bg-warning-subtle` | `bg-error-primary` / `bg-success-primary` / `bg-warning-primary` | or `Notice` |
| `border-border`, `border-border-subtle` | `border-secondary` | |
| `border-input`, `border-hover-border` | `border-control`, `border-control_hover` | form controls only |
| `border-brand` | `border-brand` | **Now Untitled's** brand-500 / brand-400 |
| `ring-ring`, `outline-ring` | `outline-focus-ring` | |
| `text-base` | `text-sm` | deprecated alias, 14px |
| `text-2xs` | `text-xs` | deprecated alias, 12px |
| `text-2xl` | `text-display-xs` | deprecated alias, 24px |

Changed meaning: `bg-primary` is now a **surface** (was ink), `text-secondary` is body text (was a light
surface colour). No screen used the old meanings. Old radius overrides were removed, so legacy
`rounded-md/lg/xl` are one step sharper (6/8/12).

## Colour discipline

- **Brand = active / now / primary action.** One primary button per view, the current step, the selected
  tab underline, the in-focus chart series, focus rings. Never for decoration, "waiting", eyebrows or tips.
- **Green = verified success only** (a check passed, a citation resolved, cases passed). Completed work is neutral.
- **Amber = needs attention** (stale upstream, low score). **Red = failed / blocked / destructive.**
- Neutral first: icons are gray, charts are gray unless the colour means something.

## Components

All under `@/components/ui/<file>`.

| Component | File | Key API | Notes |
| --- | --- | --- | --- |
| `Button`, `buttonStyles()` | `button` | `variant`: primary · secondary · tertiary · destructive · destructive-secondary · link · link-gray · **pearl**; `size`: sm 32 · md 36 · lg 40 · xl 48 · icon-sm · icon · icon-lg; `iconLeading`/`iconTrailing` (AppIcon name or node); `isLoading`; `asChild` | Native `<button>`. Legacy `default/outline/ghost` + `size="default"` still work (`data-variant` echoes the name used). Pearl = hero CTA only. Icon-only buttons need `aria-label` + `Tooltip`. Disabled is flat, not faded. |
| `SegmentedControl` | `segmented-control` | `options=[{value,label,icon?,iconOnly?,disabled?}]`, `value`/`defaultValue`, `onChange`, `size` sm/md, `fullWidth`, `aria-label` | The one "pick one of a few" control (theme, strategy, view). React Aria radio group: arrows move + select. Sliding pill. |
| `Tabs`, `TabList`, `Tab`, `TabPanel` | `tabs` | `Tabs selectedKey/defaultSelectedKey/onSelectionChange`; `TabList type="underline" \| "pill"`, `aria-label`; `Tab id icon badge`; `TabPanel id` | React Aria tabs, sliding indicator. Underline for page sections, pill inside panels. |
| `Input`, `fieldSurface` | `input` | native input props + `size` sm/md/lg, `icon`, `trailing` | `onChange` gets the event (unchanged). 16px on mobile, 14px ≥ sm. |
| `Textarea` | `textarea` | native textarea props | |
| `Field`, `Label`, `HintText` | `field` | `Field label hint error required tooltip tooltipLabel` + one child, or render-prop `{(control) => …}` for Select | Wires id, `aria-describedby`, `aria-invalid`. Hints go *under* the control. |
| `Select*` | `select` | Radix API unchanged: `Select value onValueChange`, `SelectTrigger size`, `SelectContent`, `SelectItem`, `SelectGroup`, `SelectLabel`, `SelectSeparator`, `SelectValue` | Keeps `role="combobox"`; dropdown recipe motion. Label via `Field` render-prop: `<SelectTrigger id={id} …>`. |
| `Switch` | `switch` | Radix API: `checked`, `onCheckedChange`, `size` sm/md | `role="switch"` + `aria-checked`; spring thumb. Pair with a visible `<label>`. |
| `Checkbox`, `CheckboxBox` | `checkbox` | `isSelected`/`defaultSelected`, `onChange(bool)`, `isIndeterminate`, `isDisabled`, `label`, `hint`, `size` | React Aria. `TransitionCheckbox` (transitions.tsx) remains for native-input cases. |
| `RadioGroup`, `RadioGroupItem` | `radio-group` | Radix API unchanged | For option *lists* with descriptions; use SegmentedControl for compact choices. |
| `Slider` | `slider` | React Aria: `value`/`defaultValue` (number or [a,b]), `onChange`, `minValue`, `maxValue`, `step`, `formatOptions`, `label`, `showValue` | Range supported. |
| `Badge` | `badge` | `color` gray·brand·success·warning·error, `type` pill·color·modern, `size`, `dot`, `icon`, `trailing` | Labels and counts. **Not** for status. |
| `StatusBadge`, `STATUS_META` | `status-badge` | `status`: idle · queued · ready · processing · completed · success · warning · stale · error; `appearance` inline (default) · pill · icon; children = label | The single status language. Legacy `StatusPill`/`StatusIcon`/`PIPELINE_STEP_STATUS` (tone API) still exported from `status-pill`. |
| `Notice` | `notice` | `tone` neutral·info·warning·error·success, `title`, `action`, `icon` | Inline callout (reuse notice, stale upstream). Not for empty inputs, not for transient feedback. |
| `Tooltip` | `tooltip` | `title`, `description`, `shortcut`, `placement`, `delay`; child = one focusable element | React Aria: hover + keyboard focus, Escape. Short text only. |
| `InfoTip` | `info-tip` | `label` (localized accessible name), `title`, `description` | (?) button + Tooltip. Use instead of a visible helper line; `Label`/`Field` `tooltip` use it too. |
| `Kbd` | `kbd` | children | Key hints. |
| `Table*`, `TableCard` | `table` | native table parts; `TableHead/TableCell numeric` | `TableCard` only when the table stands alone on the canvas. Row selection: `aria-selected`. |
| `Modal`, `ModalTrigger`, `ModalContent`, `ModalBody`, `ModalFooter`, `ModalClose` | `modal` | `ModalContent title description icon iconColor size(sm·md·lg·xl) hideClose` | Radix Dialog + t-modal recipe. Title is required (names the dialog). |
| `AlertDialog*`, `ConfirmDialog` | `modal` | `ConfirmDialog title description confirmLabel cancelLabel tone onConfirm trigger isLoading` | `role="alertdialog"`, no outside-click dismiss. Use for irreversible actions. |
| `Drawer`, `DrawerTrigger`, `DrawerContent`, `DrawerBody`, `DrawerFooter`, `DrawerClose` | `drawer` | `DrawerContent title description side(right·left·bottom)` | Floating inset sheet; panel motion tokens. |
| `PreviewCard`, `PreviewCardTrigger`, `PreviewCardContent` | `preview-card` | Radix HoverCard API (`openDelay`, `asChild` trigger) | Citation `[S1]` → passage previews. Also link the full source. |
| `toast` | `toast` | `toast()`, `.success`, `.error`, `.warning`, `.promise`, `{ description, action }` | Mounted once. Transient only. |
| `Disclosure`, `HowItWorks`, `TechnicalDetails` | `disclosure` | `Disclosure title meta variant(section·plain·inline) defaultOpen` | The one disclosure. `plain` inside a Panel, `section` on the canvas, `inline` for detail toggles. |
| `Panel`, `PanelHeader`, `Section`, `SectionLabel` | `panel` | `Panel padding tone(default·inset) as`; `PanelHeader title description actions divider titleAs`; `Section title description actions label` | One framed surface max. Split with `Section` + `Separator`. |
| `PageHeader` | `page-header` | `title description actions help context` | One per page. |
| `EmptyState` | `empty-state` | `icon title description action titleAs size(sm·md)` | Calm, one primary action. |
| `FeaturedIcon` | `featured-icon` | `icon color theme(light·modern·outline) size` | Headers/empty states only, not rows. |
| `Metric`, `MetricGroup`, `MetricValue` | `metric` | `Metric label value format(Intl) prefix suffix delta{value,format,suffix,higherIsBetter,label} hint size visual`; `MetricGroup framed`; `MetricValue value format` | NumberFlow digits, tabular. `MetricGroup` = frameless stat strip. |
| `ProgressBar`, `Stepper` | `progress` | `ProgressBar value?(omit = indeterminate) tone label showLabel showValue valueFormatter`; `Stepper steps=[{id,label,description,state}] orientation aria-label` | Completed steps neutral; current = brand. |
| `ProgressCircle` | `progress-circle` | `value max tone label radius strokeWidth` + centred children | Tremor-derived. |
| `Spinner` | `spinner` | `size` xs–xl, `label`, `showLabel`, `tone` | Short waits; `Skeleton` when the shape is known. |
| `Skeleton`, `SkeletonBlock` | `skeleton` | `rows label` / `className` | |
| `Separator` | `separator` | Radix API | Hairline. |
| `FileDropzone`, `FileItem`, `formatFileSize` | `file-uploader` | `FileDropzone title browseLabel hint accept maxSize allowsMultiple compact onDropFiles onDropUnacceptedFiles onSizeLimitExceed`; `FileItem name size progress status statusLabel onRemove removeLabel` | Copy comes from props (i18n). |
| `BarList` | `bar-list` | `data=[{key,name,value,color?,meta?}] valueFormatter color sortOrder onValueChange` | Ranked magnitudes (scores per chunk). |
| `CategoryBar` | `category-bar` | `segments=[{label,value,color}] marker{value,label} showLegend aria-label` | Parts of a whole (context budget). |
| `Tracker` | `tracker` | `data=[{key,color,tooltip}] aria-label` | Run/case history strip. |
| `SparkLineChart`, `SparkAreaChart`, `SparkBarChart` | `spark-chart` | `data index categories colors minValue maxValue aria-label` | Dependency-free SVG; decorative unless `aria-label`. |
| `AppIcon` | `app-icon` | `name` (registry), `size` xs 14 · sm 16 · md 20 · lg 24 | The only icon API (iconoir). Add icons to the registry, never import iconoir directly. |
| `useSlidingIndicator` | `use-sliding-indicator` | `(selector, "fill" \| "underline")` → refs | For custom sliding selections. |

Chart colours: `ChartColor` = brand · gray · success · warning · error (`chart-colors.ts`).

## Do / don't

- **Do** use tokens only. **Don't** write `text-[13px]`, `rounded-[7px]`, `h-[37px]`, hex, `rgba()` or Tailwind palette colours in screens.
- **Do** put at most one framed surface between canvas and content. **Don't** nest `Panel` in `Panel` or wrap every disclosure, notice and table in another bordered box.
- **Do** keep one primary action per view. **Don't** colour secondary actions brand.
- **Do** show status with `StatusBadge`. **Don't** invent dots/pills per screen or colour completed work green.
- **Do** use `font-mono` for ids, hashes, JSON and code. **Don't** use mono for numbers or status words — use `tabular-nums` / `MetricValue`.
- **Do** keep hints under the control (`Field`). **Don't** show warning callouts for inputs the user has not filled yet — disable the action and explain in a hint.
- **Do** use `SectionLabel` (overline) at most once or twice per screen; section headings are sentence case.
- **Do** give icon-only controls an `aria-label` and a `Tooltip`; respect `prefers-reduced-motion` (built in).

## Primitive choices and gaps

- React Aria for SegmentedControl, Tabs, Checkbox, Slider, Tooltip (radio/tab semantics, keyboard, locale).
  Radix stays where screens and tests depend on its API/roles (Select = combobox, Switch = `aria-checked`,
  RadioGroup) and for dialogs/hover cards, because the transitions.dev recipes are already bridged to Radix
  `data-state` (`transition-surface.tsx`). Base UI was not added: Radix HoverCard covers PreviewCard.
- Untitled PRO categories (metrics, progress steps, command menu, date range pickers…) are not used;
  `Metric`, `Stepper`, `Notice`, `SegmentedControl` are written here on the free tokens.
- No dropdown menu, popover, command menu, pagination or date picker yet. Add them here (Radix DropdownMenu /
  React Aria Menu) before a screen needs one.
- `@untitledui/icons` is not used; all icons go through `AppIcon` (iconoir).
