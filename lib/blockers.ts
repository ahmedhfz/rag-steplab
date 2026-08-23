import type { AppLocale } from "@/lib/copy";

export type BlockerCode =
  | "processing"
  | "missing_document"
  | "missing_pipeline"
  | "missing_parse"
  | "missing_chunk"
  | "missing_embedding"
  | "missing_experiment"
  | "missing_question"
  | "missing_dataset"
  | "missing_sources"
  | "invalid_config"
  | "backend_unavailable"
  | "incompatible_lineage";

export type Blocker = { code: BlockerCode; message: string };

const copy = {
  en: {
    processing: "This operation is already running. Its real status will appear here when it completes.",
    missingDocument: "Select a document to continue.",
    missingPipeline: "Select an indexing pipeline so this operation has an explicit lineage.",
    missingParse: "Parse the document first. Chunking and later stages use the persisted parse output.",
    missingChunk: "Create a compatible chunk run first, or select one from the pipeline history.",
    missingEmbedding: "Dense and hybrid retrieval require embeddings. Create embeddings or switch to Keyword.",
    missingExperiment: "Run the retrieval experiment first. Later query stages inspect that persisted run.",
    missingQuestion: "Enter a question to run a real retrieval experiment.",
    missingDataset: "Create or select an evaluation dataset before running evaluation.",
    missingSources: "Add at least one parsed source element to the evaluation case.",
    invalidConfig: "Check the configuration values and try again.",
    backendUnavailable: "The RAG service is temporarily unavailable. Retry shortly.",
    incompatibleLineage: "This result belongs to a different upstream lineage. Select a compatible run.",
  },
  tr: {
    processing: "Bu işlem zaten çalışıyor. Tamamlandığında gerçek durum burada görünecek.",
    missingDocument: "Devam etmek için bir doküman seçin.",
    missingPipeline: "İşlemin açık bir lineage'ı olması için bir indexing pipeline seçin.",
    missingParse: "Önce dokümanı ayrıştırın. Chunking ve sonraki aşamalar kalıcı parse çıktısını kullanır.",
    missingChunk: "Önce uyumlu bir chunk run oluşturun veya pipeline geçmişinden seçin.",
    missingEmbedding: "Dense ve hybrid retrieval embedding gerektirir. Embedding oluşturun veya Keyword seçin.",
    missingExperiment: "Önce retrieval deneyini çalıştırın. Sonraki sorgu aşamaları bu kalıcı run'ı inceler.",
    missingQuestion: "Gerçek bir retrieval deneyi çalıştırmak için bir soru girin.",
    missingDataset: "Evaluation çalıştırmadan önce bir dataset oluşturun veya seçin.",
    missingSources: "Evaluation case'ine en az bir parse source elementi ekleyin.",
    invalidConfig: "Ayar değerlerini kontrol edip tekrar deneyin.",
    backendUnavailable: "RAG servisi geçici olarak kullanılamıyor. Kısa süre sonra tekrar deneyin.",
    incompatibleLineage: "Bu sonuç farklı bir upstream lineage'a ait. Uyumlu bir run seçin.",
  },
} as const;

export function blocker(locale: AppLocale, code: BlockerCode): Blocker {
  const labels = copy[locale];
  const key = code.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
  const messageKey = key === "missingDocument" ? "missingDocument" : key === "missingPipeline" ? "missingPipeline" : key === "missingParse" ? "missingParse" : key === "missingChunk" ? "missingChunk" : key === "missingEmbedding" ? "missingEmbedding" : key === "missingExperiment" ? "missingExperiment" : key === "missingQuestion" ? "missingQuestion" : key === "missingDataset" ? "missingDataset" : key === "missingSources" ? "missingSources" : key === "invalidConfig" ? "invalidConfig" : key === "backendUnavailable" ? "backendUnavailable" : key === "incompatibleLineage" ? "incompatibleLineage" : "processing";
  return { code, message: labels[messageKey as keyof typeof labels] };
}

export function firstBlocker(locale: AppLocale, checks: Array<[boolean, BlockerCode]>): Blocker | null {
  const match = checks.find(([isBlocked]) => isBlocked);
  return match ? blocker(locale, match[1]) : null;
}
