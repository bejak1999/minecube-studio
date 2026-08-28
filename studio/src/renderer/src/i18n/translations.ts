export type Language = 'en' | 'de';

export const translations: Record<Language, Record<string, string>> = {
  en: {
    // Main tabs
    'tab.panels': 'Panels',
    'tab.presets': 'Presets',
    'tab.settings': 'Settings',

    // Settings - Media servers
    'settings.mediaServers.title': 'Media Servers',
    'settings.mediaServers.description': 'go2rtc or Frigate. Camera list is fetched by the main process.',
    'settings.mediaServers.add': '+ Server',
    'settings.mediaServers.empty': 'No server yet. Add one to select "Stream" as source for panels.',
    'settings.mediaServers.name': 'Name',
    'settings.mediaServers.hint.go2rtc': 'e.g. http://192.168.1.10:1984',
    'settings.mediaServers.hint.frigate': 'e.g. http://192.168.1.10:5000',
    'settings.mediaServers.remove': 'Remove',
    'settings.mediaServers.loadCameras': 'Load Cameras',
    'settings.mediaServers.camerasFound': 'camera(s) found',
    'settings.mediaServers.notQueried': 'not queried yet',

    // Settings - System startup
    'settings.startup.title': 'System Startup',
    'settings.startup.autostart': 'Start with Windows',
    'settings.startup.minimized': 'Start minimized on autostart',
    'settings.startup.minimizeToTray': 'Minimize to tray when closing',
    'settings.startup.description':
      'Last configured content continues running after startup if "Auto-play on Startup" is enabled. The autostart entry is only set by an installed version — in development mode it would leave a reference to node_modules.',

    // Settings - Keyboard shortcuts
    'settings.shortcuts.title': 'Keyboard Shortcuts',
    'settings.shortcuts.sceneSwitch': 'Switch Scenes',
    'settings.shortcuts.recording': 'Press keys...',
    'settings.shortcuts.notSet': 'Not Set',
    'settings.shortcuts.delete': 'Delete shortcut',
    'settings.shortcuts.description':
      'A global shortcut works even when the program is minimized (e.g. CommandOrControl+Shift+S).',

    // Settings - Hardware monitor
    'settings.hardware.title': 'Hardware Monitor',
    'settings.hardware.description':
      'Dashboards show CPU/RAM/network/disk usage immediately without additional software. For temperatures and fan speeds, optionally start LibreHardwareMonitor and enable Remote Web Server under Options, then enter the address here.',
    'settings.hardware.loadSensors': 'Load Sensors',
    'settings.hardware.sensorsFound': 'sensor(s) found',
    'settings.hardware.notQueried': 'not queried yet',

    // Settings - Frigate events
    'settings.frigate.title': 'Frigate Events',
    'settings.frigate.description':
      'Automatically shows a camera on a panel while Frigate detects an object there — e.g. "person" on the driveway camera for at least 20s on panel 2. Works via frigate/<camera>/<label> MQTT topics, the same ones Home Assistant Frigate integration uses — the same broker Frigate already uses.',
    'settings.frigate.unifiedWarning':
      'Currently "Unified Mode" is active — events can only take over a panel in single mode, as there is no independent panel content there.',
    'settings.frigate.brokerIdle': 'no broker configured',
    'settings.frigate.brokerConnecting': 'connecting…',
    'settings.frigate.brokerConnected': 'connected',
    'settings.frigate.brokerError': 'Error',
    'settings.frigate.brokerUrl': 'mqtt://192.168.1.10:1883',
    'settings.frigate.username': 'Username (optional)',
    'settings.frigate.password': 'Password (optional)',
    'settings.frigate.removeBroker': 'Remove broker connection',
    'settings.frigate.noServers': 'No media server of type "Frigate" configured — add one above first.',
    'settings.frigate.ruleName': 'Name, e.g. Driveway',
    'settings.frigate.selectServer': 'Frigate Server…',
    'settings.frigate.selectCamera': 'Camera…',
    'settings.frigate.reloadCameras': 'Reload cameras',
    'settings.frigate.labels': 'Labels, comma-separated (empty = all), e.g. person, car',
    'settings.frigate.addRule': '+ Rule',
    'settings.frigate.incomingEvents': 'Incoming Events',
    'settings.frigate.noEvents': 'No MQTT message received yet. To test: trigger camera (e.g. walk in front) and check if something appears here — if not, it\'s the broker connection above, not a rule.',
    'settings.frigate.removeRule': 'Remove',

    // Settings - Transmission
    'settings.transmission.title': 'Transmission',
    'settings.transmission.description':
      'WebRTC has the lowest latency; negotiation runs via the main process, the image comes directly. MJPEG works virtually always and is routed via the internal media:// schema so the canvas is not "tainted" and can still be encoded.',

    // Settings - Diagnostics
    'settings.diagnostics.title': 'Diagnostics',
    'settings.diagnostics.description':
      'Panel connection problems are written to a log file, including USB drop-outs, reconnects and sleep/wake events. Open it if a panel freezes or Windows reports an unrecognised USB device.',
    'settings.diagnostics.open': 'Show log file',

    // Settings - Language
    'settings.language.title': 'Language',
    'settings.language.description': 'Choose your preferred language',

    // Output settings
    'output.quality': 'Quality',
    'output.fps': 'FPS',

    // Panel labels
    'panel.label': 'Panel',

    // Source kinds
    'source.empty': 'Empty',
    'source.color': 'Color',
    'source.image': 'Image',
    'source.gif': 'GIF / Animation',
    'source.video': 'Video',
    'source.stream': 'Camera Stream',
    'source.desktop': 'Screen',

    // Stream modes
    'stream.webrtc': 'WebRTC',
    'stream.mjpeg': 'MJPEG',

    // Studio UI
    'studio.connectedCount': 'Panels connected',
    'studio.encodeStats': 'Encode',
    'studio.reconnect': 'Reconnect',
    'studio.setup': 'Setup',
    'studio.start': 'Start',
    'studio.stop': 'Stop',
    'studio.searchingPanels': 'Searching for panels…',
    'studio.mode': 'Mode',
    'studio.individual': '4 × individual',
    'studio.unified': '1 × continuous',
    'studio.chooseFile': 'File…',
    'studio.noContent': 'no content',
    'studio.chooseScreen': 'Screen…',
    'studio.chooseCrop': 'Choose crop…',
    'studio.server': '— Server —',
    'studio.camera': '— Camera —',
    'studio.screen': '— Screen —',
    'studio.quality': 'Quality',
    'studio.fps': 'FPS',
    'studio.output': 'Output',
    'studio.jpegQuality': 'JPEG Quality',
    'studio.actualQuality': 'Actual Quality',
    'studio.actualQualityDescription': 'Actually used (can be lower for demanding content like camera feeds to comply with the ~249 KB limit per frame):',
    'studio.maxFramerate': 'Max Framerate',
    'studio.autoplayOnStart': 'Auto-play on start',
    'studio.reloadCameras': 'Reload camera list',
    'studio.reloadScreens': 'Reload screens',

    // Presets Tab
    'presets.title': 'Presets',
    'presets.description': 'Save a panel content that you can drop on any display. Save via star on the panel card.',
    'presets.noPresets': 'No presets saved yet.',
    'presets.deleteTitle': 'Delete preset',
    'presets.showOn': 'show on:',
    'presets.dashboards': 'Dashboards',
    'presets.addNew': '+ New',
    'presets.dashboardsDescription': 'Custom displays made of text, gauges, graphs and shapes fed from system values. A dashboard overlays the existing panel content — image, video or stream continues to play underneath.',
    'presets.noDashboards': 'No dashboard yet. "+ New" opens the editor.',
    'presets.widgets': 'Widget(s)',
    'presets.edit': 'Edit',
    'presets.deleteDashboard': 'Delete dashboard',
    'presets.overlayOn': 'as overlay on:',
    'presets.scenes': 'Scenes',
    'presets.scenesDescription': 'The complete arrangement: layout, all four panels with carousels and rotation.',
    'presets.sceneName': 'Scene name',
    'presets.saveCurrent': 'Save current',
    'presets.noScenes': 'No scene saved yet.',
    'presets.carousel': 'Carousel',
    'presets.elements': 'Elements',
    'presets.stream': 'Stream',
    'presets.color': 'Color',
    'presets.load': 'Load',
    'presets.deleteScene': 'Delete scene',

    // PanelCard & Panels
    'panel.panelLabel': 'Panel',
    'panel.delete': 'Delete',
    'panel.loadImage': 'Load Image',
    'panel.nothingLoaded': 'nothing loaded',
    'panel.reload': 'Reload',
    'panel.noStream': '— no stream —',
    'panel.noCamera': '— no camera —',
    'panel.noDashboard': '— no dashboard —',
    'panel.addOverlay': '+ Add Overlay Dashboard',
    'panel.editOverlay': 'Edit overlay dashboard',
    'panel.displayDuration': 'Display duration',
    'panel.playToEnd': 'Play to end',
    'panel.randomOrder': 'Random order',
    'panel.carousel': 'Carousel',
    'panel.cropEdit': 'Edit crop',
    'panel.crop': 'Crop',
    'panel.saveAsPreset': 'Save content as preset',
    'panel.offline': 'offline',
    'panel.selectServer': '— Select server —',
    'panel.selectCamera': '— Camera —',
    'panel.reloadCameras': 'Reload camera list',
    'panel.webrtcLowLatency': 'WebRTC (low latency)',
    'panel.mjpegCompatible': 'MJPEG (compatible)',
    'panel.noServersConfigured': 'No server configured — see Settings tab.',
    'panel.selectScreen': '— Select screen —',
    'panel.reloadScreens': 'Reload screens',
    'panel.error': 'Error',
    'panel.fitCrop': 'Fill (crop)',
    'panel.fitContain': 'Fit',
    'panel.fitStretch': 'Stretch',
    'panel.noDashboardOverlay': '— no dashboard overlay —',
    'panel.source': 'Source',
    'panel.presetNamePrompt': 'Name for the preset:',
    's': 's',

    // Playlist Editor
    'playlist.noFile': '(no file)',
    'playlist.addItem': '+ Add…',
    'playlist.empty': 'Nothing yet. Use "+ Add" to add files or the current view.',
    'playlist.moveUp': 'move up',
    'playlist.moveDown': 'move down',
    'playlist.remove': 'remove',
    'playlist.edit': 'Edit',
    'playlist.customDwell': 'Custom display duration',
    'playlist.customDwellDefault': '(0 = default)',
    'playlist.videosDwellNote': 'For videos, the display duration is a maximum — images and GIFs always change after it.',
    'playlist.rotated': 'rotated',

    // Prompt Modal
    'prompt.cancel': 'Cancel',
    'prompt.save': 'Save',

    // CubeView
    'cube.resetView': 'Reset view',

    // Dashboard Editor
    'dashboard.autoSaved': 'Is saved automatically · the checkerboard pattern shows what will be transparent',
    'dashboard.done': 'Done',
    'dashboard.selectWidget': 'Add widget from palette or click existing one to edit.',

    // Widget Palette
    'widget.text.label': 'Text/Value',
    'widget.text.hint': 'Value with unit, e.g. "57 °C"',
    'widget.gauge.label': 'Gauge',
    'widget.gauge.hint': 'Ring progress indicator',
    'widget.graph.label': 'Graph',
    'widget.graph.hint': 'Line over the last seconds',
    'widget.shape.label': 'Shape',
    'widget.shape.hint': 'Rectangle or circle as background',
    'widget.icon.label': 'Image/Icon',
    'widget.icon.hint': 'Static image from file',

    // Widget Properties
    'widget.toFront': 'To front',
    'widget.toBack': 'To back',
    'widget.delete': 'Delete',
    'widget.metric': 'Metric',
    'widget.fixedText': '— Fixed text —',
    'widget.none': '— None —',
    'widget.builtIn': 'Built-in',
    'widget.disks': 'Disks',
    'widget.hardware': 'LibreHardwareMonitor',
    'widget.hardwareNote': 'For temperatures/fans: set Hardware Monitor URL in settings.',
    'widget.unit': 'Unit',
    'widget.text': 'Text',
    'widget.label': 'Label (optional)',
    'widget.example': 'e.g. CPU',
    'widget.labelColor': 'Label color',
    'widget.labelSize': 'Size',
    'widget.decimals': 'Decimal places',
    'widget.format': 'Format',
    'widget.min': 'Min',
    'widget.max': 'Max',
    'widget.auto': 'auto',
    'widget.timeRange': 'Time range (s)',
    'widget.smooth': 'Smooth',
    'widget.shape': 'Shape',
    'widget.rectangle': 'Rectangle',
    'widget.circle': 'Circle',
    'widget.image': 'Image',
    'widget.noFile': 'No file',
    'widget.chooseFile': 'Choose file…',
    'widget.color': 'Color',
    'widget.background': 'Background',
    'widget.transparent': 'Transparent',
    'widget.bgOpacity': 'Background opacity',
    'widget.border': 'Border',
    'widget.noBorder': 'No border',
    'widget.borderWidth': 'Border width',
    'widget.fontSize': 'Font size',
    'widget.align': 'Alignment',
    'widget.left': 'Left',
    'widget.center': 'Center',
    'widget.right': 'Right',
    'widget.opacity': 'Opacity',

    // Setup Mode
    'setup.active': 'Setup Mode Active',
    'setup.description': 'Each panel now shows its number. Walk up to the cube, check which physical display corresponds to which number, and assign below.',
    'setup.unassigned': '— unassigned —',
    'setup.swap': 'Swap',

    // Crop Editor
    'crop.title': 'Select crop',
    'crop.square': 'Keep square',
    'crop.largestSquare': 'Largest square',
    'crop.fullImage': 'Full image',
    'crop.noPreview': 'No preview',

    // Unified Editor
    'unified.title': 'Continuous Mode',
    'unified.selectCrop': 'Select crop',

    // Metrics
    'metric.cpu.load': 'CPU Usage',
    'metric.mem.usedPercent': 'RAM Usage',
    'metric.mem.usedGb': 'RAM Used',
    'metric.mem.totalGb': 'RAM Total',
    'metric.net.rxKbps': 'Download',
    'metric.net.txKbps': 'Upload',
    'metric.gpu.load': 'GPU Usage',
    'metric.gpu.temp': 'GPU Temperature',
    'metric.gpu.memUsedPercent': 'GPU Memory',
    'metric.disk.usedPercent': 'Disk Usage',
    'metric.disk.usedGb': 'Disk Used',
    'metric.disk.totalGb': 'Disk Total',

    // Error messages
    'error.invalidColor': 'Invalid color',
    'error.noScreenSelected': 'No screen selected',
    'error.noFileSelected': 'No file selected',
    'error.imageDecoderNotSupported': 'ImageDecoder not supported by this Chromium version',
    'error.noServerSelected': 'No server selected',
    'error.noCameraSelected': 'No camera selected',
    'error.preloadBridgeMissing': 'Preload bridge missing — window.minecube not available',

    // Other
    'ui.dragToRotate': 'Drag to rotate · Scroll to zoom',
  },

  de: {
    // Main tabs
    'tab.panels': 'Panels',
    'tab.presets': 'Presets',
    'tab.settings': 'Einstellungen',

    // Settings - Media servers
    'settings.mediaServers.title': 'Medienserver',
    'settings.mediaServers.description': 'go2rtc oder Frigate. Die Kameraliste wird vom Hauptprozess geholt.',
    'settings.mediaServers.add': '+ Server',
    'settings.mediaServers.empty': 'Noch kein Server. Leg einen an, dann kannst du bei den Panels „Stream" als Quelle wählen.',
    'settings.mediaServers.name': 'Name',
    'settings.mediaServers.hint.go2rtc': 'z. B. http://192.168.1.10:1984',
    'settings.mediaServers.hint.frigate': 'z. B. http://192.168.1.10:5000',
    'settings.mediaServers.remove': 'Entfernen',
    'settings.mediaServers.loadCameras': 'Kameras laden',
    'settings.mediaServers.camerasFound': 'Kamera(s) gefunden',
    'settings.mediaServers.notQueried': 'noch nicht abgefragt',

    // Settings - System startup
    'settings.startup.title': 'Systemstart',
    'settings.startup.autostart': 'Mit Windows starten',
    'settings.startup.minimized': 'Beim Autostart ohne Fenster starten',
    'settings.startup.minimizeToTray': 'Schließen minimiert in den Infobereich',
    'settings.startup.description':
      'Zuletzt eingestellte Inhalte laufen nach dem Start automatisch weiter, sofern „Beim Start automatisch abspielen" aktiv ist. Der Autostart-Eintrag wird erst von einer installierten Version gesetzt — im Entwicklungsmodus bliebe sonst ein Verweis auf node_modules zurück.',

    // Settings - Keyboard shortcuts
    'settings.shortcuts.title': 'Tastenkombinationen',
    'settings.shortcuts.sceneSwitch': 'Szenen durchschalten',
    'settings.shortcuts.recording': 'Tasten drücken...',
    'settings.shortcuts.notSet': 'Nicht belegt',
    'settings.shortcuts.delete': 'Shortcut löschen',
    'settings.shortcuts.description':
      'Ein globaler Shortcut funktioniert auch, wenn das Programm minimiert ist (z. B. CommandOrControl+Shift+S).',

    // Settings - Hardware monitor
    'settings.hardware.title': 'Hardware-Monitor',
    'settings.hardware.description':
      'Dashboards zeigen CPU-/RAM-/Netzwerk-/Datenträger-Auslastung sofort, ohne Zusatzsoftware. Für Temperaturen und Lüfterdrehzahlen optional LibreHardwareMonitor starten und unter Options → Remote Web Server aktivieren, dann hier die Adresse eintragen.',
    'settings.hardware.loadSensors': 'Sensoren laden',
    'settings.hardware.sensorsFound': 'Sensor(en) gefunden',
    'settings.hardware.notQueried': 'noch nicht abgefragt',

    // Settings - Frigate events
    'settings.frigate.title': 'Frigate-Ereignisse',
    'settings.frigate.description':
      'Zeigt eine Kamera automatisch auf einem Panel, solange Frigate dort ein Objekt erkennt -- z. B. „Person" auf der Einfahrt-Kamera für mindestens 20s auf Panel 2. Läuft über die frigate/<kamera>/<label>-MQTT-Topics, dieselben, die auch Home Assistants Frigate-Integration nutzt -- derselbe Broker, den Frigate selbst schon verwendet.',
    'settings.frigate.unifiedWarning':
      'Aktuell ist „Einheitlicher Modus" aktiv -- Ereignisse können ein Panel nur im Einzelmodus übernehmen, da es dort keinen unabhängigen Panel-Inhalt gibt.',
    'settings.frigate.brokerIdle': 'kein Broker konfiguriert',
    'settings.frigate.brokerConnecting': 'verbinde…',
    'settings.frigate.brokerConnected': 'verbunden',
    'settings.frigate.brokerError': 'Fehler',
    'settings.frigate.brokerUrl': 'mqtt://192.168.1.10:1883',
    'settings.frigate.username': 'Benutzername (optional)',
    'settings.frigate.password': 'Passwort (optional)',
    'settings.frigate.removeBroker': 'Broker-Verbindung entfernen',
    'settings.frigate.noServers': 'Kein Medienserver vom Typ „Frigate" angelegt -- dafür oben erst einen hinzufügen.',
    'settings.frigate.ruleName': 'Name, z. B. Einfahrt',
    'settings.frigate.selectServer': 'Frigate-Server…',
    'settings.frigate.selectCamera': 'Kamera…',
    'settings.frigate.reloadCameras': 'Kameras neu laden',
    'settings.frigate.labels': 'Labels, kommagetrennt (leer = alle), z. B. person, car',
    'settings.frigate.addRule': '+ Regel',
    'settings.frigate.incomingEvents': 'Eingehende Ereignisse',
    'settings.frigate.noEvents': 'Noch keine MQTT-Nachricht angekommen. Zum Testen: Kamera auslösen (z. B. davor laufen) und prüfen, ob hier etwas erscheint -- wenn nicht, liegt es an der Broker-Verbindung oben, nicht an einer Regel.',
    'settings.frigate.removeRule': 'Entfernen',

    // Settings - Transmission
    'settings.transmission.title': 'Übertragung',
    'settings.transmission.description':
      'WebRTC hat die geringste Latenz; die Aushandlung läuft über den Hauptprozess, das Bild kommt direkt an. MJPEG funktioniert praktisch immer und wird über das interne media://-Schema geleitet, damit die Canvas nicht „tainted" wird und sich noch encodieren lässt.',

    // Settings - Language
    // Settings - Diagnose
    'settings.diagnostics.title': 'Diagnose',
    'settings.diagnostics.description':
      'Verbindungsprobleme der Panels werden in eine Logdatei geschrieben — inklusive USB-Abbrüchen, Neuverbindungen und Ruhezustand-Ereignissen. Öffne sie, wenn ein Panel einfriert oder Windows ein nicht erkanntes USB-Gerät meldet.',
    'settings.diagnostics.open': 'Logdatei anzeigen',

    // Settings - Sprache
    'settings.language.title': 'Sprache',
    'settings.language.description': 'Wählen Sie Ihre bevorzugte Sprache',

    // Output settings
    'output.quality': 'Qualität',
    'output.fps': 'FPS',

    // Panel labels
    'panel.label': 'Panel',

    // Source kinds
    'source.empty': 'Leer',
    'source.color': 'Farbe',
    'source.image': 'Bild',
    'source.gif': 'GIF / Animation',
    'source.video': 'Video',
    'source.stream': 'Kamera-Stream',
    'source.desktop': 'Bildschirm',

    // Stream modes
    'stream.webrtc': 'WebRTC',
    'stream.mjpeg': 'MJPEG',

    // Studio UI
    'studio.connectedCount': 'Panels verbunden',
    'studio.encodeStats': 'Encode',
    'studio.reconnect': 'Neu verbinden',
    'studio.setup': 'Einrichtung',
    'studio.start': 'Start',
    'studio.stop': 'Stopp',
    'studio.searchingPanels': 'Panels werden gesucht…',
    'studio.mode': 'Modus',
    'studio.individual': '4 × einzeln',
    'studio.unified': '1 × durchgehend',
    'studio.chooseFile': 'Datei…',
    'studio.noContent': 'kein Motiv',
    'studio.chooseScreen': 'Bildschirm…',
    'studio.chooseCrop': 'Ausschnitt wählen…',
    'studio.server': '— Server —',
    'studio.camera': '— Kamera —',
    'studio.screen': '— Bildschirm —',
    'studio.quality': 'Qualität',
    'studio.fps': 'FPS',
    'studio.output': 'Ausgabe',
    'studio.jpegQuality': 'JPEG-Qualität',
    'studio.actualQuality': 'Tatsächliche Qualität',
    'studio.actualQualityDescription': 'Tatsächlich genutzt (kann bei aufwendigem Inhalt wie Kamerabildern niedriger sein, um das ~249 KB-Limit pro Bild einzuhalten):',
    'studio.maxFramerate': 'Max. Bildrate',
    'studio.autoplayOnStart': 'Beim Start automatisch abspielen',
    'studio.reloadCameras': 'Kameras neu laden',
    'studio.reloadScreens': 'Bildschirme neu laden',

    // Presets Tab
    'presets.title': 'Presets',
    'presets.description': 'Inhalt eines Panels, den du auf jedes beliebige Display legen kannst. Speichern über den Stern auf der Panel-Karte.',
    'presets.noPresets': 'Noch keine Presets gespeichert.',
    'presets.deleteTitle': 'Preset löschen',
    'presets.showOn': 'anzeigen auf:',
    'presets.dashboards': 'Dashboards',
    'presets.addNew': '+ Neu',
    'presets.dashboardsDescription': 'Eigene Anzeigen aus Text, Gauges, Verläufen und Formen, gespeist aus Systemwerten. Ein Dashboard legt sich als Overlay über den bestehenden Panel-Inhalt — Bild, Video oder Stream laufen darunter weiter.',
    'presets.noDashboards': 'Noch kein Dashboard. „+ Neu" öffnet den Editor.',
    'presets.widgets': 'Widget(s)',
    'presets.edit': 'Bearbeiten',
    'presets.deleteDashboard': 'Dashboard löschen',
    'presets.overlayOn': 'als Overlay auf:',
    'presets.scenes': 'Szenen',
    'presets.scenesDescription': 'Die komplette Anordnung: Modus, alle vier Panels samt Karussells und Drehung.',
    'presets.sceneName': 'Name der Szene',
    'presets.saveCurrent': 'Aktuelle sichern',
    'presets.noScenes': 'Noch keine Szene gespeichert.',
    'presets.carousel': 'Karussell',
    'presets.elements': 'Elemente',
    'presets.stream': 'Stream',
    'presets.color': 'Farbe',
    'presets.load': 'Laden',
    'presets.deleteScene': 'Szene löschen',

    // PanelCard & Panels
    'panel.panelLabel': 'Panel',
    'panel.delete': 'Löschen',
    'panel.loadImage': 'Datei laden',
    'panel.nothingLoaded': 'nichts geladen',
    'panel.reload': 'Neu laden',
    'panel.noStream': '— kein Stream —',
    'panel.noCamera': '— keine Kamera —',
    'panel.noDashboard': '— kein Dashboard —',
    'panel.addOverlay': '+ Neues Overlay-Dashboard',
    'panel.editOverlay': 'Overlay-Dashboard bearbeiten',
    'panel.displayDuration': 'Anzeigedauer',
    'panel.playToEnd': 'Videos zu Ende spielen',
    'panel.randomOrder': 'Zufällige Reihenfolge',
    'panel.carousel': 'Karussell',
    'panel.cropEdit': 'Ausschnitt bearbeiten',
    'panel.crop': 'Ausschnitt',
    'panel.saveAsPreset': 'Inhalt als Preset speichern',
    'panel.offline': 'offline',
    'panel.selectServer': '— Server wählen —',
    'panel.selectCamera': '— Kamera —',
    'panel.reloadCameras': 'Kameraliste neu laden',
    'panel.webrtcLowLatency': 'WebRTC (geringe Latenz)',
    'panel.mjpegCompatible': 'MJPEG (kompatibel)',
    'panel.noServersConfigured': 'Kein Server konfiguriert — siehe Tab „Einstellungen".',
    'panel.selectScreen': '— Bildschirm wählen —',
    'panel.reloadScreens': 'Bildschirme neu laden',
    'panel.error': 'Fehler',
    'panel.fitCrop': 'Füllen (beschneiden)',
    'panel.fitContain': 'Einpassen',
    'panel.fitStretch': 'Verzerren',
    'panel.noDashboardOverlay': '— kein Dashboard-Overlay —',
    'panel.source': 'Quelle',
    'panel.presetNamePrompt': 'Name für das Preset:',
    's': 's',

    // Playlist Editor
    'playlist.noFile': '(ohne Datei)',
    'playlist.addItem': '+ Hinzufügen…',
    'playlist.empty': 'Noch nichts drin. Mit „+ Hinzufügen" Dateien oder die aktuelle Ansicht hinzufügen.',
    'playlist.moveUp': 'nach oben',
    'playlist.moveDown': 'nach unten',
    'playlist.remove': 'entfernen',
    'playlist.edit': 'Bearbeiten',
    'playlist.customDwell': 'Eigene Anzeigedauer',
    'playlist.customDwellDefault': '(0 = Standard)',
    'playlist.videosDwellNote': 'Bei Videos gilt die Anzeigedauer als Obergrenze — Bilder und GIFs wechseln immer danach.',
    'playlist.rotated': 'gedreht',

    // Prompt Modal
    'prompt.cancel': 'Abbrechen',
    'prompt.save': 'Speichern',

    // CubeView
    'cube.resetView': 'Ansicht zurücksetzen',

    // Dashboard Editor
    'dashboard.autoSaved': 'wird automatisch gespeichert · das Karo-Muster zeigt, was später durchscheint',
    'dashboard.done': 'Fertig',
    'dashboard.selectWidget': 'Widget aus der Palette hinzufügen oder ein vorhandenes anklicken, um es zu bearbeiten.',

    // Widget Palette
    'widget.text.label': 'Text/Zahl',
    'widget.text.hint': 'Wert mit Einheit, z. B. „57 °C"',
    'widget.gauge.label': 'Gauge',
    'widget.gauge.hint': 'Ring-Fortschrittsanzeige',
    'widget.graph.label': 'Verlauf',
    'widget.graph.hint': 'Linie über die letzten Sekunden',
    'widget.shape.label': 'Form',
    'widget.shape.hint': 'Rechteck oder Kreis als Hintergrund',
    'widget.icon.label': 'Bild/Icon',
    'widget.icon.hint': 'Statisches Bild aus einer Datei',

    // Widget Properties
    'widget.toFront': 'Nach vorn',
    'widget.toBack': 'Nach hinten',
    'widget.delete': 'Löschen',
    'widget.metric': 'Messwert',
    'widget.fixedText': '— fester Text —',
    'widget.none': '— keiner —',
    'widget.builtIn': 'Ohne Zusatzsoftware',
    'widget.disks': 'Datenträger',
    'widget.hardware': 'LibreHardwareMonitor',
    'widget.hardwareNote': 'Für Temperaturen/Lüfter: Hardware-Monitor-URL in den Einstellungen setzen.',
    'widget.unit': 'Einheit',
    'widget.text': 'Text',
    'widget.label': 'Beschriftung (optional)',
    'widget.example': 'z. B. CPU',
    'widget.labelColor': 'Beschriftungsfarbe',
    'widget.labelSize': 'Größe',
    'widget.decimals': 'Nachkommastellen',
    'widget.format': 'Format',
    'widget.min': 'Min',
    'widget.max': 'Max',
    'widget.auto': 'auto',
    'widget.timeRange': 'Zeitraum (s)',
    'widget.smooth': 'Geglättet',
    'widget.shape': 'Form',
    'widget.rectangle': 'Rechteck',
    'widget.circle': 'Kreis',
    'widget.image': 'Bild',
    'widget.noFile': 'keine Datei',
    'widget.chooseFile': 'Datei wählen…',
    'widget.color': 'Farbe',
    'widget.background': 'Hintergrund',
    'widget.transparent': 'transparent',
    'widget.bgOpacity': 'Hintergrund-Deckkraft',
    'widget.border': 'Rahmen',
    'widget.noBorder': 'kein Rahmen',
    'widget.borderWidth': 'Rahmenbreite',
    'widget.fontSize': 'Schriftgröße',
    'widget.align': 'Ausrichtung',
    'widget.left': 'Links',
    'widget.center': 'Mitte',
    'widget.right': 'Rechts',
    'widget.opacity': 'Deckkraft',

    // Setup Mode
    'setup.active': 'Einrichtungsmodus aktiv',
    'setup.description': 'Auf jedem Panel steht jetzt seine Nummer. Schau am Würfel nach und ordne unten zu, welche physische Anzeige welcher Nummer entspricht.',
    'setup.unassigned': '— nicht zugewiesen —',
    'setup.swap': 'tauschen',

    // Crop Editor
    'crop.title': 'Ausschnitt wählen',
    'crop.square': 'Quadratisch halten',
    'crop.largestSquare': 'Größtes Quadrat',
    'crop.fullImage': 'Ganzes Bild',
    'crop.noPreview': 'Keine Vorschau',

    // Unified Editor
    'unified.title': 'Durchgehender Modus',
    'unified.selectCrop': 'Ausschnitt wählen',

    // Metrics
    'metric.cpu.load': 'CPU Auslastung',
    'metric.mem.usedPercent': 'RAM Auslastung',
    'metric.mem.usedGb': 'RAM belegt',
    'metric.mem.totalGb': 'RAM gesamt',
    'metric.net.rxKbps': 'Download',
    'metric.net.txKbps': 'Upload',
    'metric.gpu.load': 'GPU Auslastung',
    'metric.gpu.temp': 'GPU Temperatur',
    'metric.gpu.memUsedPercent': 'GPU-Speicher',
    'metric.disk.usedPercent': 'Datenträger Auslastung',
    'metric.disk.usedGb': 'Datenträger belegt',
    'metric.disk.totalGb': 'Datenträger gesamt',

    // Error messages
    'error.invalidColor': 'Ungültige Farbe',
    'error.noScreenSelected': 'Kein Bildschirm ausgewählt',
    'error.noFileSelected': 'Keine Datei ausgewählt',
    'error.imageDecoderNotSupported': 'ImageDecoder wird von dieser Chromium-Version nicht unterstützt',
    'error.noServerSelected': 'Kein Server ausgewählt',
    'error.noCameraSelected': 'Keine Kamera ausgewählt',
    'error.preloadBridgeMissing': 'Preload-Bridge fehlt — window.minecube ist nicht verfügbar',

    // Other
    'ui.dragToRotate': 'Ziehen zum Drehen · Scrollen zum Zoomen',
  },
};

export function t(key: string, language: Language = 'en'): string {
  return translations[language][key] ?? translations.en[key] ?? key;
}
