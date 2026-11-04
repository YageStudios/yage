"""Recover the exact small NY fixture using the application's existing city-detail codec."""
import argparse
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('archive', type=Path)
parser.add_argument('codec', type=Path)
parser.add_argument('output', type=Path)
args = parser.parse_args()
proof = json.loads((Path(__file__).resolve().parents[1] / 'docs/validation/2026-11-04-dense-road-merge/input-proof.json').read_text())
if hashlib.sha256(args.codec.read_bytes()).hexdigest() != proof['codecSha256']:
    raise ValueError('The city-detail codec does not match the verified recovery')
spec = importlib.util.spec_from_file_location('city_detail_codec', args.codec)
codec = importlib.util.module_from_spec(spec)
spec.loader.exec_module(codec)
with zipfile.ZipFile(args.archive) as archive:
    raw = archive.read(proof['member'])
header, arrays = codec.city_columns(raw)
_, offsets, points = codec.street_points(header, arrays)
paths = [{'id': index, 'path': points[offsets[index]:offsets[index+1]].tolist()} for index in proof['orderedSourceIds']]
fixture = json.dumps({'source': proof['source'], 'paths': paths}).encode()
if hashlib.sha256(fixture).hexdigest() != proof['fixtureRawSha256']:
    raise ValueError('Recovered source paths differ from the verified fixture')
args.output.write_bytes(gzip.compress(fixture, mtime=0))
print(json.dumps({'memberSha256': hashlib.sha256(raw).hexdigest(), 'paths': len(paths), 'rawSha256': hashlib.sha256(fixture).hexdigest(), 'gzipSha256': hashlib.sha256(args.output.read_bytes()).hexdigest()}))
