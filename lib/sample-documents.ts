import type { AppLocale } from "@/lib/copy";

/** Hashes of the shipped PDFs; filename alone must never identify a sample. */
export const SAMPLE_DOCUMENTS = {
  tr: {
    path: "/samples/rag-steplab-ornek-kent-bisikleti.pdf",
    fileName: "rag-steplab-ornek-kent-bisikleti.pdf",
    sha256: "28b3d0b8846ef6063f8cbc1cc71eb379d1db7ce576f9f423b73417ce505470db",
    questions: [
      "Pilot ne zaman ve hangi mahallelerde yürütülür?",
      "Yolculuk ücreti ve günlük üst sınır nedir?",
      "Arızalı bisikletlere nasıl müdahale edilir?",
    ],
  },
  en: {
    path: "/samples/rag-steplab-sample-city-bikes.pdf",
    fileName: "rag-steplab-sample-city-bikes.pdf",
    sha256: "ee26ecb099d9a1fba771ce9b4f8e82664a4b6982e5dec7a638350fa1e3e7b8a7",
    questions: [
      "When and where does the pilot run?",
      "What are the ride price and daily cap?",
      "How are broken bikes handled?",
    ],
  },
} as const;

export function sampleForHash(sha256: string | null | undefined) {
  if (!sha256) return null;
  return Object.values(SAMPLE_DOCUMENTS).find((sample) => sample.sha256 === sha256.toLowerCase()) ?? null;
}

export function sampleForLocale(locale: AppLocale) {
  return SAMPLE_DOCUMENTS[locale];
}
