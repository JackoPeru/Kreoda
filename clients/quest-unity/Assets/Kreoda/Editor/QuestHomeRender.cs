using System.IO;
using System.Reflection;
using System.Collections.Generic;
using System.Security.Cryptography;
using System;
using System.Text.Json;
using Kreoda.QuestRuntime;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Kreoda.QuestEditor
{
    public static class QuestHomeRender
    {
        const BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;
        [Serializable] sealed class CaptureManifest
        {
            public string kind = "Unity Editor scene reconstruction; no XR device, live CAD session or passthrough";
            public string capturedUtc;
            public int width = 1600;
            public int height = 900;
            public string[] pages;
            public string[] sha256;
            // Reproducible per-page world-space framing. This is computed from
            // the actual Unity renderers, never from a reference mockup.
            public float[] cameraHalfHeights;
            public Vector2[] cameraCenters;
        }

        static readonly string[] PageFields = { "_homePage", "_viewPage", "_connectionPage", "_pcPage", "_metricsPage",
            "_homeNoticePage", "_sectionPage", "_editPage", "_referencePage", "_configurationPage", "_commandPage",
            "_sketchPage", "_voicePage" };
        static readonly string[] PageFiles = { "home.png", "workspace.png", "connection.png", "pc-discovery.png",
            "metrics.png", "home-notice.png", "section.png", "edit.png", "references.png", "configurations.png",
            "commands.png", "sketch.png", "voice.png" };

        public static void Capture()
        {
            var priorPath = SceneManager.GetActiveScene().path;
            try
            {
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var root = new GameObject("Offscreen Quest UI proof");
                var connection = root.AddComponent<QuestConnection>();
                connection.DisplayRoot = new GameObject("Empty CAD stand-in").transform;
                connection.DisplayRoot.SetParent(root.transform, false);
                connection.Section = root.AddComponent<QuestSection>();
                connection.Section.Connection = connection;
                var display = root.AddComponent<QuestDisplay>();
                display.Connection = connection;
                var controls = root.AddComponent<QuestControls>();
                controls.Connection = connection;
                controls.Display = display;
                controls.Environment = root.AddComponent<QuestEnvironment>();
                controls.Font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
                controls.PanelMaterial = AssetDatabase.LoadAssetAtPath<Material>("Assets/Kreoda/Materials/Panel.mat");
                controls.ButtonMaterial = AssetDatabase.LoadAssetAtPath<Material>("Assets/Kreoda/Materials/Buttons.mat");
                controls.RayMaterial = AssetDatabase.LoadAssetAtPath<Material>("Assets/Kreoda/Materials/Ray.mat");
                controls.Home = root.AddComponent<QuestHome>();
                controls.Voice = root.AddComponent<QuestVoice>();
                controls.Voice.Connection = connection;
                controls.Voice.Controls = controls;
                typeof(QuestControls).GetMethod("Start", Private).Invoke(controls, null);
                controls.transform.SetPositionAndRotation(Vector3.zero, Quaternion.identity);

                var cameraObject = new GameObject("Neutral render camera");
                var camera = cameraObject.AddComponent<Camera>();
                camera.clearFlags = CameraClearFlags.SolidColor;
                // Neutral dark stand-in for real passthrough: no fake scenery.
                camera.backgroundColor = new Color(.075f, .095f, .12f, 1);
                camera.orthographic = true;
                // The spatial Home is wider than each workstation. Its camera
                // framing is intentionally different from the twelve detailed
                // screens, which need enough pixels for legible MR typography.
                camera.orthographicSize = .62f;
                camera.nearClipPlane = .05f;
                camera.farClipPlane = 10;
                camera.transform.position = new Vector3(0, 0, -2);
                camera.transform.rotation = Quaternion.identity;
                // Keep previous iteration's GPU evidence immutable. Every new
                // Phase12 capture is written into its own proof directory;
                // the verifier still rejects stale files by UTC timestamp.
                var output = Path.GetFullPath(Environment.GetEnvironmentVariable("KREODA_UI_CAPTURE_OUTPUT") ??
                    Path.Combine(Application.dataPath, "../../../docs/superpowers/evidence/2026-10-18-phase12-quest-ui"));
                Directory.CreateDirectory(output);
                var hashes = new List<string>();
                var halfHeights = new List<float>();
                var centers = new List<Vector2>();
                string thicknessText = null;
                var thicknessFile = Environment.GetEnvironmentVariable("KREODA_THICKNESS_RESULT");
                if (!string.IsNullOrEmpty(thicknessFile))
                {
                    using var native = JsonDocument.Parse(File.ReadAllBytes(thicknessFile));
                    var formatter = typeof(QuestControls).Assembly.GetType("Kreoda.QuestRuntime.QuestThicknessInspection")
                        ?.GetMethod("Format", BindingFlags.Static | BindingFlags.NonPublic)
                        ?? throw new InvalidOperationException("Actual thickness formatter missing");
                    thicknessText = (string)formatter.Invoke(null, new object[] { native.RootElement,
                        native.RootElement.GetProperty("result").GetProperty("featureId").GetString() });
                    File.Copy(thicknessFile, Path.Combine(output, "thickness-source.json"), false);
                }
                for (int i = 0; i < PageFields.Length; i++)
                {
                    var field = typeof(QuestControls).GetField(PageFields[i], Private);
                    var page = field?.GetValue(controls) as Transform;
                    if (page == null) throw new InvalidOperationException("Required Quest UI page absent: " + PageFields[i]);
                    if (thicknessText != null && PageFields[i] == "_homeNoticePage")
                        ((TextMesh)typeof(QuestControls).GetField("_homeNotice", Private).GetValue(controls)).text = thicknessText;
                    var filename = Path.Combine(output, PageFiles[i]);
                    Render(camera, controls, page, filename, out var halfHeight, out var center);
                    halfHeights.Add(halfHeight);
                    centers.Add(center);
                    using (var sha = SHA256.Create())
                        hashes.Add(BitConverter.ToString(sha.ComputeHash(File.ReadAllBytes(filename))).Replace("-", "").ToLowerInvariant());
                }
                File.WriteAllText(Path.Combine(output, "capture-manifest.json"), JsonUtility.ToJson(new CaptureManifest {
                    capturedUtc = DateTime.UtcNow.ToString("o"), pages = PageFiles, sha256 = hashes.ToArray(),
                    cameraHalfHeights = halfHeights.ToArray(), cameraCenters = centers.ToArray()
                }, true));
            }
            finally
            {
                if (!string.IsNullOrEmpty(priorPath) && File.Exists(priorPath)) EditorSceneManager.OpenScene(priorPath, OpenSceneMode.Single);
                else EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            }
        }

        static void FitRealPage(Camera camera, Transform page, out float halfHeight, out Vector2 center)
        {
            // A wider Home or a different CAD workstation must not be cropped
            // or appear miniature just because the previous capture used a
            // fixed orthographic size. Fit the actual enabled UI renderers.
            camera.transform.SetPositionAndRotation(new Vector3(0, 0, -2), Quaternion.identity);
            var min = new Vector2(float.PositiveInfinity, float.PositiveInfinity);
            var max = new Vector2(float.NegativeInfinity, float.NegativeInfinity);
            var found = false;
            // Shared title/navigation/frame renderers are siblings of the active
            // page. Include them so evidence does not crop actionable chrome.
            var visibleRoot = page.parent != null ? page.parent : page;
            foreach (var renderer in visibleRoot.GetComponentsInChildren<Renderer>(false))
            {
                if (renderer == null || !renderer.enabled) continue;
                var bounds = renderer.bounds;
                for (var x = -1; x <= 1; x += 2)
                    for (var y = -1; y <= 1; y += 2)
                        for (var z = -1; z <= 1; z += 2)
                        {
                            var corner = bounds.center + Vector3.Scale(bounds.extents,
                                new Vector3(x, y, z));
                            var local = camera.transform.InverseTransformPoint(corner);
                            if (float.IsNaN(local.x) || float.IsNaN(local.y) ||
                                float.IsInfinity(local.x) || float.IsInfinity(local.y))
                                throw new InvalidOperationException("Nonfinite page visual bounds: " + page.name);
                            min = Vector2.Min(min, new Vector2(local.x, local.y));
                            max = Vector2.Max(max, new Vector2(local.x, local.y));
                            found = true;
                        }
            }
            if (!found || max.x <= min.x || max.y <= min.y)
                throw new InvalidOperationException("No real visible Unity renderer bounds: " + page.name);
            center = (min + max) * .5f;
            halfHeight = Mathf.Max((max.y - min.y) * .55f,
                (max.x - min.x) * .55f / (1600f / 900f), .18f);
            camera.orthographicSize = halfHeight;
            camera.transform.position += new Vector3(center.x, center.y, 0);
        }

        static void Render(Camera camera, QuestControls controls, Transform page, string path,
            out float halfHeight, out Vector2 center)
        {
            typeof(QuestControls).GetMethod("Page", Private).Invoke(controls, new object[] { page });
            // The real UI updates live headings, input availability, discovered
            // device cards and workstation readouts in Update. A renderer proof
            // that only called Start captured pre-binding placeholder content.
            // No synthetic document, peer or telemetry is introduced here.
            typeof(QuestControls).GetMethod("Update", Private).Invoke(controls, null);
            typeof(QuestControls).GetMethod("LateUpdate", Private).Invoke(controls, null);
            FitRealPage(camera, page, out halfHeight, out center);
            var target = new RenderTexture(1600, 900, 24, RenderTextureFormat.ARGB32);
            var previous = RenderTexture.active;
            Texture2D image = null;
            try
            {
                camera.targetTexture = target;
                RenderTexture.active = target;
                camera.Render();
                image = new Texture2D(target.width, target.height, TextureFormat.RGB24, false);
                image.ReadPixels(new Rect(0, 0, target.width, target.height), 0, 0);
                image.Apply();
                var baseline = image.GetPixel(0, 0);
                bool hasVisualContent = false;
                for (int y = 20; y < target.height && !hasVisualContent; y += 20)
                    for (int x = 20; x < target.width; x += 20)
                        if (Vector4.Distance(image.GetPixel(x, y), baseline) > .04f)
                        { hasVisualContent = true; break; }
                if (!hasVisualContent) throw new InvalidOperationException("Blank capture: " + path);
                File.WriteAllBytes(path, image.EncodeToPNG());
            }
            finally
            {
                if (image != null) UnityEngine.Object.DestroyImmediate(image);
                camera.targetTexture = null;
                RenderTexture.active = previous;
                target.Release();
                UnityEngine.Object.DestroyImmediate(target);
            }
        }

    }
}
