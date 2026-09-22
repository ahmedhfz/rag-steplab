"""Generate the two small, selectable-text PDFs used by the first-use flow."""

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.utils import simpleSplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "samples"
FONT_ROOT = Path("C:/Windows/Fonts")
PAGE_WIDTH, PAGE_HEIGHT = 595, 842
INK = colors.HexColor("#26212a")
MUTED = colors.HexColor("#625b65")
ACCENT = colors.HexColor("#8f3c61")

pdfmetrics.registerFont(TTFont("Arial", str(FONT_ROOT / "arial.ttf")))
pdfmetrics.registerFont(TTFont("Arial-Bold", str(FONT_ROOT / "arialbd.ttf")))


DOCUMENTS = {
    "tr": {
        "file": "rag-steplab-ornek-kent-bisikleti.pdf",
        "title": "Kent Bisikleti Pilot Rehberi",
        "subtitle": "RAG StepLab için kurgusal, açık örnek doküman",
        "sections": [
            (
                "1 · Pilotun özeti",
                "Kıyı Kent Bisikleti pilotu 1 Nisan–30 Eylül 2025 tarihleri arasında yürütülür. "
                "Amaç, üç mahallede kısa mesafeli ulaşımın erişilebilirliğini ölçmektir. "
                "Pilot tamamen kurgusaldır; bu belge gerçek bir belediye politikasını anlatmaz.",
                "İlk aşamada 24 istasyon ve 180 bisiklet vardır. İstasyonlar Merkez, Liman ve Üniversite "
                "mahallelerine dağılır. Filonun 30 bisikleti elektrik desteklidir. Programın sahibi "
                "Ulaşım İnovasyon Ekibi, operasyon sorumlusu ise Derya Aksoy'dur.",
                "Pilotun başarı ölçütü aylık en az 12.000 yolculuk ve kullanıcıların en az %85'inin "
                "istasyonda kullanılabilir bisiklet bulmasıdır. Bu değerler hedeflerdir, gerçekleşmiş "
                "sonuçlar değildir.",
            ),
            (
                "2 · Kullanım ve ücretlendirme",
                "Kayıt mobil uygulamada e-posta doğrulamasıyla tamamlanır. Kullanıcılar istasyondaki QR "
                "kodunu okutarak bisiklet açar. Her yolculuğun ilk 15 dakikası ücretsizdir; sonraki "
                "her 15 dakika için 10 TL alınır. Günlük ücret üst sınırı 80 TL'dir.",
                "Elektrik destekli bisikletlerde aynı dakika tarifesi uygulanır. Ancak bu bisikletler "
                "yalnızca Merkez ve Üniversite istasyonlarından teslim alınabilir. Liman'da iade edilebilirler.",
                "Pilot döneminde ücret iadesi talepleri uygulamadaki Destek menüsünden yapılır. "
                "İstasyon boşsa kullanıcı haritadan yakındaki bir istasyonu seçebilir; rezervasyon özelliği yoktur.",
            ),
            (
                "3 · İşletim ve veriler",
                "Saha ekibi istasyonları her gün 06.00 ve 18.00'de kontrol eder. Arızalı bisiklet "
                "uygulamada kullanıma kapatılır ve en geç 48 saat içinde incelenir. Güvenlik riski "
                "bildirimi gelirse bisiklet hemen devre dışı bırakılır.",
                "Yolculuk kayıtları başlangıç ve bitiş istasyonu, süre, bisiklet kimliği ve ücret tutarını "
                "içerir. Pilot analizi için kimliksizleştirilmiş yolculuk verisi kullanılır. Ham yolculuk "
                "kayıtları 90 gün sonunda silinir; toplulaştırılmış raporlar pilot bitimine kadar saklanır.",
                "Haftalık operasyon raporu her pazartesi hazırlanır. Rapor kullanım sayısını, kullanılabilir "
                "bisiklet oranını ve açık arıza sayısını gösterir. Kişisel yolculuk geçmişi rapora eklenmez.",
            ),
            (
                "4 · Değerlendirme ve sınırlar",
                "Pilot değerlendirmesi 15 Ekim 2025'te yapılır. Ekip, aylık yolculuk hedefini ve "
                "%85 kullanılabilirlik hedefini birlikte inceler. Hedefler karşılanmadığında istasyon "
                "yerleşimi ve bakım sıklığı gözden geçirilir; kalıcı yaygınlaştırma kararı otomatik verilmez.",
                "Bu belge dört sayfalık bir RAG öğrenme örneğidir. Sorular farklı sayfalardaki açık "
                "bilgilere dayanmalıdır. Metinde bulunmayan bir olayı veya sonucu sistemin uydurması "
                "beklenmez. Özellikle hedeflerle gerçekleşmiş metrikler birbirine karıştırılmamalıdır.",
                "Örnek sorular: Pilot ne zaman ve nerede yürütülür? Ücret ve günlük üst sınır nedir? "
                "Arızalı bisikletlere nasıl müdahale edilir? Başarı hangi iki hedefle ölçülür?",
            ),
        ],
    },
    "en": {
        "file": "rag-steplab-sample-city-bikes.pdf",
        "title": "City Bike Pilot Guide",
        "subtitle": "A fictional, open sample document for RAG StepLab",
        "sections": [
            (
                "1 · Pilot overview",
                "The Harbor City Bike pilot runs from April 1 to September 30, 2025. Its goal is to "
                "measure access to short-distance transport in three neighborhoods. The pilot is "
                "entirely fictional; this document does not describe a real municipal policy.",
                "The first phase has 24 stations and 180 bikes. Stations are distributed across "
                "Central, Harbor, and University neighborhoods. Thirty bikes have electric assist. "
                "The program owner is the Mobility Innovation Team, and Derya Aksoy leads operations.",
                "The pilot targets at least 12,000 rides per month and an available bike at the station "
                "for at least 85% of users. These numbers are targets, not achieved results.",
            ),
            (
                "2 · Use and pricing",
                "Registration is completed in the mobile app with email verification. Riders unlock a "
                "bike by scanning a station QR code. The first 15 minutes of every ride are free; each "
                "additional 15 minutes costs 10 TRY. The daily charge is capped at 80 TRY.",
                "Electric-assist bikes use the same time-based price. They can be picked up only at "
                "Central and University stations, though they may be returned at Harbor.",
                "During the pilot, refund requests go through the Support menu in the app. If a station "
                "has no bikes, riders can choose a nearby station on the map; there is no reservation feature.",
            ),
            (
                "3 · Operations and data",
                "Field staff check stations daily at 06:00 and 18:00. A broken bike is marked unavailable "
                "in the app and inspected within 48 hours. A reported safety risk takes the bike out "
                "of service immediately.",
                "Ride records include start and end station, duration, bike ID, and charge amount. "
                "Pilot analysis uses de-identified ride data. Raw ride records are deleted after 90 days; "
                "aggregate reports are retained until the pilot ends.",
                "A weekly operations report is prepared every Monday. It shows ride count, available-bike "
                "rate, and open maintenance issues. Personal ride histories are not included in the report.",
            ),
            (
                "4 · Evaluation and limits",
                "The pilot is evaluated on October 15, 2025. The team reviews the monthly ride target "
                "and the 85% availability target together. If the targets are missed, station placement "
                "and maintenance frequency are reconsidered; a permanent rollout is not automatic.",
                "This four-page document is a RAG learning example. Answers should rely on explicit "
                "information from the relevant pages. The system should not invent an event or result "
                "that the text does not contain. In particular, targets must not be confused with outcomes.",
                "Example questions: When and where does the pilot run? What are the ride price and daily "
                "cap? How are broken bikes handled? Which two targets measure success?",
            ),
        ],
    },
}


def draw_paragraph(pdf: canvas.Canvas, text: str, y: float, size: int = 11) -> float:
    pdf.setFont("Arial", size)
    pdf.setFillColor(INK)
    for line in simpleSplit(text, "Arial", size, PAGE_WIDTH - 110):
        pdf.drawString(55, y, line)
        y -= 17
    return y - 18


def generate(locale: str, data: dict) -> None:
    path = OUTPUT / data["file"]
    pdf = canvas.Canvas(str(path), pagesize=(PAGE_WIDTH, PAGE_HEIGHT), pageCompression=1, invariant=1)
    pdf.setTitle(data["title"])
    pdf.setAuthor("RAG StepLab")
    for page_number, section in enumerate(data["sections"], start=1):
        pdf.setStrokeColor(colors.HexColor("#e9dce2"))
        pdf.line(55, 795, PAGE_WIDTH - 55, 795)
        pdf.setFillColor(ACCENT)
        pdf.setFont("Arial-Bold", 11)
        pdf.drawString(55, 809, "RAG StepLab  /  Örnek doküman" if locale == "tr" else "RAG StepLab  /  Sample document")
        pdf.setFillColor(INK)
        pdf.setFont("Arial-Bold", 21)
        pdf.drawString(55, 750, data["title"])
        pdf.setFillColor(MUTED)
        pdf.setFont("Arial", 10)
        pdf.drawString(55, 728, data["subtitle"])
        pdf.setFillColor(ACCENT)
        pdf.setFont("Arial-Bold", 15)
        pdf.drawString(55, 665, section[0])
        y = 625
        for paragraph in section[1:]:
            y = draw_paragraph(pdf, paragraph, y)
        pdf.setStrokeColor(colors.HexColor("#e9dce2"))
        pdf.line(55, 58, PAGE_WIDTH - 55, 58)
        pdf.setFillColor(MUTED)
        pdf.setFont("Arial", 9)
        pdf.drawString(55, 42, "Fictional learning material" if locale == "en" else "Kurgusal öğrenme materyali")
        pdf.drawRightString(PAGE_WIDTH - 55, 42, f"{page_number} / 4")
        pdf.showPage()
    pdf.save()


if __name__ == "__main__":
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for language, document in DOCUMENTS.items():
        generate(language, document)
