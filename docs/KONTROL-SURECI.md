# Kontrol süreci: kıyasla, sonra ekle

```
kaynak dosya ──import──▶ status = pending ──compare──▶ agree_count / conflict / not
                                                      │
                     yönetim paneli (insan) ◀─────────┘
                       ├─ çelişkiler: tek tek onay/ret (toplu onaya asla girmez)
                       ├─ rastgele 50 örnek: elle bakılır, not yazılır
                       └─ toplu onay (not zorunlu) ──▶ status = approved ──▶ sitede görünür
```

- Ziyaretçi yalnızca `status = 'approved'` satırları görür. Yönetici `?preview=1` ile onay
  bekleyenleri de sarı zeminde görebilir.
- Her kaynak kendi satırını yazar; bir kaynağın onayı başka kaynağın verisini yayına sokmaz.
- Her onay/ret `audit_log` tablosuna kim, ne zaman, hangi notla bilgisiyle yazılır.
- Kullanıcıların "Hata bildir" kayıtları içeriği değiştirmez; panelde listelenir.
- LLM ile üretilmiş çeviri/ilişki kullanılmıyor. İleride eklenirse ayrı kaynak adıyla
  (`source = 'llm'`) yüklenip yalnız tek tek onayla yayına girmeli.

## Karşılaştırma kuralları (`etl/compare.py`)
| Veri | Uyum | Çelişki |
|---|---|---|
| Kelime (lemma) | aynı kelime + aynı kök birden fazla kaynakta | kaynaklar farklı kök veriyor (ör. شيطان: Kur'an korpusu شطن, Arramooz شيط) |
| Sözlük maddesi | aynı sözlük + kök iki dijital nüshada, metin benzerliği ≥ %85 | benzerlik < %50 |
| Eş/zıt anlam | aynı ikili birden fazla kaynakta | aynı ikili hem eş hem zıt işaretli |
| Karşılık | aynı Türkçe karşılık birden fazla kaynakta | — |
| Kur'an korpusu | yapısal kontrol: 114 sûre, 6.236 âyet, 77.429 kelime | sayı tutmazsa yük "KALDI" |

## İlk yerel denemenin sonucu (Kur'an korpusu + Arramooz)
- Kur'an lemmaları: 5.018 → 3.591 Arramooz ile uyumlu, 1.192 tek kaynak, **235 çelişki**.
- Arramooz: 42.244 → 5.894 uyumlu, 35.754 tek kaynak, **596 çelişki**.
- 50 kontrol kelimesi: 50/50 doğru kök ve Kur'an geçişi (önizleme verisiyle). Doğrulama
  sırasında yakalanıp düzeltilenler: korpusun Mushaf imlâlı lemmaları (عِبادَت، وَلايَت),
  إيلاف'ın korpusta إِلاف diye lemmalanması, إِيمَان aramasının أَيْمَان'a (yeminler) düşmesi.
