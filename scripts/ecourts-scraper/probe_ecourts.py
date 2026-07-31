#!/usr/bin/env python3
import urllib.request
import urllib.parse
import urllib.error
import ssl
import re
import time
import json

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

BASE = 'https://services.ecourts.gov.in/ecourtindia_v6'
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
cookie_jar = {}

def do_get(url):
    req = urllib.request.Request(url)
    req.add_header('User-Agent', UA)
    req.add_header('Referer', BASE + '/')
    if cookie_jar:
        req.add_header('Cookie', '; '.join(f'{k}={v}' for k, v in cookie_jar.items()))
    resp = urllib.request.urlopen(req, context=ctx, timeout=15)
    raw = resp.headers.get_all('Set-Cookie') or []
    for h in raw:
        m = re.match(r'(\w+)=([^;]+)', h)
        if m:
            cookie_jar[m.group(1)] = m.group(2)
    return resp.read().decode('utf-8', errors='ignore')

def do_post(url, fields):
    data = urllib.parse.urlencode(fields).encode('utf-8')
    req = urllib.request.Request(url, data=data)
    req.add_header('User-Agent', UA)
    req.add_header('Content-Type', 'application/x-www-form-urlencoded')
    req.add_header('X-Requested-With', 'XMLHttpRequest')
    req.add_header('Referer', BASE + '/')
    if cookie_jar:
        req.add_header('Cookie', '; '.join(f'{k}={v}' for k, v in cookie_jar.items()))
    try:
        resp = urllib.request.urlopen(req, context=ctx, timeout=15)
        raw = resp.headers.get_all('Set-Cookie') or []
        for h in raw:
            m = re.match(r'(\w+)=([^;]+)', h)
            if m:
                cookie_jar[m.group(1)] = m.group(2)
        return resp.read().decode('utf-8', errors='ignore')
    except urllib.error.HTTPError as e:
        return e.read().decode('utf-8', errors='ignore')

# Step 1: Get homepage and session token
print('Loading eCourts homepage...')
html = do_get(BASE + '/')
token_m = re.search(r"id='app_token'[^>]*value='([^']+)'", html)
app_token = token_m.group(1) if token_m else ''
print(f'Token found: {bool(app_token)}')
print(f'Cookies: {cookie_jar}')

# Step 2: Try direct ajax without CAPTCHA to see what error we get
print('\n--- Attempt: AJAX without captcha ---')
r = do_post(BASE + '/', {
    'cino': 'KABC030534362020',
    'fcaptcha_code': '',
    'app_token': app_token,
    'ajax_req': 'true',
    'action_code': 'fetchCinoHistory'
})
print('Response:', r[:800])

# Step 3: Try known working endpoints
print('\n--- Attempt: API endpoint ---')
r2 = do_post(BASE + '/?p=home/searchCnr', {
    'cino': 'KABC030534362020',
    'fcaptcha_code': 'test',
    'app_token': app_token,
})
print('Response:', r2[:800])
