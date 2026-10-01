"""Prepare version-pinned notices and corresponding source for a Windows release.

Does not execute downloads, extract arbitrary paths, or load scanner hardware.
"""
import argparse
import hashlib
import json
import shutil
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MAX_ASSET = 128 * 1024 * 1024


def asset_bytes(asset, cache):
    destination = cache / asset['path']
    if not destination.exists():
        destination.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(asset['url'], timeout=60) as response:
            data = response.read(MAX_ASSET + 1)
        if len(data) > MAX_ASSET:
            raise ValueError('Release material exceeds size limit')
        if hashlib.sha256(data).hexdigest() != asset['sha256']:
            raise ValueError('Release material checksum mismatch: ' + asset['component'])
        destination.write_bytes(data)
    data = destination.read_bytes()
    if hashlib.sha256(data).hexdigest() != asset['sha256']:
        raise ValueError('Cached release material checksum mismatch: ' + asset['component'])
    return data


def prepare(publish, cache):
    notices = publish / 'third-party'
    report_path = notices / 'inventory.json'
    report = json.loads(report_path.read_text(encoding='utf-8'))
    worker = json.loads((notices / 'worker-inventory.json').read_text(encoding='utf-8'))
    assets = json.loads((ROOT / 'tools/scanner-agent/release-materials.lock.json').read_text(encoding='utf-8'))['assets']
    by_component = {item['component']: item for item in assets}
    # All fetched bytes are checksum-pinned; nothing is executed or generally extracted.
    for asset in assets:
        asset_bytes(asset, cache)
    for package in report['packages']:
        if package['primaryLicenseTextPresent']:
            continue
        component = package['id']
        if component.startswith('Microsoft.') or component.startswith('System.') and package['version'] == '10.0.10':
            component = 'Microsoft-10'
        asset = by_component[component]
        folder = notices / (package['id'] + '-' + package['version'])
        filename = Path(asset['path']).name
        (folder / filename).write_bytes(asset_bytes(asset, cache))
        package['copiedTexts'].append(filename)
        package['primaryLicenseTextPresent'] = True
        package['supplementalLicenseSource'] = asset['url']
        package['supplementalLicenseSha256'] = asset['sha256']
    runtime_name = 'runtimepack.Microsoft.NETCore.App.Runtime.win-x86/10.0.10'
    if runtime_name not in worker['libraries']:
        raise ValueError('Embedded runtime changed; qualify and pin its notices first')
    runtime_asset = by_component['worker-runtime']
    with zipfile.ZipFile(cache / runtime_asset['path']) as runtime:
        folder = notices / 'microsoft.netcore.app.runtime.win-x86-10.0.10'
        folder.mkdir(exist_ok=True)
        for name in ('LICENSE.TXT', 'THIRD-PARTY-NOTICES.TXT'):
            data = runtime.read(name)
            if not data:
                raise ValueError('Missing embedded runtime notice')
            (folder / name).write_bytes(data)
    source_asset = by_component['NAPS2-source']
    source = cache / source_asset['path']
    source_root = 'naps2-8ae3e82203115754e804fe9c14f00f6bd86ee192/'
    with zipfile.ZipFile(source) as archive:
        source_license = archive.read(source_root + 'NAPS2.Sdk/LICENSE').decode('utf-8-sig').replace('\r\n', '\n').strip()
        package_license = (notices / 'NAPS2.Sdk-1.3.0/LICENSE').read_text(encoding='utf-8-sig').strip()
        if source_license != package_license:
            raise ValueError('SDK corresponding-source license does not match package')
        archive.getinfo(source_root + 'NAPS2.Sdk.Worker.Build/NAPS2.Sdk.Worker.Build.csproj')
    sources = notices / 'sources'
    sources.mkdir(exist_ok=True)
    shutil.copyfile(source, sources / Path(source_asset['path']).name)
    helper = ROOT / 'tools/scanner-agent'
    # Explicit, flat source inputs only: no build output, appdata, logs or credentials.
    with zipfile.ZipFile(sources / 'mtg-scanner-helper-source.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(helper.iterdir()):
            if path.is_file() and path.suffix in ('.cs', '.csproj', '.json', '.ps1', '.py', '.iss', '.md'):
                archive.write(path, 'tools/scanner-agent/' + path.name)
    shutil.copyfile(helper / 'REBUILD.md', sources / 'REBUILD.md')
    identities = {p['id'].lower() + '/' + p['version']: p for p in report['packages']}
    for name in worker['libraries']:
        if name.startswith(('NAPS2.Worker/', 'runtimepack.')):
            continue
        if name.lower() not in identities:
            raise ValueError('Embedded dependency has no notice inventory: ' + name)
    for runtime in report['hostRuntimes']:
        if runtime['version'] != '8.0.31':
            raise ValueError('Host runtime changed; qualify its exact notices first')
        if runtime['id'] == 'microsoft.windowsdesktop.app.runtime.win-x64':
            folder = notices / (runtime['id'] + '-' + runtime['version'])
            for component in ('desktop-winforms', 'desktop-wpf'):
                name = component + '-THIRD-PARTY-NOTICES.TXT'
                (folder / name).write_bytes(asset_bytes(by_component[component], cache))
                runtime['copiedTexts'].append(name)
        if not any(name.upper().startswith('LICENSE') for name in runtime['copiedTexts']) or not any('THIRD-PARTY-NOTICES' in name.upper() for name in runtime['copiedTexts']):
            raise ValueError('Host runtime notices incomplete')
    report.pop('publicDistributionReady', None)
    report.pop('remaining', None)
    report['distributionMaterialsComplete'] = True
    report['scope'] = 'Pinned component notices, embedded runtime texts and corresponding source; hardware acceptance is separate'
    report['releaseMaterials'] = assets
    report['embeddedRuntime'] = {'id': runtime_name, 'noticePackageSha256': runtime_asset['sha256']}
    report['hardwareQualification'] = 'Manufacturer driver and clean second-computer discovery/scan acceptance pending; no driver or TWAIN DSM is redistributed'
    report_path.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    (notices / 'README.txt').write_text('''MTG Archives Scanner Helper -- third-party materials

Component license/copyright texts and applicable package third-party notices
are in versioned directories. inventory.json identifies locked package hashes,
upstream license provenance and the separately bundled x86 runtime.
worker-inventory.json describes the actual NAPS2.Worker.exe.

LGPL NAPS2 libraries and worker are unmodified, replaceable separate files.
The exact corresponding upstream source archive and the helper source are in
sources/. See sources/REBUILD.md for rebuilding and replacing them. You may
modify/replace these libraries for your use and debug those modifications;
this helper imposes no restriction on doing so. Keep credentials and pending
originals outside the program installation directory.

The scanner manufacturer's driver and TWAIN DSM are prerequisites provided
by Windows/the manufacturer; neither is redistributed here. Install the
manufacturer's Windows driver before connecting. Hardware support on a new
computer must be tested separately from this software packaging.

Installer created with Inno Setup (Jordan Russell and Martijn Laan):
https://jrsoftware.org/
''', encoding='utf-8')
    print('Release materials verified: all locked packages, embedded runtime and corresponding SDK/worker source')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--publish', type=Path, required=True)
    parser.add_argument('--cache', type=Path, default=ROOT / '.local-data/release-materials-cache')
    args = parser.parse_args()
    prepare(args.publish, args.cache)