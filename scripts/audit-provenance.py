"""Generate factual dependency/asset inventory; never infer permission from metadata."""
import argparse
from collections import Counter
import json
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
parser.add_argument('--nuget-cache', type=Path)
args = parser.parse_args()

def git(*arguments):
    return subprocess.check_output(['git', '-C', str(root), *arguments], encoding='utf-8').strip()

npm = []
for lock in ['flower.com/package-lock.json', 'flower.com/tests/package-lock.json']:
    data = json.loads((root / lock).read_text(encoding='utf-8'))
    for location, package in sorted(data['packages'].items()):
        if not location:
            continue
        npm.append({'lockfile': lock, 'path': location, 'name': location.rsplit('node_modules/', 1)[-1],
                    'version': package.get('version'), 'license': package.get('license', 'UNKNOWN'),
                    'dev': bool(package.get('dev')), 'optional': bool(package.get('optional'))})

nuget = []
for project in sorted((root / 'flower.com').rglob('*.csproj')):
    if any(part in ['bin', 'obj', 'node_modules'] for part in project.parts):
        continue
    for reference in ET.parse(project).getroot().iter('PackageReference'):
        name, version = reference.attrib['Include'], reference.attrib['Version']
        record = {'project': project.relative_to(root).as_posix(), 'name': name, 'version': version,
                  'license': 'UNKNOWN', 'licenseType': None}
        if args.nuget_cache:
            nuspec = args.nuget_cache / name.lower() / version.lower() / (name.lower() + '.nuspec')
            if nuspec.is_file():
                metadata = ET.parse(nuspec).getroot().find('{*}metadata')
                license_node = metadata.find('{*}license')
                if license_node is not None:
                    record.update(license=license_node.text, licenseType=license_node.attrib.get('type'))
                record['metadataSource'] = f'NuGet cache: {name}/{version}/{name.lower()}.nuspec'
        nuget.append(record)

credits = (root / 'docs/product-image-credits.md').read_text(encoding='utf-8')
assets = []
paths = git('ls-files').splitlines()
for name in paths:
    if (name.startswith(('flower.com/images/', 'docs/wiki/')) and Path(name).suffix.lower() in ['.webp', '.png', '.jpeg', '.jpg', '.svg']) or name == 'flower.com/favicon.svg':
        assets.append({'path': name, 'status': 'documented-image-credit' if f'`{name}`' in credits else 'permission-evidence-not-recorded'})

base = git('rev-parse', '9bd76dc')
def blobs(revision):
    result = {}
    for line in git('ls-tree', '-r', revision).splitlines():
        metadata, name = line.split('\t', 1)
        if metadata.split()[1] == 'blob':
            result.setdefault(metadata.split()[2], []).append(name)
    return result
old, current = blobs(base), blobs('HEAD')
matches = [{'blob': blob, 'upstreamPaths': old[blob], 'currentPaths': current[blob]} for blob in sorted(old.keys() & current.keys())]
report = {'sourceCommit': git('rev-parse', 'HEAD'), 'upstreamBaseline': base,
          'scope': 'npm lockfile metadata (all locations), direct NuGet references only, tracked image/SVG asset paths; no legal clearance or full transitive NuGet SBOM',
          'npmLicenseCounts': dict(sorted(Counter(str(p['license']) for p in npm).items())),
          'npm': npm, 'nugetDirect': nuget, 'assets': assets, 'identicalUpstreamBlobs': matches}
output = Path(args.output)
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'npmLocations': len(npm), 'npmUnknown': sum(p['license'] == 'UNKNOWN' for p in npm),
                  'directNugetReferences': len(nuget), 'nugetUnknown': sum(p['license'] == 'UNKNOWN' for p in nuget),
                  'assetCounts': dict(Counter(a['status'] for a in assets)), 'identicalUpstreamBlobs': len(matches)}, ensure_ascii=False))
