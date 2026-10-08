Lato Regular and Bold are bundled from [Google Fonts](https://github.com/google/fonts/tree/f3b885d5590e307e02542f1a724cec55d567fdaa/ofl/lato).
They are licensed under the SIL Open Font License 1.1; see `OFL.txt`.
Only these two open font files are used to build the sample PDFs.

With Python 3.13, install `scripts/requirements-samples.txt`, then run
`python scripts/generate-sample-documents.py`. Run the same command with
`--check` to compare a fresh deterministic build with the committed PDFs.
`pypdf` in the requirements is used only by `scripts/test_sample_documents.py`.

Bundled font SHA-256 values:

- `Lato-Regular.ttf`: `d636e4683231f931eda222d588e944d082bfd3bdba02f928bee461c0f185b251`
- `Lato-Bold.ttf`: `8a0aace75d33794eece4b28187bfc1df0bbd2888b5d8a56e01788c8d65d16be1`
