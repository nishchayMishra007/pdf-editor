# Local PDF Editor

A local PDF text editor. Upload a PDF, change the text that is already in it, and download a new file. The original PDF on disk is not overwritten.

The app runs only on your machine. There is no account, no cloud storage, and no payments.

## What you can do

- Upload a PDF by dropping it or clicking
- See page thumbnails, zoom, and fit the page to width
- Click a text block to select it, double-click to edit it
- Drag to move text, or nudge it with the arrow keys
- Duplicate (`Ctrl/Cmd+D`) or delete the selection
- Undo and redo
- Compare the original page with the edited page
- Read warnings for missing font glyphs, overflow, and scanned pages
- Rename a document and open it again from the library
- Download `<name>_edited.pdf`

Edits are stored as operations. Export applies those operations to a copy of the PDF. Images and vector graphics stay in the file.

## Stack

| Part | What it uses |
|------|----------------|
| `frontend/` | Next.js, React, Tailwind, Zustand, pdf.js, Konva |
| `backend/` | FastAPI, PyMuPDF |
| Database | **SQLite**, a file at `backend/data/editor.db` |

SQLite is created on your computer the first time the backend starts. It is not a hosted database.

## Layout

```
frontend/    Next.js app (port 3000)
backend/     FastAPI app (port 8000)
README.md
```

Uploaded PDFs, exports, and the database live in `backend/data/`. That folder is gitignored.

## Limits

- Scanned PDFs with no text layer cannot be edited. OCR is not included.
- Encrypted PDFs are rejected on upload.
- If a character is missing from the PDF’s embedded font, the app falls back to a bundled Liberation font and shows a warning.
- Text styling (font, size, color) is taken from the original span. There is no style picker.
- Non-Latin text is outside the current scope.
- A download with no edits matches the original bytes. After an edit, the PDF is rewritten, so it will not be byte-identical.




############################ Setup ############################




You need Python 3.11+ and Node.js.

From the project folder:

```bash
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r backend/requirements.txt

cd frontend
npm install
cd ..
```

Start the backend:

```bash
cd backend
../.venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Start the frontend in a second terminal:

```bash
cd frontend
npm run dev -- --port 3000 --hostname 127.0.0.1
```

Open [http://localhost:3000](http://localhost:3000).

### Windows

Copy the whole `PDF-Editor-Windows` folder onto the Windows PC and double-click `PDF Editor.exe`. Python and Node.js are already inside that folder. Keep the folder together — do not move the exe out on its own.

If Windows says the app is unrecognized, choose More info, then Run anyway. PDFs you upload are stored in `%APPDATA%\PDF Editor`.

API docs: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs).

To point the UI at a different API, create `frontend/.env.local`:

```bash
NEXT_PUBLIC_API_BASE=http://127.0.0.1:8000
```

Restart the frontend after changing that file.

### Checks

Generate the local sample PDFs, then run the backend tests:

```bash
.venv/bin/python backend/scripts/generate_samples.py
cd backend && ../.venv/bin/pytest -q
cd .. && .venv/bin/python backend/scripts/e2e_flow.py
```

Sample PDFs are written under `backend/data/samples/` and are not committed.
