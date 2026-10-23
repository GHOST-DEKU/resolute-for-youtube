#!/usr/bin/env python3
"""Build the store upload ZIP for Chrome or Firefox, and check it.

Usage:  python3 scripts/build.py chrome    -> dist/resolute-chrome-v<version>.zip
        python3 scripts/build.py firefox   -> dist/resolute-firefox-v<version>.zip
manifest.json is always at the ZIP root.
"""
import json
import re
import struct
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# Only what the extension needs at runtime. Tests, docs, scripts and git files stay out.
FILES = ['manifest.json', 'background.js', 'content.js', 'page.js', 'popup.html', 'popup.css', 'popup.js',
         'icons/icon16.png', 'icons/icon32.png', 'icons/icon48.png', 'icons/icon128.png']


def png_size(path):
    with open(path, 'rb') as f:
        head = f.read(24)
    assert head[:8] == b'\x89PNG\r\n\x1a\n', f'{path} is not a PNG'
    return struct.unpack('>II', head[16:24])


def main():
    target = sys.argv[1] if len(sys.argv) > 1 else ''
    if target not in ('chrome', 'firefox'):
        sys.exit('Usage: python3 scripts/build.py chrome|firefox')
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    # Each browser warns about the other's key, so each package keeps only its own.
    if target == 'chrome':
        manifest.pop('browser_specific_settings', None)
        manifest['background'].pop('scripts', None)
    else:
        manifest.pop('minimum_chrome_version', None)
        manifest['background'].pop('service_worker', None)

    # Checks the store would otherwise reject
    problems = []
    if manifest.get('manifest_version') != 3:
        problems.append('manifest_version must be 3')
    if len(manifest['name']) > 75:
        problems.append('name is over 75 characters')
    if len(manifest['description']) > 132:
        problems.append(f"description is {len(manifest['description'])} characters (max 132)")
    if not re.fullmatch(r'\d+(\.\d+){0,3}', manifest['version']):
        problems.append('version must be 1-4 dot-separated numbers')
    referenced = set(manifest['icons'].values()) | set(manifest['action']['default_icon'].values())
    referenced |= {manifest['action']['default_popup']}
    referenced |= set(manifest['background'].get('scripts', [])) | {manifest['background'].get('service_worker')} - {None}
    for cs in manifest['content_scripts']:
        referenced |= set(cs['js'])
    for f in sorted(referenced):
        if f not in FILES:
            problems.append(f'manifest references {f}, which is not packaged')
    for f in FILES:
        if not (ROOT / f).is_file():
            problems.append(f'missing file: {f}')
    for size, f in manifest['icons'].items():
        if (ROOT / f).is_file() and png_size(ROOT / f) != (int(size), int(size)):
            problems.append(f'{f} is not {size}x{size}')
    for f in ('background.js', 'content.js', 'page.js', 'popup.js'):
        text = (ROOT / f).read_text()
        if re.search(r'\beval\(|new Function\(|https?://(?!www\.w3\.org/|www\.youtube(-nocookie)?\.com/)', text):
            problems.append(f'{f} may contain remote code or network URLs; check it')
    if target == 'firefox':
        gecko = manifest.get('browser_specific_settings', {}).get('gecko', {})
        if not gecko.get('id'):
            problems.append('Firefox needs browser_specific_settings.gecko.id (keep it the same forever)')
        if 'data_collection_permissions' not in gecko:
            problems.append('Firefox needs gecko.data_collection_permissions for new extensions')
    if problems:
        print('NOT BUILT:\n  - ' + '\n  - '.join(problems))
        sys.exit(1)

    out = ROOT / 'dist' / f"resolute-{target}-v{manifest['version']}.zip"
    out.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('manifest.json', json.dumps(manifest, indent=2) + '\n')
        for f in FILES[1:]:
            z.write(ROOT / f, f)

    with zipfile.ZipFile(out) as z:  # re-open and verify what was written
        assert z.testzip() is None, 'ZIP is corrupt'
        names = z.namelist()
        built = json.loads(z.read('manifest.json'))
        assert names[0] == 'manifest.json'
        assert ('browser_specific_settings' in built) == (target == 'firefox')
        assert ('minimum_chrome_version' in built) == (target == 'chrome')
        print(f'Built {out.relative_to(ROOT)} ({out.stat().st_size // 1024} KB)')
        for n in names:
            print('  ', n)


if __name__ == '__main__':
    main()
