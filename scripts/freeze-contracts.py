"""Refresh the compatibility evidence from the committed npm lock, never during tests.

Run `npm install --package-lock-only --ignore-scripts --legacy-peer-deps` in
tests/fixtures/upstream first when deliberately updating the dependency freeze.
"""
import concurrent.futures, hashlib, io, json, pathlib, re, tarfile, urllib.request, time, base64

ROOT = pathlib.Path(__file__).resolve().parents[1]
LOCK = json.loads((ROOT / 'tests/fixtures/upstream/package-lock.json').read_text())['packages']
NAMES = ['tools', 'llm', 'agent', 'settings', 'timeout', 'subagent', 'credentials', 'compaction-basic',
         'client-ui-plugin-manager', 'client-ui-settings', 'client-ui-slots', 'client-ui-primitives',
         'host-webserver', 'client-connection']
WANTED = {'@deepseek-ai/dsh-' + name for name in NAMES}

def resolve(owner, name):
    while True:
        path = (owner + '/' if owner else '') + 'node_modules/' + name
        if path in LOCK: return path
        if not owner: return None
        owner = owner.rsplit('/node_modules/', 1)[0] if '/node_modules/' in owner else ''

releases, wanted = {}, {}
for alias in LOCK['']['dependencies']:
    root = 'node_modules/' + alias
    pending, seen, selected = [root], set(), {}
    while pending:
        owner = pending.pop()
        if owner in seen: continue
        seen.add(owner)
        row = LOCK[owner]
        for name in {**row.get('dependencies', {}), **row.get('optionalDependencies', {})}:
            target = resolve(owner, name)
            if target:
                pending.append(target)
                if name in WANTED:
                    data = LOCK[target]
                    key = name + '@' + data['version']
                    wanted[key] = (name, data)
                    selected.setdefault(name, set()).add(key)
    releases[LOCK[root]['version']] = {name: sorted(keys) for name, keys in sorted(selected.items())}

def contract(item):
    key, (name, row) = item
    cache = ROOT / '.cache/contracts-tarballs' / (name.split('/')[-1] + '-' + row['version'] + '.tgz')
    cache.parent.mkdir(parents=True, exist_ok=True)
    if cache.exists(): data = cache.read_bytes()
    else:
        for attempt in range(4):
            try:
                data = urllib.request.urlopen(row['resolved'], timeout=60).read()
                cache.write_bytes(data)
                break
            except Exception:
                if attempt == 3: raise
                time.sleep(attempt + 1)
    if row.get('integrity', '').startswith('sha512-'):
        assert base64.b64encode(hashlib.sha512(data).digest()).decode() == row['integrity'][7:], key
    archive = tarfile.open(fileobj=io.BytesIO(data), mode='r:gz')
    text = {}
    for member in archive.getmembers():
        if member.isfile() and (member.name.endswith('lib/index.js') or member.name.endswith('.d.ts')):
            text[member.name] = archive.extractfile(member).read().decode('utf-8')
    source = text.get('package/lib/index.js', '')
    exports = []
    for block in re.findall(r'export\s*\{([^}]+)\}', source):
        exports.extend(part.strip().split(' as ')[-1].strip() for part in block.split(',') if part.strip())
    declarations = '\n'.join(value for path, value in text.items() if path.endswith('.d.ts'))
    return key, {'version': row['version'], 'integrity': row.get('integrity'),
                 'entrySHA256': hashlib.sha256(source.encode()).hexdigest(), 'exports': sorted(set(exports)),
                 'slots': sorted(set(re.findall(r"['\"]((?:settings|plugins)\.[\w.]+)['\"]\s*:", declarations))),
                 'settingsRegister': bool(re.search(r'\bregister\(', declarations)) if name.endswith('/dsh-settings') else None,
                 'authorizeIndex': 'authorizeIndex(' in declarations if name.endswith('/dsh-client-connection') else None,
                 'webKinds': ['exact', 'prefix'] if "'exact' | 'prefix'" in declarations else None}

with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    contracts = dict(pool.map(contract, sorted(wanted.items())))
output = {'capturedAt': '2026-10-30', 'resolution': 'npm lockfileVersion 3; legacy-peer-deps; scripts disabled',
          'releases': dict(sorted(releases.items())), 'contracts': contracts}
(ROOT / 'tests/fixtures/resolved-contracts.json').write_text(json.dumps(output, indent=2) + '\n', encoding='utf-8')
print(f'Frozen {len(releases)} releases and {len(contracts)} resolved package contracts')
