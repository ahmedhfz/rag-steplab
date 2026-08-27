import type { AppLocale } from "@/lib/copy";
import type { DocumentLineageSelection, DocumentPipeline, RetrievalMode, RunSummary } from "@/lib/rag-api-types";

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

export type PipelineAvailabilityStage = "parse" | "chunk" | "embedding" | "retrieval" | "evaluation" | "dataset" | "pipeline";

export type PipelineAvailabilityInput = {
  document?: { id?: string | null } | null;
  pipeline?: Pick<DocumentPipeline, "id" | "parseRunId" | "chunkRunId" | "embeddingRunId"> | null;
  selection?: Partial<DocumentLineageSelection> | null;
  parseRun?: Pick<RunSummary, "id" | "status" | "isCompatible"> | null;
  chunkRun?: (Pick<RunSummary, "id" | "status" | "isCompatible" | "upstream"> & { parseRunId?: string | null }) | null;
  embeddingRun?: (Pick<RunSummary, "id" | "status" | "isCompatible" | "upstream"> & { chunkRunId?: string | null }) | null;
  hasExperiment?: boolean;
  hasDataset?: boolean;
  hasQuestion?: boolean;
  hasSources?: boolean;
  retrievalMode?: RetrievalMode;
  persistenceStatus?: "checking" | "available" | "unavailable";
  processing?: boolean;
};

export type PipelineAvailability = {
  allowed: boolean;
  code: BlockerCode | null;
  message: string;
  requiredAction: string | null;
  href: string | null;
};

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

const actionCopy = {
  en: {
    processing: "Wait for the current operation to finish.",
    missingDocument: "Select a document.",
    missingPipeline: "Select or create a pipeline.",
    missingParse: "Parse the document.",
    missingChunk: "Create or select a compatible chunk run.",
    missingEmbedding: "Create or select a compatible embedding run.",
    missingExperiment: "Run a retrieval experiment.",
    missingQuestion: "Enter a question.",
    missingDataset: "Create or select an evaluation dataset.",
    missingSources: "Add a parsed source element.",
    invalidConfig: "Correct the configuration.",
    backendUnavailable: "Retry the persistence backend.",
    incompatibleLineage: "Select a run from the current upstream lineage.",
  },
  tr: {
    processing: "Mevcut işlemin tamamlanmasını bekleyin.",
    missingDocument: "Bir doküman seçin.",
    missingPipeline: "Bir pipeline seçin veya oluşturun.",
    missingParse: "Dokümanı ayrıştırın.",
    missingChunk: "Uyumlu bir chunk run oluşturun veya seçin.",
    missingEmbedding: "Uyumlu bir embedding run oluşturun veya seçin.",
    missingExperiment: "Bir retrieval deneyi çalıştırın.",
    missingQuestion: "Bir soru girin.",
    missingDataset: "Bir evaluation dataset'i oluşturun veya seçin.",
    missingSources: "Parse edilmiş bir kaynak elementi ekleyin.",
    invalidConfig: "Ayarları düzeltin.",
    backendUnavailable: "Kalıcı backend'i tekrar deneyin.",
    incompatibleLineage: "Mevcut upstream lineage içinden bir run seçin.",
  },
} as const;

const blockerHref: Record<BlockerCode, string | null> = {
  processing: null,
  missing_document: "/documents",
  missing_pipeline: "/",
  missing_parse: "/parse",
  missing_chunk: "/chunking",
  missing_embedding: "/embeddings",
  missing_experiment: "/retrieval",
  missing_question: "/retrieval",
  missing_dataset: "/evaluation",
  missing_sources: "/evaluation",
  invalid_config: null,
  backend_unavailable: null,
  incompatible_lineage: null,
};

function availabilityBlocker(locale: AppLocale, code: BlockerCode): PipelineAvailability {
  const item = blocker(locale, code);
  const key = code.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()) as keyof typeof actionCopy.en;
  return {
    allowed: false,
    code,
    message: item.message,
    requiredAction: actionCopy[locale][key],
    href: blockerHref[code],
  };
}

function allowedAvailability(): PipelineAvailability {
  return { allowed: true, code: null, message: "", requiredAction: null, href: null };
}

/**
 * Resolves stage prerequisites from explicit state instead of letting each
 * screen invent a slightly different definition of "ready".
 */
export function getPipelineAvailability(
  locale: AppLocale,
  stage: PipelineAvailabilityStage,
  input: PipelineAvailabilityInput,
): PipelineAvailability {
  const selection = input.selection ?? {};
  if (input.processing || input.persistenceStatus === "checking") return availabilityBlocker(locale, "processing");
  if (input.persistenceStatus === "unavailable") return availabilityBlocker(locale, "backend_unavailable");
  if (!input.document?.id) return availabilityBlocker(locale, "missing_document");
  if (stage === "pipeline" && !input.pipeline) return availabilityBlocker(locale, "missing_pipeline");

  const parseId = selection.selectedParseRunId ?? null;
  const chunkId = selection.selectedChunkRunId ?? null;
  const embeddingId = selection.selectedEmbeddingRunId ?? null;
  if (input.pipeline && stage !== "pipeline"
    && (input.pipeline.parseRunId !== parseId
      || input.pipeline.chunkRunId !== chunkId
      || input.pipeline.embeddingRunId !== embeddingId)) {
    return availabilityBlocker(locale, "incompatible_lineage");
  }
  if (stage !== "parse" && stage !== "pipeline" && !parseId) return availabilityBlocker(locale, "missing_parse");
  if (stage !== "parse" && stage !== "pipeline" && parseId && !input.parseRun) return availabilityBlocker(locale, "incompatible_lineage");
  if (input.parseRun && parseId && input.parseRun.id !== parseId) return availabilityBlocker(locale, "incompatible_lineage");
  if (input.parseRun && (!input.parseRun.isCompatible || input.parseRun.status !== "completed")) return availabilityBlocker(locale, "incompatible_lineage");
  if (["embedding", "retrieval", "evaluation"].includes(stage) && !chunkId) return availabilityBlocker(locale, "missing_chunk");
  if (["embedding", "retrieval", "evaluation"].includes(stage) && chunkId && !input.chunkRun) return availabilityBlocker(locale, "incompatible_lineage");
  if (input.chunkRun && chunkId && input.chunkRun.id !== chunkId) return availabilityBlocker(locale, "incompatible_lineage");
  if (input.chunkRun && (!input.chunkRun.isCompatible || input.chunkRun.status !== "completed")) return availabilityBlocker(locale, "incompatible_lineage");
  if (input.chunkRun && parseId && input.chunkRun.upstream.parseRunId !== parseId) return availabilityBlocker(locale, "incompatible_lineage");
  if (stage === "retrieval" || stage === "evaluation") {
    const modeNeedsEmbedding = input.retrievalMode !== "keyword";
    if (modeNeedsEmbedding && !embeddingId) return availabilityBlocker(locale, "missing_embedding");
    if (input.embeddingRun && (!input.embeddingRun.isCompatible || input.embeddingRun.status !== "completed")) return availabilityBlocker(locale, "incompatible_lineage");
    if (input.embeddingRun && embeddingId && input.embeddingRun.id !== embeddingId) return availabilityBlocker(locale, "incompatible_lineage");
    if (input.embeddingRun && chunkId && input.embeddingRun.upstream.chunkRunId !== chunkId) return availabilityBlocker(locale, "incompatible_lineage");
  }
  if (stage === "retrieval" && !input.hasQuestion) return availabilityBlocker(locale, "missing_question");
  if (stage === "retrieval" && input.hasExperiment === false) return availabilityBlocker(locale, "missing_experiment");
  if (stage === "evaluation" && !input.hasDataset) return availabilityBlocker(locale, "missing_dataset");
  if (stage === "evaluation" && input.hasSources === false) return availabilityBlocker(locale, "missing_sources");
  if (stage === "dataset" && !parseId) return availabilityBlocker(locale, "missing_parse");
  return allowedAvailability();
}

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
