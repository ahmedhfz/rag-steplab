import { ResetPasswordScreen } from "@/components/reset-password-screen";
import { pageMetadata } from "@/lib/page-titles";

export const metadata = pageMetadata("resetPassword");

export default function ResetPasswordPage() {
  return <ResetPasswordScreen />;
}
