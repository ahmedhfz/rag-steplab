import { SettingsScreen } from "@/components/settings-screen";
import { pageMetadata } from "@/lib/page-titles";

export const metadata = pageMetadata("settings");

export default function SettingsPage() {
  return <SettingsScreen />;
}
