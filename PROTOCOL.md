# Thermaltake Minecube 360 Ultra — LCD-Protokoll

Reverse Engineering aus `minecube_full_start_all_red.pcapng` (USBPcap) und
`minecube_initialisierung.json`. Alle Angaben unten sind aus dem Mitschnitt
verifiziert; `test_protocol.py` prüft die Encoder byte-exakt gegen echte Frames
(`vectors.json`).

## Gerät

| | |
|---|---|
| VID:PID | `264A:22C5` (4× identisch, ein Gerät pro Display) |
| Klasse | HID, Usage Page `0xFF00`, Usage `0x01` (vendor defined) |
| Endpoints | Interrupt IN `0x81`, Interrupt OUT `0x01`, je `wMaxPacketSize` 1024 |
| Report-Descriptor | 36 Byte, **keine** Report-ID, In/Out je `ReportCount=1024`, `ReportSize=8` |
| Panel | 720 × 720 px |
| Firmware | app/firmware V1.0.6, sdk V1.2.7, "OS":"Linux" |

Die vier Panels unterscheiden sich nur über die USB-Strings:

| Product-String | Serial | `degree` |
|---|---|---|
| `ThermalTake USB1 Device` | `BYZL2537CM21AM003185` | 180 |
| `ThermalTake USB2 Device` | `BYZL2537CM21AM003186` | 90 |
| `ThermalTake USB3 Device` | `BYZL2537CM21AM003188` | 180 |
| `ThermalTake USB4 Device` | `BYZL2537CM21AM003187` | 270 |

**Es gibt keine Vendor-Control-Transfers.** Im Mitschnitt tauchen auf Endpoint 0
ausschließlich Standard-Requests auf (`GET_DESCRIPTOR`, `SET_CONFIGURATION`).
Die komplette Kommunikation läuft über die beiden Interrupt-Endpoints, also über
gewöhnliche HID-Output-/Input-Reports.

## Zwei Frame-Typen

Jeder Report ist genau 1024 Byte, mit `0x00` aufgefüllt. Das erste Byte
unterscheidet:

* `0x5A` — Textprotokoll (Kommandos und Antworten)
* `0x5C` — Bilddaten (JPEG-Chunks)

---

## `0x5A` — Textprotokoll

Ein HTTP-artiges Request/Response-Protokoll in einem längenpräfixierten,
checksummierten Rahmen:

```
5A | len_hi len_lo | <Text> | chk | 5A
```

* `len` = **big endian 16 bit**, Gesamtlänge des Frames *inklusive* beider `0x5A`
  und der Checksumme, also `3 + len(Text) + 2`.
* `chk` = `(len_hi + len_lo + sum(Text)) & 0xFF`.
* Danach wird auf 1024 Byte mit `0x00` gepaddet.

### Byte-Stuffing

Zwischen den beiden `0x5A`-Markern dürfen die Marker-Bytes nicht vorkommen, also
werden sie escaped:

| Byte | wird übertragen als |
|---|---|
| `0x5A` | `0x5B 0x01` |
| `0x5B` | `0x5B 0x02` |

**Länge und Checksumme beziehen sich auf die *ungestuffte* Form.** Ein gestuffter
Frame ist damit länger als sein eigenes Längenfeld — das ist kein Firmware-Bug,
sondern genau diese Regel.

Belege im Mitschnitt:

* Frame 301: Seriennummer `BYZL…` enthält `Z` = `0x5A` und wird als
  `42 59 5B 01 4C …` (`BY[\x01L…`) übertragen. Längenfeld 286, tatsächlich
  287 Byte. Checksumme stimmt nur nach dem Unstuffing.
* Frame 533: die *Checksumme selbst* war `0x5A` → übertragen als `5B 01`.
* Frame 539: Checksumme `0x5B` → übertragen als `5B 02`.

Ohne Unstuffing sieht die `conn`-Antwort aus wie abgeschnittenes JSON
(`…"bootFinish":1` ohne `}`) — daran erkennt man den Fehler zuerst.

### Request-Format

```
POST <resource> 1\r\n
SeqNumber=<n>\r\n
Date=<unix-millis>\r\n
[ContentType=json\r\n
ContentLength=<n>\r\n]
\r\n
[<JSON-Body>]
```

`SeqNumber` ist **ein einziger Zähler über alle vier Panels** (im Mitschnitt
0,1,2,3,… über die Geräte hinweg), beginnend bei 0. `ContentType`/`ContentLength`
fehlen, wenn es keinen Body gibt.

### Response-Format

```
1 200\r\n
AckNumber=<n>\r\n
[ContentType=json\r\n
ContentLength=<n>\r\n]
\r\n
[<JSON-Body>]
```

Jedes `0x5A`-Kommando wird mit genau einem Frame beantwortet. Die `0x5C`-Chunks
werden **nicht** quittiert.

### Vollständiger Befehlssatz

Beide Mitschnitte zusammen — Start der Software, Geräteerkennung, Bildwechsel —
enthalten **nur diese vier Kommandos**. Es gibt keine versteckten
Initialisierungsschritte.

| Kommando | Body | Antwort |
|---|---|---|
| `POST conn 1` | – | JSON mit Geräteinfo (s.u.) |
| `POST power 1` | `{"event":"resume"}` | leeres `1 200` |
| `POST displayInSleep 1` | `{"enable":false}` | leeres `1 200` |
| `POST realtimeDisplay 1` | `{"enable":true}` | leeres `1 200` |

`conn`-Antwort:

```json
{"OS":"Linux",
 "version":{"app":"V1.0.6","firmware":"V1.0.6","sdk":"V1.2.7","hardware":"V1.0"},
 "space":79348, "brightness":0, "degree":180,
 "sn":"BYZL2537CM21AM003185",
 "osdState":0, "mode":0, "logo":1, "timeout":5, "bootFinish":1}
```

`degree` ist die Einbaudrehung, die das Panel **selbst** anwendet. Die
Originalsoftware sendet an alle Panels dasselbe, *ungedrehte* Bild — verifiziert
durch Vergleich zweier gleichzeitig gesendeter Frames an USB2 (`degree=90`) und
USB1 (`degree=180`): identisches, aufrechtes Bild. Man muss also nicht selbst
rotieren.

---

## `0x5C` — Bildübertragung

Ein JPEG wird über N Reports verteilt. Jeder Report:

```
Offset  Größe  Inhalt
 0      1      0x5C
 1      2      BE16  Länge ab Offset 3, also 21 + len(Daten)
 3      1      Bild-Tag: (unix_seconds & 0xFF)   — konstant über alle Chunks
 4      1      0x00
 5      2      LE16  Gesamtzahl der Chunks
 7      1      Chunk-Index, 0-basiert
 8      1      0x01
 9      1      0x00
10     14      0x00 (reserviert)
24   ≤1000     JPEG-Bytes
```

* Header 24 Byte → **1000 Byte JPEG pro Report**.
* Der Chunk-Index ist ein einzelnes Byte, also **max. 255 Chunks = 255.000 Byte
  JPEG**. Die Originalsoftware bleibt mit ~150 KB darunter.
* Byte 3 ist im Mitschnitt exakt `unix_seconds & 0xFF` (144 → 157 über 13,4 s,
  identisch auf allen vier Panels zum selben Zeitpunkt). Wirkt wie ein
  Gruppen-Tag; erforderlich ist nur, dass er über alle Chunks eines Bildes
  gleich bleibt.
* **Kein Byte-Stuffing** im Bildstrom, keine Checksumme, keine Quittung. Die
  1024-Byte-Reportgrenze macht das Framing eindeutig.

### JPEG-Anforderungen

Die Originalsoftware sendet ausschließlich:

* Baseline (`SOF0`), **nicht** progressiv
* JFIF (`APP0`), 720 × 720, 8 bit
* 4:2:0 Chroma-Subsampling (Component-Sampling `0x22,0x11,0x11`)
* ~150 KB, also Qualität ≈ 95

Was die Firmware darüber hinaus akzeptiert, am Gerät getestet:

* **APP2 mit ICC-Profil ist unkritisch.** Chromiums Canvas-Encoder hängt an
  jedes JPEG ein 472-Byte-sRGB-Profil, das die Originalsoftware nie sendet. Ein
  A/B-Test über den Python-Treiber (dasselbe Bild mit und ohne Segment auf zwei
  Panels) zeigte beide korrekt an. Man darf es entfernen, um Bandbreite zu
  sparen, muss aber nicht.
* Die **Panels halten ihr Bild**, bis neue Daten kommen. Für stehende Inhalte
  ist kein Keepalive nötig — ein einzelner Bildsatz genügt.

### Ablauf

```
POST conn 1
POST power 1            {"event":"resume"}
POST displayInSleep 1   {"enable":false}
POST realtimeDisplay 1  {"enable":true}
danach beliebig oft: N × 0x5C-Chunk
```

Timing im Mitschnitt: Chunks gehen back-to-back raus (~0,25 ms Abstand,
kein künstliches Delay), Bildwechsel mit 4–20 fps. `realtimeDisplay` wird
gelegentlich erneut gesendet.

---

## Offene Punkte

* **Byte 8 = `0x01`** im `0x5C`-Header ist im ganzen Mitschnitt konstant
  (28 611 Chunks). Bedeutung unbekannt — evtl. Bildformat-Kennung. Könnte auch
  das High-Byte eines 16-bit-Chunk-Index sein, das spricht aber gegen die
  beobachteten Werte (Chunk 150 hätte dann Index 406).
* **Byte-Stuffing beim Senden** ist aus der Symmetrie des Protokolls
  geschlossen, nicht beobachtet: keiner der 16 mitgeschnittenen Requests enthält
  `0x5A`/`0x5B` im gestufften Bereich. Falls die Firmware ausgehende Frames
  *nicht* unstufft, betrifft das ~0,8 % der Frames (Checksumme trifft zufällig
  einen Marker); `Panel.request()` wiederholt darum bei fehlender Antwort mit
  neuem `Date`, was den Frame verändert.
* Kommandos für **Helligkeit**, **Rotation** und **Datei-Upload** (das Gerät
  meldet `space` ≈ 78 KB frei) existieren mit Sicherheit, kommen im Mitschnitt
  aber nicht vor.
* Wozu `timeout:5`, `logo`, `mode`, `osdState` dienen, ist unklar.
