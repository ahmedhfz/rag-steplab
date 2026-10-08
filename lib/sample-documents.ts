import type { AppLocale } from "@/lib/copy";

/** Hashes of the shipped PDFs; filename alone must never identify a sample. */
export const SAMPLE_DOCUMENTS = {
  tr: {
    path: "/samples/rag-steplab-ornek-kent-bisikleti.pdf",
    fileName: "rag-steplab-ornek-kent-bisikleti.pdf",
    sha256: "83789f2571faa5c65df8901b85c2cec53bc1417bc3603f5fbc91f7ebc77d29f2",
    questions: [
      "Pilot ne zaman ve hangi mahallelerde yürütülür?",
      "Yolculuk ücreti ve günlük üst sınır nedir?",
      "Arızalı bisikletlere nasıl müdahale edilir?",
    ],
  },
  en: {
    path: "/samples/rag-steplab-sample-city-bikes.pdf",
    fileName: "rag-steplab-sample-city-bikes.pdf",
    sha256: "d38d658d92e9c469dae061550f1ef5736ee89ce2c2d322a49529e215513584cb",
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
