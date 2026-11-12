using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using Google.FlatBuffers;
using Kreoda.Protocol;
using Kreoda.QuestFoundation;
using Kreoda.QuestRuntime;
using Kreoda.Session;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Kreoda.QuestEditor
{
    public static class QuestZebraRender
    {
        [Serializable] sealed class Proof
        {
            public string kind = "Unity Editor GPU render of actual OCCT mesh; no headset or passthrough";
            public string graphicsDevice, meshSha256;
            public int triangles, stripedPixels, adjustedPixels, sectionPixels;
            public bool restoredBaseline, nativeMeshIdentityPreserved;
            public string[] shaderErrors;
        }

        internal static SessionMeshResult ReadNativeMesh(byte[] raw)
        {
            var source = MeshUpdate.GetRootAsMeshUpdate(new ByteBuffer(raw));
            float[] Floats(ArraySegment<byte>? segment)
            {
                var bytes = segment.Value;
                var result = new float[bytes.Count / 4];
                Buffer.BlockCopy(bytes.Array, bytes.Offset, result, 0, bytes.Count);
                return result;
            }
            var bytes = source.GetIndicesBytes().Value;
            var indices = new uint[bytes.Count / 4];
            Buffer.BlockCopy(bytes.Array, bytes.Offset, indices, 0, bytes.Count);
            return new SessionMeshResult(new SessionMeshHeader(source.RequestId,
                "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "quest-zebra-proof", source.Revision,
                "body-zebra-sphere", source.FeatureId, source.FeatureId, source.Lod, raw.Length),
                Floats(source.GetPositionsBytes()), Floats(source.GetNormalsBytes()), indices,
                Floats(source.GetEdgeVerticesBytes()),
                Enumerable.Range(0, source.FacesLength).Select(i => source.Faces(i).Value)
                    .Select(face => new SessionMeshFaceRange(face.PersistentFaceId, face.TriangleStart, face.TriangleCount)).ToArray(),
                Enumerable.Range(0, source.EdgesLength).Select(i => source.Edges(i).Value)
                    .Select(edge => new SessionMeshEdgeRange(edge.PersistentEdgeId, edge.VertexStart, edge.VertexCount)).ToArray(),
                source.VolumeMm3, Enumerable.Range(0, 6).Select(source.BboxMm).ToArray(), raw.Length, "native-editor-render",
                source.CurvatureMaxAbsPerMmLength > 0 ? Floats(source.GetCurvatureMaxAbsPerMmBytes()) : null);
        }

        public static void Capture()
        {
            if (SystemInfo.graphicsDeviceType.ToString() == "Null") throw new InvalidOperationException("GPU rendering is required");
            var output = Environment.GetEnvironmentVariable("KREODA_ZEBRA_OUTPUT") ?? throw new InvalidOperationException("Missing private capture output");
            var input = Environment.GetEnvironmentVariable("KREODA_ZEBRA_MESH") ?? throw new InvalidOperationException("Missing actual OCCT fixture");
            Directory.CreateDirectory(output);
            var prior = SceneManager.GetActiveScene().path;
            var oldAmbient = RenderSettings.ambientLight;
            var materials = new System.Collections.Generic.List<Material>();
            RenderTexture target = null;
            Texture2D texture = null;
            try
            {
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var root = new GameObject("Native CAD inspection root");
                var view = new GameObject("Actual OCCT sphere").AddComponent<QuestMeshView>();
                view.transform.SetParent(root.transform, false);
                Material Material(string name)
                {
                    var shader = Shader.Find(name) ?? throw new InvalidOperationException("Missing shader " + name);
                    var material = new Material(shader);materials.Add(material);return material;
                }
                view.SurfaceMaterial = Material("Kreoda/SectionSurface");
                view.EdgeMaterial = Material("Kreoda/SectionEdge");
                view.SelectionMaterial = Material("Kreoda/Selection");
                view.SectionCapMaterial = Material("Kreoda/SectionSurface");
                view.SectionContourMaterial = Material("Kreoda/SectionEdge");
                var raw = File.ReadAllBytes(input);
                view.Upload(ReadNativeMesh(raw));
                var mesh = view.GetComponent<MeshFilter>().sharedMesh;
                var upload = view.UploadVersion;
                var camera = new GameObject("Offscreen analysis camera").AddComponent<Camera>();
                camera.transform.position = new Vector3(-.16f, .11f, -.22f);
                camera.transform.LookAt(Vector3.zero);
                camera.orthographic = true;camera.orthographicSize = .073f;
                camera.nearClipPlane = .001f;camera.farClipPlane = 2;
                camera.clearFlags = CameraClearFlags.SolidColor;camera.backgroundColor = new Color(.05f,.07f,.09f,1);
                RenderSettings.ambientLight = Color.gray;
                target = new RenderTexture(768,768,24) { antiAliasing = 4 };
                target.Create();camera.targetTexture = target;
                texture = new Texture2D(768,768,TextureFormat.RGBA32,false);
                Color32[] Render(string file)
                {
                    camera.Render();camera.Render();
                    var priorTarget = RenderTexture.active;
                    try { RenderTexture.active = target;texture.ReadPixels(new Rect(0,0,768,768),0,0);texture.Apply(); }
                    finally { RenderTexture.active = priorTarget; }
                    File.WriteAllBytes(Path.Combine(output,file),texture.EncodeToPNG());
                    return texture.GetPixels32();
                }
                int Difference(Color32[] first, Color32[] second) => first.Zip(second,(a,b) => a.Equals(b) ? 0 : 1).Sum();
                var baseline = Render("baseline.png");
                view.ApplyZebra(true,16,0);
                var striped = Render("zebra.png");
                view.ApplyZebra(true,32,75);
                var adjusted = Render("zebra-adjusted.png");
                view.ApplySection(SectionPlane.FromAxis(SectionAxis.Z,0),root.transform,view.SectionCapMaterial,view.SectionContourMaterial);
                var section = Render("zebra-section.png");
                view.ApplySection(null,root.transform,view.SectionCapMaterial,view.SectionContourMaterial);
                view.ApplyZebra(false,16,0);
                var restored = Render("restored.png");
                using (var sha = SHA256.Create())
                {
                    var proof = new Proof { graphicsDevice = SystemInfo.graphicsDeviceType.ToString(),
                        meshSha256 = BitConverter.ToString(sha.ComputeHash(raw)).Replace("-","").ToLowerInvariant(),
                        triangles = view.TriangleCount, stripedPixels = Difference(baseline,striped),
                        adjustedPixels = Difference(striped,adjusted), sectionPixels = Difference(adjusted,section),
                        restoredBaseline = Difference(baseline,restored) == 0,
                        nativeMeshIdentityPreserved = mesh == view.GetComponent<MeshFilter>().sharedMesh && upload == view.UploadVersion,
                        shaderErrors = ShaderUtil.GetShaderMessages(view.SurfaceMaterial.shader)
                            .Where(message => message.severity.ToString() == "Error").Select(message => message.message).ToArray() };
                    File.WriteAllText(Path.Combine(output,"gpu-proof.json"),JsonUtility.ToJson(proof,true));
                    if (proof.stripedPixels < 1000 || proof.adjustedPixels < 1000 || proof.sectionPixels < 1000 ||
                        !proof.restoredBaseline || !proof.nativeMeshIdentityPreserved || proof.shaderErrors.Length > 0)
                        throw new InvalidOperationException("Actual Unity zebra GPU verification failed; inspect private proof");
                }
            }
            finally
            {
                if (target != null) {target.Release();UnityEngine.Object.DestroyImmediate(target);}
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
