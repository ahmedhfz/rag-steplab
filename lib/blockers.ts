import type { AppLocale } from "@/lib/copy";
import type { DocumentLineageSelection, DocumentPipeline, RetrievalMode, RunSummary } from "@/lib/rag-api-types";

export type BlockerCode =
  | "loading"
  | "processing"
  | "missing_document"
  | "missing_pipeline"
  | "missing_parse"
  | "missing_chunk"
  | "missing_embedding"
  | "missing_experiment"
  | "missing_question"
  | "missing_dataset"
  | "missing_dataset_name"
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
  /** Provider workspace status; blockers are not evaluated while it is "loading". */
  workspaceStatus?: "loading" | "ready" | "unavailable";
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
    loading: "Loading the workspace…",
    processing: "This operation is already running. Its real status will appear here when it completes.",
    missingDocument: "Select a document to continue.",
    missingPipeline: "Select an indexing pipeline to continue.",
    missingParse: "Parse the document first. Chunking and later stages use its parsed content.",
    missingChunk: "Create chunks first, or select a compatible result from the pipeline history.",
    missingEmbedding: "Dense and hybrid retrieval require embeddings. Create embeddings or switch to Keyword.",
    missingExperiment: "Run a retrieval experiment first to inspect its results.",
    missingQuestion: "Enter a question to run retrieval.",
    missingDataset: "Create or select an evaluation dataset before running evaluation.",
    missingDatasetName: "Enter a dataset name.",
    missingSources: "Select at least one parsed source for the evaluation question.",
    invalidConfig: "Check the configuration values and try again.",
    backendUnavailable: "The RAG service is temporarily unavailable. Retry shortly.",
    incompatibleLineage: "This result does not match the current pipeline. Select a compatible result from its history.",
  },
  tr: {
    loading: "Çalışma alanı yükleniyor…",
    processing: "Bu işlem zaten çalışıyor. Tamamlandığında gerçek durum burada görünecek.",
    missingDocument: "Devam etmek için bir doküman seçin.",
    missingPipeline: "Devam etmek için bir indexing pipeline seçin.",
    missingParse: "Önce dokümanı ayrıştırın. Chunking ve sonraki aşamalar ayrıştırılmış içeriği kullanır.",
    missingChunk: "Önce parçaları oluşturun veya pipeline geçmişinden uyumlu bir sonuç seçin.",
    missingEmbedding: "Dense ve hybrid retrieval embedding gerektirir. Embedding oluşturun veya Keyword seçin.",
    missingExperiment: "Sonuçları incelemek için önce bir retrieval deneyi çalıştırın.",
    missingQuestion: "Retrieval çalıştırmak için bir soru girin.",
    missingDataset: "Evaluation çalıştırmadan önce bir dataset oluşturun veya seçin.",
    missingDatasetName: "Bir dataset adı girin.",
    missingSources: "Evaluation sorusu için en az bir ayrıştırılmış kaynak seçin.",
    invalidConfig: "Ayar değerlerini kontrol edip tekrar deneyin.",
    backendUnavailable: "RAG servisi geçici olarak kullanılamıyor. Kısa süre sonra tekrar deneyin.",
    incompatibleLineage: "Bu sonuç geçerli pipeline ile eşleşmiyor. Geçmişten uyumlu bir sonuç seçin.",
  },
} as const;

const actionCopy = {
  en: {
    loading: "Wait for the workspace to load.",
    processing: "Wait for the current operation to finish.",
    missingDocument: "Select a document.",
    missingPipeline: "Select or create a pipeline.",
    missingParse: "Parse the document.",
    missingChunk: "Create or select compatible chunks.",
    missingEmbedding: "Create or select compatible embeddings.",
    missingExperiment: "Run a retrieval experiment.",
    missingQuestion: "Enter a question.",
    missingDataset: "Create or select an evaluation dataset.",
    missingDatasetName: "Name the dataset.",
    missingSources: "Add a parsed source element.",
    invalidConfig: "Correct the configuration.",
    backendUnavailable: "Try again when the RAG service is available.",
    incompatibleLineage: "Select a compatible result from the current pipeline.",
  },
  tr: {
    loading: "Çalışma alanının yüklenmesini bekleyin.",
    processing: "Mevcut işlemin tamamlanmasını bekleyin.",
    missingDocument: "Bir doküman seçin.",
    missingPipeline: "Bir pipeline seçin veya oluşturun.",
    missingParse: "Dokümanı ayrıştırın.",
    missingChunk: "Uyumlu parçalar oluşturun veya seçin.",
    missingEmbedding: "Uyumlu embedding'ler oluşturun veya seçin.",
    missingExperiment: "Bir retrieval deneyi çalıştırın.",
    missingQuestion: "Bir soru girin.",
    missingDataset: "Bir evaluation dataset'i oluşturun veya seçin.",
    missingDatasetName: "Dataset'e bir ad verin.",
    missingSources: "Parse edilmiş bir kaynak elementi ekleyin.",
    invalidConfig: "Ayarları düzeltin.",
    backendUnavailable: "RAG servisi kullanılabilir olduğunda tekrar deneyin.",
    incompatibleLineage: "Geçerli pipeline'dan uyumlu bir sonuç seçin.",
  },
} as const;

const blockerHref: Record<BlockerCode, string | null> = {
  loading: null,
  processing: null,
  missing_document: "/documents",
  missing_pipeline: "/",
  missing_parse: "/parse",
  missing_chunk: "/chunking",
  missing_embedding: "/embeddings",
  missing_experiment: "/playground",
  missing_question: "/playground",
  missing_dataset: "/evaluation",
  missing_dataset_name: null,
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
  if (input.workspaceStatus === "unavailable" || input.persistenceStatus === "unavailable") return availabilityBlocker(locale, "backend_unavailable");
  if (input.workspaceStatus === "loading" || input.persistenceStatus === "checking") return availabilityBlocker(locale, "loading");
  if (input.processing) return availabilityBlocker(locale, "processing");
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
  const key = code.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()) as keyof typeof copy.en;
  return { code, message: copy[locale][key] };
}

export function firstBlocker(locale: AppLocale, checks: Array<[boolean, BlockerCode]>): Blocker | null {
  const match = checks.find(([isBlocked]) => isBlocked);
  return match ? blocker(locale, match[1]) : null;
}
