"""Deduplicate identical embedded assets without changing any image pixels."""
from pathlib import Path
import zipfile, hashlib, posixpath
import xml.etree.ElementTree as ET
base=Path(__file__).resolve().parent
with zipfile.ZipFile(base/'draft.pptx') as zin:
    files={n:zin.read(n) for n in zin.namelist()}
seen={}; replacements={}
for name,contents in files.items():
    if name.startswith('ppt/media/'):
        key=(Path(name).suffix,hashlib.sha256(contents).digest())
        if key in seen: replacements[name]=seen[key]
        else: seen[key]=name
ns='http://schemas.openxmlformats.org/package/2006/relationships'
ET.register_namespace('',ns)
for name,contents in list(files.items()):
    if not name.endswith('.rels'):continue
    tree=ET.fromstring(contents); changed=False
    owner_dir=posixpath.dirname(posixpath.dirname(name))
    for rel in tree:
        if rel.get('TargetMode')=='External': continue
        target=rel.get('Target','')
        full=(posixpath.normpath(target).lstrip('/') if target.startswith('/')
              else posixpath.normpath(posixpath.join(owner_dir,target)))
        if full in replacements:
            rel.set('Target',posixpath.relpath(replacements[full],owner_dir));changed=True
    if changed:files[name]=ET.tostring(tree,encoding='utf-8',xml_declaration=True)
ct='[Content_Types].xml'
tree=ET.fromstring(files[ct]);changed=False
for element in list(tree):
    if element.get('PartName','').lstrip('/') in replacements:
        tree.remove(element);changed=True
if changed:files[ct]=ET.tostring(tree,encoding='utf-8',xml_declaration=True)
with zipfile.ZipFile(base/'candidate-dedup.pptx','w',zipfile.ZIP_DEFLATED) as zout:
    for name,contents in files.items():
        if name not in replacements:zout.writestr(name,contents)
print(f'Deduplicated {len(replacements)} exact image copies; images unchanged.')
