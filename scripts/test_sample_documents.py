"""Checks for the shipped sample PDFs; run with the pinned sample requirements."""

from pathlib import Path
import runpy
from tempfile import TemporaryDirectory
import unittest

from pypdf import PdfReader

generator = runpy.run_path(str(Path(__file__).with_name("generate-sample-documents.py")))
DOCUMENTS, OUTPUT, generate = (generator[name] for name in ("DOCUMENTS", "OUTPUT", "generate"))


class SampleDocumentTests(unittest.TestCase):
    def test_generation_matches_shipped_bytes_in_different_directories(self):
        with TemporaryDirectory() as directory:
            for locale, data in DOCUMENTS.items():
                with self.subTest(locale=locale):
                    output = Path(directory) / locale
                    output.mkdir()
                    generate(locale, data, output)
                    self.assertEqual((output / data["file"]).read_bytes(), (OUTPUT / data["file"]).read_bytes())

    def test_pdf_contains_learning_structures_and_no_questions(self):
        for locale, data in DOCUMENTS.items():
            with self.subTest(locale=locale):
                path = OUTPUT / data["file"]
                pages = PdfReader(path).pages
                self.assertEqual(len(pages), 4)
                self.assertLess(path.stat().st_size, 100_000)
                text = "\n".join(page.extract_text() for page in pages)
                self.assertNotIn("?", text)
                for section in data["sections"]:
                    self.assertIn(section[0], text)
                self.assertIn("2025", text)
                self.assertIn("180", text)
                self.assertIn("•", text)
                for item in data["list_items"]:
                    self.assertIn(item, text)
                for row in data["table_rows"]:
                    for cell in row:
                        self.assertIn(cell, text)


if __name__ == "__main__":
    unittest.main()
