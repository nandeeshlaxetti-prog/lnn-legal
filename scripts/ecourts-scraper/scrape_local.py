#!/usr/bin/env python3
"""
eCourts CNR scraper using Python requests + Tesseract CLI
Directly calls the Securimage CAPTCHA and submits the CNR form via HTTP.
"""

import urllib.request
import urllib.parse
import urllib.error
import ssl
import re
import subprocess
import os
import time
import json
import sys

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

BASE = 'https://services.ecourts.gov.in/ecourtindia_v6'
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Referer': BASE + '/',
}

cookie_jar = {}
session_id = None


def get(url, extra_headers={}):
    req = urllib.request.Request(url, headers={**HEADERS, **extra_headers})
    if cookie_jar:
        req.add_header('Cookie', '; '.join(f'{k}={v}' for k, v in cookie_jar.items()))
    resp = urllib.request.urlopen(req, context=ctx, timeout=15)
    # Save cookies
    for header in resp.headers.get_all('Set-Cookie') or []:
        m = re.match(r'(\w+)=([^;]+)', header)
        if m:
            cookie_jar[m.group(1)] = m.group(2)
    return resp.read().decode('utf-8', errors='ignore')


def post(url, data, extra_headers={}):
    encoded = urllib.parse.urlencode(data).encode('utf-8')
    req = urllib.request.Request(url, data=encoded, headers={
        **HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
        **extra_headers
    })
    if cookie_jar:
        req.add_header('Cookie', '; '.join(f'{k}={v}' for k, v in cookie_jar.items()))
    try:
        resp = urllib.request.urlopen(req, context=ctx, timeout=15)
        for header in resp.headers.get_all('Set-Cookie') or []:
            m = re.match(r'(\w+)=([^;]+)', header)
            if m:
                cookie_jar[m.group(1)] = m.group(2)
        return resp.read().decode('utf-8', errors='ignore')
    except urllib.error.HTTPError as e:
        return e.read().decode('utf-8', errors='ignore')


def download_captcha(url, path):
    req = urllib.request.Request(url, headers={
        **HEADERS,
        'Referer': BASE + '/',
    })
    if cookie_jar:
        req.add_header('Cookie', '; '.join(f'{k}={v}' for k, v in cookie_jar.items()))
    resp = urllib.request.urlopen(req, context=ctx, timeout=15)
    with open(path, 'wb') as f:
        f.write(resp.read())


def solve_captcha_tesseract(img_path):
    """Use macOS tesseract to solve CAPTCHA"""
    out_path = img_path.replace('.png', '_out')
    result = subprocess.run(
        ['tesseract', img_path, out_path, '--psm', '7', '-c', 'tessedit_char_whitelist=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'],
        capture_output=True, text=True
    )
    txt_path = out_path + '.txt'
    if os.path.exists(txt_path):
        text = open(txt_path).read().strip().replace(' ', '').replace('\n', '')
        os.remove(txt_path)
        return text
    return ''


def scrape_cnr(cnr):
    print(f'\n====== Searching CNR: {cnr} ======')

    # Step 1: Load homepage to get session
    print('Loading homepage...')
    html = get(BASE + '/')
    
    # Extract app_token (CSRF token)
    token_match = re.search(r'id=["\']app_token["\'][^>]*value=["\']([^"\']+)["\']', html)
    app_token = token_match.group(1) if token_match else ''
    print(f'App token: {app_token[:30]}...' if app_token else 'No token found')

    for attempt in range(1, 9):
        print(f'\n--- CAPTCHA Attempt {attempt} ---')

        # Download CAPTCHA image (each download gives a fresh CAPTCHA)
        captcha_url = f'{BASE}/vendor/securimage/securimage_show.php?{int(time.time())}'
        captcha_path = f'captcha_attempt_{attempt}.png'
        download_captcha(captcha_url, captcha_path)
        print(f'CAPTCHA downloaded: {captcha_path}')

        # Solve with tesseract
        solved = solve_captcha_tesseract(captcha_path)
        print(f'Tesseract read: "{solved}"')

        if not solved or len(solved) < 4:
            print('Too short, skipping...')
            continue

        # Submit the CNR search
        print(f'Submitting CNR search with captcha="{solved}"...')
        result_html = post(BASE + '/', {
            'cino': cnr,
            'fcaptcha_code': solved,
            'app_token': app_token,
            'ajax_req': 'true',
            'action_code': 'fetchCinoHistory'
        }, extra_headers={
            'Referer': BASE + '/',
        })

        print('Response (first 500 chars):', result_html[:500])

        # Check for success
        if 'Party Name' in result_html or 'petitioner' in result_html.lower() or 'case_no' in result_html.lower() or 'historyTable' in result_html:
            print('\n✅ SUCCESS! Case data found!')
            # Extract next hearing date
            next_hearing = re.search(r'Next\s+Hearing[^<]*<[^>]+>([^<]+)<', result_html)
            if next_hearing:
                print('Next Hearing:', next_hearing.group(1).strip())
            with open(f'result_{cnr}.html', 'w') as f:
                f.write(result_html)
            print(f'Full result saved to result_{cnr}.html')
            return result_html

        if 'captcha' in result_html.lower() and 'invalid' in result_html.lower():
            print('CAPTCHA was wrong. Retrying...')
            continue

        if 'No Record' in result_html or 'not found' in result_html.lower():
            print('CNR not found on eCourts.')
            return None

        print('Unexpected response. Continuing...')

    print('All attempts exhausted.')
    return None


if __name__ == '__main__':
    cnr = sys.argv[1] if len(sys.argv) > 1 else 'KABC030534362020'
    result = scrape_cnr(cnr)
    if result:
        print('\n✅ Scraping complete!')
    else:
        print('\n❌ Scraping failed.')
