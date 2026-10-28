import json, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from normalize import form_key, normalize, normalize_root, lemma_key

cases = json.loads((pathlib.Path(__file__).parent.parent / "data/normalize_cases.json").read_text())
bad = [(f, i, f(i), w) for f, key in ((normalize, "normalize"), (normalize_root, "root"), (lemma_key, "lemma_key"), (form_key, "form_key"))
       for i, w in cases[key] if f(i) != w]
for f, i, got, want in bad:
    print(f"HATA {f.__name__}({i!r}) = {got!r}, beklenen {want!r}")
print(f"{sum(len(cases[k]) for k in ('normalize', 'root', 'lemma_key', 'form_key')) - len(bad)} geçti, {len(bad)} hata")
sys.exit(1 if bad else 0)
