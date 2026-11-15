using System;
using System.Linq;
using UnityEngine;

namespace Kreoda.QuestRuntime
{
    // Home owns the spatial launch cards. The world-locked status chip and
    // section label belong to the QuestControls shell so they survive page
    // changes; Home binds its live status text to that chip.
    public sealed class QuestHome : MonoBehaviour
    {
        public Transform Page { get; private set; }
        public TextMesh ConnectionStatus { get; private set; }
        public TextMesh ProjectStatus { get; private set; }
        public TextMesh OpenableStatus { get; private set; }
        public GameObject Background { get; private set; }
        public TextMesh ChipStatus { get; set; }
        public Material ChipDot { get; set; }
        QuestUi.StatusSeverity _connectionSeverity = QuestUi.StatusSeverity.Neutral;
        bool _connectionSeverityInitialized;

        public Transform Build(Transform parent, Font font, Material panelMaterial, Material buttonMaterial,
            Action<TextMesh, Vector2> register, Action<string> activate)
        {
            if (Page != null) return Page;
            Page = new GameObject("Quest Home / spatial cards").transform;
            Page.SetParent(parent, false);
            Page.localScale = Vector3.one * 1.08f;
            Background = null;
            var glass = QuestUi.GlassMaterial(panelMaterial);
            var tile = QuestUi.GlassMaterial(buttonMaterial);

            HomeCard(Page, font, glass, tile, "home:design", "ENTRA NELLO SPAZIO", "Modella e ispeziona",
                "APRI", 0, new Vector3(-.200f, .015f, 0), .150f, .200f, true,
                () => activate?.Invoke("home:design"), register);
            HomeCard(Page, font, glass, tile, "home:pc", "CONNETTI PC", "Trova workstation",
                "SELEZIONA", 2, new Vector3(0, .015f, 0), .150f, .200f, false,
                () => activate?.Invoke("home:pc"), register);
            HomeCard(Page, font, glass, tile, "home:ai", "HERMES", "Assistente vocale",
                "SELEZIONA", 10, new Vector3(.200f, .015f, 0), .150f, .200f, false,
                () => activate?.Invoke("home:ai"), register);

            OpenableStatus = QuestUi.Badge(Page, font, tile, "home:project:select",
                "NESSUN PROGETTO CARICATO", new Vector3(-.060f, -.105f, -.008f), .160f, .026f,
                QuestUi.Warning, () => activate?.Invoke("home:project:select"), register);
            ProjectStatus = OpenableStatus;
            QuestUi.Pill(Page, font, tile, "home:project:open", "APRI",
                new Vector3(.115f, -.105f, -.008f), .060f, .026f, false,
                () => activate?.Invoke("home:project:open"), register);

            QuestUi.Belt(Page, font, tile, new Vector3(0, -.155f, -.006f), .480f, .040f,
                new[] { "home:design", "home:model", "home:view", "home:measure", "home:render" },
                new[] { "DISEGNA", "MODELLA", "VISTA", "MISURA", "DISPLAY" },
                new[] { true, false, false, false, false },
                id => activate?.Invoke(id), register);

            QuestUi.Hint(Page, font, tile, new Vector3(-.150f, -.218f, -.006f), .200f);

            // Compatibility status text for existing callers; the visible
            // state lives in the world-locked shell chip.
            ConnectionStatus = QuestUi.Label(Page, font, "PC non connesso", new Vector3(0, .25f, -.012f),
                .010f, new Vector2(.20f, .020f), register, QuestUi.Muted);
            ConnectionStatus.gameObject.SetActive(false);
            SetConnectionStatus("PC non connesso", false);
            SetProjectStatus(null, false, false);
            return Page;
        }

        static void HomeCard(Transform parent, Font font, Material glass, Material tile, string id,
            string title, string subtitle, string action, int glyph, Vector3 center, float width, float height,
            bool primary, Action click, Action<TextMesh, Vector2> register)
        {
            var root = new GameObject(title + " card").transform;
            root.SetParent(parent, false);
            root.localPosition = center;
            var card = QuestUi.GlassMaterial(glass);
            card.color = new Color(.047f, .141f, .169f, .97f);
            if (card.HasProperty("_BorderColor"))
                card.SetColor("_BorderColor", primary
                    ? new Color(QuestUi.Accent.r, QuestUi.Accent.g, QuestUi.Accent.b, .95f)
                    : new Color(.333f, .490f, .529f, .9f));
            if (card.HasProperty("_BorderSize")) card.SetFloat("_BorderSize", primary ? .014f : .008f);
            if (card.HasProperty("_Radius")) card.SetFloat("_Radius", .12f);
            if (card.HasProperty("_Sheen")) card.SetFloat("_Sheen", .18f);
            QuestUi.Surface(root, card, title + " backing", Vector3.zero, new Vector3(width, height, .002f));

            var discY = height * .17f;
            QuestUi.Ellipse(root, glass, title + " icon disc", new Vector3(0, discY, -.008f),
                height * .20f, height * .20f, new Color(.075f, .286f, .294f, .9f), 0f);
            QuestUi.Ellipse(root, glass, title + " icon ring", new Vector3(0, discY, -.009f),
                height * .20f, height * .20f, new Color(.35f, .75f, .78f, .55f), .93f);
            var icon = new GameObject(title + " icon").transform;
            icon.SetParent(root, false);
            icon.localPosition = new Vector3(0, discY, -.014f);
            icon.localScale = Vector3.one * 1.70f;
            QuestUi.Glyph(icon, glass, title + " glyph", Vector3.zero, QuestUi.Accent, glyph);

            var heading = QuestUi.Label(root, font, title, new Vector3(0, -.038f, -.012f),
                .0100f, new Vector2(width - .012f, .020f), register, QuestUi.Ink);
            heading.anchor = TextAnchor.MiddleCenter;
            heading.fontStyle = FontStyle.Bold;
            var caption = QuestUi.Label(root, font, subtitle, new Vector3(0, -.055f, -.012f),
                .0075f, new Vector2(width - .012f, .016f), register, QuestUi.Muted);
            caption.anchor = TextAnchor.MiddleCenter;
            QuestUi.Pill(root, font, tile, id, action, new Vector3(0, -height * .40f, -.012f),
                width * .62f, height * .15f, primary, click, register);
        }

        // Prefer the authenticated session's actual state over inferring
        // success from a localized status message. A nullable argument keeps
        // existing Editor callers/source fixtures compatible.
        public void SetConnectionStatus(string status, bool? authenticated = null)
        {
            if (string.IsNullOrWhiteSpace(status)) status = "PC non connesso";
            SetTextIfChanged(ConnectionStatus, Clip(status, 24));
            var connected = authenticated ?? (status.IndexOf("connesso", StringComparison.OrdinalIgnoreCase) >= 0 &&
                status.IndexOf("non connesso", StringComparison.OrdinalIgnoreCase) < 0 &&
                status.IndexOf("disconnesso", StringComparison.OrdinalIgnoreCase) < 0);
            var explicitlyOffline = status.IndexOf("non connesso", StringComparison.OrdinalIgnoreCase) >= 0 ||
                status.IndexOf("disconnesso", StringComparison.OrdinalIgnoreCase) >= 0;
            var pending = !connected && !explicitlyOffline &&
                (status.IndexOf("connession", StringComparison.OrdinalIgnoreCase) >= 0 ||
                 status.IndexOf("pair", StringComparison.OrdinalIgnoreCase) >= 0);
            var nextSeverity = connected ? QuestUi.StatusSeverity.Active :
                pending ? QuestUi.StatusSeverity.Warning : QuestUi.StatusSeverity.Neutral;
            var tint = QuestUi.SeverityColor(nextSeverity);
            var chipText = status.StartsWith("PC", StringComparison.OrdinalIgnoreCase) ? status : "PC " + status;
            SetTextIfChanged(ChipStatus, Clip(chipText, 32).ToUpperInvariant());
            if (ChipStatus != null) ChipStatus.color = connected ? tint : QuestUi.Muted;
            if (ChipDot != null) ChipDot.color = new Color(tint.r, tint.g, tint.b, connected ? .95f : .8f);
            if (ConnectionStatus != null) ConnectionStatus.color = connected ? tint : QuestUi.Ink;
            if (_connectionSeverityInitialized && _connectionSeverity == nextSeverity) return;
            _connectionSeverityInitialized = true;
            _connectionSeverity = nextSeverity;
        }

        public void SetProjectStatus(string status, bool hasProjects, bool serverSnapshot)
        {
            if (OpenableStatus == null) return;
            var line = hasProjects && !string.IsNullOrWhiteSpace(status)
                ? status.Replace("\r", "").Split('\n').FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))
                : null;
            SetTextIfChanged(OpenableStatus, string.IsNullOrWhiteSpace(line)
                ? serverSnapshot ? "NESSUNA VARIANTE CARICATA" : "NESSUN PROGETTO CARICATO"
                : Clip(line, 26).ToUpperInvariant());
            OpenableStatus.color = QuestUi.Ink;
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

