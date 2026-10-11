import { LoginScreen } from "@/components/login-screen";
import { pageMetadata } from "@/lib/page-titles";

export const metadata = pageMetadata("signIn");

export default function LoginPage() {
  return <LoginScreen />;
}
