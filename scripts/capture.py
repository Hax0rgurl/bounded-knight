"""Exercise the generated static site and capture the three dossier views."""
import argparse
from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


@contextmanager
def local_origin(output):
    handler = partial(QuietHandler, directory=str(output))
    try:
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    except PermissionError:
        print("Loopback sockets unavailable. Playwright will serve the same disk files at a loopback origin.")
        yield "http://127.0.0.1:8765", False
        return
    with server:
        Thread(target=server.serve_forever, daemon=True).start()
        try:
            yield f"http://127.0.0.1:{server.server_port}", True
        finally:
            server.shutdown()


def capture(output, screenshots):
    screenshots.mkdir(parents=True, exist_ok=True)
    with local_origin(output) as (origin, live_http), sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path="/usr/bin/chromium", args=["--no-sandbox", "--disable-crashpad-for-testing", "--no-zygote", "--single-process", "--disable-gpu"])
        page = browser.new_page(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
        errors, outbound = [], []

        def route_request(route):
            if urlsplit(route.request.url).netloc == urlsplit(origin).netloc:
                if live_http:
                    route.continue_()
                    return
                path = (output / urlsplit(route.request.url).path.lstrip("/")).resolve()
                if path.is_dir():
                    path /= "index.html"
                if path.is_relative_to(output) and path.is_file():
                    route.fulfill(path=path)
                else:
                    route.fulfill(status=404, body="Not found")
            else:
                outbound.append(route.request.url)
                route.abort()

        page.route("**/*", route_request)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(origin + "/dashboard/")
        board_count = page.evaluate("RADAR.rows.length")
        expect(page.locator("#results")).to_contain_text(f"{board_count} of {board_count}")
        header = page.locator("#head th[aria-sort]")
        expect(header).to_contain_text("Rank")
        page.screenshot(path=screenshots / "1-board.png")

        page.get_by_role("button", name="Steakhouse Financial").click()
        expect(page.get_by_role("dialog")).to_be_visible()
        expect(page.get_by_role("heading", name="Farming research plan")).to_be_visible()
        page.locator("summary").click()
        expect(page.locator(".peer-list li").first).to_be_visible()
        page.screenshot(path=screenshots / "2-detail.png")
        page.keyboard.press("Escape")
        expect(page.get_by_role("dialog")).not_to_be_visible()

        page.get_by_role("combobox", name="Category").select_option("Risk Curators")
        page.get_by_role("combobox", name="Chain", exact=True).select_option("Ethereum")
        page.get_by_label("Watchlist only").check()
        expect(page.locator("#category")).to_have_value("Risk Curators")
        expected = page.evaluate("RADAR.rows.filter(r => r.watchlist && r.category === 'Risk Curators' && r.chains.includes('Ethereum')).length")
        expect(page.locator("#results")).to_have_text(f"{expected} of {board_count} protocols · ◆ Snapshot watchlist")
        assert 3 <= expected < board_count
        page.get_by_role("button", name="TVL", exact=True).click()
        expect(header).to_have_attribute("aria-sort", "descending")
        page.screenshot(path=screenshots / "3-filtered.png")
        page.get_by_role("button", name="Reset filters").click()

        band = page.locator('.bin[data-bin="5"]')
        band.click()
        expect(band).to_have_attribute("aria-pressed", "true")
        expected = page.evaluate("RADAR.rows.filter(r => r.implied_value_usd >= 1e8 && r.implied_value_usd < 3.16227766e8).length")
        expect(page.locator("#results")).to_contain_text(f"{expected} of {board_count}")
        band.click()

        search = page.get_by_role("searchbox")
        search.fill("no-result-expected")
        expect(page.locator(".empty")).to_be_visible()
        search.fill("usdd")
        expect(page.get_by_role("button", name="USDD")).to_be_visible()
        search.clear()
        page.get_by_role("button", name="Next").click()
        expect(page.locator("#pagination")).to_contain_text(f"13–24 of {board_count}")
        page.get_by_role("button", name="Token recorded").click()
        expect(page.locator("#market")).to_be_hidden()
        expect(header).to_contain_text("Recorded cap")
        page.locator(".token-name").first.click()
        expect(page.get_by_role("dialog")).to_contain_text("Recorded market cap")
        page.get_by_role("button", name="Close dialog").click()
        page.get_by_role("button", name="Methodology").click()
        expect(page.get_by_role("heading", name="Peer pricing")).to_be_visible()
        page.keyboard.press("Escape")

        page.set_viewport_size({"width": 390, "height": 844})
        page.get_by_role("button", name="Launch radar").click()
        assert page.evaluate("document.documentElement.scrollWidth === innerWidth")
        page.locator(".token-name").first.click()
        expect(page.get_by_role("dialog")).to_be_visible()
        expect(page.get_by_role("heading", name="Farming research plan")).to_be_visible()
        assert not errors and not outbound, (errors, outbound)
        browser.close()
        print("Chromium passed desktop and mobile interactions with zero outbound requests or uncaught errors.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("screenshots", type=Path)
    args = parser.parse_args()
    capture(args.output.resolve(), args.screenshots.resolve())
