using System.IO;
using System.Reflection;
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
                typeof(QuestControls).GetMethod("Start", Private).Invoke(controls, null);
                controls.transform.SetPositionAndRotation(Vector3.zero, Quaternion.identity);

                var cameraObject = new GameObject("Neutral render camera");
                var camera = cameraObject.AddComponent<Camera>();
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(.78f, .81f, .85f, 1);
                camera.orthographic = true;
                camera.orthographicSize = .46f;
                camera.nearClipPlane = .05f;
                camera.farClipPlane = 10;
                camera.transform.position = new Vector3(0, 0, -2);
                camera.transform.rotation = Quaternion.identity;
                var output = Path.GetFullPath(Path.Combine(Application.dataPath, "../../../docs/superpowers/evidence/2026-10-16-quest-home-ui"));
                Directory.CreateDirectory(output);
                Render(camera, controls, (Transform)typeof(QuestControls).GetField("_homePage", Private).GetValue(controls),
                    Path.Combine(output, "home.png"));
                Render(camera, controls, (Transform)typeof(QuestControls).GetField("_viewPage", Private).GetValue(controls),
                    Path.Combine(output, "workspace.png"));
            }
            finally
            {
                if (!string.IsNullOrEmpty(priorPath) && File.Exists(priorPath)) EditorSceneManager.OpenScene(priorPath, OpenSceneMode.Single);
                else EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            }
        }

        static void Render(Camera camera, QuestControls controls, Transform page, string path)
        {
            typeof(QuestControls).GetMethod("Page", Private).Invoke(controls, new object[] { page });
            typeof(QuestControls).GetMethod("LateUpdate", Private).Invoke(controls, null);
            var target = new RenderTexture(1600, 900, 24, RenderTextureFormat.ARGB32);
            var previous = RenderTexture.active;
            try
            {
                camera.targetTexture = target;
                RenderTexture.active = target;
                camera.Render();
                var image = new Texture2D(target.width, target.height, TextureFormat.RGB24, false);
                image.ReadPixels(new Rect(0, 0, target.width, target.height), 0, 0);
                image.Apply();
                File.WriteAllBytes(path, image.EncodeToPNG());
                Object.DestroyImmediate(image);
            }
            finally
            {
                camera.targetTexture = null;
                RenderTexture.active = previous;
                target.Release();
                Object.DestroyImmediate(target);
            }
        }
    }
}
