"""
Automated test for AutoID Q9 screen compatibility
Checks all main pages at 480×800 resolution
"""

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import time
import os

# AutoID Q9 specifications
Q9_WIDTH = 480
Q9_HEIGHT = 800
Q9_NAME = "AutoID Q9"

def setup_driver():
    """Setup Chrome with Q9 screen size"""
    options = Options()
    options.add_argument('--headless')
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')
    options.add_argument(f'--window-size={Q9_WIDTH},{Q9_HEIGHT}')

    driver = webdriver.Chrome(options=options)
    driver.set_window_size(Q9_WIDTH, Q9_HEIGHT)
    return driver

def check_page(driver, url, page_name):
    """Check if page renders correctly on Q9 screen"""
    print(f"\n{'='*60}")
    print(f"Checking: {page_name}")
    print(f"URL: {url}")
    print(f"{'='*60}")

    try:
        driver.get(url)
        time.sleep(1)

        # Check viewport size
        viewport_width = driver.execute_script("return window.innerWidth")
        viewport_height = driver.execute_script("return window.innerHeight")
        print(f"✓ Viewport: {viewport_width}×{viewport_height}px")

        # Check for horizontal overflow
        body_width = driver.execute_script("return document.body.scrollWidth")
        has_overflow = body_width > viewport_width
        if has_overflow:
            print(f"⚠ Horizontal overflow detected: {body_width}px (expected ≤{viewport_width}px)")
        else:
            print(f"✓ No horizontal overflow ({body_width}px)")

        # Check if handheld CSS is applied
        has_handheld = driver.execute_script("""
            const link = document.querySelector('link[href*="handheld.css"]');
            return link !== null;
        """)
        if has_handheld:
            print("✓ Handheld CSS loaded")
        else:
            print("⚠ Handheld CSS not found")

        # Check for visible elements
        body = driver.find_element(By.TAG_NAME, "body")
        if body:
            print("✓ Page loaded successfully")

        # Take screenshot
        screenshot_path = f"q9-check-{page_name.lower().replace(' ', '-')}.png"
        driver.save_screenshot(screenshot_path)
        print(f"✓ Screenshot saved: {screenshot_path}")

        return True

    except Exception as e:
        print(f"✗ Error: {str(e)}")
        return False

def main():
    print(f"\n{'*'*60}")
    print(f"AutoID Q9 Compatibility Test")
    print(f"Screen: {Q9_WIDTH}×{Q9_HEIGHT}px (4 inch)")
    print(f"{'*'*60}")

    base_url = "http://127.0.0.1:5000"

    # Pages to check
    pages = [
        ("/", "Login Page"),
        ("/dashboard", "Dashboard"),
        # Note: These require authentication
        # ("/sort", "Sort Page"),
        # ("/presort", "Pre-sort Page"),
    ]

    driver = setup_driver()

    try:
        results = []
        for path, name in pages:
            url = base_url + path
            success = check_page(driver, url, name)
            results.append((name, success))

        # Summary
        print(f"\n{'='*60}")
        print("SUMMARY")
        print(f"{'='*60}")
        passed = sum(1 for _, success in results if success)
        total = len(results)
        print(f"Passed: {passed}/{total}")

        for name, success in results:
            status = "✓" if success else "✗"
            print(f"{status} {name}")

    finally:
        driver.quit()

    print(f"\n{'*'*60}")
    print("Test completed!")
    print(f"{'*'*60}\n")

if __name__ == "__main__":
    main()
