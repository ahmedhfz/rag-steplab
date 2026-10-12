"use client";

import {
  ArrowLeft,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Check,
  CheckCircle,
  Circle,
  Clock,
  ClockRotateRight,
  CloudUpload,
  Code,
  Computer,
  Copy,
  Database,
  Download,
  Eye,
  EyeClosed,
  Filter,
  Flash,
  HalfMoon,
  HelpCircle,
  HomeSimple,
  Hourglass,
  InfoCircle,
  LightBulb,
  Link,
  ListSelect,
  Lock,
  LogOut,
  Menu,
  Minus,
  MoreHoriz,
  NavArrowDown,
  NavArrowLeft,
  NavArrowRight,
  NavArrowUp,
  Network,
  OnePointCircle,
  OpenBook,
  OpenNewWindow,
  Page,
  PageSearch,
  Play,
  Plus,
  Quote,
  Refresh,
  RefreshDouble,
  Search,
  Settings,
  SortDown,
  Sparks,
  StatsReport,
  SunLight,
  Timer,
  Trash,
  UndoCircle,
  Upload,
  ViewGrid,
  WarningCircle,
  WarningTriangle,
  Xmark,
  XmarkCircle,
} from "iconoir-react";
import type { ComponentProps, ElementType } from "react";

import { cn } from "@/lib/utils";

/**
 * Uygulamadaki ikonların tek semantic kaynağı.
 * Ekranlar iconoir-react bileşenlerini doğrudan içe aktarmak yerine bu registry'yi kullanır.
 */
export const SEMANTIC_ICONS = {
  overview: HomeSimple,
  document: Page,
  parse: PageSearch,
  chunk: ViewGrid,
  embed: Network,
  retrieve: Search,
  rerank: SortDown,
  context: ListSelect,
  generate: Sparks,
  evaluate: StatsReport,
  settings: Settings,
  arrowLeft: ArrowLeft,
  trendDown: ArrowDown,
  arrowRight: ArrowRight,
  trendUp: ArrowUp,
  arrowUpRight: ArrowUpRight,
  openBook: OpenBook,
  check: Check,
  completed: CheckCircle,
  chevronDown: NavArrowDown,
  chevronUp: NavArrowUp,
  chevronLeft: NavArrowLeft,
  chevronRight: NavArrowRight,
  circle: Circle,
  ready: OnePointCircle,
  help: HelpCircle,
  info: InfoCircle,
  clock: Clock,
  queued: Hourglass,
  timer: Timer,
  copy: Copy,
  database: Database,
  download: Download,
  externalLink: OpenNewWindow,
  link: Link,
  eye: Eye,
  eyeOff: EyeClosed,
  fileSearch: PageSearch,
  filter: Filter,
  flash: Flash,
  history: ClockRotateRight,
  loading: Refresh,
  lock: Lock,
  logOut: LogOut,
  menu: Menu,
  minus: Minus,
  moreHorizontal: MoreHoriz,
  play: Play,
  plus: Plus,
  quote: Quote,
  refresh: RefreshDouble,
  reset: UndoCircle,
  trash: Trash,
  warning: WarningCircle,
  warningTriangle: WarningTriangle,
  xCircle: XmarkCircle,
  upload: Upload,
  cloudUpload: CloudUpload,
  close: Xmark,
  lightBulb: LightBulb,
  code: Code,
  sun: SunLight,
  moon: HalfMoon,
  monitor: Computer,
} as const;

export type SemanticIconName = keyof typeof SEMANTIC_ICONS;

/** Icon size follows the text it sits next to: xs 14px (12–13px text), sm 16px (14px), md 20px (16px+/nav), lg 24px. */
export type AppIconSize = "xs" | "sm" | "md" | "lg";

const iconSizes: Record<AppIconSize, string> = {
  xs: "size-3.5",
  sm: "size-4",
  md: "size-5",
  lg: "size-6",
};

export type AppIconProps = Omit<ComponentProps<(typeof SEMANTIC_ICONS)[SemanticIconName]>, "name"> & {
  name: SemanticIconName;
  size?: AppIconSize;
};

export function AppIcon({ name, size, strokeWidth = 1.5, className, ...props }: AppIconProps) {
  const Icon = SEMANTIC_ICONS[name] as ElementType;
  return <Icon aria-hidden={props["aria-hidden"] ?? true} className={cn(size && iconSizes[size], className)} strokeWidth={strokeWidth} {...props} />;
}
