"""Check the published legal pages for unbalanced HTML tags.

A tiny, dependency-free sanity check for the static pages in ``docs/web``: it
walks each file with :class:`html.parser.HTMLParser` and keeps a stack of open
tags, reporting anything that closes without opening or stays open at the end.

Run from the repository root:
    python docs/web/check_html.py
"""
from __future__ import annotations

import sys
from html.parser import HTMLParser
from pathlib import Path

VOID = {
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr", "!doctype",
}


class BalanceChecker(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[tuple[str, int]] = []
        self.problems: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag not in VOID:
            self.stack.append((tag, self.getpos()[0]))

    def handle_startendtag(self, tag: str, attrs) -> None:
        pass  # self-closing, nothing to track

    def handle_endtag(self, tag: str) -> None:
        if tag in VOID:
            return
        if not self.stack:
            self.problems.append(f"line {self.getpos()[0]}: </{tag}> without an opening tag")
            return
        open_tag, open_line = self.stack.pop()
        if open_tag != tag:
            self.problems.append(
                f"line {self.getpos()[0]}: </{tag}> closes <{open_tag}> "
                f"opened on line {open_line}"
            )


def main() -> int:
    pages = sorted(Path(__file__).resolve().parent.glob("*.html"))
    if not pages:
        print("no HTML pages found")
        return 1

    failed = False
    for page in pages:
        checker = BalanceChecker()
        checker.feed(page.read_text(encoding="utf-8"))
        unclosed = [f"<{tag}> line {line}" for tag, line in checker.stack]
        if checker.problems or unclosed:
            failed = True
            print(f"FAIL {page.name}")
            for problem in checker.problems:
                print(f"     {problem}")
            if unclosed:
                print(f"     unclosed: {', '.join(unclosed)}")
        else:
            print(f"ok   {page.name}")

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
