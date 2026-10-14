import os, sys
import markdown
from playwright.sync_api import sync_playwright

DOCS = r"c:/Users/606610/CodeBuddy/QRCode 客戶意見反饋/docs"

TARGETS = [
    ("Quick Start 用戶手冊.md", "Quick Start 用戶手冊.pdf"),
    ("用戶手冊.md", "用戶手冊.pdf"),
]

CSS = """
@page {
  size: A4;
  margin: 18mm 16mm 20mm 16mm;
}
* { box-sizing: border-box; }
body {
  font-family: "Microsoft JhengHei", "Microsoft YaHei", "PingFang SC",
               "Noto Sans CJK SC", "Heiti TC", sans-serif;
  font-size: 11pt;
  line-height: 1.6;
  color: #1a1a1a;
}
h1 { font-size: 22pt; border-bottom: 3px solid #1565c0; padding-bottom: 6px; margin-top: 0; }
h2 { font-size: 16pt; border-bottom: 1px solid #bbb; padding-bottom: 4px; margin-top: 24px; }
h3 { font-size: 13pt; color: #0d47a1; margin-top: 18px; }
h4 { font-size: 12pt; margin-top: 14px; }
h5, h6 { font-size: 11pt; }
p { margin: 6px 0; }
a { color: #1565c0; text-decoration: none; }
code {
  font-family: "Consolas", "Courier New", monospace;
  background: #f3f4f6; padding: 1px 4px; border-radius: 3px; font-size: 9.5pt;
}
pre {
  background: #f3f4f6; border: 1px solid #ddd; border-radius: 6px;
  padding: 10px 12px; overflow-x: auto;
}
pre code { background: none; padding: 0; }
blockquote {
  border-left: 4px solid #90caf9; background: #f1f8ff;
  margin: 8px 0; padding: 6px 12px; color: #333;
}
table {
  border-collapse: collapse; width: 100%; margin: 10px 0;
  font-size: 9.5pt; table-layout: fixed;
}
th, td { border: 1px solid #b0bec5; padding: 5px 7px; vertical-align: top; word-break: break-word; }
thead th { background: #e3f2fd; font-weight: 700; }
tbody tr:nth-child(even) { background: #fafafa; }
ul, ol { padding-left: 22px; margin: 6px 0; }
hr { border: none; border-top: 1px solid #ccc; margin: 16px 0; }
img { max-width: 100%; height: auto; display: block; margin: 8px 0; }
"""

def convert(md_path, pdf_path):
    full = os.path.join(DOCS, md_path)
    with open(full, "r", encoding="utf-8") as f:
        md = f.read()
    html_body = markdown.markdown(
        md, extensions=["tables", "fenced_code", "nl2br", "sane_lists", "attr_list"]
    )
    html = f"""<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8">
<style>{CSS}</style></head><body>{html_body}</body></html>"""
    # 寫到 docs 目錄，使相對資源（若有）可解析
    tmp_html = os.path.join(DOCS, "_tmp_" + os.path.basename(md_path).replace(".md", ".html"))
    with open(tmp_html, "w", encoding="utf-8") as f:
        f.write(html)
    out_pdf = os.path.join(DOCS, pdf_path)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto("file://" + tmp_html, wait_until="networkidle")
        page.pdf(path=out_pdf, format="A4", print_background=True,
                 margin={"top": "18mm", "bottom": "20mm", "left": "16mm", "right": "16mm"})
        browser.close()
    os.remove(tmp_html)
    print(f"OK  {md_path} -> {pdf_path}  ({os.path.getsize(out_pdf)} bytes)")

if __name__ == "__main__":
    for md, pdf in TARGETS:
        convert(md, pdf)
