using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using Kreoda.QuestFoundation;
using Kreoda.QuestRuntime;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Kreoda.QuestEditor
{
    public static class QuestCurvatureRender
    {
        [Serializable] sealed class Proof
        {
            public string kind = "Unity Editor GPU render of actual OCCT curvature; no headset or passthrough";
            public string graphicsDevice, meshSha256;
            public int triangles, changedPixels, scaledPixels, sectionPixels, redPixels;
            public float maximumPerMm;
            public bool restoredBaseline, nativeMeshIdentityPreserved;
            public string[] shaderErrors;
        }

        public static void Capture()
        {
            if (SystemInfo.graphicsDeviceType.ToString() == "Null") throw new InvalidOperationException("GPU rendering is required");
            var output = Environment.GetEnvironmentVariable("KREODA_CURVATURE_OUTPUT") ?? throw new InvalidOperationException("Missing private capture output");
            var input = Environment.GetEnvironmentVariable("KREODA_CURVATURE_MESH") ?? throw new InvalidOperationException("Missing actual OCCT fixture");
            Directory.CreateDirectory(output);
            var prior = SceneManager.GetActiveScene().path;
            var oldAmbient = RenderSettings.ambientLight;
            var materials = new List<Material>();
            RenderTexture target = null; Texture2D texture = null;
            try
            {
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var root = new GameObject("Actual native curvature proof");
                var body = new GameObject("OCCT sphere");body.transform.SetParent(root.transform,false);
                var view = body.AddComponent<QuestMeshView>();
                Material Material(string shaderName)
                {
                    var shader = Shader.Find(shaderName);
                    if (shader == null) throw new InvalidOperationException(shaderName);
                    var material = new Material(shader);materials.Add(material);return material;
                }
                view.SurfaceMaterial = Material("Kreoda/SectionSurface");
                view.EdgeMaterial = Material("Kreoda/SectionEdge");
                view.SelectionMaterial = Material("Kreoda/Selection");
                view.SectionCapMaterial = Material("Kreoda/SectionSurface");
                view.SectionContourMaterial = Material("Kreoda/SectionEdge");
                var raw = File.ReadAllBytes(input);
                var source = QuestZebraRender.ReadNativeMesh(raw);
                if (source.CurvatureMaxAbsPerMm == null || source.CurvatureMaxAbsPerMm.Length != source.Positions.Length / 3)
                    throw new InvalidOperationException("Actual native curvature field is required");
                var maximum = source.CurvatureMaxAbsPerMm.Max();
                if (Math.Abs(maximum - 1f / 60) > 1e-7) throw new InvalidOperationException("Expected radius-60 native curvature");
                view.Upload(source);
                var mesh = view.GetComponent<MeshFilter>().sharedMesh;
                var upload = view.UploadVersion;
                var camera = new GameObject("Offscreen curvature camera").AddComponent<Camera>();
                camera.transform.position = new Vector3(-.16f,.11f,-.22f);camera.transform.LookAt(Vector3.zero);
                camera.orthographic = true;camera.orthographicSize = .073f;
                camera.nearClipPlane = .001f;camera.farClipPlane = 2;
                camera.clearFlags = CameraClearFlags.SolidColor;camera.backgroundColor = new Color(.05f,.07f,.09f,1);
                RenderSettings.ambientLight = Color.gray;
                target = new RenderTexture(768,768,24) { antiAliasing = 4 };
                target.Create();camera.targetTexture = target;
                texture = new Texture2D(768,768,TextureFormat.RGBA32,false);
                Color32[] Render(string name)
                {
                    camera.Render();camera.Render();
                    var previous = RenderTexture.active;
                    try { RenderTexture.active = target;texture.ReadPixels(new Rect(0,0,768,768),0,0);texture.Apply(); }
                    finally { RenderTexture.active = previous; }
                    File.WriteAllBytes(Path.Combine(output,name),texture.EncodeToPNG());
                    return texture.GetPixels32();
                }
                int Difference(Color32[] a, Color32[] b) => a.Zip(b,(x,y) => x.Equals(y) ? 0 : 1).Sum();
                var baseline = Render("baseline.png");
                view.ApplyCurvature(true,.1f);
                var heat = Render("curvature.png");
                view.ApplyCurvature(true,maximum);
                var scaled = Render("curvature-scaled.png");
                view.ApplySection(SectionPlane.FromAxis(SectionAxis.Z,0),root.transform,view.SectionCapMaterial,view.SectionContourMaterial);
                var section = Render("curvature-section.png");
                view.ApplySection(null,root.transform,view.SectionCapMaterial,view.SectionContourMaterial);
                view.ApplyCurvature(false,maximum);
                var restored = Render("restored.png");
                using (var sha = SHA256.Create())
                {
                    var proof = new Proof { graphicsDevice = SystemInfo.graphicsDeviceType.ToString(),
                        meshSha256 = BitConverter.ToString(sha.ComputeHash(raw)).Replace("-","").ToLowerInvariant(),
                        triangles = view.TriangleCount, maximumPerMm = maximum,
                        changedPixels = Difference(baseline,heat), scaledPixels = Difference(heat,scaled),
                        sectionPixels = Difference(scaled,section),
                        redPixels = scaled.Count(color => color.r > 120 && color.r > color.g * 1.5 && color.r > color.b * 1.5),
                        restoredBaseline = Difference(baseline,restored) == 0,
                        nativeMeshIdentityPreserved = mesh == view.GetComponent<MeshFilter>().sharedMesh && upload == view.UploadVersion,
                        shaderErrors = ShaderUtil.GetShaderMessages(view.SurfaceMaterial.shader)
                            .Where(message => message.severity.ToString() == "Error").Select(message => message.message).ToArray() };
                    File.WriteAllText(Path.Combine(output,"gpu-proof.json"),JsonUtility.ToJson(proof,true));
                    if (proof.changedPixels < 1000 || proof.scaledPixels < 1000 || proof.sectionPixels < 1000 || proof.redPixels < 1000 ||
                        !proof.restoredBaseline || !proof.nativeMeshIdentityPreserved || proof.shaderErrors.Length > 0)
                        throw new InvalidOperationException("Actual Unity curvature GPU verification failed");
                }
            }
            finally
            {
                if (target != null) { target.Release();UnityEngine.Object.DestroyImmediate(target); }
                if (texture != null) UnityEngine.Object.DestroyImmediate(texture);
                foreach (var material in materials) UnityEngine.Object.DestroyImmediate(material);
                RenderSettings.ambientLight = oldAmbient;
                if (!string.IsNullOrEmpty(prior) && File.Exists(prior)) EditorSceneManager.OpenScene(prior,OpenSceneMode.Single);
                else EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);
            }
            QuestHomeRender.Capture();
        }
    }
}
