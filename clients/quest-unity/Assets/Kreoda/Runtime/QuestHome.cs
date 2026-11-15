using System;
using System.Linq;
using UnityEngine;

namespace Kreoda.QuestRuntime
{
    // Home owns only the MR HUD composition; all commands and project data come from QuestControls.
    public sealed class QuestHome : MonoBehaviour
    {
        public Transform Page { get; private set; }
        public TextMesh ConnectionStatus { get; private set; }
        public TextMesh ProjectStatus { get; private set; }
        public TextMesh OpenableStatus { get; private set; }
        public GameObject Background { get; private set; }
        TextMesh[] _recentRows;
        GameObject[] _recentCards;
        Material[] _recentAccents;
        GameObject[] _recentAccentObjects;
        GameObject[] _recentIdentityMarks;
        GameObject _recentEmpty;
        static readonly int RecentColorProperty = Shader.PropertyToID("_Color");
        string _lastRecentSummary;
        Material _connectionIndicatorMaterial;
        TextMesh _recentSourceCaption;
        QuestUi.StatusSeverity _connectionSeverity = QuestUi.StatusSeverity.Neutral;
        bool _connectionSeverityInitialized;

        public Transform Build(Transform parent, Font font, Material panelMaterial, Material buttonMaterial,
            Action<TextMesh, Vector2> register, Action<string> activate)
        {
            if (Page != null) return Page;
            Page = new GameObject("Quest Home / spatial dashboard").transform;
            Page.SetParent(parent, false);
            // At the parent's standard 1.65x scale this is ~1.28m wide.
            // It fits a comfortable central angular cone at ~1.8m eye distance.
            Page.localScale = Vector3.one * 1.08f;
            Background = null;
            var glass = QuestUi.GlassMaterial(panelMaterial);
            var tile = QuestUi.GlassMaterial(buttonMaterial);
            var cyan = QuestUi.Ink;
            var subdued = new Color(.68f, .73f, .80f);
            var signal = new Material(glass) { color = new Color(.50f, .72f, 1f, .60f) };

            // Separated islands: never an opaque central overlay over passthrough.
            QuestUi.GlassCard(Page, glass, "Top / nav", new Vector3(0, .253f, .014f), .96f, .062f, cyan);
            _connectionIndicatorMaterial = new Material(signal);
            QuestUi.GlassSurface(Page, _connectionIndicatorMaterial, "Top signal indicator", new Vector3(-.361f, .253f, -.009f),
                new Vector3(.003f, .029f, .001f));
            var brand = QuestUi.Label(Page, font, "KREODA", new Vector3(-.350f, .263f, -.010f),
                .018f, new Vector2(.20f, .035f), register, QuestUi.Ink);
            brand.fontStyle = FontStyle.Bold;
            // Only navigable screens with real HomeAction routes are exposed.
            // No placeholder Materials/Settings category without a destination.
            Nav("home:design", "DISEGNA", -.108f, font, tile, register, activate);
            Nav("home:model", "MODELLA", -.005f, font, tile, register, activate);
            Nav("home:view", "VISTA", .098f, font, tile, register, activate);
            ConnectionStatus = QuestUi.Button(Page, font, tile, "home:pc", "PC non connesso",
                new Vector3(.273f, .253f, -.006f), .184f, .042f, .012f,
                () => activate?.Invoke("home:pc"), register, cyan);

            var wordmark = QuestUi.Label(Page, font, "KREODA", new Vector3(0, .105f, -.012f), .022f,
                new Vector2(.28f, .044f), register, QuestUi.Ink);
            wordmark.anchor = TextAnchor.MiddleCenter;
            wordmark.fontStyle = FontStyle.Bold;
            var promise = QuestUi.Label(Page, font, "Progetta · Visualizza · Realizza",
                new Vector3(0, .062f, -.012f), .010f, new Vector2(.34f, .020f), register, QuestUi.Ink);
            promise.anchor = TextAnchor.MiddleCenter;
            var tagline = QuestUi.Label(Page, font, "Dalla tua idea al mondo reale",
                new Vector3(0, .038f, -.012f), .009f, new Vector2(.32f, .018f), register, subdued);
            tagline.anchor = TextAnchor.MiddleCenter;

            QuestUi.GlassCard(Page, glass, "Left / projects", new Vector3(-.228f, .005f, .014f), .304f, .395f, cyan);
            QuestUi.Divider(Page, glass, "Project header separator", new Vector3(-.228f, .148f, .007f), .265f);
            // Keep title bounds entirely above the section divider at y=.148.
            QuestUi.Heading(Page, font, "PROGETTI RECENTI", new Vector3(-.363f, .179f, -.010f),
                new Vector2(.27f, .028f), register, cyan);
            QuestUi.GlassSurface(Page, signal, "Projects accent tick", new Vector3(-.372f, .184f, -.010f),
                new Vector3(.0022f, .018f, .0005f));
            // The heading's reserved bottom is .127; the first card top is .118.
            // Keep a 9 mm vertical gap at the authored local scale.
            _recentSourceCaption = QuestUi.Label(Page, font, string.Empty,
                new Vector3(-.346f, .143f, -.011f), .0087f,
                new Vector2(.246f, .016f), register, subdued);
            _recentRows = new TextMesh[3];
            _recentCards = new GameObject[_recentRows.Length];
            _recentAccents = new Material[_recentRows.Length];
            _recentAccentObjects = new GameObject[_recentRows.Length];
            _recentIdentityMarks = new GameObject[_recentRows.Length];
            for (var index = 0; index < _recentRows.Length; index++)
            {
                var y = .109f - index * .031f;
                _recentCards[index] = QuestUi.DataCard(Page, glass, "Recent project card " + index,
                    new Vector3(-.228f, y - .005f, .004f), .260f, .029f);
                _recentAccents[index] = new Material(signal);
                _recentAccentObjects[index] = QuestUi.GlassSurface(Page, _recentAccents[index], "Recent project state " + index,
                    new Vector3(-.350f, y - .005f, -.003f), new Vector3(.0022f, .021f, .0005f));
                var identity = new GameObject("Recent project identity " + index);
                identity.transform.SetParent(Page, false);
                identity.transform.localPosition = new Vector3(-.336f, y - .002f, -.014f);
                // A neutral vector document pictogram, not an invented model
                // thumbnail. The entire group follows true project visibility.
                QuestUi.Outline(identity.transform, glass, "Document contour", Vector3.zero,
                    .014f, .017f, new Color(.34f, .78f, .99f, .72f), .001f);
                QuestUi.GlassSurface(identity.transform, signal, "Document fold",
                    new Vector3(.004f, .005f, -.001f), new Vector3(.004f, .0012f, .0004f));
                QuestUi.GlassSurface(identity.transform, signal, "Document content mark",
                    new Vector3(0, -.003f, -.001f), new Vector3(.007f, .001f, .0004f));
                _recentIdentityMarks[index] = identity;
                _recentRows[index] = QuestUi.DataRow(Page, font, string.Empty,
                    new Vector3(-.308f, y, -.012f),
                    new Vector2(.200f, .027f), register, index == 0);
            }
            ProjectStatus = _recentRows[0];
            _recentEmpty = new GameObject("Recent projects empty state");
            _recentEmpty.transform.SetParent(Page, false);
            _recentEmpty.transform.localPosition = new Vector3(-.228f, .075f, 0);
            QuestUi.Outline(_recentEmpty.transform, glass, "Empty projects frame",
                Vector3.zero, .22f, .058f, new Color(.85f, .88f, .94f, .09f), .0012f);
            QuestUi.Glyph(_recentEmpty.transform, glass, "Empty projects glyph",
                new Vector3(0, 0, -.002f), new Color(.50f, .72f, 1f, .42f), 0);
            SetProjectStatus(null, false, false);
            // Reserved bottom of this caption must stay above the divider at .003.
            QuestUi.Label(Page, font, "PROGETTI SUL PC", new Vector3(-.363f, .030f, -.010f), .0115f,
                new Vector2(.27f, .020f), register, subdued);
            QuestUi.Divider(Page, glass, "Project actions divider", new Vector3(-.228f, .003f, .007f), .260f);
            OpenableStatus = QuestUi.Button(Page, font, tile, "home:project:select", "Aggiorna progetti PC",
                new Vector3(-.228f, -.027f, -.007f), .267f, .047f, .0115f,
                () => activate?.Invoke("home:project:select"), register);
            QuestUi.Button(Page, font, tile, "home:project:open", "Apri / conferma 2 volte",
                new Vector3(-.228f, -.091f, -.007f), .267f, .047f, .0115f,
                () => activate?.Invoke("home:project:open"), register, cyan);

            QuestUi.GlassCard(Page, glass, "Right / actions", new Vector3(.228f, .005f, .014f), .304f, .395f, cyan);
            QuestUi.Divider(Page, glass, "Action header separator", new Vector3(.228f, .148f, .007f), .265f);
            QuestUi.Heading(Page, font, "INIZIA DA QUI", new Vector3(.092f, .179f, -.010f),
                new Vector2(.26f, .028f), register, cyan);
            QuestUi.GlassSurface(Page, signal, "Actions accent tick", new Vector3(.083f, .184f, -.010f),
                new Vector3(.0022f, .018f, .0005f));
            ActionTile("home:pc", "CONNETTI", .157f, .073f, 2, font, tile, register, activate);
            ActionTile("home:project:select", "PROGETTI", .300f, .073f, 0, font, tile, register, activate);
            ActionTile("home:project:open", "APRI", .157f, -.075f, 1, font, tile, register, activate);
            ActionTile("home:ai", "ASSISTENTE", .300f, -.075f, 3, font, tile, register, activate);

            // The Desktop action arc floats directly over the real room. One
            // quiet backing bar unifies the arc without closing the center.
            var dockBacking = QuestUi.GlassMaterial(glass);
            dockBacking.color = new Color(.045f, .05f, .062f, .62f);
            if (dockBacking.HasProperty("_Radius")) dockBacking.SetFloat("_Radius", .12f);
            QuestUi.GlassSurface(Page, dockBacking, "Dock / backing", new Vector3(0, -.292f, .014f),
                new Vector3(.84f, .122f, .002f));
            Dock("home:design", "DISEGNA", -.305f, -.269f, 0, font, tile, register, activate);
            Dock("home:model", "MODELLA", -.158f, -.298f, 2, font, tile, register, activate);
            // The center dock action itself is the hub: avoid an opaque sphere
            // that masks the passthrough behind the interaction target.
            Dock("home:view", "VISTA", 0, -.312f, 3, font, tile, register, activate);
            Dock("home:measure", "MISURA", .158f, -.298f, 1, font, tile, register, activate);
            Dock("home:render", "DISPLAY", .305f, -.269f, 3, font, tile, register, activate);
            // Panoramic MR framing. Reposition whole authored lateral islands,
            // including the original QuestButton colliders, labels and glass,
            // rather than stretching text or changing hitbox-to-label alignment.
            // Top navigation and the centered curved dock are left untouched.
            // Old island bounds: +/- .380m. New outer bounds: +/- .480m.
            // Center passthrough opening grows from .152m to .352m.
            const float islandOutset = .100f;
            foreach (Transform item in Page)
            {
                var position = item.localPosition;
                // QuestUi.Button creates a ZERO-origin parent with its real
                // QuestButton cube and TextMesh children at authored coordinates.
                // Classify that parent by its actual collider child, then move
                // the WHOLE group once. IconButton colliders are direct Page
                // children and already use their own authored coordinates.
                var anchor = position;
                if (Mathf.Abs(position.x) < .00001f && Mathf.Abs(position.y) < .00001f)
                {
                    foreach (Transform child in item)
                    {
                        if (child.GetComponent<QuestButton>() == null) continue;
                        anchor = child.localPosition;
                        break;
                    }
                }
                if (anchor.y <= -.215f || anchor.y >= .215f) continue;
                if (anchor.x <= -.080f) position.x -= islandOutset;
                else if (anchor.x >= .080f) position.x += islandOutset;
                else continue;
                item.localPosition = position;
            }
            return Page;
        }

        void Nav(string id, string label, float x, Font font, Material material,
            Action<TextMesh, Vector2> register, Action<string> activate)
        {
            QuestUi.Button(Page, font, material, id, label, new Vector3(x, .253f, -.006f), .094f, .042f,
                .0115f, () => activate?.Invoke(id), register);
        }

        void ActionTile(string id, string label, float x, float y, int glyph, Font font, Material material,
            Action<TextMesh, Vector2> register, Action<string> activate)
        {
            // The existing real interactive tile is the entire action area;
            // the procedural icon and its caption remain inside that hitbox.
            QuestUi.IconButton(Page, font, material, id, label, new Vector3(x, y, -.009f), .136f, .130f,
                glyph, () => activate?.Invoke(id), register);
            QuestUi.GlassSurface(Page, material, id + " focused corner index",
                new Vector3(x - .055f, y + .052f, -.014f), new Vector3(.011f, .0014f, .0004f));
        }

        void Dock(string id, string label, float x, float y, int glyph, Font font, Material material,
            Action<TextMesh, Vector2> register, Action<string> activate)
        {
            var isHub = id == "home:view";
            QuestUi.IconButton(Page, font, material, id, label,
                new Vector3(x, y, isHub ? -.011f : -.006f), isHub ? .138f : .128f,
                isHub ? .085f : .071f,
                glyph, () => activate?.Invoke(id), register);
        }

        // Prefer the authenticated session's actual state over inferring
        // success from a localized status message. A nullable argument keeps
        // existing Editor callers/source fixtures compatible.
        public void SetConnectionStatus(string status, bool? authenticated = null)
        {
            if (ConnectionStatus == null) return;
            if (string.IsNullOrWhiteSpace(status)) status = "PC non connesso";
            SetTextIfChanged(ConnectionStatus, Clip(status, 24));
            // Connection feedback reflects the reported lifecycle, without
            // implying authorization or live CAD edits from an ambiguous state.
            var connected = authenticated ?? (status.IndexOf("connesso", StringComparison.OrdinalIgnoreCase) >= 0 &&
                status.IndexOf("non connesso", StringComparison.OrdinalIgnoreCase) < 0 &&
                status.IndexOf("disconnesso", StringComparison.OrdinalIgnoreCase) < 0);
            // A disconnected status is not evidence that pairing is underway.
            var explicitlyOffline = status.IndexOf("non connesso", StringComparison.OrdinalIgnoreCase) >= 0 ||
                status.IndexOf("disconnesso", StringComparison.OrdinalIgnoreCase) >= 0;
            var pending = !connected && !explicitlyOffline &&
                (status.IndexOf("connession", StringComparison.OrdinalIgnoreCase) >= 0 ||
                 status.IndexOf("pair", StringComparison.OrdinalIgnoreCase) >= 0);
            var nextSeverity = connected ? QuestUi.StatusSeverity.Active :
                pending ? QuestUi.StatusSeverity.Warning : QuestUi.StatusSeverity.Neutral;
            if (_connectionSeverityInitialized && _connectionSeverity == nextSeverity) return;
            _connectionSeverityInitialized = true;
            _connectionSeverity = nextSeverity;
            var tint = QuestUi.SeverityColor(nextSeverity);
            ConnectionStatus.color = connected ? tint : QuestUi.Ink;
            if (_connectionIndicatorMaterial != null)
                _connectionIndicatorMaterial.color = new Color(tint.r, tint.g, tint.b, connected ? .74f : .43f);
        }
        public void SetProjectStatus(string status, bool hasProjects, bool serverSnapshot)
        {
            if (_recentRows == null) return;
            var lines = hasProjects && !string.IsNullOrWhiteSpace(status)
                ? ClipLines(status, _recentRows.Length, 31).Split('\n') : Array.Empty<string>();
            hasProjects = lines.Any(line => !string.IsNullOrWhiteSpace(line));
            if (_recentEmpty != null && _recentEmpty.activeSelf == hasProjects)
                _recentEmpty.SetActive(!hasProjects);
            var cacheKey = (hasProjects ? "rows:" : "empty:") +
                (serverSnapshot ? "server:" : "session:") + (status ?? string.Empty);
            if (_lastRecentSummary == cacheKey) return;
            _lastRecentSummary = cacheKey;
            SetTextIfChanged(_recentSourceCaption, hasProjects
                ? serverSnapshot ? "AGGIORNATO DAL PC" : "SESSIONE PC"
                : serverSnapshot ? "Nessun progetto recente sul PC" : "Collega il PC per vedere i progetti recenti");
            for (var index = 0; index < _recentRows.Length; index++)
            {
                var visible = hasProjects && index < lines.Length && !string.IsNullOrWhiteSpace(lines[index]);
                SetTextIfChanged(_recentRows[index], visible ? lines[index] : string.Empty);
                if (_recentRows[index] != null)
                {
                    var desired = visible && index == 0
                        ? QuestUi.Ink : new Color(.70f, .76f, .84f);
                    if (_recentRows[index].color != desired) _recentRows[index].color = desired;
                }
                if (_recentCards != null && _recentCards[index] != null)
                {
                    if (_recentCards[index].activeSelf != visible) _recentCards[index].SetActive(visible);
                    if (_recentAccentObjects != null && _recentAccentObjects[index] != null &&
                        _recentAccentObjects[index].activeSelf != visible)
                        _recentAccentObjects[index].SetActive(visible);
                    if (_recentIdentityMarks != null && _recentIdentityMarks[index] != null &&
                        _recentIdentityMarks[index].activeSelf != visible)
                        _recentIdentityMarks[index].SetActive(visible);
                    if (_recentAccents != null && _recentAccents[index] != null)
                    {
                    var accent = visible
                        ? (index == 0 ? new Color(.50f, .72f, 1f, .66f) : new Color(.45f, .55f, .65f, .34f))
                        : new Color(.50f, .55f, .60f, .18f);
                        if (_recentAccents[index].color != accent) _recentAccents[index].color = accent;
                    }
                    var cardRenderer = _recentCards[index].GetComponent<MeshRenderer>();
                    if (cardRenderer != null && cardRenderer.sharedMaterial != null)
                    {
                        var fill = visible && index == 0
                            ? new Color(.11f, .15f, .20f, .62f)
                            : visible ? new Color(.08f, .10f, .13f, .52f)
                            : new Color(.07f, .085f, .11f, .42f);
                        if (cardRenderer.sharedMaterial.HasProperty(RecentColorProperty))
                        {
                            var properties = new MaterialPropertyBlock();
                            cardRenderer.GetPropertyBlock(properties);
                            properties.SetColor(RecentColorProperty, fill);
                            cardRenderer.SetPropertyBlock(properties);
                        }
                    }
                }
            }
        }
        static void SetTextIfChanged(TextMesh target, string value)
        {
            if (target != null && target.text != value) target.text = value;
        }
        internal static string ClipLines(string value, int maxLines, int maxCharactersPerLine)
        {
            if (string.IsNullOrEmpty(value)) return string.Empty;
            var lines = value.Replace("\r", "").Split('\n');
            var count = Math.Min(lines.Length, maxLines);
            var result = new string[count];
            for (var i = 0; i < count; i++) result[i] = Clip(lines[i], maxCharactersPerLine);
            return string.Join("\n", result);
        }
        static string Clip(string value, int max) => value.Length <= max ? value : value.Substring(0, max - 3) + "...";
        internal static bool IsWiredHomeAction(string id) => id is
            "home:pc" or "home:view" or "home:ai" or "home:project:select" or "home:project:open" or
            "home:project:new" or "home:project:import" or "home:project:template" or "home:design" or
            "home:model" or "home:measure" or "home:render";
    }
}
