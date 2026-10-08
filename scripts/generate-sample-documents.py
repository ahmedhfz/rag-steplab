"""Generate the two small, selectable-text PDFs used by the first-use flow.

Install scripts/requirements-samples.txt first. Lato fonts and their OFL license
are checked into scripts/sample-fonts so this works without a system font.
"""

import argparse
from pathlib import Path
from tempfile import TemporaryDirectory

from reportlab.lib import colors
from reportlab.lib.utils import simpleSplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "samples"
FONT_ROOT = ROOT / "scripts" / "sample-fonts"
PAGE_WIDTH, PAGE_HEIGHT = 595, 842
INK = colors.HexColor("#26212a")
MUTED = colors.HexColor("#625b65")
ACCENT = colors.HexColor("#8f3c61")

pdfmetrics.registerFont(TTFont("Lato", str(FONT_ROOT / "Lato-Regular.ttf")))
pdfmetrics.registerFont(TTFont("Lato-Bold", str(FONT_ROOT / "Lato-Bold.ttf")))


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
                "Bu belge dört sayfalık kurgusal bir pilot rehberidir. Tarihler, ücretler ve operasyon "
                "kuralları planlanan uygulamayı anlatır. Pilotun gerçek sonuçları bu belgede yer almaz.",
                "Aylık yolculuk ve kullanılabilirlik değerleri hedef olarak belirlenmiştir. Değerlendirme "
                "tarihinde toplanan veriler ayrıca incelenecektir; hedefler gerçekleşmiş sonuç sayılmaz.",
            ),
        ],
        "list_heading": "İstasyon denetiminde izlenen adımlar",
        "list_items": ["Bisiklet sayısını kaydet.", "Arızaları işaretle.", "Güvenlik riskini hemen bildir."],
        "table_heading": "Haftalık rapor alanları",
        "table_rows": [["Alan", "Sıklık"], ["Yolculuk sayısı", "Her pazartesi"], ["Kullanılabilir bisiklet oranı", "Her pazartesi"]],
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
                "This four-page fictional pilot guide describes planned dates, charges, and operating "
                "rules. Actual pilot results are not included in this document.",
                "Monthly ride and availability figures are targets. Data collected for the evaluation "
                "will be reviewed separately; a target is not an achieved outcome.",
            ),
        ],
        "list_heading": "Station inspection steps",
        "list_items": ["Record the bike count.", "Mark maintenance issues.", "Report safety risks immediately."],
        "table_heading": "Weekly report fields",
        "table_rows": [["Field", "Frequency"], ["Ride count", "Every Monday"], ["Available-bike rate", "Every Monday"]],
    },
}


def draw_paragraph(pdf: canvas.Canvas, text: str, y: float, size: int = 11) -> float:
    pdf.setFont("Lato", size)
    pdf.setFillColor(INK)
    for line in simpleSplit(text, "Lato", size, PAGE_WIDTH - 110):
        pdf.drawString(55, y, line)
        y -= 17
    return y - 18


def draw_list(pdf: canvas.Canvas, data: dict, y: float) -> float:
    pdf.setFillColor(ACCENT)
    pdf.setFont("Lato-Bold", 12)
    pdf.drawString(55, y, data["list_heading"])
    pdf.setFillColor(INK)
    pdf.setFont("Lato", 11)
    for item in data["list_items"]:
        y -= 24
        pdf.drawString(65, y, f"•  {item}")
    return y - 30


def draw_table(pdf: canvas.Canvas, data: dict, y: float) -> None:
    pdf.setFillColor(ACCENT)
    pdf.setFont("Lato-Bold", 12)
    pdf.drawString(55, y, data["table_heading"])
    top = y - 17
    row_height = 28
    left, middle, right = 55, 350, PAGE_WIDTH - 55
    pdf.setStrokeColor(colors.HexColor("#d9ccd2"))
    for index, row in enumerate(data["table_rows"]):
        row_top = top - index * row_height
        if index == 0:
            pdf.setFillColor(colors.HexColor("#f8f2f5"))
            pdf.rect(left, row_top - row_height, right - left, row_height, fill=1, stroke=0)
        pdf.setFillColor(INK)
        pdf.setFont("Lato-Bold" if index == 0 else "Lato", 10)
        pdf.drawString(left + 9, row_top - 18, row[0])
        pdf.drawString(middle + 9, row_top - 18, row[1])
        pdf.line(left, row_top - row_height, right, row_top - row_height)
    pdf.line(left, top, right, top)
    pdf.line(left, top, left, top - len(data["table_rows"]) * row_height)
    pdf.line(middle, top, middle, top - len(data["table_rows"]) * row_height)
    pdf.line(right, top, right, top - len(data["table_rows"]) * row_height)


def generate(locale: str, data: dict, output: Path) -> None:
    path = output / data["file"]
    pdf = canvas.Canvas(str(path), pagesize=(PAGE_WIDTH, PAGE_HEIGHT), pageCompression=1, invariant=1)
    pdf.setTitle(data["title"])
    pdf.setAuthor("RAG StepLab")
    for page_number, section in enumerate(data["sections"], start=1):
        pdf.setStrokeColor(colors.HexColor("#e9dce2"))
        pdf.line(55, 795, PAGE_WIDTH - 55, 795)
        pdf.setFillColor(ACCENT)
        pdf.setFont("Lato-Bold", 11)
        pdf.drawString(55, 809, "RAG StepLab  /  Örnek doküman" if locale == "tr" else "RAG StepLab  /  Sample document")
        pdf.setFillColor(INK)
        pdf.setFont("Lato-Bold", 21)
        pdf.drawString(55, 750, data["title"])
        pdf.setFillColor(MUTED)
        pdf.setFont("Lato", 10)
        pdf.drawString(55, 728, data["subtitle"])
        pdf.setFillColor(ACCENT)
        pdf.setFont("Lato-Bold", 15)
        pdf.drawString(55, 665, section[0])
        y = 625
        for paragraph in section[1:]:
            y = draw_paragraph(pdf, paragraph, y)
        if page_number == 3:
            y = draw_list(pdf, data, y - 4)
            draw_table(pdf, data, y)
        pdf.setStrokeColor(colors.HexColor("#e9dce2"))
        pdf.line(55, 58, PAGE_WIDTH - 55, 58)
        pdf.setFillColor(MUTED)
        pdf.setFont("Lato", 9)
        pdf.drawString(55, 42, "Fictional learning material" if locale == "en" else "Kurgusal öğrenme materyali")
        pdf.drawRightString(PAGE_WIDTH - 55, 42, f"{page_number} / 4")
        pdf.showPage()
    pdf.save()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="verify committed PDFs match a fresh generation")
    args = parser.parse_args()
    if args.check:
        with TemporaryDirectory() as directory:
            generated = Path(directory)
            for language, document in DOCUMENTS.items():
                generate(language, document, generated)
                if (generated / document["file"]).read_bytes() != (OUTPUT / document["file"]).read_bytes():
                    parser.error(f"{document['file']} differs; regenerate the sample PDFs")
        print("Sample PDFs match deterministic generation.")
    else:
        OUTPUT.mkdir(parents=True, exist_ok=True)
        for language, document in DOCUMENTS.items():
            generate(language, document, OUTPUT)
