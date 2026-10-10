using System;
using System.IO;
using System.Linq;
using Kreoda.QuestRuntime;
using Meta.XR;
using UnityEditor;
using UnityEditor.Android;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEditor.XR.Management;
using UnityEditor.XR.Management.Metadata;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.XR.Management;
using UnityEngine.XR.OpenXR;
using UnityEngine.XR.OpenXR.Features.Interactions;
using UnityEditor.XR.OpenXR.Features;

namespace Kreoda.QuestEditor
{
    public static class QuestBuild
    {
        const string ScenePath = "Assets/Kreoda/Scenes/KreodaQuest.unity";

        public static void Prepare()
        {
            Directory.CreateDirectory("Assets/Kreoda/Scenes");
            Directory.CreateDirectory("Assets/Kreoda/Materials");
            Directory.CreateDirectory("Assets/Kreoda/Settings");
            AssetDatabase.Refresh();
            ConfigureXr();
            PlayerSettings.companyName = "Kreoda";
            PlayerSettings.productName = "Kreoda Quest";
            PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.Android, "com.kreoda.quest");
            PlayerSettings.bundleVersion = "0.1.0";
            PlayerSettings.Android.bundleVersionCode = 1;
            PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel29;
            PlayerSettings.Android.targetSdkVersion = AndroidSdkVersions.AndroidApiLevelAuto;
            PlayerSettings.SetScriptingBackend(NamedBuildTarget.Android, ScriptingImplementation.IL2CPP);
            PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;
            PlayerSettings.Android.applicationEntry = AndroidApplicationEntry.Activity;
            PlayerSettings.SetApiCompatibilityLevel(NamedBuildTarget.Android, ApiCompatibilityLevel.NET_Standard);
            PlayerSettings.SetManagedStrippingLevel(NamedBuildTarget.Android, ManagedStrippingLevel.Low);
            PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.Android, false);
            PlayerSettings.SetGraphicsAPIs(BuildTarget.Android, new[] { GraphicsDeviceType.Vulkan });
            PlayerSettings.colorSpace = ColorSpace.Linear;
            QualitySettings.antiAliasing = 4;
            var config = OVRProjectConfig.CachedProjectConfig;
            if (config == null) throw new InvalidOperationException("Meta project config not ready");
            config.handTrackingSupport = OVRProjectConfig.HandTrackingSupport.ControllersAndHands;
            config.requiresSystemKeyboard = true;
            config.focusAware = true;
            config.insightPassthroughSupport = OVRProjectConfig.FeatureSupport.Supported;
            config.isPassthroughCameraAccessEnabled = false;
            OVRProjectConfig.CommitProjectConfig(config);

            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(
                "Packages/com.meta.xr.sdk.core/Prefabs/OVRCameraRig.prefab");
            if (prefab == null) throw new InvalidOperationException("Meta camera rig prefab missing");
            var rigObject = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
            rigObject.name = "Quest tracking";
            var rig = rigObject.GetComponent<OVRCameraRig>();
            var manager = rigObject.GetComponent<OVRManager>();
            if (manager == null) manager = rigObject.AddComponent<OVRManager>();
            manager.trackingOriginType = OVRManager.TrackingOrigin.FloorLevel;
            manager.isInsightPassthroughEnabled = true;
            rig.centerEyeAnchor.GetComponent<Camera>().tag = "MainCamera";
            var left = rig.leftHandAnchor.GetComponent<OVRHand>();
            if (left == null) left = rig.leftHandAnchor.gameObject.AddComponent<OVRHand>();
            SetHand(left, OVRHand.Hand.HandLeft, rig.trackingSpace);
            var right = rig.rightHandAnchor.GetComponent<OVRHand>();
            if (right == null) right = rig.rightHandAnchor.gameObject.AddComponent<OVRHand>();
            SetHand(right, OVRHand.Hand.HandRight, rig.trackingSpace);
            var display = new GameObject("CAD display (metres, independent placement)").transform;
            display.position = new Vector3(0, 1.0f, 1.0f);
            var connection = new GameObject("CAD session").AddComponent<QuestConnection>();
            connection.DisplayRoot = display;
            connection.SurfaceMaterial = Material("Surface", "Standard", new Color(.63f, .71f, .78f));
            connection.EdgeMaterial = Material("Edges", "Unlit/Color", new Color(.06f, .1f, .15f));
            connection.SelectionMaterial = Material("Selection", "Kreoda/Selection", new Color(0, .8f, 1f, .45f));
            connection.PreviewMaterial = Material("Preview", "Kreoda/Selection", new Color(0, .7f, 1f, .22f));
            var controls = new GameObject("Compact Quest controls").AddComponent<QuestControls>();
            controls.Connection = connection;
            controls.Rig = rig;
            controls.LeftHand = left;
            controls.RightHand = right;
            controls.Font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            controls.PanelMaterial = Material("Panel", "Unlit/Color", new Color(.035f, .05f, .075f));
            controls.ButtonMaterial = Material("Buttons", "Unlit/Color", new Color(.09f, .15f, .22f));
            controls.RayMaterial = Material("Ray", "Unlit/Color", new Color(0, .8f, 1f));
            var placement = new GameObject("Independent physical placement").AddComponent<QuestDisplay>();
            placement.Connection = connection;
            placement.Rig = rig;
            placement.MarkerMaterial = controls.RayMaterial;
            var environment = new GameObject("MR with neutral VR fallback").AddComponent<QuestEnvironment>();
            environment.Rig = rig; environment.Manager = manager; environment.Connection = connection;
            environment.Layer = rigObject.AddComponent<OVRPassthroughLayer>();
            var reference = GameObject.CreatePrimitive(PrimitiveType.Cube);
            reference.name = "VR reference floor";
            reference.transform.position = new Vector3(0, -.005f, 1);
            reference.transform.localScale = new Vector3(3, .01f, 3);
            reference.GetComponent<Collider>().enabled = false;
            reference.GetComponent<MeshRenderer>().sharedMaterial = Material("VrFloor", "Unlit/Color", new Color(.07f, .09f, .12f));
            environment.VrReference = reference;
            controls.Display = placement; controls.Environment = environment;
            var light = new GameObject("CAD light").AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = 1.2f;
            light.transform.rotation = Quaternion.Euler(50, -30, 0);
            RenderSettings.ambientLight = new Color(.4f, .4f, .4f);
            EditorSceneManager.SaveScene(scene, ScenePath);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
            AssetDatabase.SaveAssets();
            // Meta's processor preserves custom network/application attributes.
            OVRManifestPreprocessor.GenerateOrUpdateAndroidManifest(true);
        }

        static Material Material(string name, string shaderName, Color color)
        {
            var path = "Assets/Kreoda/Materials/" + name + ".mat";
            var material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                var shader = Shader.Find(shaderName);
                if (shader == null) throw new InvalidOperationException("Referenced shader missing: " + shaderName);
                material = new Material(shader);
                AssetDatabase.CreateAsset(material, path);
            }
            material.color = color;
            EditorUtility.SetDirty(material);
            return material;
        }

        static void SetHand(OVRHand hand, OVRHand.Hand side, Transform trackingSpace)
        {
            // Core207 exposes hand side to the Inspector as an internal field.
            var serialized = new SerializedObject(hand);
            serialized.FindProperty("HandType").intValue = (int)side;
            serialized.FindProperty("_pointerPoseRoot").objectReferenceValue = trackingSpace;
            serialized.ApplyModifiedPropertiesWithoutUndo();
        }

        static void ConfigureXr()
        {
            if (!EditorBuildSettings.TryGetConfigObject<XRGeneralSettingsPerBuildTarget>(XRGeneralSettings.k_SettingsKey, out var targets))
            {
                targets = ScriptableObject.CreateInstance<XRGeneralSettingsPerBuildTarget>();
                AssetDatabase.CreateAsset(targets, "Assets/Kreoda/Settings/XRGeneralSettings.asset");
                EditorBuildSettings.AddConfigObject(XRGeneralSettings.k_SettingsKey, targets, true);
            }
            if (!targets.HasSettingsForBuildTarget(BuildTargetGroup.Android))
                targets.CreateDefaultSettingsForBuildTarget(BuildTargetGroup.Android);
            if (!targets.HasManagerSettingsForBuildTarget(BuildTargetGroup.Android))
                targets.CreateDefaultManagerSettingsForBuildTarget(BuildTargetGroup.Android);
            var android = targets.SettingsForBuildTarget(BuildTargetGroup.Android);
            android.InitManagerOnStart = true;
            if (!XRPackageMetadataStore.AssignLoader(android.Manager, "UnityEngine.XR.OpenXR.OpenXRLoader", BuildTargetGroup.Android))
                throw new InvalidOperationException("OpenXR loader assignment failed");
            var featureSet = OpenXRFeatureSetManager.GetFeatureSetWithId(BuildTargetGroup.Android, "com.meta.openxr.featureset.metaxr");
            if (featureSet == null) throw new InvalidOperationException("Meta OpenXR feature set missing");
            featureSet.isEnabled = true;
            OpenXRFeatureSetManager.SetFeaturesFromEnabledFeatureSets(BuildTargetGroup.Android);
            var settings = OpenXRSettings.GetSettingsForBuildTargetGroup(BuildTargetGroup.Android);
            settings.GetFeature<MetaXRFeature>().enabled = true;
            settings.GetFeature<OculusTouchControllerProfile>().enabled = true;
            settings.renderMode = OpenXRSettings.RenderMode.SinglePassInstanced;
            EditorUtility.SetDirty(settings);
            EditorUtility.SetDirty(targets);
            AssetDatabase.SaveAssets();
        }

        public static void Build()
        {
            if (!File.Exists(ScenePath)) Prepare();
            ValidatePrepared();
            var sdk = Environment.GetEnvironmentVariable("KREODA_ANDROID_SDK");
            if (string.IsNullOrEmpty(sdk) || !Directory.Exists(sdk)) throw new InvalidOperationException("Android SDK path missing");
            AndroidExternalToolsSettings.sdkRootPath = sdk;
            var androidTools = Path.Combine(EditorApplication.applicationContentsPath, "PlaybackEngines", "AndroidPlayer");
            AndroidExternalToolsSettings.jdkRootPath = Path.Combine(androidTools, "OpenJDK");
            AndroidExternalToolsSettings.ndkRootPath = Path.Combine(androidTools, "NDK");
            var apk = Environment.GetEnvironmentVariable("KREODA_APK_PATH");
            if (string.IsNullOrEmpty(apk) || !Path.IsPathRooted(apk)) throw new InvalidOperationException("APK destination missing");
            var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions { scenes = new[] { ScenePath },
                locationPathName = apk, target = BuildTarget.Android, options = BuildOptions.None });
            var evidence = new BuildEvidence { result = report.summary.result.ToString(),
                totalBytes = report.summary.totalSize, seconds = report.summary.totalTime.TotalSeconds,
                errors = report.summary.totalErrors, warnings = report.summary.totalWarnings,
                output = report.summary.outputPath };
            File.WriteAllText(Environment.GetEnvironmentVariable("KREODA_BUILD_REPORT"), JsonUtility.ToJson(evidence, true));
            if (report.summary.result != BuildResult.Succeeded) throw new InvalidOperationException("Quest build failed");
        }

        static void ValidatePrepared()
        {
            EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            var connection = UnityEngine.Object.FindFirstObjectByType<QuestConnection>();
            var controls = UnityEngine.Object.FindFirstObjectByType<QuestControls>();
            var xr = XRGeneralSettingsPerBuildTarget.XRGeneralSettingsForBuildTarget(BuildTargetGroup.Android);
            if (connection == null || controls == null || controls.Connection != connection || controls.Rig == null ||
                connection.DisplayRoot == null || connection.SurfaceMaterial == null || connection.EdgeMaterial == null ||
                connection.SelectionMaterial == null || connection.PreviewMaterial == null ||
                connection.PreviewMaterial == connection.SelectionMaterial || controls.Font == null || controls.LeftHand == null || controls.RightHand == null ||
                connection.TriangleBudget <= 0 || controls.Display == null || controls.Environment == null ||
                controls.Environment.Layer == null || controls.Environment.VrReference == null ||
                xr == null || !xr.InitManagerOnStart || !xr.Manager.activeLoaders.Any(loader => loader is OpenXRLoader) ||
                PlayerSettings.GetScriptingBackend(NamedBuildTarget.Android) != ScriptingImplementation.IL2CPP ||
                PlayerSettings.Android.targetArchitectures != AndroidArchitecture.ARM64)
                throw new InvalidOperationException("Populated ARM64 Quest scene/settings are incomplete; run QuestBuild.Prepare");
        }

        [Serializable]
        sealed class BuildEvidence
        {
            public string result, output;
            public ulong totalBytes;
            public double seconds;
            public int errors, warnings;
        }
    }
}
