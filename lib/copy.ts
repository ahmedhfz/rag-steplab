import type { DocumentActivityEventType, PipelineStepKey, PipelineStepState } from "@/lib/rag-ui-types";

export type AppLocale = "en" | "tr";
export type DetailLevel = "guided" | "technical";
export type AppNavKey = "overview" | "documents" | "chunks" | "retrieval" | "evaluation" | "settings";
export type DocumentViewKey = "overview" | "parsed" | "chunks";

type DocumentViewCopy = {
  title: string;
  description: string;
};

export type AppCopy = {
  productName: string;
  learningMode: string;
  detailLevel: Record<DetailLevel, string>;
  nav: Record<AppNavKey, string>;
  status: Record<PipelineStepState, string>;
  guides: string;
  help: string;
  guidePanel: { title: string; description: string };
  helpPanel: { title: string; description: string; settingsLink: string };
  footer: { localProject: string; backendStatus: string };
  common: {
    close: string;
    openNavigation: string;
    primaryNavigation: string;
    frontendFoundation: string;
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
    parseReady: string;
    parseProcessing: string;
    parseCompleted: string;
    parseFailed: string;
    parseReasonSelected: string;
    parseReasonEmpty: string;
    parseReasonReady: string;
    parseReasonProcessing: string;
    parseReasonCompleted: string;
    parseReasonError: string;
    parseSummary: string;
    openParsedContent: string;
    noParseSummary: string;
    activity: string;
    noActivity: string;
    activityEvents: Record<DocumentActivityEventType, string>;
    emptyFile: string;
    backendUnavailable: string;
    invalidResponse: string;
    doclingError: string;
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
    nav: { overview: "Overview", documents: "Documents", chunks: "Chunks", retrieval: "Retrieval", evaluation: "Evaluation", settings: "Settings" },
    status: { "Not started": "Not started", Ready: "Ready", Processing: "Processing", Completed: "Completed", Error: "Error", Locked: "Locked" },
    guides: "Guides",
    help: "Help",
    guidePanel: {
      title: "Learn the RAG flow",
      description: "Follow the pipeline stages, send a PDF through the local parser, and inspect what becomes available before chunking.",
    },
    helpPanel: {
      title: "About this lab",
      description: "This local learning lab now connects the Document → FastAPI → Docling → Parsed Content stage. Later RAG stages remain locked.",
      settingsLink: "Open settings",
    },
    footer: { localProject: "Local learning project", backendStatus: "Backend: local parser" },
    common: {
      close: "Close",
      openNavigation: "Open navigation",
      primaryNavigation: "Primary navigation",
      frontendFoundation: "Frontend foundation",
      storagePending: "Loading preferences…",
      backToOverview: "Back to overview",
      learningHint: "Learning hint",
    },
    overview: {
      title: "RAG Pipeline",
      steps: { document: "Document", parse: "Parse", chunk: "Chunk", embed: "Embed", index: "Index", retrieve: "Retrieve", generate: "Generate" },
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
      parseReady: "Ready to send this PDF to FastAPI and Docling.",
      parseProcessing: "Docling is parsing the PDF. This can take a moment.",
      parseCompleted: "Parsing completed. Chunking remains locked for now.",
      parseFailed: "Parsing failed.",
      parseReasonReady: "Click Parse Document to start the real FastAPI → Docling request.",
      parseReasonProcessing: "The PDF is being parsed by Docling.",
      parseReasonCompleted: "Parse completed. You can inspect the returned content or run parsing again.",
      parseReasonError: "The PDF was sent, but the parser returned an error.",
      parseReasonSelected: "The PDF is selected and ready for parsing.",
      parseReasonEmpty: "Select a PDF first. Parsing sends the file to the local FastAPI parser.",
      parseSummary: "Parse Summary",
      openParsedContent: "Open Parsed Content",
      noParseSummary: "No parse summary is available until a backend parser returns structured content.",
      activity: "Activity",
      noActivity: "No activity yet. Select a PDF to begin.",
      activityEvents: {
        documentSelected: "Document selected",
        parseRequested: "Parse requested",
        parsing: "Parsing",
        parseCompleted: "Parse completed",
        parseFailed: "Parse failed",
      },
      emptyFile: "The selected file is empty.",
      backendUnavailable: "The parsing backend could not be reached. Start FastAPI on port 8000 and try again.",
      invalidResponse: "The backend returned an invalid parse result.",
      doclingError: "Docling could not parse this PDF. Try a different or non-corrupted PDF.",
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
      title: "Retrieval Playground",
      question: "Question",
      questionPlaceholder: "Enter a question to prepare a retrieval request",
      clearQuestion: "Clear question",
      ask: "Ask",
      askUnavailable: "Ask is disabled until a retrieval backend and indexed content are connected.",
      topK: "Top-K",
      mode: "Mode",
      modes: { dense: "Dense", hybrid: "Hybrid", keyword: "Keyword" },
      reranker: "Reranker",
      notConfigured: "Not configured",
      rerankerUnavailable: "Reranker options become available after retrieval is connected.",
      reset: "Reset",
      nothingToReset: "No query settings have changed.",
      hint: {
        guided: "Configure the request now; results will remain empty until retrieval is connected.",
        technical: "These controls represent request parameters only. No vector search, reranking, or generation runs in the browser.",
      },
      retrievedChunks: "Retrieved Chunks",
      rank: "Rank",
      score: "Score",
      sourceDocument: "Source Document",
      page: "Page",
      preview: "Preview",
      noResults: "No retrieval results are available yet.",
      resultsUnavailable: "Results will appear after a retrieval backend is connected.",
      generatedAnswer: "Generated Answer",
      noAnswer: "No answer is available. Retrieval and generation are not connected.",
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
      description: "Compare retrieval and answer quality once an evaluation dataset and backend are connected.",
      emptyTitle: "No evaluation data yet",
      emptyDescription: "Evaluation needs a dataset and a real RAG run. Neither is connected yet.",
      emptyNote: "This screen will host reproducible experiment results and comparisons without fabricating placeholder metrics.",
    },
  },
  tr: {
    productName: "RAG StepLab",
    learningMode: "Öğrenme modu",
    detailLevel: { guided: "Yönlendirmeli", technical: "Teknik" },
    nav: { overview: "Genel Bakış", documents: "Dokümanlar", chunks: "Parçalar", retrieval: "Getirme", evaluation: "Değerlendirme", settings: "Ayarlar" },
    status: { "Not started": "Başlatılmadı", Ready: "Hazır", Processing: "İşleniyor", Completed: "Tamamlandı", Error: "Hata", Locked: "Kilitli" },
    guides: "Rehberler",
    help: "Yardım",
    guidePanel: {
      title: "RAG akışını öğren",
      description: "İşlem hattı aşamalarını takip edin, PDF'i yerel ayrıştırıcıdan geçirin ve parçalamadan önce ne oluştuğunu inceleyin.",
    },
    helpPanel: {
      title: "Bu laboratuvar hakkında",
      description: "Bu yerel öğrenme laboratuvarı artık Doküman → FastAPI → Docling → Ayrıştırılmış İçerik aşamasını çalıştırır. Sonraki RAG aşamaları kilitlidir.",
      settingsLink: "Ayarları aç",
    },
    footer: { localProject: "Yerel öğrenme projesi", backendStatus: "Backend: yerel ayrıştırıcı" },
    common: {
      close: "Kapat",
      openNavigation: "Gezinmeyi aç",
      primaryNavigation: "Birincil gezinme",
      frontendFoundation: "Frontend temeli",
      storagePending: "Tercihler yükleniyor…",
      backToOverview: "Genel bakışa dön",
      learningHint: "Öğrenme ipucu",
    },
    overview: {
      title: "RAG İşlem Hattı",
      steps: { document: "Doküman", parse: "Ayrıştır", chunk: "Parçala", embed: "Vektörleştir", index: "İndeksle", retrieve: "Getir", generate: "Üret" },
      pipelineStatus: "İşlem Hattı Durumu",
      noPipelineRun: "İşlem hattı henüz çalışmadı.",
      pipelineHint: {
        guided: "PDF seçin ve Dokümanı Ayrıştır'a tıklayarak FastAPI ve Docling akışını başlatın. Sonraki aşamalar kilitli kalır.",
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
      parseReady: "Bu PDF FastAPI ve Docling'e gönderilmeye hazır.",
      parseProcessing: "Docling PDF'i ayrıştırıyor. Bu işlem biraz sürebilir.",
      parseCompleted: "Ayrıştırma tamamlandı. Parçalama şimdilik kilitli.",
      parseFailed: "Ayrıştırma başarısız.",
      parseReasonReady: "Gerçek FastAPI → Docling isteğini başlatmak için Dokümanı Ayrıştır'a tıklayın.",
      parseReasonProcessing: "PDF Docling tarafından ayrıştırılıyor.",
      parseReasonCompleted: "Ayrıştırma tamamlandı. Dönen içeriği inceleyebilir veya yeniden çalıştırabilirsiniz.",
      parseReasonError: "PDF gönderildi ancak ayrıştırıcı hata döndürdü.",
      parseReasonSelected: "PDF seçildi ve ayrıştırmaya hazır.",
      parseReasonEmpty: "Önce PDF seçin. Ayrıştırma dosyayı yerel FastAPI ayrıştırıcısına gönderir.",
      parseSummary: "Ayrıştırma Özeti",
      openParsedContent: "Ayrıştırılmış İçeriği Aç",
      noParseSummary: "Backend ayrıştırıcısı yapısal içerik döndürene kadar ayrıştırma özeti bulunmaz.",
      activity: "Aktivite",
      noActivity: "Henüz aktivite yok. Başlamak için PDF seçin.",
      activityEvents: {
        documentSelected: "Doküman seçildi",
        parseRequested: "Ayrıştırma istendi",
        parsing: "Ayrıştırılıyor",
        parseCompleted: "Ayrıştırma tamamlandı",
        parseFailed: "Ayrıştırma başarısız",
      },
      emptyFile: "Seçilen dosya boş.",
      backendUnavailable: "Ayrıştırma backend'ine ulaşılamadı. FastAPI'yi 8000 portunda başlatıp tekrar deneyin.",
      invalidResponse: "Backend geçersiz bir ayrıştırma sonucu döndürdü.",
      doclingError: "Docling bu PDF'i ayrıştıramadı. Farklı veya bozulmamış bir PDF deneyin.",
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
      title: "Getirme Deney Alanı",
      question: "Soru",
      questionPlaceholder: "Getirme isteği hazırlamak için soru girin",
      clearQuestion: "Soruyu temizle",
      ask: "Sor",
      askUnavailable: "Getirme backend'i ve indekslenmiş içerik bağlanana kadar soru gönderilemez.",
      topK: "Top-K",
      mode: "Mod",
      modes: { dense: "Dense", hybrid: "Hybrid", keyword: "Keyword" },
      reranker: "Reranker",
      notConfigured: "Yapılandırılmadı",
      rerankerUnavailable: "Getirme bağlandıktan sonra yeniden sıralama seçenekleri kullanılabilir.",
      reset: "Sıfırla",
      nothingToReset: "Sorgu ayarlarında değişiklik yok.",
      hint: {
        guided: "İsteği şimdi yapılandırabilirsiniz; getirme altyapısı bağlanana kadar sonuçlar boş kalır.",
        technical: "Bu kontroller yalnızca istek parametrelerini temsil eder. Tarayıcıda vektör arama, yeniden sıralama veya yanıt üretimi çalışmaz.",
      },
      retrievedChunks: "Getirilen Parçalar",
      rank: "Sıra",
      score: "Skor",
      sourceDocument: "Kaynak Doküman",
      page: "Sayfa",
      preview: "Önizleme",
      noResults: "Henüz getirme sonucu yok.",
      resultsUnavailable: "Getirme backend'i bağlandıktan sonra sonuçlar burada görünür.",
      generatedAnswer: "Üretilen Cevap",
      noAnswer: "Henüz cevap yok. Getirme ve üretim bağlı değil.",
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
      description: "Bir değerlendirme veri seti ve backend bağlandığında getirme ve cevap kalitesini karşılaştırın.",
      emptyTitle: "Henüz değerlendirme verisi yok",
      emptyDescription: "Değerlendirme için veri seti ve gerçek RAG çalışması gerekir. Henüz ikisi de bağlı değil.",
      emptyNote: "Bu ekran sahte metrik üretmeden tekrarlanabilir deney sonuçlarını ve karşılaştırmaları barındıracaktır.",
    },
  },
} as const satisfies Record<AppLocale, AppCopy>;
