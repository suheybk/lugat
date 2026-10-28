"""Arapça normalizasyon. src/normalize.ts ile birebir aynı kurallar;
ikisi de data/normalize_cases.json'a karşı test edilir."""
import re

DIACRITICS = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۭـ]")
NON_ARABIC_LETTER = re.compile(r"[^ء-يٱ]")
SPACES = re.compile(r"\s+")


def strip_diacritics(s: str) -> str:
    return DIACRITICS.sub("", s or "")


def normalize(s: str) -> str:
    s = strip_diacritics(s)
    s = s.replace("ی", "ي").replace("ک", "ك")
    s = re.sub("[أإآٱ]", "ا", s)
    s = s.replace("ؤ", "و").replace("ئ", "ي").replace("ة", "ه").replace("ى", "ي")
    return SPACES.sub(" ", s).strip()


def normalize_root(s: str) -> str:
    s = strip_diacritics(s)
    s = re.sub("[أإآٱءؤئا]", "ء", s)
    s = s.replace("ى", "ي").replace("ة", "ه")
    return NON_ARABIC_LETTER.sub("", s)


def form_key(s: str) -> str:
    """Resm-i Osmânî biçimini imlâî karşılaştırmaya hazırlar (üstün elif → ا)."""
    k = re.sub("و[\u064B-\u0652]*\u0670", "ا", s or "").replace("\u0670", "ا")
    return normalize(k).replace(" ", "")


def lemma_key(s: str) -> str:
    k = form_key(s)
    if k.startswith("ال") and len(k) > 4 and k != "الله":
        k = k[2:]
    return k


# Türev kategorileri (Arramooz wordtype ve Kur'an korpusu etiketlerinden)
CATEGORY_AR = [
    ("مصدر ميمي", "mastar-ı mîmî"), ("مصدر صناعي", "mastar-ı sınâî"), ("اسم المرة", "ism-i merre"),
    ("اسم هيئة", "ism-i hey'et"), ("اسم المصدر", "ism-i mastar"), ("مصدر", "mastar"),
    ("اسم فاعل", "ism-i fâil"), ("فاعل", "ism-i fâil"), ("اسم مفعول", "ism-i mef'ûl"), ("مفعول", "ism-i mef'ûl"),
    ("مبالغة", "mübalağa sîgası"), ("صفة مشبهة", "sıfat-ı müşebbehe"), ("اسم تفضيل", "ism-i tafdîl"),
    ("منسوب", "ism-i mensûb"), ("اسم آلة", "ism-i âlet"), ("اسم مكان", "ism-i mekân"),
    ("طرف زمان", "ism-i zaman"), ("تصغير", "ism-i tasgîr"), ("علم", "özel isim"), ("صفة", "sıfat"),
    ("جامد", "câmid isim"),
]
CATEGORY_QAC = {"VN": "mastar", "ACT_PCPL": "ism-i fâil", "PASS_PCPL": "ism-i mef'ûl", "ADJ": "sıfat", "PN": "özel isim"}


def category_from_arramooz(wordtype: str):
    wt = wordtype or ""
    for ar, tr in CATEGORY_AR:
        if ar in wt:
            return tr
    return None
