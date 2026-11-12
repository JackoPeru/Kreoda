using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Globalization;
using Kreoda.QuestFoundation;
using Kreoda.QuestRuntime;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Kreoda.QuestEditor
{
    public static class QuestSurfaceRender
    {
        [Serializable]
        sealed class NativeProof
        {
            public string source, featureId, featureType, geometryKind, meshSha256, nativeSha256;
            public int solidCount;
            public double areaMm2, volumeMm3;
            public double[] bounds;
        }

        [Serializable]
        sealed class RenderProof
        {
            public string source, featureId, featureType, geometryKind, graphicsDevice, meshSha256, nativeSha256;
            public string sectionAxis, frontSelectionFace, backSelectionFace;
            public string capOnlyExpectedVisibleSide;
            public int solidCount, triangles, frontPixels, backPixels, sectionPixels, backRestoredPixels, contourIndices;
            public int obliquePixels, sectionObliquePixels;
            public int frontSelectionTriangle, backSelectionTriangle, sectionCapTriangles, sectionUnityAxis;
            public int sectionCapCull, capOnlyClippedSidePixels, capOnlyRetainedSidePixels;
            public int cullBefore, previewCull, cullAfter;
            public double areaMm2, volumeMm3, meshVolumeMm3, sectionOffsetMm, sectionMinimumMm, sectionMaximumMm;
            public double[] bounds, unityBoundsMetres;
            public bool twoSidedBefore, twoSidedAfter, noSectionCap, closedContour, identityPreserved;
            public bool frontSelectionChanged, backSelectionChanged;
            public bool surfaceGeometry, solidBackCullBefore, solidBackCullAfter, volumeMatches;
            public bool sectionInBounds, sectionCapPresent, sectionCapColliderMatches;
            public bool obliqueClippingRequired, obliqueClippingVisible;
            public bool capOnlyMainBodyDisabled, capOnlyOnlyCapRendererEnabled;
            public bool capVisibleFromClippedSide, capCulledFromRetainedSide, capOnlyRenderersRestored;
            public string[] shaderErrors;
        }

        public static void Capture()
        {
            if (SystemInfo.graphicsDeviceType.ToString() == "Null")
                throw new InvalidOperationException("GPU rendering is required");
            var input = Environment.GetEnvironmentVariable("KREODA_SURFACE_MESH")
                ?? throw new InvalidOperationException("Missing actual OCCT surface mesh");
            var provenancePath = Environment.GetEnvironmentVariable("KREODA_SURFACE_PROOF")
                ?? throw new InvalidOperationException("Missing native surface provenance proof");
            var output = Environment.GetEnvironmentVariable("KREODA_SURFACE_OUTPUT")
                ?? throw new InvalidOperationException("Missing surface capture output");
            Directory.CreateDirectory(output);

            var raw = File.ReadAllBytes(input);
            var rawHash = Hash(raw);
            var native = JsonUtility.FromJson<NativeProof>(File.ReadAllText(provenancePath));
            if (native == null)
                throw new InvalidOperationException("Native surface provenance is missing");
            var isSurface = native.geometryKind == "surface";
            var isSewnSolid = native.featureType == "SurfaceSewnSolid" || native.featureType == "SurfaceThicken";
            var isSupportedType = native.featureType == "SurfaceExtrude" || native.featureType == "SurfaceRevolve" ||
                native.featureType == "SurfaceOffset" || native.featureType == "SurfaceSew" ||
                native.featureType == "SurfaceSweep" || native.featureType == "SurfaceTrim" ||
                native.featureType == "SurfaceExtend" || isSewnSolid;
            var expectedGeometry = isSewnSolid
                ? native.geometryKind == "solid" && native.solidCount == 1 && native.volumeMm3 > 0 &&
                    !double.IsNaN(native.volumeMm3) && !double.IsInfinity(native.volumeMm3)
                : isSurface && native.solidCount == 0 && native.volumeMm3 == 0;
            if (native.source != "offlineEditor/actualnativefixture" || !isSupportedType || !expectedGeometry ||
                string.IsNullOrEmpty(native.featureId) || double.IsNaN(native.areaMm2) || double.IsInfinity(native.areaMm2) ||
                native.areaMm2 <= 0 || native.bounds == null || native.bounds.Length != 6 ||
                native.bounds.Any(value => double.IsNaN(value) || double.IsInfinity(value)) ||
                string.IsNullOrEmpty(native.nativeSha256) || native.nativeSha256.Length != 64 ||
                !native.nativeSha256.All(Uri.IsHexDigit) ||
                !string.Equals(native.meshSha256, rawHash, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Native provenance must describe the exact uncapped surface meshfb payload");

            var previousScene = SceneManager.GetActiveScene();
            var temporaryBatchScene = string.IsNullOrEmpty(previousScene.path);
            if (temporaryBatchScene && !Application.isBatchMode)
                throw new InvalidOperationException("Save the current scene before interactive GPU verification");
            var previousAmbient = RenderSettings.ambientLight;
            var materials = new System.Collections.Generic.List<Material>();
            RenderTexture target = null;
            Texture2D texture = null;
            Scene captureScene = default(Scene);
            try
            {
                captureScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,
                    temporaryBatchScene ? NewSceneMode.Single : NewSceneMode.Additive);
                SceneManager.SetActiveScene(captureScene);
                var root = new GameObject("Native surface render proof");
                var body = new GameObject("OCCT SurfaceExtrude");
                body.transform.SetParent(root.transform, false);
                var view = body.AddComponent<QuestMeshView>();
                Material MakeMaterial(string shaderName)
                {
                    var shader = Shader.Find(shaderName);
                    if (shader == null) throw new InvalidOperationException("Missing shader " + shaderName);
                    var material = new Material(shader);
                    materials.Add(material);
                    return material;
                }
                view.SurfaceMaterial = MakeMaterial("Kreoda/SectionSurface");
                view.EdgeMaterial = MakeMaterial("Kreoda/SectionEdge");
                view.SelectionMaterial = MakeMaterial("Kreoda/Selection");
                view.PreviewMaterial = MakeMaterial("Kreoda/Selection");
                view.SectionCapMaterial = MakeMaterial("Kreoda/SectionSurface");
                view.SectionContourMaterial = MakeMaterial("Kreoda/SectionEdge");
                var source = QuestZebraRender.ReadNativeMesh(raw);
                if (source.Header == null || string.IsNullOrEmpty(source.Header.FeatureId) ||
                    source.Header.FeatureId != native.featureId || source.Indices == null || source.Indices.Length < 3)
                    throw new InvalidOperationException("Native mesh is empty or missing feature identity");
                var volumeToleranceMm3 = Math.Max(1e-6, Math.Abs(native.volumeMm3) * 1e-6);
                var volumeMatches = isSurface
                    ? source.VolumeMm3 == 0
                    : !double.IsNaN(source.VolumeMm3) && !double.IsInfinity(source.VolumeMm3) &&
                        source.VolumeMm3 > 0 && Math.Abs(source.VolumeMm3 - native.volumeMm3) <= volumeToleranceMm3;
                if (!volumeMatches)
                    throw new InvalidOperationException(isSurface
                        ? "Surface mesh must retain zero native volume"
                        : "Native solid volume must match its provenance proof");
                view.SetSurfaceGeometry(isSurface);
                view.Upload(source);

                var filter = view.GetComponent<MeshFilter>();
                var renderer = view.GetComponent<MeshRenderer>();
                var collider = view.GetComponent<MeshCollider>();
                var cullBefore = ReadCull(renderer.sharedMaterial);
                var twoSidedBefore = isSurface && HasCull(renderer.sharedMaterial, 0);
                var solidBackCullBefore = !isSurface && HasCull(renderer.sharedMaterial, 2);
                var nativeMesh = filter.sharedMesh;
                var colliderMesh = collider.sharedMesh;
                var uploadVersion = view.UploadVersion;
                var vertices = nativeMesh.vertices;
                var normals = nativeMesh.normals;
                var indices = nativeMesh.triangles;
                if (vertices.Length == 0 || indices.Length == 0 || normals.Length != vertices.Length)
                    throw new InvalidOperationException("Surface upload did not preserve a complete triangle mesh");

                var edgeRenderer = view.transform.Find("Edges")?.GetComponent<MeshRenderer>();
                if (edgeRenderer != null) edgeRenderer.enabled = false;
                var bounds = view.BboxMetres;
                if (bounds == null || bounds.Length != 6 || bounds.Any(value => double.IsNaN(value) || double.IsInfinity(value)))
                    throw new InvalidOperationException("Native mesh upload has invalid Unity-axis bounds");
                var center = new Vector3((float)((bounds[0] + bounds[3]) * .5),
                    (float)((bounds[1] + bounds[4]) * .5), (float)((bounds[2] + bounds[5]) * .5));
                var normal = normals.Aggregate(Vector3.zero, (sum, value) => sum + value);
                if (normal.sqrMagnitude < 1e-10f) normal = normals.First(value => value.sqrMagnitude > 1e-10f);
                normal.Normalize();
                var extents = new[] { bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2] };
                var span = (float)Math.Max(extents.Max(), .001);
                var unityAxis = Array.IndexOf(extents, extents.Max());
                var sectionAxis = unityAxis == 0 ? SectionAxis.X : unityAxis == 1 ? SectionAxis.Z : SectionAxis.Y;
                var sectionOffsetMm = (bounds[unityAxis] + bounds[unityAxis + 3]) * 500d;
                var sectionMinimumMm = bounds[unityAxis] * 1000d;
                var sectionMaximumMm = bounds[unityAxis + 3] * 1000d;
                var sectionInBounds = sectionOffsetMm >= sectionMinimumMm - 1e-6 &&
                    sectionOffsetMm <= sectionMaximumMm + 1e-6;
                if (!sectionInBounds)
                    throw new InvalidOperationException("Section plane midpoint falls outside the uploaded Unity-axis bounds");
                var section = SectionPlane.FromAxis(sectionAxis, sectionOffsetMm);
                var perViewSelection = native.featureType == "SurfaceOffset" || native.featureType == "SurfaceSew" ||
                    native.featureType == "SurfaceSweep" || native.featureType == "SurfaceTrim" ||
                    native.featureType == "SurfaceExtend" || isSewnSolid;
                var sewnGeometry = native.featureType == "SurfaceSew" || isSewnSolid;
                var dominantSide = unityAxis == 0 ? Vector3.right : unityAxis == 1 ? Vector3.up : Vector3.forward;
                var frontSide = sewnGeometry ? dominantSide : normal;
                var backSide = -frontSide;
                var obliquePerpendicular = unityAxis == 0 ? Vector3.up : Vector3.right;
                var obliqueSide = (dominantSide + obliquePerpendicular * .6f).normalized;

                var cameraObject = new GameObject("Offscreen surface camera");
                var camera = cameraObject.AddComponent<Camera>();
                camera.orthographic = true;
                camera.orthographicSize = span * (perViewSelection ? .8f : .7f);
                camera.nearClipPlane = .001f;
                camera.farClipPlane = span * 8 + .1f;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(.05f, .07f, .09f, 1);
                var up = Mathf.Abs(Vector3.Dot(frontSide, Vector3.up)) > .92f ? Vector3.right : Vector3.up;
                target = new RenderTexture(768, 768, 24) { antiAliasing = 4 };
                target.Create();
                camera.targetTexture = target;
                texture = new Texture2D(768, 768, TextureFormat.RGBA32, false);
                RenderSettings.ambientLight = Color.gray;
                var lightObject = new GameObject("Surface render key light");
                var light = lightObject.AddComponent<Light>();
                light.type = LightType.Directional;
                light.intensity = 1.4f;
                lightObject.transform.rotation = Quaternion.Euler(35, -25, 0);

                Color32[] RenderFrom(Vector3 side, string file)
                {
                    camera.transform.position = center + side * (span * 2 + .02f);
                    camera.transform.LookAt(center, up);
                    camera.Render();
                    var previous = RenderTexture.active;
                    try
                    {
                        RenderTexture.active = target;
                        texture.ReadPixels(new Rect(0, 0, 768, 768), 0, 0);
                        texture.Apply();
                    }
                    finally { RenderTexture.active = previous; }
                    File.WriteAllBytes(Path.Combine(output, file), texture.EncodeToPNG());
                    var pixels = texture.GetPixels32();
                    var background = pixels[0];
                    return pixels.Where(color =>
                        Math.Abs(color.r - background.r) + Math.Abs(color.g - background.g) +
                        Math.Abs(color.b - background.b) > 36).ToArray();
                }

                MeshSemanticHit SelectVisibleFace(Vector3 side, out int triangle)
                {
                    camera.transform.position = center + side * (span * 2 + .02f);
                    camera.transform.LookAt(center, up);
                    var useCentroidFallback = native.featureType == "SurfaceSweep" ||
                        native.featureType == "SurfaceTrim" || native.featureType == "SurfaceExtend" ||
                        native.featureType == "SurfaceThicken";
                    var ray = camera.ViewportPointToRay(new Vector3(.5f, .5f, 0));
                    var centerHit = view.TryRaycast(ray, null, root.transform, span * 4 + .1f,
                        out triangle, out _, out _);
                    var face = centerHit ? view.ResolveFace(triangle) : null;
                    if (face != null && (!useCentroidFallback ||
                        !string.IsNullOrEmpty(face.PersistentId))) return face;
                    if (!useCentroidFallback)
                        throw new InvalidOperationException(centerHit
                            ? "Visible native triangle has no semantic face reference"
                            : "Camera center ray did not hit a visible native face");

                    const int maxCentroidSamples = 4096;
                    const int maxCandidateRays = 64;
                    var triangleCount = indices.Length / 3;
                    var triangleStride = Math.Max(1, (triangleCount + maxCentroidSamples - 1) / maxCentroidSamples);
                    var candidates = new System.Collections.Generic.List<Vector3>();
                    for (var candidateTriangle = 0; candidateTriangle < triangleCount; candidateTriangle += triangleStride)
                    {
                        var offset = candidateTriangle * 3;
                        var a = vertices[indices[offset]];
                        var b = vertices[indices[offset + 1]];
                        var c = vertices[indices[offset + 2]];
                        var centroid = filter.transform.TransformPoint((a + b + c) / 3f);
                        var viewport = camera.WorldToViewportPoint(centroid);
                        if (viewport.z <= 0 || viewport.x < 0 || viewport.x > 1 || viewport.y < 0 || viewport.y > 1)
                            continue;
                        candidates.Add(viewport);
                    }
                    candidates.Sort((left, right) =>
                    {
                        var leftDelta = new Vector2(left.x - .5f, left.y - .5f);
                        var rightDelta = new Vector2(right.x - .5f, right.y - .5f);
                        var distance = leftDelta.sqrMagnitude.CompareTo(rightDelta.sqrMagnitude);
                        if (distance != 0) return distance;
                        var x = left.x.CompareTo(right.x);
                        return x != 0 ? x : left.y.CompareTo(right.y);
                    });
                    var candidateLimit = Math.Min(candidates.Count, maxCandidateRays);
                    for (var candidateIndex = 0; candidateIndex < candidateLimit; candidateIndex++)
                    {
                        var point = candidates[candidateIndex];
                        var candidateRay = camera.ViewportPointToRay(new Vector3(point.x, point.y, 0));
                        if (!view.TryRaycast(candidateRay, null, root.transform, span * 4 + .1f,
                            out triangle, out _, out _)) continue;
                        face = view.ResolveFace(triangle);
                        if (face != null && !string.IsNullOrEmpty(face.PersistentId)) return face;
                    }
                    throw new InvalidOperationException(native.featureType +
                        " camera and sampled mesh-centroid rays found no visible native face with a semantic reference");
                }

                var obliquePixels = sewnGeometry ? RenderFrom(obliqueSide, "oblique.png").Length : 0;
                var frontImage = RenderFrom(frontSide, "front.png");
                var backImage = RenderFrom(backSide, "back.png");
                var frontPixels = frontImage.Length;
                var backPixels = backImage.Length;
                var frontSelectionTriangle = -1;
                var backSelectionTriangle = -1;
                var frontSelectionFace = "";
                var backSelectionFace = "";
                bool frontSelectionChanged;
                bool backSelectionChanged;
                if (perViewSelection)
                {
                    var frontHit = SelectVisibleFace(frontSide, out frontSelectionTriangle);
                    frontSelectionFace = frontHit.PersistentId;
                    view.SelectFace(frontHit);
                    frontSelectionChanged = !RenderFrom(frontSide, "front-selected.png").SequenceEqual(frontImage);
                    view.ClearSelection();
                    var backHit = SelectVisibleFace(backSide, out backSelectionTriangle);
                    backSelectionFace = backHit.PersistentId;
                    view.SelectFace(backHit);
                    backSelectionChanged = !RenderFrom(backSide, "back-selected.png").SequenceEqual(backImage);
                }
                else
                {
                    var selectedFace = view.ResolveFace(0);
                    if (selectedFace == null)
                        throw new InvalidOperationException("Legacy native surface has no semantic face at triangle zero");
                    frontSelectionTriangle = 0;
                    backSelectionTriangle = 0;
                    frontSelectionFace = selectedFace.PersistentId;
                    backSelectionFace = selectedFace.PersistentId;
                    view.SelectFace(selectedFace);
                    frontSelectionChanged = !RenderFrom(frontSide, "front-selected.png").SequenceEqual(frontImage);
                    backSelectionChanged = !RenderFrom(backSide, "back-selected.png").SequenceEqual(backImage);
                }
                view.ClearSelection();
                view.ApplySection(section, root.transform, view.SectionCapMaterial, view.SectionContourMaterial);
                var contour = view.transform.Find("Section contour")?.GetComponent<MeshFilter>()?.sharedMesh;
                var contourIndices = contour != null ? (int)contour.GetIndexCount(0) : 0;
                var closedContour = IsClosedContour(contour);
                var capObject = view.transform.Find("Section cap");
                var capMesh = capObject != null ? capObject.GetComponent<MeshFilter>()?.sharedMesh : null;
                var capCollider = capObject != null ? capObject.GetComponent<MeshCollider>() : null;
                var sectionCapTriangles = capMesh != null ? capMesh.triangles.Length / 3 : 0;
                var sectionCapPresent = capMesh != null && sectionCapTriangles > 0;
                var sectionCapColliderMatches = sectionCapPresent && capCollider != null && capCollider.sharedMesh == capMesh;
                var noSectionCap = capObject == null;
                var sectionPixels = RenderFrom(frontSide, "section.png").Length;
                var sectionObliquePixels = sewnGeometry ? RenderFrom(obliqueSide, "section-oblique.png").Length : 0;
                var obliqueClippingVisible = sewnGeometry && obliquePixels > 0 && sectionObliquePixels > 0 &&
                    sectionObliquePixels < obliquePixels;
                var capOnlyExpectedVisibleSide = "";
                var sectionCapCull = -1;
                var capOnlyClippedSidePixels = 0;
                var capOnlyRetainedSidePixels = 0;
                var capOnlyMainBodyDisabled = false;
                var capOnlyOnlyCapRendererEnabled = false;
                var capVisibleFromClippedSide = false;
                var capCulledFromRetainedSide = false;
                var capOnlyRenderersRestored = false;
                if (isSewnSolid)
                {
                    var capRenderer = capObject != null ? capObject.GetComponent<MeshRenderer>() : null;
                    if (!sectionCapPresent || capRenderer == null)
                        throw new InvalidOperationException("Sewn solid GPU cap-only proof requires a rendered section cap");

                    // SectionSurface keeps SignedDistance >= 0 and clips the negative half-space.
                    // The generated solid cap faces that discarded exterior side, and Cull Back must expose it there.
                    var retainedSide = new Vector3((float)section.NormalX, (float)section.NormalZ, (float)section.NormalY);
                    if (section.Inverted) retainedSide = -retainedSide;
                    if (retainedSide.sqrMagnitude < 1e-10f)
                        throw new InvalidOperationException("Section clip half-space has no usable Unity-local normal");
                    var capOnlyRenderers = root.GetComponentsInChildren<MeshRenderer>(true);
                    var capOnlyRendererStates = capOnlyRenderers.Select(value => value.enabled).ToArray();
                    sectionCapCull = ReadCull(capRenderer.sharedMaterial);
                    capOnlyExpectedVisibleSide = "clipped-negative-half-space";
                    try
                    {
                        foreach (var candidate in capOnlyRenderers)
                            candidate.enabled = candidate == capRenderer;
                        capOnlyMainBodyDisabled = !renderer.enabled;
                        capOnlyOnlyCapRendererEnabled = capRenderer.enabled &&
                            capOnlyRenderers.Count(value => value.enabled) == 1;
                        capOnlyClippedSidePixels = RenderFrom(-retainedSide, "cap-only-clipped-side.png").Length;
                        capOnlyRetainedSidePixels = RenderFrom(retainedSide, "cap-only-retained-side.png").Length;
                        capVisibleFromClippedSide = capOnlyClippedSidePixels > 0;
                        capCulledFromRetainedSide = capOnlyRetainedSidePixels == 0;
                    }
                    finally
                    {
                        for (var index = 0; index < capOnlyRenderers.Length; index++)
                            capOnlyRenderers[index].enabled = capOnlyRendererStates[index];
                    }
                    capOnlyRenderersRestored = capOnlyRenderers.Select((value, index) =>
                        value.enabled == capOnlyRendererStates[index]).All(value => value);
                }
                view.ApplySection(null, root.transform, view.SectionCapMaterial, view.SectionContourMaterial);
                view.ApplyZebra(true, 16, 0);
                view.ApplyZebra(false, 16, 0);
                view.ApplyCurvature(true, .1f);
                view.ApplyCurvature(false, .1f);
                view.SetPreview(true);
                var previewMaterial = renderer.sharedMaterial;
                var previewCull = ReadCull(previewMaterial);
                view.SetPreview(false);
                var cullAfter = ReadCull(renderer.sharedMaterial);
                var twoSidedAfter = isSurface && HasCull(previewMaterial, 0) && HasCull(renderer.sharedMaterial, 0);
                var solidBackCullAfter = !isSurface && HasCull(previewMaterial, 2) && HasCull(renderer.sharedMaterial, 2);
                var backRestoredPixels = RenderFrom(backSide, "back-restored.png").Length;
                var identityPreserved = filter.sharedMesh == nativeMesh && collider.sharedMesh == colliderMesh &&
                    colliderMesh == nativeMesh && view.UploadVersion == uploadVersion &&
                    nativeMesh.vertices.SequenceEqual(vertices) && nativeMesh.normals.SequenceEqual(normals) &&
                    nativeMesh.triangles.SequenceEqual(indices);
                var shaderErrors = new[] { view.SurfaceMaterial.shader, view.PreviewMaterial.shader,
                        view.SectionCapMaterial.shader, view.SectionContourMaterial.shader }
                    .Distinct().SelectMany(shader => ShaderUtil.GetShaderMessages(shader))
                    .Where(message => message.severity.ToString() == "Error")
                    .Select(message => message.message).ToArray();
                var proof = new RenderProof
                {
                    source = native.source,
                    featureId = native.featureId,
                    featureType = native.featureType,
                    geometryKind = native.geometryKind,
                    solidCount = native.solidCount,
                    graphicsDevice = SystemInfo.graphicsDeviceType.ToString(),
                    meshSha256 = rawHash,
                    nativeSha256 = native.nativeSha256,
                    areaMm2 = native.areaMm2,
                    volumeMm3 = native.volumeMm3,
                    meshVolumeMm3 = source.VolumeMm3,
                    bounds = native.bounds,
                    unityBoundsMetres = bounds.ToArray(),
                    triangles = view.TriangleCount,
                    frontPixels = frontPixels,
                    backPixels = backPixels,
                    sectionPixels = sectionPixels,
                    obliquePixels = obliquePixels,
                    sectionObliquePixels = sectionObliquePixels,
                    backRestoredPixels = backRestoredPixels,
                    frontSelectionChanged = frontSelectionChanged,
                    backSelectionChanged = backSelectionChanged,
                    frontSelectionTriangle = frontSelectionTriangle,
                    backSelectionTriangle = backSelectionTriangle,
                    frontSelectionFace = frontSelectionFace,
                    backSelectionFace = backSelectionFace,
                    contourIndices = contourIndices,
                    sectionCapTriangles = sectionCapTriangles,
                    sectionCapPresent = sectionCapPresent,
                    sectionCapColliderMatches = sectionCapColliderMatches,
                    sectionCapCull = sectionCapCull,
                    capOnlyExpectedVisibleSide = capOnlyExpectedVisibleSide,
                    capOnlyClippedSidePixels = capOnlyClippedSidePixels,
                    capOnlyRetainedSidePixels = capOnlyRetainedSidePixels,
                    capOnlyMainBodyDisabled = capOnlyMainBodyDisabled,
                    capOnlyOnlyCapRendererEnabled = capOnlyOnlyCapRendererEnabled,
                    capVisibleFromClippedSide = capVisibleFromClippedSide,
                    capCulledFromRetainedSide = capCulledFromRetainedSide,
                    capOnlyRenderersRestored = capOnlyRenderersRestored,
                    obliqueClippingRequired = sewnGeometry,
                    obliqueClippingVisible = obliqueClippingVisible,
                    sectionAxis = sectionAxis.ToString(),
                    sectionUnityAxis = unityAxis,
                    sectionOffsetMm = sectionOffsetMm,
                    sectionMinimumMm = sectionMinimumMm,
                    sectionMaximumMm = sectionMaximumMm,
                    sectionInBounds = sectionInBounds,
                    cullBefore = cullBefore,
                    previewCull = previewCull,
                    cullAfter = cullAfter,
                    twoSidedBefore = twoSidedBefore,
                    twoSidedAfter = twoSidedAfter,
                    solidBackCullBefore = solidBackCullBefore,
                    solidBackCullAfter = solidBackCullAfter,
                    noSectionCap = noSectionCap,
                    closedContour = closedContour,
                    identityPreserved = identityPreserved,
                    surfaceGeometry = view.IsSurfaceGeometry,
                    volumeMatches = volumeMatches,
                    shaderErrors = shaderErrors,
                };
                File.WriteAllText(Path.Combine(output, "gpu-proof.json"), JsonUtility.ToJson(proof, true));
                var modeRestored = isSurface
                    ? proof.twoSidedBefore && proof.twoSidedAfter
                    : proof.solidBackCullBefore && proof.solidBackCullAfter;
                var capVerified = isSurface
                    ? proof.noSectionCap
                    : proof.sectionCapPresent && proof.sectionCapColliderMatches;
                var sewnSolidCapRenderVerified = !isSewnSolid ||
                    (proof.sectionCapCull == 2 && proof.capOnlyMainBodyDisabled &&
                     proof.capOnlyOnlyCapRendererEnabled && proof.capVisibleFromClippedSide &&
                     proof.capCulledFromRetainedSide && proof.capOnlyRenderersRestored);
                var sectionPixelsMustReduce = !perViewSelection || native.featureType == "SurfaceOffset" ||
                    native.featureType == "SurfaceSweep" || native.featureType == "SurfaceTrim" ||
                    native.featureType == "SurfaceExtend";
                var sectionPixelsNotReduced = sectionPixelsMustReduce && sectionPixels >= frontPixels;
                if (frontPixels < 1000 || backPixels < 1000 || sectionPixels <= 0 || sectionPixelsNotReduced ||
                    backRestoredPixels != backPixels || contourIndices == 0 || !capVerified || !sectionInBounds ||
                    !frontSelectionChanged || !backSelectionChanged || string.IsNullOrEmpty(frontSelectionFace) ||
                    string.IsNullOrEmpty(backSelectionFace) || !volumeMatches ||
                    ((native.featureType == "SurfaceRevolve" || isSewnSolid) && !closedContour) ||
                    !sewnSolidCapRenderVerified ||
                    (sewnGeometry && !obliqueClippingVisible) ||
                    !modeRestored || proof.surfaceGeometry != isSurface || !identityPreserved || shaderErrors.Length > 0)
                    throw new InvalidOperationException("Actual native surface/solid GPU verification failed");
            }
            finally
            {
                if (target != null) { target.Release(); UnityEngine.Object.DestroyImmediate(target); }
                if (texture != null) UnityEngine.Object.DestroyImmediate(texture);
                foreach (var material in materials) UnityEngine.Object.DestroyImmediate(material);
                RenderSettings.ambientLight = previousAmbient;
                if (previousScene.IsValid() && previousScene.isLoaded)
                    SceneManager.SetActiveScene(previousScene);
                if (captureScene.IsValid() && captureScene.isLoaded)
                {
                    if (temporaryBatchScene) EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                    else EditorSceneManager.CloseScene(captureScene, true);
                }
            }
        }

        static bool IsClosedContour(Mesh contour)
        {
            if (contour == null) return false;
            var vertices = contour.vertices;
            var indices = contour.GetIndices(0);
            if (indices.Length < 6 || indices.Length % 2 != 0) return false;
            var degree = new System.Collections.Generic.Dictionary<string, int>();
            void Add(Vector3 point)
            {
                var key = Math.Round(point.x * 1e7d).ToString(CultureInfo.InvariantCulture) + "," +
                    Math.Round(point.y * 1e7d).ToString(CultureInfo.InvariantCulture) + "," +
                    Math.Round(point.z * 1e7d).ToString(CultureInfo.InvariantCulture);
                degree.TryGetValue(key, out var value);
                degree[key] = value + 1;
            }
            for (var i = 0; i < indices.Length; i += 2)
            {
                var a = indices[i];
                var b = indices[i + 1];
                if (a < 0 || b < 0 || a >= vertices.Length || b >= vertices.Length) return false;
                if (vertices[a] == vertices[b]) return false;
                Add(vertices[a]);
                Add(vertices[b]);
            }
            return degree.Count >= 3 && degree.Values.All(value => value == 2);
        }

        static int ReadCull(Material material)
        {
            return material != null && material.HasProperty("_Cull")
                ? Mathf.RoundToInt(material.GetFloat("_Cull"))
                : -1;
        }

        static bool HasCull(Material material, float expected)
        {
            return material != null && material.HasProperty("_Cull") &&
                Mathf.Abs(material.GetFloat("_Cull") - expected) < 1e-6f;
        }

        static string Hash(byte[] bytes)
        {
            using (var sha = SHA256.Create())
                return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
        }

    }
}
