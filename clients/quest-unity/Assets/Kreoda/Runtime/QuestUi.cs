using System;
using UnityEngine;

namespace Kreoda.QuestRuntime
{
    public static class QuestUi
    {
        // Kreoda/QuestUi exposes _Color. Per-renderer overrides must never
        // mutate sharedMaterial, which may be used by sibling operations.
        static readonly int GlassColorProperty = Shader.PropertyToID("_Color");
        // Local-space layout: top-left origin, positive widths/heights in metres.
        // Each placement checks actual available bounds rather than relying on
        // authored offsets; use a new FlowLayout for each secondary screen.
        public sealed class FlowLayout
        {
            readonly float _left, _top, _width, _height, _spacing;
            float _cursor;
            int _items;
            public float RemainingHeight => Mathf.Max(0f, _height - _cursor);
            public FlowLayout(float left, float top, float width, float height, float spacing = .008f)
            {
                if (width <= 0f || height <= 0f || spacing < 0f)
                    throw new ArgumentOutOfRangeException(nameof(width), "Flow bounds must be positive and spacing nonnegative");
                _left = left; _top = top; _width = width; _height = height; _spacing = spacing;
            }
            public Vector3 Next(float itemHeight, float depth = -.012f)
            {
                var required = itemHeight + (_items > 0 ? _spacing : 0f);
                if (itemHeight <= 0f || required > RemainingHeight + .00001f)
                    throw new InvalidOperationException("Quest UI flow has insufficient vertical space");
                if (_items > 0) _cursor += _spacing;
                var center = new Vector3(_left + _width * .5f, _top - _cursor - itemHeight * .5f, depth);
                _cursor += itemHeight;
                _items++;
                return center;
            }
            public Vector3[] NextColumns(int count, float itemHeight, float gutter = .008f, float depth = -.012f)
            {
                if (count < 1 || gutter < 0f || (count - 1) * gutter >= _width)
                    throw new ArgumentOutOfRangeException(nameof(count));
                var center = Next(itemHeight, depth);
                var columnWidth = (_width - (count - 1) * gutter) / count;
                var positions = new Vector3[count];
                for (var i = 0; i < count; i++)
                    positions[i] = new Vector3(_left + columnWidth * (i + .5f) + gutter * i, center.y, depth);
                return positions;
            }
            public float ColumnWidth(int count, float gutter = .008f)
            {
                if (count < 1 || gutter < 0f || (count - 1) * gutter >= _width)
                    throw new ArgumentOutOfRangeException(nameof(count));
                return (_width - (count - 1) * gutter) / count;
            }
        }
        public enum StatusSeverity { Neutral, Active, Warning, Error }
        public enum OperationPanelRole { DevicePicker, Selector, ParameterEditor, PrimaryCommand, Diagnostic, History, Navigation }
        public static readonly Color Ink = new Color(.961f, .980f, .988f);
        public static readonly Color Accent = new Color(.388f, .961f, .914f);
        public static readonly Color Muted = new Color(.718f, .808f, .831f);
        public static readonly Color Panel = new Color(.043f, .110f, .141f);
        public static readonly Color PanelEdge = new Color(.322f, .522f, .557f);
        public static readonly Color Warning = new Color(1f, .733f, .447f);
        public static readonly Color Good = new Color(.494f, .878f, .714f);
        public static readonly Color Line = new Color(.314f, .443f, .486f);

        // Transparent local HUD material. Never place an opaque full-screen quad
        // over Quest passthrough; only the independent panels use this material.
        public static Material GlassMaterial(Material source)
        {
            // Use the project's actual transparent rounded panel shader. The
            // generic Unlit/Transparent fallback rendered white in Unity Editor.
            var shader = Shader.Find("Kreoda/QuestUi");
            var glass = shader != null ? new Material(shader) : new Material(source);
            glass.name = "Quest MR teal glass";
            glass.color = new Color(Panel.r, Panel.g, Panel.b, .95f);
            if (glass.HasProperty("_Sheen")) glass.SetFloat("_Sheen", .10f);
            if (glass.HasProperty("_BorderSize")) glass.SetFloat("_BorderSize", .006f);
            if (glass.HasProperty("_BorderColor"))
                glass.SetColor("_BorderColor", new Color(PanelEdge.r, PanelEdge.g, PanelEdge.b, .75f));
            glass.renderQueue = 3000;
            return glass;
        }

        public static GameObject GlassSurface(Transform parent, Material material, string name, Vector3 position, Vector3 size)
            => Surface(parent, material, name, position, size);

        public static void Divider(Transform parent, Material material, string name, Vector3 center, float width)
        {
            var line = GlassMaterial(material);
            line.color = new Color(Line.r, Line.g, Line.b, .55f);
            Surface(parent, line, name, center, new Vector3(width, .0012f, .0005f));
        }

        public static GameObject GlassCard(Transform parent, Material material, string name, Vector3 center,
            float width, float height, Color edge)
        {
            var bodyMaterial = GlassMaterial(material);
            bodyMaterial.color = new Color(Panel.r, Panel.g, Panel.b, .96f);
            if (bodyMaterial.HasProperty("_Radius")) bodyMaterial.SetFloat("_Radius", .09f);
            var surface = GlassSurface(parent, bodyMaterial, name, center, new Vector3(width, height, .002f));
            // One rounded surface; its shader owns the hairline. Extra bezels
            // and stacked highlights obscure the room and compete with content.
            return surface;
        }

        public sealed class LiveFocusStage : IDisposable
        {
            public readonly Transform Root;
            public readonly TextMesh Title;
            public readonly TextMesh Value;
            public readonly TextMesh Side;
            readonly Material _backingMaterial;
            readonly Material _accentMaterial;
            bool _disposed;
            internal LiveFocusStage(Transform root, TextMesh title, TextMesh value, TextMesh side,
                Material backingMaterial, Material accentMaterial)
            {
                Root = root; Title = title; Value = value; Side = side;
                _backingMaterial = backingMaterial; _accentMaterial = accentMaterial;
            }
            // Caller releases these two owned instances in QuestControls.OnDestroy.
            // Font.material and the caller's original panel material are shared
            // resources and are never owned or destroyed by this stage.
            public void Dispose()
            {
                if (_disposed) return;
                _disposed = true;
                ReleaseOwned(_backingMaterial);
                ReleaseOwned(_accentMaterial);
            }
            static void ReleaseOwned(Material owned)
            {
                if (owned == null) return;
                if (Application.isPlaying) UnityEngine.Object.Destroy(owned);
                else UnityEngine.Object.DestroyImmediate(owned);
            }
            static string Fit(string input, int limit)
            {
                var text = (input ?? string.Empty).Replace('\r', ' ').Replace('\n', ' ').Trim();
                return text.Length > limit ? text.Substring(0, limit - 1) + "…" : text;
            }
            public void SetData(string title, string value, string side, StatusSeverity severity)
            {
                if (_disposed || Title == null || Value == null) return;
                var t = Fit(title, 32); var v = Fit(value, 48); var s = Fit(side, 48);
                if (Title.text != t) Title.text = t;
                if (Value.text != v) Value.text = v;
                if (Side != null && Side.text != s) Side.text = s;
                var tint = SeverityColor(severity);
                if (Value.color != tint) Value.color = tint;
                if (Side != null) Side.color = severity == StatusSeverity.Warning ? new Color(.75f,.79f,.84f) : tint;
            }
        }

        // One compact non-interactive summary per workstation. Real command
        // buttons and modal raycasts remain entirely separate.
        public static LiveFocusStage CreateLiveFocusStage(Transform parent, Font font,
            Material material, string name, Vector3 center, float width, float height,
            Action<TextMesh, Vector2> register)
        {
            var root = new GameObject(name + " live focus stage").transform;
            root.SetParent(parent, false);
            root.localPosition = center;
            var back = GlassMaterial(material);
            back.color = new Color(Panel.r, Panel.g, Panel.b, .85f);
            Surface(root, back, name + " focus backing", Vector3.zero,
                new Vector3(width, height, .002f));
            var accent = GlassMaterial(material);
            accent.color = new Color(Accent.r, Accent.g, Accent.b, .9f);
            Surface(root, accent, name + " focus edge", new Vector3(-width * .475f, 0, -.004f),
                new Vector3(.0022f, height * .70f, .0006f));
            var title = Label(root, font, string.Empty,
                new Vector3(-width * .435f, height * .27f, -.010f), .010f,
                new Vector2(width * .87f, height * .22f), register, Muted);
            var value = Label(root, font, string.Empty,
                new Vector3(-width * .435f, height * .01f, -.012f), .014f,
                new Vector2(width * .87f, height * .28f), register, Ink);
            value.fontStyle = FontStyle.Bold;
            var side = Label(root, font, string.Empty,
                new Vector3(-width * .435f, -height * .30f, -.012f), .010f,
                new Vector2(width * .87f, height * .20f), register, Muted);
            return new LiveFocusStage(root, title, value, side, back, accent);
        }

        // Reusable workstation visual emphasis around an existing real action.
        // No button, ray target, ActionId or synthetic metric is created.
        public static void SetActionFocus(TextMesh actionLabel, bool focused, StatusSeverity severity)
        {
            if (actionLabel == null || actionLabel.transform.parent == null) return;
            var root = actionLabel.transform.parent;
            var rail = root.Find("Operation semantic rail");
            if (rail == null) return;
            var renderer = rail.GetComponent<MeshRenderer>();
            if (renderer == null || renderer.sharedMaterial == null ||
                !renderer.sharedMaterial.HasProperty(GlassColorProperty)) return;
            var tint = SeverityColor(severity);
            var block = new MaterialPropertyBlock();
            renderer.GetPropertyBlock(block);
            block.SetColor(GlassColorProperty, focused
                ? new Color(tint.r, tint.g, tint.b, .92f)
                : new Color(.25f, .48f, .64f, .27f));
            renderer.SetPropertyBlock(block);
        }

        // A coherent spatial work surface: visual backing, content transform and
        // measured flow share one local coordinate system. The backing never
        // captures rays; controls created under Content own the hit targets.
        public sealed class OperationPanel
        {
            public readonly Transform Root;
            public readonly Transform Content;
            public readonly FlowLayout Layout;
            public readonly TextMesh Heading;
            public readonly TextMesh ReadoutLabel;
            public readonly TextMesh ReadoutValue;
            readonly TextMesh _secondaryFact;
            readonly TextMesh _detail;
            readonly Renderer _dataTrack;
            OperationPanelRole? _role;
            internal OperationPanel(Transform root, Transform content, FlowLayout layout,
                TextMesh heading)
            {
                Root = root; Content = content; Layout = layout; Heading = heading;
                ReadoutLabel = null; ReadoutValue = null;
                _secondaryFact = null; _detail = null; _dataTrack = null;
            }
            // Keep authored role and status APIs for the existing screen
            // bindings. The repeated fact shelves and meters are intentionally
            // absent; each page summary and its real action detail own state.
            public void SetRole(OperationPanelRole role) => _role = role;
            public void SetContext(string heading, StatusSeverity severity, bool available) { }
            public void SetDomainFacts(string primaryLabel, string primaryValue,
                string secondaryLabel, string secondaryValue, StatusSeverity severity) { }
            public void SetMeasuredValue(float normalizedValue) { }
            public void SetWorkflowData(string label, string value, string detail,
                StatusSeverity severity, float normalizedValue = -1f) { }
            public TextMesh Action(Font font, Material material, string id, string caption,
                float height, Action click, Action<TextMesh, Vector2> register, bool emphasized = false)
                => FlowAction(Layout, Content, font, material, id, caption,
                    Width, height, click, register, emphasized);
            public float Width { get; internal set; }
        }
        public static OperationPanel CreateOperationPanel(Transform parent, Font font, Material material,
            string name, string heading, Vector3 center, float width, float height,
            Action<TextMesh, Vector2> register, StatusSeverity severity = StatusSeverity.Neutral)
        {
            if (width <= .04f || height <= .065f)
                throw new ArgumentOutOfRangeException(nameof(width), "Operation panel is too small for content");
            var root = OperationSection(parent, font, material, name, heading,
                center, width, height, register, severity);
            var content = new GameObject(name + " content").transform;
            content.SetParent(root, false);
            var inset = Mathf.Min(.018f, width * .09f);
            var contentTop = height * .23f;
            var contentBottom = -height * .45f;
            TextMesh headingLabel = null;
            foreach (Transform child in root)
                if (child.TryGetComponent<TextMesh>(out var text))
                { headingLabel = text; break; }
            if (headingLabel != null) register?.Invoke(headingLabel, new Vector2(width * .88f, height * .13f));
            return new OperationPanel(root, content,
                new FlowLayout(-width * .5f + inset, contentTop,
                    width - inset * 2f, contentTop - contentBottom, .008f),
                headingLabel)
            { Width = width - inset * 2f };
        }
        public static TextMesh IconButton(Transform parent, Font font, Material material, string id, string label,
            Vector3 center, float width, float height, int glyph, Action click,
            Action<TextMesh, Vector2> register)
        {
            var button = GameObject.CreatePrimitive(PrimitiveType.Cube);
            button.name = id;
            button.transform.SetParent(parent, false);
            button.transform.localPosition = center;
            button.transform.localScale = new Vector3(width, height, .003f);
            var buttonMaterial = GlassMaterial(material);
            buttonMaterial.color = new Color(.125f, .188f, .216f, .99f);
            if (buttonMaterial.HasProperty("_BorderColor"))
                buttonMaterial.SetColor("_BorderColor", new Color(PanelEdge.r, PanelEdge.g, PanelEdge.b, .8f));
            if (buttonMaterial.HasProperty("_Radius")) buttonMaterial.SetFloat("_Radius", .16f);
            button.GetComponent<MeshRenderer>().sharedMaterial = buttonMaterial;
            var input = button.AddComponent<QuestButton>();
            input.ActionId = id;
            input.Click = click;
            var compact = height < .09f;
            var iconY = compact ? height * .19f : height * .17f;
            var iconSide = compact ? .030f : .061f;
            Ellipse(parent, material, id + " icon background", center + new Vector3(0, iconY, -.009f),
                iconSide * .5f, iconSide * .5f, new Color(Accent.r, Accent.g, Accent.b, .16f), 0f);
            var icon = new GameObject(id + " icon group").transform;
            icon.SetParent(parent, false);
            icon.localPosition = center + new Vector3(0, iconY, -.015f);
            icon.localScale = Vector3.one * (compact ? .88f : 1.82f);
            Glyph(icon, material, id + " icon", Vector3.zero, Accent, glyph);
            var labelMesh = Label(parent, font, label,
                center + new Vector3(-width * .43f, -height * .12f, -.016f), compact ? .0115f : .0155f,
                new Vector2(width * .88f, height * .28f), register, Ink);
            labelMesh.anchor = TextAnchor.UpperCenter;
            // UpperCenter anchors need their own centering; the original
            // UpperLeft offset would push the label into the icon footprint.
            labelMesh.transform.localPosition = center + new Vector3(0, -height * .15f, -.016f);
            return labelMesh;
        }

        // Light-weight procedural elliptical UI rings. These are decorative only;
        // the separate QuestButton colliders remain the actual hit targets.
        public static void Ellipse(Transform parent, Material source, string name, Vector3 center,
            float radiusX, float radiusY, Color color, float innerRatio)
        {
            const int sides = 64;
            var root = new GameObject(name);
            root.transform.SetParent(parent, false);
            root.transform.localPosition = center;
            var vertices = new Vector3[(sides + 1) * 2];
            var uv = new Vector2[vertices.Length];
            var triangles = new int[sides * 6];
            for (int i = 0; i <= sides; i++)
            {
                var angle = (float)(i * 2.0 * Math.PI / sides);
                var dx = Mathf.Cos(angle); var dy = Mathf.Sin(angle);
                vertices[i * 2] = new Vector3(dx * radiusX, dy * radiusY, 0);
                vertices[i * 2 + 1] = new Vector3(dx * radiusX * innerRatio, dy * radiusY * innerRatio, 0);
                uv[i * 2] = new Vector2(.5f + dx * .5f, .5f + dy * .5f);
                uv[i * 2 + 1] = new Vector2(.5f + dx * .5f * innerRatio, .5f + dy * .5f * innerRatio);
                if (i == sides) continue;
                var at = i * 6;var a = i * 2;var b = a + 2;
                triangles[at] = a; triangles[at + 1] = b; triangles[at + 2] = a + 1;
                triangles[at + 3] = a + 1; triangles[at + 4] = b; triangles[at + 5] = b + 1;
            }
            var mesh = new Mesh { name = name + " mesh", vertices = vertices, uv = uv, triangles = triangles };
            mesh.RecalculateBounds();
            root.AddComponent<MeshFilter>().sharedMesh = mesh;
            var material = GlassMaterial(source);
            material.name = name + " material";
            material.color = color;
            root.AddComponent<MeshRenderer>().sharedMaterial = material;
        }

        public static void Outline(Transform parent, Material source, string name, Vector3 center,
            float width, float height, Color color, float thickness = .0018f)
        {
            var rim = GlassMaterial(source);
            rim.name = name + " cyan rim";
            rim.color = color;
            var z = center.z - .004f;
            Surface(parent, rim, name + " top", new Vector3(center.x, center.y + height / 2, z), new Vector3(width, thickness, .001f));
            Surface(parent, rim, name + " bottom", new Vector3(center.x, center.y - height / 2, z), new Vector3(width, thickness, .001f));
            Surface(parent, rim, name + " left", new Vector3(center.x - width / 2, center.y, z), new Vector3(thickness, height, .001f));
            Surface(parent, rim, name + " right", new Vector3(center.x + width / 2, center.y, z), new Vector3(thickness, height, .001f));
        }

        public static void Glyph(Transform parent, Material source, string name, Vector3 center, Color color, int kind)
        {
            var ink = GlassMaterial(source);
            ink.name = name + " icon strokes";
            ink.color = color;
            var x = center.x; var y = center.y; var z = center.z;
            if (kind == 0) // CAD cube / project
            {
                const float r = .013f;
                Hexagon(parent, ink, name + " silhouette", center, r, color);
                Stroke(parent, ink, name + " edge up", new Vector2(x, y + r), new Vector2(x, y), .0015f, color, z);
                Stroke(parent, ink, name + " edge left", new Vector2(x, y),
                    new Vector2(x - r * .866f, y - r * .5f), .0015f, color, z);
                Stroke(parent, ink, name + " edge right", new Vector2(x, y),
                    new Vector2(x + r * .866f, y - r * .5f), .0015f, color, z);
            }
            else if (kind == 1) // crosshair / measure
            {
                Surface(parent, ink, name + " horizontal", new Vector3(x, y, z), new Vector3(.025f, .0018f, .001f));
                Surface(parent, ink, name + " vertical", new Vector3(x, y, z), new Vector3(.0018f, .025f, .001f));
                Ellipse(parent, source, name + " reticle", new Vector3(x, y, z - .001f), .009f, .009f, color, .88f);
            }
            else if (kind == 2) // connection / chain link
            {
                Ellipse(parent, ink, name + " link left", new Vector3(x - .006f, y + .004f, z),
                    .009f, .009f, color, .52f);
                Ellipse(parent, ink, name + " link right", new Vector3(x + .006f, y - .004f, z),
                    .009f, .009f, color, .52f);
                Stroke(parent, ink, name + " link bridge", new Vector2(x - .002f, y),
                    new Vector2(x + .002f, y), .0022f, color, z);
            }
            else if (kind == 4) // home
            {
                Stroke(parent, ink, name + " roof L", new Vector2(x - .014f, y + .001f),
                    new Vector2(x, y + .013f), .0018f, color, z);
                Stroke(parent, ink, name + " roof R", new Vector2(x, y + .013f),
                    new Vector2(x + .014f, y + .001f), .0018f, color, z);
                Stroke(parent, ink, name + " left wall", new Vector2(x - .011f, y + .001f),
                    new Vector2(x - .011f, y - .012f), .0018f, color, z);
                Stroke(parent, ink, name + " right wall", new Vector2(x + .011f, y + .001f),
                    new Vector2(x + .011f, y - .012f), .0018f, color, z);
                Stroke(parent, ink, name + " floor", new Vector2(x - .011f, y - .012f),
                    new Vector2(x + .011f, y - .012f), .0018f, color, z);
            }
            else if (kind == 5) // move
            {
                Surface(parent, ink, name + " horizontal", new Vector3(x, y, z), new Vector3(.030f, .0018f, .001f));
                Surface(parent, ink, name + " vertical", new Vector3(x, y, z), new Vector3(.0018f, .030f, .001f));
                Stroke(parent, ink, name + " left tip", new Vector2(x - .015f, y),
                    new Vector2(x - .010f, y + .004f), .0018f, color, z);
                Stroke(parent, ink, name + " left tip 2", new Vector2(x - .015f, y),
                    new Vector2(x - .010f, y - .004f), .0018f, color, z);
                Stroke(parent, ink, name + " right tip", new Vector2(x + .015f, y),
                    new Vector2(x + .010f, y + .004f), .0018f, color, z);
                Stroke(parent, ink, name + " right tip 2", new Vector2(x + .015f, y),
                    new Vector2(x + .010f, y - .004f), .0018f, color, z);
            }
            else if (kind == 6) // rotate
            {
                var points = new Vector2[9];
                for (var i = 0; i < points.Length; i++)
                {
                    var angle = (240f + i * 15f) * Mathf.Deg2Rad;
                    points[i] = new Vector2(x + Mathf.Cos(angle) * .012f, y + Mathf.Sin(angle) * .012f);
                }
                for (var i = 0; i + 1 < points.Length; i++)
                    Stroke(parent, ink, name + " arc " + i, points[i], points[i + 1], .0018f, color, z);
                Stroke(parent, ink, name + " arrow", points[points.Length - 1],
                    points[points.Length - 1] + new Vector2(.006f, .004f), .0018f, color, z);
            }
            else if (kind == 7) // pen / sketch
            {
                Stroke(parent, ink, name + " body", new Vector2(x - .012f, y + .012f),
                    new Vector2(x + .010f, y - .010f), .0022f, color, z);
                Stroke(parent, ink, name + " tip", new Vector2(x + .010f, y - .010f),
                    new Vector2(x + .014f, y - .014f), .0018f, color, z);
                Stroke(parent, ink, name + " nib", new Vector2(x - .012f, y + .012f),
                    new Vector2(x - .015f, y + .006f), .0018f, color, z);
            }
            else if (kind == 8) // section plane
            {
                Outline(parent, ink, name, center, .022f, .018f, color, .0016f);
                Stroke(parent, ink, name + " cut", new Vector2(x - .010f, y + .008f),
                    new Vector2(x + .008f, y - .008f), .0018f, color, z);
            }
            else if (kind == 9) // axes / references
            {
                Surface(parent, ink, name + " x", new Vector3(x + .006f, y, z), new Vector3(.020f, .0016f, .001f));
                Surface(parent, ink, name + " y", new Vector3(x, y + .006f, z), new Vector3(.0016f, .020f, .001f));
                Stroke(parent, ink, name + " z", new Vector2(x - .006f, y - .004f),
                    new Vector2(x - .014f, y - .012f), .0016f, color, z);
            }
            else if (kind == 10) // voice
            {
                Ellipse(parent, ink, name + " ring 1", new Vector3(x, y, z), .014f, .014f, color, .9f);
                Ellipse(parent, ink, name + " ring 2", new Vector3(x, y, z), .009f, .009f, color, .85f);
                Surface(parent, ink, name + " core", new Vector3(x, y, z - .001f), new Vector3(.004f, .004f, .001f));
                Surface(parent, ink, name + " right tick", new Vector3(x + .018f, y, z), new Vector3(.005f, .0016f, .001f));
                Surface(parent, ink, name + " left tick", new Vector3(x - .018f, y, z), new Vector3(.005f, .0016f, .001f));
            }
            else if (kind == 11) // warning
            {
                Stroke(parent, ink, name + " left", new Vector2(x, y + .013f),
                    new Vector2(x - .013f, y - .010f), .0018f, color, z);
                Stroke(parent, ink, name + " right", new Vector2(x, y + .013f),
                    new Vector2(x + .013f, y - .010f), .0018f, color, z);
                Stroke(parent, ink, name + " base", new Vector2(x - .013f, y - .010f),
                    new Vector2(x + .013f, y - .010f), .0018f, color, z);
                Surface(parent, ink, name + " mark", new Vector3(x, y - .002f, z - .001f), new Vector3(.0018f, .006f, .001f));
            }
            else if (kind == 12) // variants / stack
            {
                Outline(parent, ink, name + " back", center + new Vector3(-.004f, .004f, .001f),
                    .018f, .014f, color, .0015f);
                Outline(parent, ink, name + " front", center + new Vector3(.004f, -.004f, -.001f),
                    .018f, .014f, color, .0015f);
            }
            else if (kind == 13) // metrics / bars
            {
                Surface(parent, ink, name + " bar 1", new Vector3(x - .010f, y - .005f, z), new Vector3(.004f, .010f, .001f));
                Surface(parent, ink, name + " bar 2", new Vector3(x, y + .002f, z), new Vector3(.004f, .024f, .001f));
                Surface(parent, ink, name + " bar 3", new Vector3(x + .010f, y - .002f, z), new Vector3(.004f, .016f, .001f));
            }
            else // navigation / play
            {
                Outline(parent, ink, name, center, .023f, .023f, color, .0016f);
                Surface(parent, ink, name + " dot", new Vector3(x, y, z - .001f), new Vector3(.004f, .004f, .001f));
                Surface(parent, ink, name + " direction", new Vector3(x + .007f, y, z - .001f), new Vector3(.005f, .0015f, .001f));
            }
        }

        public static TextMesh GlassButton(Transform parent, Font font, Material glass, string id, string label,
            Vector3 position, float width, float height, Action click, Action<TextMesh, Vector2> register,
            Color? color = null)
        {
            var text = Button(parent, font, glass, id, label, position, width, height,
                .0115f, click, register, color);
            var body = text.transform.parent.Find(label);
            if (body != null)
            {
                var renderer = body.GetComponent<MeshRenderer>();
                if (renderer != null) renderer.sharedMaterial = glass;
            }
            return text;
        }

        public static TextMesh Label(Transform parent, Font font, string text, Vector3 position, float size,
            Vector2 bounds, Action<TextMesh, Vector2> register, Color? color = null)
        {
            var label = new GameObject(text).AddComponent<TextMesh>();
            label.transform.SetParent(parent, false);
            label.transform.localPosition = position;
            label.font = font;
            label.fontSize = 64;
            label.characterSize = size * 10f / label.fontSize;
            label.anchor = TextAnchor.UpperLeft;
            label.text = text;
            label.color = color ?? Ink;
            label.GetComponent<MeshRenderer>().sharedMaterial = font.material;
            register?.Invoke(label, bounds);
            return label;
        }

        // Shared section typography: headings remain consistent across the
        // dashboard's independent MR islands and preserve the same text bounds.
        public static TextMesh Heading(Transform parent, Font font, string text, Vector3 position,
            Vector2 bounds, Action<TextMesh, Vector2> register, Color? color = null)
        {
            var title = Label(parent, font, text, position, .014f, bounds, register, color ?? Ink);
            title.fontStyle = FontStyle.Bold;
            return title;
        }

        public static TextMesh DataRow(Transform parent, Font font, string text, Vector3 position,
            Vector2 bounds, Action<TextMesh, Vector2> register, bool primary)
        {
            var row = Label(parent, font, text, position, primary ? .0105f : .0098f,
                bounds, register, primary ? Ink : Muted);
            row.fontStyle = primary ? FontStyle.Bold : FontStyle.Normal;
            return row;
        }

        public static GameObject DataCard(Transform parent, Material material, string name,
            Vector3 center, float width, float height)
        {
            var background = GlassMaterial(material);
            background.color = new Color(Panel.r, Panel.g, Panel.b, .9f);
            if (background.HasProperty("_Sheen")) background.SetFloat("_Sheen", .08f);
            return Surface(parent, background, name, center, new Vector3(width, height, .001f));
        }

        public static Color SeverityColor(StatusSeverity severity)
        {
            switch (severity)
            {
                case StatusSeverity.Active: return Accent;
                case StatusSeverity.Warning: return Warning;
                case StatusSeverity.Error: return new Color(1f, .48f, .43f);
                default: return Muted;
            }
        }

        // One operation owns one island. Returning its root allows callers to
        // show/hide a whole section without changing any registered click targets.
        public static Transform OperationSection(Transform parent, Font font, Material material,
            string name, string heading, Vector3 center, float width, float height,
            Action<TextMesh, Vector2> register, StatusSeverity severity = StatusSeverity.Neutral)
        {
            var root = new GameObject(name + " section").transform;
            root.SetParent(parent, false);
            root.localPosition = center;
            GlassCard(root, material, name + " card", Vector3.zero, width, height, SeverityColor(StatusSeverity.Neutral));
            Heading(root, font, heading,
                new Vector3(-width * .45f, height * .44f, -.012f),
                new Vector2(width * .88f, height * .13f), register, Ink);
            return root;
        }

        // A status is explicit caller data. The UI never infers successful work.
        public static TextMesh OperationStatus(Transform parent, Font font, Material material,
            string name, string status, Vector3 position, float width,
            StatusSeverity severity, Action<TextMesh, Vector2> register)
        {
            var tint = SeverityColor(severity);
            var marker = GlassMaterial(material);
            marker.color = new Color(tint.r, tint.g, tint.b, .66f);
            Surface(parent, marker, name + " severity", position + new Vector3(0, -.007f, .003f),
                new Vector3(.002f, .016f, .001f));
            return Label(parent, font, status, position + new Vector3(.009f, 0, -.008f), .0105f,
                new Vector2(Mathf.Max(.01f, width - .012f), .024f), register, tint);
        }

        public static TextMesh MetadataRow(Transform parent, Font font, string key, string value,
            Vector3 position, float width, Action<TextMesh, Vector2> register)
        {
            Label(parent, font, key, position, .0095f,
                new Vector2(width * .38f, .022f), register, Muted);
            return Label(parent, font, value, position + new Vector3(width * .40f, 0, 0), .0105f,
                new Vector2(width * .57f, .022f), register, Ink);
        }

        // Functional groups use explicit caller coordinates. Decorative layers
        // have no colliders, so existing QuestButton hit targets keep priority.
        public static Transform ActionGroup(Transform parent, Material material, string name,
            Vector3 center, float width, float height, StatusSeverity severity = StatusSeverity.Neutral)
        {
            var root = new GameObject(name + " actions").transform;
            root.SetParent(parent, false);
            root.localPosition = center;
            var body = GlassMaterial(material);
            body.color = new Color(Panel.r, Panel.g, Panel.b, .55f);
            Surface(root, body, name + " group surface", Vector3.zero,
                new Vector3(width, height, .001f));
            var indicator = GlassMaterial(material);
            var color = SeverityColor(severity);
            indicator.color = new Color(color.r, color.g, color.b, .40f);
            Surface(root, indicator, name + " group marker",
                new Vector3(-width * .48f, 0, -.003f), new Vector3(.0014f, height * .72f, .0005f));
            return root;
        }

        // Live operation summary: both the displayed values and their severity
        // are supplied by the owning page, never inferred from placeholder CAD.
        public sealed class OperationSummary
        {
            public readonly TextMesh Title;
            public readonly TextMesh Detail;
            public readonly TextMesh Status;
            readonly Material _accent;
            readonly Material _background;
            readonly int _titleLimit, _detailLimit, _statusLimit;
            public OperationSummary(TextMesh title, TextMesh detail, TextMesh status, Material accent,
                Material background, int titleLimit, int detailLimit, int statusLimit)
            {
                Title = title; Detail = detail; Status = status; _accent = accent;
                _background = background; _titleLimit = titleLimit;
                _detailLimit = detailLimit; _statusLimit = statusLimit;
            }
            static string Fit(string value, int max)
            {
                if (string.IsNullOrEmpty(value)) return string.Empty;
                var singleLine = value.Replace('\r', ' ').Replace('\n', ' ');
                return singleLine.Length <= max ? singleLine : singleLine.Substring(0, max - 1) + "…";
            }
            public void Update(string title, string detail, string status, StatusSeverity severity)
            {
                var heading = Fit(title, _titleLimit);
                var description = Fit(detail, _detailLimit);
                var state = Fit(status, _statusLimit);
                if (Title != null && Title.text != heading) Title.text = heading;
                if (Detail != null && Detail.text != description) Detail.text = description;
                if (Status != null)
                {
                    if (Status.text != state) Status.text = state;
                    var textColor = SeverityColor(severity);
                    if (Status.color != textColor) Status.color = textColor;
                }
                var tint = SeverityColor(severity);
                var color = new Color(tint.r, tint.g, tint.b, .65f);
                if (_accent != null && _accent.color != color) _accent.color = color;
                // The entire factual card changes with the operation's state,
                // while translucent background keeps passthrough visible.
                var backing = severity == StatusSeverity.Error ? new Color(.22f, .10f, .10f, .85f)
                    : severity == StatusSeverity.Warning ? new Color(.18f, .15f, .10f, .80f)
                    : severity == StatusSeverity.Active ? new Color(.078f, .314f, .357f, .85f)
                    : new Color(Panel.r, Panel.g, Panel.b, .9f);
                if (_background != null && _background.color != backing) _background.color = backing;
            }
        }

        public static OperationSummary SummaryCard(Transform parent, Font font, Material material,
            string name, Vector3 center, float width, float height,
            Action<TextMesh, Vector2> register)
        {
            var root = new GameObject(name + " summary").transform;
            root.SetParent(parent, false);
            root.localPosition = center;
            var background = DataCard(root, material, name + " backing", Vector3.zero, width, height);
            var accent = GlassMaterial(material);
            var indicator = Surface(root, accent, name + " status indicator",
                new Vector3(-width * .46f, 0, -.006f), new Vector3(.002f, height * .66f, .001f));
            indicator.GetComponent<Collider>().enabled = false;
            var x = -width * .41f;
            var title = Heading(root, font, string.Empty,
                new Vector3(x, height * .36f, -.012f), new Vector2(width * .80f, height * .27f), register, Ink);
            var detail = DataRow(root, font, string.Empty,
                new Vector3(x, height * .04f, -.012f), new Vector2(width * .80f, height * .28f), register, false);
            var status = DataRow(root, font, string.Empty,
                new Vector3(x, -height * .27f, -.012f), new Vector2(width * .80f, height * .25f), register, false);
            var contentWidth = width * .80f;
            return new OperationSummary(title, detail, status, accent,
                background.GetComponent<MeshRenderer>().sharedMaterial,
                Mathf.Max(2, Mathf.FloorToInt(contentWidth / .0075f)),
                Mathf.Max(2, Mathf.FloorToInt(contentWidth / .0062f)),
                Mathf.Max(2, Mathf.FloorToInt(contentWidth / .0062f)));
        }

        // The existing Button creates and owns the real QuestButton collider.
        // The caller supplies the existing callback and action ID unchanged.
        public static TextMesh OperationAction(Transform parent, Font font, Material material,
            string id, string caption, Vector3 center, float width, float height,
            Action click, Action<TextMesh, Vector2> register, bool emphasized = false)
        {
            var fill = GlassMaterial(material);
            fill.color = emphasized ? new Color(.078f, .314f, .357f, .97f) : new Color(.082f, .153f, .192f, .97f);
            if (fill.HasProperty("_BorderColor"))
                fill.SetColor("_BorderColor", emphasized
                    ? new Color(.384f, .851f, .863f, .9f)
                    : new Color(PanelEdge.r, PanelEdge.g, PanelEdge.b, .8f));
            if (fill.HasProperty("_BorderSize")) fill.SetFloat("_BorderSize", .01f);
            if (fill.HasProperty("_Radius")) fill.SetFloat("_Radius", .28f);
            var characterCount = Mathf.Max(1, string.IsNullOrEmpty(caption) ? 1 : caption.Length);
            var labelWidth = Mathf.Max(.012f, width - Mathf.Min(.016f, width * .18f));
            // TextMesh characterSize is proportional to glyph advance; keep
            // compact action labels within the measured collider's text inset.
            var textSize = Mathf.Min(.0115f, height * .62f, labelWidth / (characterCount * .55f));
            var title = Button(parent, font, fill, id, caption, center, width, height,
                textSize, click, register, Ink);
            // Every workflow command has one semantic edge indicator. It is a
            // non-raycastable sibling within the control root; actual commands
            // and their independently enabled colliders remain untouched.
            var semantic = GlassMaterial(fill);
            semantic.color = emphasized ? new Color(Accent.r, Accent.g, Accent.b, .9f) :
                new Color(Line.r, Line.g, Line.b, .5f);
            Surface(title.transform.parent, semantic, "Operation semantic rail",
                center + new Vector3(-width * .465f, 0, -.005f),
                new Vector3(.002f, height * .55f, .0006f));
            title.fontStyle = emphasized ? FontStyle.Bold : FontStyle.Normal;
            // A real control's measured text box is contained by its collider;
            // no extra surface is placed over the pointing ray.
            title.anchor = TextAnchor.MiddleCenter;
            title.transform.localPosition = center + new Vector3(0, 0, -.006f);
            return title;
        }

        // Second factual line INSIDE the existing real action collider. Worker6
        // supplies the actual endpoint/value/configuration; no additional button.
        public static void SetActionDetail(TextMesh actionLabel, string detail, StatusSeverity severity)
        {
            if (actionLabel == null || actionLabel.transform.parent == null) return;
            var group = actionLabel.transform.parent;
            QuestButton action = null;
            for (var i = 0; i < group.childCount; i++)
            {
                action = group.GetChild(i).GetComponent<QuestButton>();
                if (action != null) break;
            }
            if (action == null) return;
            var body = action.transform;
            var width = body.localScale.x;
            var height = body.localScale.y;
            // At Quest viewing distance narrow controls cannot fit a legible
            // second line. Keep the original centered command label instead;
            // the page summary carries the concise state.
            const float minimumTwoLineHeight = .045f;
            const float minimumTwoLineWidth = .075f;
            var canShowDetail = height >= minimumTwoLineHeight && width >= minimumTwoLineWidth;
            var safe = string.IsNullOrWhiteSpace(detail) ? string.Empty :
                detail.Replace('\n', ' ').Replace('\r', ' ').Trim();
            if (!canShowDetail || string.Equals(safe, actionLabel.text?.Trim(), StringComparison.OrdinalIgnoreCase))
                safe = string.Empty;
            var maxChars = Mathf.Max(3, Mathf.FloorToInt((width - .016f) / .0051f));
            if (safe.Length > maxChars) safe = safe.Substring(0, maxChars - 1) + "…";
            var existing = group.Find("Operation detail");
            if (existing == null && safe.Length > 0)
            {
                var mesh = Label(group, actionLabel.font, string.Empty,
                    body.localPosition + new Vector3(0, -height * .19f, -.007f),
                    Mathf.Min(.009f, height * .22f), new Vector2(width - .016f, height * .30f), null);
                mesh.name = "Operation detail";
                mesh.anchor = TextAnchor.MiddleCenter;
                existing = mesh.transform;
            }
            if (existing != null)
            {
                var mesh = existing.GetComponent<TextMesh>();
                if (mesh != null)
                {
                    if (mesh.text != safe) mesh.text = safe;
                    var tone = SeverityColor(severity);
                    if (mesh.color != tone) mesh.color = tone;
                }
                if (existing.gameObject.activeSelf != (safe.Length > 0))
                    existing.gameObject.SetActive(safe.Length > 0);
            }
            var destination = body.localPosition + new Vector3(0, safe.Length > 0 ? height * .13f : 0, -.006f);
            if (actionLabel.transform.localPosition != destination)
                actionLabel.transform.localPosition = destination;
        }

        struct ActionCardState
        {
            public string Detail;
            public bool Selected;
            public bool Enabled;
            public StatusSeverity Severity;
        }
        static readonly System.Collections.Generic.Dictionary<TextMesh, ActionCardState> ActionCardStates =
            new System.Collections.Generic.Dictionary<TextMesh, ActionCardState>();

        // A genuine selected device/parameter/action row uses the EXISTING
        // QuestButton hit target. Selection controls the renderer-local tint;
        // its secondary fact stays inside the same measured collider.
        // Compact controls deliberately remain single-line for readability.
        public static void SetActionDataCard(TextMesh actionLabel, string actualDetail,
            bool selected, bool enabled, StatusSeverity severity)
        {
            if (actionLabel == null) return;
            var root = actionLabel.transform.parent;
            if (root == null || !root.gameObject.activeInHierarchy) return;
            var detail = actualDetail ?? string.Empty;
            if (ActionCardStates.TryGetValue(actionLabel, out var prior) &&
                prior.Detail == detail && prior.Selected == selected &&
                prior.Enabled == enabled && prior.Severity == severity) return;
            // External contextual state updates invalidate this cache via
            // SetOperationActionState, so stale card state cannot override them.
            SetOperationActionState(actionLabel, selected, enabled, severity);
            SetActionDetail(actionLabel, detail, severity);
            ActionCardStates[actionLabel] = new ActionCardState
                { Detail = detail, Selected = selected, Enabled = enabled, Severity = severity };
            if (ActionCardStates.Count > 256)
            {
                var stale = new System.Collections.Generic.List<TextMesh>();
                foreach (var entry in ActionCardStates)
                    if (entry.Key == null) stale.Add(entry.Key);
                foreach (var key in stale) ActionCardStates.Remove(key);
            }
            var rail = root.Find("Operation semantic rail");
            if (rail == null) return;
            // A selected row has a substantial vertical rail; neutral rows
            // retain a quiet small indicator. No additional visual collider.
            QuestButton hit = null;
            for (var i = 0; i < root.childCount; i++)
            {
                hit = root.GetChild(i).GetComponent<QuestButton>();
                if (hit != null) break;
            }
            if (hit == null) return;
            var scale = rail.localScale;
            var desired = hit.transform.localScale.y * (selected && enabled ? .78f : .42f);
            if (!Mathf.Approximately(scale.y, desired))
            {
                scale.y = desired;
                rail.localScale = scale;
            }
        }

        // Large actions use the same single detail line as compact actions.
        // The caller's original QuestButton and hitbox remain unchanged.
        public static void SetLargeActionComposition(TextMesh actionLabel, string eyebrow,
            string actualValue, bool selected, bool enabled, StatusSeverity severity)
        {
            // Reuse the original command label and its one detail line. The
            // previous eyebrow/value stack duplicated the same live state.
            SetActionDataCard(actionLabel, actualValue, selected, enabled, severity);
        }
        // Flow-backed operational controls: avoids ad hoc positions and always
        // carries the user's actual command callback and QuestButton hit target.
        public static TextMesh FlowAction(FlowLayout flow, Transform parent, Font font, Material material,
            string id, string caption, float width, float height, Action click,
            Action<TextMesh, Vector2> register, bool emphasized = false)
        {
            return OperationAction(parent, font, material, id, caption,
                flow.Next(height), width, height, click, register, emphasized);
        }

        // A measured row of real mutually exclusive operation commands.
        // Each choice retains an independent QuestButton collider and caller
        // callback. The selected state is supplied by the owning screen.
        public static TextMesh[] ChoiceRow(FlowLayout flow, Transform parent, Font font, Material material,
            string[] ids, string[] captions, int selectedIndex, float height,
            Action<string> activate, Action<TextMesh, Vector2> register, float gutter = .008f)
        {
            if (ids == null || captions == null || ids.Length == 0 || ids.Length != captions.Length)
                throw new ArgumentException("ChoiceRow requires matching nonempty IDs and captions");
            var width = flow.ColumnWidth(ids.Length, gutter);
            var centers = flow.NextColumns(ids.Length, height, gutter);
            var controls = new TextMesh[ids.Length];
            for (var i = 0; i < ids.Length; i++)
            {
                var actionId = ids[i];
                controls[i] = SelectionAction(parent, font, material, actionId, captions[i],
                    centers[i], width, height, i == selectedIndex,
                    () => activate?.Invoke(actionId), register);
            }
            return controls;
        }

        // A selection is backed by the same real action ID and collider as a
        // normal operation. The caller owns the selected state and callback.
        public static TextMesh SelectionAction(Transform parent, Font font, Material material,
            string id, string caption, Vector3 center, float width, float height,
            bool selected, Action click, Action<TextMesh, Vector2> register)
        {
            var text = OperationAction(parent, font, material, id, caption,
                center, width, height, click, register, selected);
            text.fontStyle = selected ? FontStyle.Bold : FontStyle.Normal;
            return text;
        }

        // Update an existing operational control without rebuilding its collider,
        // invalidating raycast references, or replacing its real command binding.
        public static void SetOperationActionState(TextMesh label, bool selected, bool enabled,
            StatusSeverity severity = StatusSeverity.Neutral)
        {
            if (label == null) return;
            ActionCardStates.Remove(label);
            var root = label.transform.parent;
            if (root == null) return;
            QuestButton target = null;
            for (var i = 0; i < root.childCount; i++)
            {
                target = root.GetChild(i).GetComponent<QuestButton>();
                if (target != null) break;
            }
            if (target == null) return;
            // Preserve action ID and Click. Disabling the collider makes the
            // unavailable action genuinely non-interactive, not just grey.
            var collider = target.GetComponent<Collider>();
            if (collider != null && collider.enabled != enabled) collider.enabled = enabled;
            // Disabled always wins over selection. Otherwise an unavailable
            // previously-selected command still looks active in the headset.
            var tint = !enabled ? new Color(.46f, .56f, .64f)
                : selected ? SeverityColor(severity == StatusSeverity.Neutral ? StatusSeverity.Active : severity)
                : Ink;
            if (label.color != tint) label.color = tint;
            var style = enabled && selected ? FontStyle.Bold : FontStyle.Normal;
            if (label.fontStyle != style) label.fontStyle = style;
            var renderer = target.GetComponent<MeshRenderer>();
            if (renderer != null && renderer.sharedMaterial != null)
            {
                var accent = SeverityColor(severity);
                var fill = !enabled ? new Color(.045f, .07f, .10f, .42f)
                    : selected ? new Color(.07f + accent.r * .12f, .10f + accent.g * .25f,
                        .15f + accent.b * .32f, .87f) : new Color(.08f, .17f, .28f, .78f);
                // SetPropertyBlock is local to this renderer even when many
                // actions reference the same material. Never use .material or
                // sharedMaterial.color to toggle an individual control.
                if (renderer.sharedMaterial.HasProperty(GlassColorProperty))
                {
                    var properties = new MaterialPropertyBlock();
                    renderer.GetPropertyBlock(properties);
                    properties.SetColor(GlassColorProperty, fill);
                    renderer.SetPropertyBlock(properties);
                }
                var rail = root.Find("Operation semantic rail");
                if (rail != null)
                {
                    var railRenderer = rail.GetComponent<MeshRenderer>();
                    if (railRenderer != null && railRenderer.sharedMaterial != null &&
                        railRenderer.sharedMaterial.HasProperty(GlassColorProperty))
                    {
                        var railBlock = new MaterialPropertyBlock();
                        railRenderer.GetPropertyBlock(railBlock);
                        railBlock.SetColor(GlassColorProperty,
                            !enabled ? new Color(.24f, .32f, .38f, .12f) :
                            selected ? new Color(accent.r, accent.g, accent.b, .90f) :
                            new Color(.25f, .48f, .64f, .36f));
                        railRenderer.SetPropertyBlock(railBlock);
                    }
                }
            }
        }

        // Apply a coherent state to a group of mutually exclusive commands.
        // Does not rebuild controls or replace their actual handlers.
        public static void SetChoiceRowState(TextMesh[] choices, int selectedIndex, bool[] enabled = null,
            StatusSeverity severity = StatusSeverity.Active)
        {
            if (choices == null) return;
            if (enabled != null && enabled.Length != choices.Length)
                throw new ArgumentException("Choice enable flags must match the control count", nameof(enabled));
            for (var i = 0; i < choices.Length; i++)
                SetOperationActionState(choices[i], i == selectedIndex,
                    enabled == null || enabled[i], severity);
        }

        // Explicitly couple a contextual operation with its true availability.
        // Callers supply both state and action: a disabled command is neither
        // visually active nor raycastable, without rebuilding its glass panel.
        public static TextMesh ContextAction(Transform parent, Font font, Material material,
            string id, string caption, Vector3 center, float width, float height,
            Action click, Action<TextMesh, Vector2> register, bool selected,
            bool enabled, StatusSeverity severity = StatusSeverity.Neutral)
        {
            var text = OperationAction(parent, font, material, id, caption,
                center, width, height, click, register, selected && enabled);
            SetOperationActionState(text, selected, enabled, severity);
            return text;
        }

        // Update a workflow's existing context actions atomically from real
        // enabled/selected state. Never touches the actions' callback bindings.
        public static void ReconcileContextActions(TextMesh[] actions, int selectedIndex,
            bool[] availability, StatusSeverity[] severities)
        {
            if (actions == null) return;
            if (availability != null && availability.Length != actions.Length)
                throw new ArgumentException("Availability must match context actions", nameof(availability));
            if (severities != null && severities.Length != actions.Length)
                throw new ArgumentException("Severity must match context actions", nameof(severities));
            for (var i = 0; i < actions.Length; i++)
            {
                var enabled = availability == null || availability[i];
                var severity = severities == null ? StatusSeverity.Neutral : severities[i];
                SetOperationActionState(actions[i], enabled && selectedIndex == i, enabled, severity);
            }
        }

        public static TextMesh Button(Transform parent, Font font, Material material, string id, string text,
            Vector3 position, float width, float height, float textSize, Action click,
            Action<TextMesh, Vector2> register, Color? color = null)
        {
            var group = new GameObject(text + " control").transform;
            group.SetParent(parent, false);
            var button = GameObject.CreatePrimitive(PrimitiveType.Cube);
            button.name = text;
            button.transform.SetParent(group, false);
            button.transform.localPosition = position;
            button.transform.localScale = new Vector3(width, height, .008f);
            button.GetComponent<MeshRenderer>().sharedMaterial = material;
            var input = button.AddComponent<QuestButton>();
            input.ActionId = id;
            input.Click = click;
            var label = Label(group, font, text, position + new Vector3(-width / 2 + .010f, 0, -.006f),
                textSize, new Vector2(width - .016f, height - Mathf.Min(.010f, height * .30f)), register, color);
            label.anchor = TextAnchor.MiddleLeft;
            return label;
        }

        public static GameObject Surface(Transform parent, Material material, string name, Vector3 position, Vector3 size)
        {
            var surface = GameObject.CreatePrimitive(PrimitiveType.Cube);
            surface.name = name;
            surface.transform.SetParent(parent, false);
            surface.transform.localPosition = position;
            surface.transform.localScale = size;
            var renderer = surface.GetComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            if (material != null && material.HasProperty("_Aspect"))
            {
                var block = new MaterialPropertyBlock();
                block.SetFloat("_Aspect", size.x / Mathf.Max(.0001f, size.y));
                renderer.SetPropertyBlock(block);
            }
            surface.GetComponent<Collider>().enabled = false;
            return surface;
        }

        // ---- Spatial XR component kit (KREODA Quest 3 redesign v3) ----

        public static void Stroke(Transform parent, Material source, string name, Vector2 from, Vector2 to,
            float thickness, Color color, float z = 0f)
        {
            var material = GlassMaterial(source);
            material.color = color;
            var stroke = GameObject.CreatePrimitive(PrimitiveType.Cube);
            stroke.name = name;
            stroke.transform.SetParent(parent, false);
            var delta = to - from;
            var mid = (from + to) * .5f;
            stroke.transform.localPosition = new Vector3(mid.x, mid.y, z);
            stroke.transform.localRotation = Quaternion.Euler(0, 0, Mathf.Atan2(delta.y, delta.x) * Mathf.Rad2Deg);
            stroke.transform.localScale = new Vector3(delta.magnitude, thickness, .001f);
            stroke.GetComponent<MeshRenderer>().sharedMaterial = material;
            stroke.GetComponent<Collider>().enabled = false;
        }

        public static void Hexagon(Transform parent, Material source, string name, Vector3 center, float radius,
            Color color)
        {
            var points = new Vector2[6];
            for (var i = 0; i < 6; i++)
            {
                var angle = (60f * i + 30f) * Mathf.Deg2Rad;
                points[i] = new Vector2(Mathf.Cos(angle), Mathf.Sin(angle)) * radius;
            }
            for (var i = 0; i < 6; i++)
                Stroke(parent, source, name + " edge " + i, center + (Vector3)points[i],
                    center + (Vector3)points[(i + 1) % 6], .0018f, color, center.z);
        }

        public static TextMesh Pill(Transform parent, Font font, Material material, string id, string label,
            Vector3 center, float width, float height, bool active, Action click,
            Action<TextMesh, Vector2> register)
        {
            var group = new GameObject(label + " pill").transform;
            group.SetParent(parent, false);
            var body = GameObject.CreatePrimitive(PrimitiveType.Cube);
            body.name = label;
            body.transform.SetParent(group, false);
            body.transform.localPosition = center;
            body.transform.localScale = new Vector3(width, height, .008f);
            var fill = GlassMaterial(material);
            fill.color = active ? new Color(.078f, .314f, .357f, .97f) : new Color(.082f, .153f, .192f, .97f);
            if (fill.HasProperty("_BorderColor"))
                fill.SetColor("_BorderColor", active
                    ? new Color(.384f, .851f, .863f, .95f)
                    : new Color(PanelEdge.r, PanelEdge.g, PanelEdge.b, .85f));
            if (fill.HasProperty("_BorderSize")) fill.SetFloat("_BorderSize", .012f);
            if (fill.HasProperty("_Radius")) fill.SetFloat("_Radius", .30f);
            body.GetComponent<MeshRenderer>().sharedMaterial = fill;
            var input = body.AddComponent<QuestButton>();
            input.ActionId = id;
            input.Click = click;
            var text = Label(group, font, label, center + new Vector3(0, 0, -.006f),
                Mathf.Min(.0105f, height * .42f), new Vector2(width - .008f, height - .004f), register, Ink);
            text.anchor = TextAnchor.MiddleCenter;
            text.fontStyle = FontStyle.Bold;
            return text;
        }

        public static TextMesh Badge(Transform parent, Font font, Material material, string id, string text,
            Vector3 center, float width, float height, Color tint, Action click,
            Action<TextMesh, Vector2> register)
        {
            var group = new GameObject(text + " badge").transform;
            group.SetParent(parent, false);
            var body = GameObject.CreatePrimitive(PrimitiveType.Cube);
            body.name = text;
            body.transform.SetParent(group, false);
            body.transform.localPosition = center;
            body.transform.localScale = new Vector3(width, height, .008f);
            var fill = GlassMaterial(material);
            fill.color = new Color(.063f, .176f, .212f, .95f);
            if (fill.HasProperty("_BorderColor")) fill.SetColor("_BorderColor", new Color(tint.r, tint.g, tint.b, .9f));
            if (fill.HasProperty("_BorderSize")) fill.SetFloat("_BorderSize", .012f);
            if (fill.HasProperty("_Radius")) fill.SetFloat("_Radius", .30f);
            body.GetComponent<MeshRenderer>().sharedMaterial = fill;
            if (click != null)
            {
                var input = body.AddComponent<QuestButton>();
                input.ActionId = id;
                input.Click = click;
            }
            else body.GetComponent<Collider>().enabled = false;
            Ellipse(group, material, text + " dot", center + new Vector3(-width * .5f + height * .55f, 0, -.008f),
                height * .11f, height * .11f, tint, 0f);
            var label = Label(group, font, text, center + new Vector3(-width * .5f + height * 1.05f, 0, -.010f),
                Mathf.Min(.0085f, height * .42f), new Vector2(width - height * 1.2f, height - .004f), register, Ink);
            label.anchor = TextAnchor.MiddleLeft;
            return label;
        }

        public static Transform StatusChip(Transform parent, Font font, Material material, Vector3 center,
            float width, float height, Action<TextMesh, Vector2> register, out TextMesh status)
        {
            var root = new GameObject("Spatial status chip").transform;
            root.SetParent(parent, false);
            root.localPosition = center;
            var back = GlassMaterial(material);
            back.color = new Color(.043f, .125f, .161f, .93f);
            if (back.HasProperty("_BorderColor"))
                back.SetColor("_BorderColor", new Color(.467f, .690f, .722f, .95f));
            if (back.HasProperty("_BorderSize")) back.SetFloat("_BorderSize", .012f);
            if (back.HasProperty("_Radius")) back.SetFloat("_Radius", .48f);
            Surface(root, back, "Status chip backing", Vector3.zero, new Vector3(width, height, .002f));
            Hexagon(root, material, "Kreoda mark", new Vector3(-width * .44f, 0, -.010f), height * .30f, Accent);
            var brand = Label(root, font, "KREODA / MR", new Vector3(-width * .36f, 0, -.012f),
                Mathf.Min(.0125f, height * .40f), new Vector2(width * .30f, height * .8f), register, Ink);
            brand.anchor = TextAnchor.MiddleLeft;
            brand.fontStyle = FontStyle.Bold;
            var separator = GlassMaterial(material);
            separator.color = new Color(Line.r, Line.g, Line.b, .7f);
            Surface(root, separator, "Status chip separator", new Vector3(-width * .045f, 0, -.009f),
                new Vector3(.0012f, height * .55f, .0005f));
            Ellipse(root, material, "Status chip dot", new Vector3(-width * .005f, 0, -.010f),
                height * .10f, height * .10f, Warning, 0f);
            status = Label(root, font, "PC NON CONNESSO", new Vector3(width * .015f, 0, -.012f),
                Mathf.Min(.009f, height * .30f), new Vector2(width * .36f, height * .8f), register, Muted);
            status.anchor = TextAnchor.MiddleLeft;
            return root;
        }

        public static TextMesh SectionLabel(Transform parent, Font font, string title, string subtitle,
            Vector3 topLeft, float width, Action<TextMesh, Vector2> register, out TextMesh subtitleLabel)
        {
            var heading = Label(parent, font, title, topLeft, .0095f, new Vector2(width, .016f), register, Accent);
            heading.fontStyle = FontStyle.Bold;
            subtitleLabel = Label(parent, font, subtitle, topLeft + new Vector3(0, -.017f, -.001f), .0080f,
                new Vector2(width, .016f), register, Muted);
            return heading;
        }

        public static Transform Hint(Transform parent, Font font, Material material, Vector3 center, float width)
        {
            var root = new GameObject("Input hint").transform;
            root.SetParent(parent, false);
            root.localPosition = center;
            var back = GlassMaterial(material);
            back.color = new Color(.067f, .141f, .173f, .87f);
            if (back.HasProperty("_Radius")) back.SetFloat("_Radius", .30f);
            Surface(root, back, "Hint backing", Vector3.zero, new Vector3(width, .028f, .001f));
            var mode = Label(root, font, "ACCESSO RAPIDO", new Vector3(-width * .46f, .006f, -.008f),
                .0062f, new Vector2(width * .9f, .010f), null, Accent);
            mode.fontStyle = FontStyle.Bold;
            Label(root, font, "Punta e pizzica · oppure Trigger", new Vector3(-width * .46f, -.006f, -.008f),
                .0075f, new Vector2(width * .9f, .011f), null, Ink);
            return root;
        }

        public static Transform ToolRail(Transform parent, Font font, Material material, Vector3 center,
            float width, float height, string[] ids, string[] labels, int[] glyphs, int active,
            Action<string> activate, Action<TextMesh, Vector2> register)
        {
            var root = new GameObject("Spatial tool rail").transform;
            root.SetParent(parent, false);
            root.localPosition = center;
            var back = GlassMaterial(material);
            back.color = new Color(.043f, .129f, .157f, .95f);
            if (back.HasProperty("_BorderColor"))
                back.SetColor("_BorderColor", new Color(.337f, .561f, .580f, .95f));
            if (back.HasProperty("_BorderSize")) back.SetFloat("_BorderSize", .01f);
            if (back.HasProperty("_Radius")) back.SetFloat("_Radius", .09f);
            Surface(root, back, "Tool rail backing", Vector3.zero, new Vector3(width, height, .002f));
            var count = Mathf.Min(4, Mathf.Min(ids.Length, Mathf.Min(labels.Length, glyphs.Length)));
            var slot = (height - .02f) / count;
            for (var i = 0; i < count; i++)
            {
                var y = (height * .5f - .01f) - slot * (i + .5f);
                var button = GameObject.CreatePrimitive(PrimitiveType.Cube);
                button.name = labels[i] + " rail button";
                button.transform.SetParent(root, false);
                button.transform.localPosition = new Vector3(0, y, -.006f);
                button.transform.localScale = new Vector3(width - .012f, slot - .008f, .006f);
                var fill = GlassMaterial(material);
                fill.color = i == active ? new Color(.078f, .325f, .353f, .99f) : new Color(.125f, .188f, .216f, .99f);
                if (fill.HasProperty("_BorderColor"))
                    fill.SetColor("_BorderColor", i == active
                        ? new Color(.392f, .933f, .882f, .95f)
                        : new Color(.341f, .455f, .490f, .9f));
                if (fill.HasProperty("_BorderSize")) fill.SetFloat("_BorderSize", i == active ? .016f : .008f);
                if (fill.HasProperty("_Radius")) fill.SetFloat("_Radius", .22f);
                button.GetComponent<MeshRenderer>().sharedMaterial = fill;
                var input = button.AddComponent<QuestButton>();
                input.ActionId = ids[i];
                var id = ids[i];
                input.Click = () => activate?.Invoke(id);
                var icon = new GameObject(labels[i] + " icon").transform;
                icon.SetParent(root, false);
                icon.localPosition = new Vector3(0, y + slot * .12f, -.014f);
                icon.localScale = Vector3.one * Mathf.Max(.6f, width / .085f);
                Glyph(icon, material, labels[i] + " glyph", Vector3.zero, Accent, glyphs[i]);
                var label = Label(root, font, labels[i], new Vector3(0, y - slot * .22f, -.016f),
                    .0075f, new Vector2(width - .01f, .012f), register, Ink);
                label.anchor = TextAnchor.MiddleCenter;
            }
            return root;
        }

        public static Transform Belt(Transform parent, Font font, Material material, Vector3 center,
            float width, float height, string[] ids, string[] labels, bool[] active, Action<string> activate,
            Action<TextMesh, Vector2> register)
        {
            var root = new GameObject("Spatial context belt").transform;
            root.SetParent(parent, false);
            root.localPosition = center;
            var back = GlassMaterial(material);
            back.color = new Color(.051f, .129f, .165f, .97f);
            if (back.HasProperty("_BorderColor"))
                back.SetColor("_BorderColor", new Color(.318f, .498f, .522f, .95f));
            if (back.HasProperty("_BorderSize")) back.SetFloat("_BorderSize", .01f);
            if (back.HasProperty("_Radius")) back.SetFloat("_Radius", .22f);
            Surface(root, back, "Belt backing", Vector3.zero, new Vector3(width, height, .002f));
            var count = Mathf.Min(ids.Length, Mathf.Min(labels.Length, active.Length));
            var gap = .008f;
            var pillWidth = Mathf.Min(.085f, (width - .02f - gap * (count - 1)) / Mathf.Max(1, count));
            var total = pillWidth * count + gap * (count - 1);
            var start = -total * .5f + pillWidth * .5f;
            for (var i = 0; i < count; i++)
            {
                var id = ids[i];
                Pill(root, font, material, id, labels[i],
                    new Vector3(start + i * (pillWidth + gap), 0, -.006f), pillWidth, height - .012f,
                    active[i], () => activate?.Invoke(id), null);
            }
            return root;
        }
    }
}
