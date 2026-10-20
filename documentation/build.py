"""Build MetaProof_Documentation.pdf from MetaProof_Documentation.html.

The cover is printed on its own borderless page and the rest with page margins, because
Chrome lays every page out at one width. Needs Google Chrome, Graphviz and pypdf.

    python build.py
"""

import re
import subprocess
import tempfile
from pathlib import Path

from pypdf import PdfReader, PdfWriter

HERE = Path(__file__).resolve().parent
CHROME = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")
NEATO = Path(r"C:\Program Files\Graphviz\bin\neato.exe")
SOURCE = HERE / "MetaProof_Documentation.html"
OUTPUT = HERE / "MetaProof_Documentation.pdf"


def print_pdf(html: str, name: str, workdir: Path) -> Path:
    # Written next to the source so relative asset paths still resolve.
    page = HERE / f".build_{name}.html"
    page.write_text(html, encoding="utf-8")
    out = workdir / f"{name}.pdf"
    try:
        subprocess.run([str(CHROME), "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                        f"--print-to-pdf={out}", page.as_uri()],
                       check=True, capture_output=True)
    finally:
        page.unlink(missing_ok=True)
    return out


def main() -> None:
    # The diagram has fixed coordinates (architecture.py), so neato -n2 draws it as laid out.
    subprocess.run(["python", "architecture.py"], cwd=HERE, check=True)
    subprocess.run([str(NEATO), "-n2", "-Tsvg", "architecture.dot", "-o", "assets/architecture.svg"],
                   cwd=HERE, check=True)
    html = SOURCE.read_text(encoding="utf-8")
    cover = re.search(r'<div class="cover">.*?\n</div>\n', html, flags=re.S).group(0)
    head, rest = html.split("<body>", 1)

    cover_html = (head.replace("</style>", "@page { margin: 0; @bottom-center { content: none; } }</style>")
                  + "<body>" + cover + "</body></html>")
    body_html = head + "<body>" + rest.replace(cover, "", 1)
    # Without the cover, the contents page is the first page; keep its page break from leaving a blank.
    body_html = body_html.replace('<section class="chapter toc">', '<section class="toc">', 1)

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        parts = [print_pdf(cover_html, "cover", tmp), print_pdf(body_html, "body", tmp)]
        writer = PdfWriter()
        writer.append(str(parts[0]), pages=(0, 1))
        writer.append(str(parts[1]))
        writer.add_metadata({"/Title": "MetaProof: Project Documentation", "/Author": "Lanchenba Mutum"})
        with OUTPUT.open("wb") as f:
            writer.write(f)
    print(f"{OUTPUT.name}: {len(PdfReader(str(OUTPUT)).pages)} pages")


if __name__ == "__main__":
    main()
