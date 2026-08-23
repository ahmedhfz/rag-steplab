import type { DocumentActivityEventType, PipelineStepKey, PipelineStepState } from "@/lib/rag-ui-types";

export type AppLocale = "en" | "tr";
export type DetailLevel = "guided" | "technical";
export type AppNavKey = "overview" | "documents" | "parse" | "chunking" | "embeddings" | "playground" | "evaluation" | "settings" | "chunks" | "retrieval";
export type DocumentViewKey = "overview" | "parsed" | "chunks";

type DocumentViewCopy = {
  title: string;
  description: string;
};

export type AppCopy = {
  productName: string;
  learningMode: string;
  detailLevel: Record<DetailLevel, string>;
  nav: Record<AppNavKey, string> & {
    pipeline: string;
    experiment: string;
    system: string;
  };
  status: Record<PipelineStepState, string>;
  guides: string;
  help: string;
  guidePanel: { title: string; description: string };
  helpPanel: { title: string; description: string; settingsLink: string };
  footer: { localProject: string; backendStatus: string };
  common: {
    close: string;
    back: string;
    openNavigation: string;
    primaryNavigation: string;
    accountMenu: string;
    frontendFoundation: string;
    signOut: string;
    storagePending: string;
    backToOverview: string;
    learningHint: string;
  };
  overview: {
    title: string;
    steps: Record<PipelineStepKey, string>;
    pipelineStatus: string;
    noPipelineRun: string;
    pipelineHint: Record<DetailLevel, string>;
    uploadDocument: string;
    dropPdf: string;
    choosePdf: string;
    fileRequirements: string;
    noFileSent: string;
    selectedDocument: string;
    noDocumentSelected: string;
    fileName: string;
    size: string;
    status: string;
    removeSelected: string;
    localSelection: string;
    documentSelected: string;
    parse: string;
    backendActionNotConnected: string;
    parseDocument: string;
    reparseDocument: string;
    parseReady: string;
    parseQueued: string;
    parseRunning: string;
    parseProcessing: string;
    parseCompleted: string;
    parseFailed: string;
    parseReasonSelected: string;
    parseReasonEmpty: string;
    parseReasonPersisted: string;
    parseReasonReady: string;
    parseReasonProcessing: string;
    parseReasonQueued: string;
    parseReasonRunning: string;
    parseReasonCompleted: string;
    parseReasonError: string;
    parseSummary: string;
    openParsedContent: string;
    noParseSummary: string;
    activity: string;
    noActivity: string;
    parseProgress: string;
    parseProgressEstimated: string;
    activityEvents: Record<DocumentActivityEventType, string>;
    emptyFile: string;
    backendUnavailable: string;
    modalDispatchFailed: string;
    invalidResponse: string;
    doclingError: string;
    parseInterrupted: string;
    parsePollTimeout: string;
    unknownParseError: string;
    invalidPdf: string;
    fileTooLarge: string;
  };
  documents: {
    root: string;
    tabs: Record<DocumentViewKey, string>;
    views: Record<DocumentViewKey, DocumentViewCopy>;
    noDocumentTitle: string;
    metadataPending: string;
    document: string;
    fileName: string;
    size: string;
    noDocumentSelected: string;
    chooseFromOverview: string;
    parseSummary: string;
    noParseSummary: string;
    pages: string;
    noPages: string;
    parsedElements: string;
    noParsedElements: string;
    viewMode: string;
    structured: string;
    markdown: string;
    json: string;
    parsedViewsUnavailable: string;
    elementTypes: Record<"heading" | "paragraph" | "list" | "table" | "other", string>;
    page: string;
    pageElements: string;
    summaryFields: {
      pageCount: string;
      headingCount: string;
      paragraphCount: string;
      listCount: string;
      tableCount: string;
    };
    chunks: string;
    noChunks: string;
  };
  retrieval: {
    title: string;
    question: string;
    questionPlaceholder: string;
    clearQuestion: string;
    ask: string;
    askUnavailable: string;
    topK: string;
    mode: string;
    modes: { dense: string; hybrid: string; keyword: string };
    reranker: string;
    notConfigured: string;
    rerankerUnavailable: string;
    reset: string;
    nothingToReset: string;
    hint: Record<DetailLevel, string>;
    retrievedChunks: string;
    rank: string;
    score: string;
    sourceDocument: string;
    page: string;
    preview: string;
    noResults: string;
    resultsUnavailable: string;
    generatedAnswer: string;
    noAnswer: string;
    trace: string;
    copyTrace: string;
    traceUnavailable: string;
    time: string;
    step: string;
    component: string;
    details: string;
    inputOutput: string;
    noTrace: string;
  };
  settings: {
    title: string;
    description: string;
    languageTitle: string;
    languageDescription: string;
    english: string;
    turkish: string;
    detailTitle: string;
    detailDescription: string;
    guided: string;
    guidedDescription: string;
    technical: string;
    technicalDescription: string;
    hintsTitle: string;
    hintsDescription: string;
    hintsEnabled: string;
    hintsDisabled: string;
    resetTitle: string;
    resetDescription: string;
    reset: string;
    nothingToReset: string;
    preferencesSaved: string;
  };
  evaluation: {
    title: string;
    description: string;
    emptyTitle: string;
    emptyDescription: string;
    emptyNote: string;
  };
};

export const UI_COPY = {
  en: {
    productName: "RAG StepLab",
    learningMode: "Learning mode",
    detailLevel: { guided: "Guided", technical: "Technical" },
    nav: {
      overview: "Overview", documents: "Documents", parse: "Parse", chunking: "Chunking", embeddings: "Embeddings",
      playground: "Playground", evaluation: "Evaluation", settings: "Settings", chunks: "Chunks", retrieval: "Retrieval",
      pipeline: "Pipeline", experiment: "Experiment", system: "System",
    },
    status: { "Not started": "Not started", Ready: "Ready", Processing: "Processing", Completed: "Completed", Skipped: "Skipped", Error: "Error", Locked: "Locked", Stale: "Stale" },
    guides: "Guides",
    help: "Help",
    guidePanel: {
      title: "Learn the RAG flow",
      description: "Run a real PDF through every RAG stage and inspect each input, output, configuration, and lineage decision.",
    },
    helpPanel: {
      title: "About this lab",
      description: "This learning lab connects parsing, chunking, pgvector/FTS retrieval, reranking, context, grounded generation, citations, and evaluation.",
      settingsLink: "Open settings",
    },
    footer: { localProject: "RAG learning laboratory", backendStatus: "Backend: configured RAG API" },
    common: {
      close: "Close",
      back: "Back",
      openNavigation: "Open navigation",
      primaryNavigation: "Primary navigation",
      accountMenu: "Account menu",
      frontendFoundation: "Full pipeline lab",
      signOut: "Sign out",
      storagePending: "Loading preferences…",
      backToOverview: "Back to overview",
      learningHint: "Learning hint",
    },
    overview: {
      title: "RAG Pipeline",
      steps: { document: "Document", parse: "Parse", chunk: "Chunk", embed: "Embed", index: "Index", retrieve: "Retrieve", rerank: "Rerank", context: "Context", generate: "Generate", evaluate: "Evaluate" },
      pipelineStatus: "Pipeline Status",
      noPipelineRun: "No pipeline run yet.",
      pipelineHint: {
        guided: "Choose a PDF, then run Parse Document to send it through FastAPI and Docling. Later stages remain locked.",
        technical: "Selection is local until Parse Document is clicked. The parse state changes only from the real FastAPI response.",
      },
      uploadDocument: "Upload Document",
      dropPdf: "Drag and drop a PDF file here",
      choosePdf: "Choose PDF",
      fileRequirements: "PDF only • Max 50 MB",
      noFileSent: "No file is sent yet",
      selectedDocument: "Selected Document",
      noDocumentSelected: "No document selected.",
      fileName: "File Name",
      size: "Size",
      status: "Status",
      removeSelected: "Remove selected document",
      localSelection: "Selected locally",
      documentSelected: "Document selected",
      parse: "Parse",
      backendActionNotConnected: "FastAPI + Docling parser",
      parseDocument: "Parse Document",
      reparseDocument: "Reparse Document",
      parseReady: "Ready to send this PDF to FastAPI and Docling.",
      parseQueued: "Parse request queued. The worker will start when capacity is available.",
      parseRunning: "Docling is parsing the PDF. This can take a moment.",
      parseProcessing: "Docling is parsing the PDF. This can take a moment.",
      parseCompleted: "Parsing completed. The persisted parse run is ready for chunking.",
      parseFailed: "Parsing failed.",
      parseReasonReady: "Click Parse Document to start the real FastAPI → Docling request.",
      parseReasonQueued: "The parse request is queued for the Docling worker.",
      parseReasonRunning: "The PDF is being parsed by the Docling worker.",
      parseReasonProcessing: "The PDF is being parsed by Docling.",
      parseReasonCompleted: "Parse completed. You can inspect the returned content or run parsing again.",
      parseReasonError: "The PDF was sent, but the parser returned an error.",
      parseReasonSelected: "The PDF is selected and ready for parsing.",
      parseReasonEmpty: "Select a PDF first. Parsing sends the file to the local FastAPI parser.",
      parseReasonPersisted: "Reparse the stored source PDF. A successful new parse selects a new default while compatible history remains usable.",
      parseSummary: "Parse Summary",
      openParsedContent: "Open Parsed Content",
      noParseSummary: "No parse summary is available until a backend parser returns structured content.",
      activity: "Activity",
      noActivity: "No activity yet. Select a PDF to begin.",
      parseProgress: "Progress",
      parseProgressEstimated: "estimated",
      activityEvents: {
        documentSelected: "Document selected",
        parseRequested: "Parse requested",
        parsing: "Parsing",
        parseCompleted: "Parse completed",
        parseFailed: "Parse failed",
      },
      emptyFile: "The selected file is empty.",
      backendUnavailable: "The RAG backend could not be reached. Check the configured API and try again.",
      modalDispatchFailed: "The parse worker could not be started. The persisted run was marked failed; try again after the service recovers.",
      invalidResponse: "The backend returned an invalid parse result.",
      doclingError: "Docling could not parse this PDF. Try a different or non-corrupted PDF.",
      parseInterrupted: "The parse worker stopped before the document was completed. Try parsing again.",
      parsePollTimeout: "The parse may still be running. Browser polling stopped after 15 minutes; refresh the page to resume status checks.",
      unknownParseError: "The document could not be parsed.",
      invalidPdf: "Only PDF files are supported.",
      fileTooLarge: "The PDF must be 50 MB or smaller.",
    },
    documents: {
      root: "Documents",
      tabs: { overview: "Overview", parsed: "Parsed Content", chunks: "Chunks" },
      views: {
        overview: { title: "Document Overview", description: "Inspect document metadata and parse output before chunking." },
        parsed: { title: "Parsed Content", description: "Inspect structured elements returned by the parser." },
        chunks: { title: "Chunks", description: "Explore chunks after parsing and chunking are available." },
      },
      noDocumentTitle: "No document selected",
      metadataPending: "Document metadata will appear after a PDF is ingested by the backend.",
      document: "Document",
      fileName: "File name",
      size: "Size",
      noDocumentSelected: "No document is available yet.",
      chooseFromOverview: "Choose a PDF from Overview",
      parseSummary: "Parse Summary",
      noParseSummary: "No parse summary is available yet.",
      pages: "Pages",
      noPages: "No pages are available until parsing completes.",
      parsedElements: "Parsed Elements",
      noParsedElements: "Select a parsed page to inspect its elements.",
      viewMode: "Parsed content view mode",
      structured: "Structured",
      markdown: "Markdown",
      json: "JSON",
      parsedViewsUnavailable: "Views become available after a real parse completes.",
      elementTypes: { heading: "Heading", paragraph: "Paragraph", list: "List", table: "Table", other: "Other" },
      page: "Page",
      pageElements: "elements",
      summaryFields: { pageCount: "Pages", headingCount: "Headings", paragraphCount: "Paragraphs", listCount: "Lists", tableCount: "Tables" },
      chunks: "Chunks",
      noChunks: "No chunks are available until parsing and chunking complete.",
    },
    retrieval: {
      title: "Playground",
      question: "Question",
      questionPlaceholder: "Enter a question to prepare a retrieval request",
      clearQuestion: "Clear question",
      ask: "Ask",
      askUnavailable: "Ask becomes available after the active document has current chunks and embeddings.",
      topK: "Top-K",
      mode: "Mode",
      modes: { dense: "Dense", hybrid: "Hybrid", keyword: "Keyword" },
      reranker: "Reranker",
      notConfigured: "Not configured",
      rerankerUnavailable: "Reranking becomes available with a current retrieval-ready document.",
      reset: "Reset",
      nothingToReset: "No query settings have changed.",
      hint: {
        guided: "Choose retrieval settings, then run a real experiment against the active document.",
        technical: "These controls represent request parameters only. No vector search, reranking, or generation runs in the browser.",
      },
      retrievedChunks: "Retrieved Chunks",
      rank: "Rank",
      score: "Score",
      sourceDocument: "Source Document",
      page: "Page",
      preview: "Preview",
      noResults: "No retrieval results are available yet.",
      resultsUnavailable: "Results appear after a real retrieval experiment runs.",
      generatedAnswer: "Generated Answer",
      noAnswer: "No generated answer exists for the current experiment.",
      trace: "Retrieval Trace",
      copyTrace: "Copy trace",
      traceUnavailable: "Trace data will be available after a real retrieval run.",
      time: "Time",
      step: "Step",
      component: "Component",
      details: "Details",
      inputOutput: "Input / Output",
      noTrace: "No trace data is available yet.",
    },
    settings: {
      title: "Settings",
      description: "Choose how RAG StepLab presents the learning interface. These preferences are saved locally in this browser.",
      languageTitle: "Language",
      languageDescription: "Change the interface language.",
      english: "English",
      turkish: "Türkçe",
      detailTitle: "Technical detail",
      detailDescription: "Choose how much implementation detail to emphasize while learning.",
      guided: "Guided",
      guidedDescription: "Short explanations and the essential concepts first.",
      technical: "Technical",
      technicalDescription: "More implementation vocabulary and pipeline detail.",
      hintsTitle: "Learning hints",
      hintsDescription: "Keep contextual hints visible while exploring the lab.",
      hintsEnabled: "Show learning hints",
      hintsDisabled: "Hide learning hints",
      resetTitle: "Reset preferences",
      resetDescription: "Return language, detail level, and hints to their defaults.",
      reset: "Reset",
      nothingToReset: "Preferences already use the defaults.",
      preferencesSaved: "Changes are saved automatically.",
    },
    evaluation: {
      title: "Evaluation",
      description: "Compare retrieval and grounded-answer quality with persisted evaluation datasets and runs.",
      emptyTitle: "No evaluation data yet",
      emptyDescription: "Create a dataset after the active document has current chunks and embeddings, then run a real evaluation.",
      emptyNote: "This screen will host reproducible experiment results and comparisons without fabricating placeholder metrics.",
    },
  },
  tr: {
    productName: "RAG StepLab",
    learningMode: "Öğrenme modu",
    detailLevel: { guided: "Yönlendirmeli", technical: "Teknik" },
    nav: {
      overview: "Genel Bakış", documents: "Dokümanlar", parse: "Ayrıştırma", chunking: "Parçalama", embeddings: "Embedding",
      playground: "Deney Alanı", evaluation: "Değerlendirme", settings: "Ayarlar", chunks: "Parçalar", retrieval: "Getirme",
      pipeline: "Pipeline", experiment: "Deney", system: "Sistem",
    },
    status: { "Not started": "Başlatılmadı", Ready: "Hazır", Processing: "İşleniyor", Completed: "Tamamlandı", Skipped: "Atlandı", Error: "Hata", Locked: "Kilitli", Stale: "Eski" },
    guides: "Rehberler",
    help: "Yardım",
    guidePanel: {
      title: "RAG akışını öğren",
      description: "Gerçek bir PDF'i tüm RAG aşamalarından geçirin; her girdi, çıktı, ayar ve lineage kararını inceleyin.",
    },
    helpPanel: {
      title: "Bu laboratuvar hakkında",
      description: "Bu öğrenme laboratuvarı ayrıştırma, parçalama, pgvector/FTS getirme, yeniden sıralama, bağlam, grounded üretim, citations ve değerlendirmeyi bağlar.",
      settingsLink: "Ayarları aç",
    },
    footer: { localProject: "RAG öğrenme laboratuvarı", backendStatus: "Backend: yapılandırılmış RAG API" },
    common: {
      close: "Kapat",
      back: "Geri",
      openNavigation: "Gezinmeyi aç",
      primaryNavigation: "Birincil gezinme",
      accountMenu: "Hesap menüsü",
      frontendFoundation: "Tam pipeline laboratuvarı",
      signOut: "Çıkış yap",
      storagePending: "Tercihler yükleniyor…",
      backToOverview: "Genel bakışa dön",
      learningHint: "Öğrenme ipucu",
    },
    overview: {
      title: "RAG İşlem Hattı",
      steps: { document: "Doküman", parse: "Ayrıştır", chunk: "Parçala", embed: "Vektörleştir", index: "İndeksle", retrieve: "Getir", rerank: "Yeniden sırala", context: "Bağlam", generate: "Üret", evaluate: "Değerlendir" },
      pipelineStatus: "İşlem Hattı Durumu",
      noPipelineRun: "İşlem hattı henüz çalışmadı.",
      pipelineHint: {
        guided: "PDF'i ayrıştırın; ardından gerçek parçalama, embedding, getirme, üretim ve değerlendirme aşamalarını sırayla çalıştırın.",
        technical: "Seçim, Dokümanı Ayrıştır'a basılana kadar yereldir. Ayrıştırma durumu yalnız gerçek FastAPI yanıtıyla değişir.",
      },
      uploadDocument: "Doküman Yükle",
      dropPdf: "PDF dosyasını buraya sürükleyip bırakın",
      choosePdf: "PDF Seç",
      fileRequirements: "Yalnız PDF • En fazla 50 MB",
      noFileSent: "Henüz hiçbir dosya gönderilmedi",
      selectedDocument: "Seçili Doküman",
      noDocumentSelected: "Doküman seçilmedi.",
      fileName: "Dosya Adı",
      size: "Boyut",
      status: "Durum",
      removeSelected: "Seçili dokümanı kaldır",
      localSelection: "Yerel seçildi",
      documentSelected: "Doküman seçildi",
      parse: "Ayrıştırma",
      backendActionNotConnected: "FastAPI + Docling ayrıştırıcısı",
      parseDocument: "Dokümanı Ayrıştır",
      reparseDocument: "Dokümanı Yeniden Ayrıştır",
      parseReady: "Bu PDF FastAPI ve Docling'e gönderilmeye hazır.",
      parseQueued: "Ayrıştırma isteği sıraya alındı. Worker uygun olduğunda başlayacak.",
      parseRunning: "Docling PDF'i ayrıştırıyor. Bu işlem biraz sürebilir.",
      parseProcessing: "Docling PDF'i ayrıştırıyor. Bu işlem biraz sürebilir.",
      parseCompleted: "Ayrıştırma tamamlandı. Kalıcı parse run parçalama için hazır.",
      parseFailed: "Ayrıştırma başarısız.",
      parseReasonReady: "Gerçek FastAPI → Docling isteğini başlatmak için Dokümanı Ayrıştır'a tıklayın.",
      parseReasonQueued: "Ayrıştırma isteği Docling worker kuyruğunda bekliyor.",
      parseReasonRunning: "PDF Docling worker tarafından ayrıştırılıyor.",
      parseReasonProcessing: "PDF Docling tarafından ayrıştırılıyor.",
      parseReasonCompleted: "Ayrıştırma tamamlandı. Dönen içeriği inceleyebilir veya yeniden çalıştırabilirsiniz.",
      parseReasonError: "PDF gönderildi ancak ayrıştırıcı hata döndürdü.",
      parseReasonSelected: "PDF seçildi ve ayrıştırmaya hazır.",
      parseReasonEmpty: "Önce PDF seçin. Ayrıştırma dosyayı yerel FastAPI ayrıştırıcısına gönderir.",
      parseReasonPersisted: "Saklanan kaynak PDF'i yeniden ayrıştırır. Başarılı yeni parse yeni default'u seçer; uyumlu tarihçe kullanılabilir kalır.",
      parseSummary: "Ayrıştırma Özeti",
      openParsedContent: "Ayrıştırılmış İçeriği Aç",
      noParseSummary: "Backend ayrıştırıcısı yapısal içerik döndürene kadar ayrıştırma özeti bulunmaz.",
      activity: "Aktivite",
      noActivity: "Henüz aktivite yok. Başlamak için PDF seçin.",
      parseProgress: "İlerleme",
      parseProgressEstimated: "tahmini",
      activityEvents: {
        documentSelected: "Doküman seçildi",
        parseRequested: "Ayrıştırma istendi",
        parsing: "Ayrıştırılıyor",
        parseCompleted: "Ayrıştırma tamamlandı",
        parseFailed: "Ayrıştırma başarısız",
      },
      emptyFile: "Seçilen dosya boş.",
      backendUnavailable: "RAG backend'ine ulaşılamadı. FastAPI'yi 8000 portunda başlatıp tekrar deneyin.",
      modalDispatchFailed: "Parse worker başlatılamadı. Kalıcı run başarısız olarak işaretlendi; servis düzeldiğinde tekrar deneyin.",
      invalidResponse: "Backend geçersiz bir ayrıştırma sonucu döndürdü.",
      doclingError: "Docling bu PDF'i ayrıştıramadı. Farklı veya bozulmamış bir PDF deneyin.",
      parseInterrupted: "Ayrıştırma worker'ı doküman tamamlanmadan durdu. Tekrar ayrıştırmayı deneyin.",
      parsePollTimeout: "Ayrıştırma hâlâ sürüyor olabilir. Tarayıcı takibi 15 dakika sonra durdu; durum takibini sürdürmek için sayfayı yenileyin.",
      unknownParseError: "Doküman ayrıştırılamadı.",
      invalidPdf: "Yalnız PDF dosyaları desteklenir.",
      fileTooLarge: "PDF 50 MB veya daha küçük olmalıdır.",
    },
    documents: {
      root: "Dokümanlar",
      tabs: { overview: "Genel Bakış", parsed: "Ayrıştırılmış İçerik", chunks: "Parçalar" },
      views: {
        overview: { title: "Doküman Genel Bakışı", description: "Parçalama öncesinde doküman üst verisini ve ayrıştırma çıktısını inceleyin." },
        parsed: { title: "Ayrıştırılmış İçerik", description: "Ayrıştırıcı tarafından döndürülen yapısal öğeleri inceleyin." },
        chunks: { title: "Parçalar", description: "Ayrıştırma ve parçalama hazır olduğunda içerik parçalarını inceleyin." },
      },
      noDocumentTitle: "Doküman seçilmedi",
      metadataPending: "PDF backend tarafından alındıktan sonra dokümanın üst verileri burada görünür.",
      document: "Doküman",
      fileName: "Dosya adı",
      size: "Boyut",
      noDocumentSelected: "Henüz kullanılabilir doküman yok.",
      chooseFromOverview: "Genel Bakıştan PDF seç",
      parseSummary: "Ayrıştırma Özeti",
      noParseSummary: "Henüz ayrıştırma özeti yok.",
      pages: "Sayfalar",
      noPages: "Ayrıştırma tamamlanana kadar sayfa bulunmaz.",
      parsedElements: "Ayrıştırılmış Öğeler",
      noParsedElements: "Öğelerini incelemek için ayrıştırılmış bir sayfa seçin.",
      viewMode: "Ayrıştırılmış içerik görünüm modu",
      structured: "Yapısal",
      markdown: "Markdown",
      json: "JSON",
      parsedViewsUnavailable: "Gerçek bir ayrıştırma tamamlandıktan sonra görünümler kullanılabilir.",
      elementTypes: { heading: "Başlık", paragraph: "Paragraf", list: "Liste", table: "Tablo", other: "Diğer" },
      page: "Sayfa",
      pageElements: "öğe",
      summaryFields: { pageCount: "Sayfa", headingCount: "Başlık", paragraphCount: "Paragraf", listCount: "Liste", tableCount: "Tablo" },
      chunks: "Parçalar",
      noChunks: "Ayrıştırma ve parçalama tamamlanana kadar içerik parçası bulunmaz.",
    },
    retrieval: {
      title: "Deney Alanı",
      question: "Soru",
      questionPlaceholder: "Getirme isteği hazırlamak için soru girin",
      clearQuestion: "Soruyu temizle",
      ask: "Sor",
      askUnavailable: "Aktif dokümanın güncel parçaları ve embedding'leri hazır olduğunda soru gönderilebilir.",
      topK: "Top-K",
      mode: "Mod",
      modes: { dense: "Dense", hybrid: "Hybrid", keyword: "Keyword" },
      reranker: "Reranker",
      notConfigured: "Yapılandırılmadı",
      rerankerUnavailable: "Güncel ve getirmeye hazır bir dokümanla yeniden sıralama kullanılabilir.",
      reset: "Sıfırla",
      nothingToReset: "Sorgu ayarlarında değişiklik yok.",
      hint: {
        guided: "Getirme ayarlarını seçin, ardından aktif dokümana karşı gerçek bir deney çalıştırın.",
        technical: "Bu kontroller yalnızca istek parametrelerini temsil eder. Tarayıcıda vektör arama, yeniden sıralama veya yanıt üretimi çalışmaz.",
      },
      retrievedChunks: "Getirilen Parçalar",
      rank: "Sıra",
      score: "Skor",
      sourceDocument: "Kaynak Doküman",
      page: "Sayfa",
      preview: "Önizleme",
      noResults: "Henüz getirme sonucu yok.",
      resultsUnavailable: "Gerçek bir getirme deneyi çalıştıktan sonra sonuçlar burada görünür.",
      generatedAnswer: "Üretilen Cevap",
      noAnswer: "Mevcut deney için üretilmiş cevap yok.",
      trace: "Getirme İzi",
      copyTrace: "İzi kopyala",
      traceUnavailable: "Gerçek getirme çalışmasından sonra iz verisi kullanılabilir.",
      time: "Zaman",
      step: "Adım",
      component: "Bileşen",
      details: "Detaylar",
      inputOutput: "Girdi / Çıktı",
      noTrace: "Henüz iz verisi yok.",
    },
    settings: {
      title: "Ayarlar",
      description: "RAG StepLab'in öğrenme arayüzünü nasıl sunacağını seçin. Bu tercihler bu tarayıcıya kaydedilir.",
      languageTitle: "Dil",
      languageDescription: "Arayüz dilini değiştirin.",
      english: "English",
      turkish: "Türkçe",
      detailTitle: "Teknik detay",
      detailDescription: "Öğrenirken ne kadar uygulama detayının öne çıkarılacağını seçin.",
      guided: "Yönlendirmeli",
      guidedDescription: "Önce kısa açıklamalar ve temel kavramlar.",
      technical: "Teknik",
      technicalDescription: "Daha fazla uygulama terminolojisi ve işlem hattı detayı.",
      hintsTitle: "Öğrenme ipuçları",
      hintsDescription: "Laboratuvarı incelerken bağlamsal ipuçlarını görünür tutun.",
      hintsEnabled: "Öğrenme ipuçlarını göster",
      hintsDisabled: "Öğrenme ipuçlarını gizle",
      resetTitle: "Tercihleri sıfırla",
      resetDescription: "Dil, detay seviyesi ve ipuçlarını varsayılanlara döndürün.",
      reset: "Sıfırla",
      nothingToReset: "Tercihler zaten varsayılan değerlerde.",
      preferencesSaved: "Değişiklikler otomatik kaydedilir.",
    },
    evaluation: {
      title: "Değerlendirme",
      description: "Kalıcı değerlendirme veri setleri ve çalışmalarıyla getirme ve grounded cevap kalitesini karşılaştırın.",
      emptyTitle: "Henüz değerlendirme verisi yok",
      emptyDescription: "Aktif dokümanın güncel parçaları ve embedding'leri hazır olduktan sonra veri seti oluşturup gerçek değerlendirme çalıştırın.",
      emptyNote: "Bu ekran sahte metrik üretmeden tekrarlanabilir deney sonuçlarını ve karşılaştırmaları barındıracaktır.",
    },
  },
} as const satisfies Record<AppLocale, AppCopy>;
