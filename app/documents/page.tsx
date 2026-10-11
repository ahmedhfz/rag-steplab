import { DocumentsScreen } from "@/components/documents-screen";
import { pageMetadata } from "@/lib/page-titles";

export const metadata = pageMetadata("documents");

export default function DocumentsPage() {
  return <DocumentsScreen />;
}
