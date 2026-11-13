using System;
using System.Collections.Generic;
using System.Runtime.CompilerServices;
using UnityEngine;
using UnityEngine.Android;

[assembly: InternalsVisibleTo("Kreoda.QuestRuntime.Tests")]

namespace Kreoda.QuestRuntime
{
    /// <summary>
    /// Opt-in bridge to Meta Room Setup anchors. Never treats passthrough images,
    /// CAD geometry or arbitrary Unity colliders as sensed physical surfaces.
    /// Uses the bundled (deprecated) Meta XR Core 207 Scene API until a supported
    /// MRUK migration can be independently validated on a headset.
    /// </summary>
    public sealed class QuestRoomSurfaceProvider : MonoBehaviour
    {
        public const string ScenePermission = "com.oculus.permission.USE_SCENE";
        const float MaxContactDistance = 5f;
        const int MaxBoundaryVertices = 256;
        const float MinPolygonArea = .000001f;

#pragma warning disable CS0618 // SDK207 still ships this optional legacy Scene API.
        public OVRSceneManager SceneManager;
#pragma warning restore CS0618

        public bool OptedIn => _optedIn;
        public bool SceneLoaded => _sceneLoaded;
        public string Status { get; private set; } = "Rilevamento stanza disattivato · posizionamento manuale";

        bool _optedIn, _sceneLoaded, _roomMissing, _captureRequested, _subscribed;
        bool _loadInFlight, _invalidateAfterLoad, _paused, _focused = true;
        uint _generation, _loadGeneration;
        PermissionCallbacks _permissionCallbacks;
        readonly List<OVRSceneAnchor> _anchors = new List<OVRSceneAnchor>();
        readonly List<RoomPlaneSnapshot> _snapshots = new List<RoomPlaneSnapshot>();

        /// <summary>
        /// Explicit action entry point for QuestControls when that worker is
        /// ready to wire the UI. Creates no scene manager at app startup.
        /// The inactive template is not a detected room object or collider.
        /// </summary>
        public static QuestRoomSurfaceProvider OptInFromUserAction()
        {
            if (!Application.isPlaying) return null;
            var existing = FindFirstObjectByType<QuestRoomSurfaceProvider>();
            if (existing != null)
            {
                existing.BeginDiscovery();
                return existing;
            }
            // Do not create a second manager: the legacy SDK destroys duplicates.
            if (FindFirstObjectByType<OVRSceneManager>() != null) return null;

            var root = new GameObject("Optional Meta room planes (user enabled)");
#pragma warning disable CS0618
            var manager = root.AddComponent<OVRSceneManager>();
            var template = new GameObject("Inactive Meta scene anchor template");
            template.transform.SetParent(root.transform, false);
            template.SetActive(false);
            var anchorTemplate = template.AddComponent<OVRSceneAnchor>();
            // Furniture is commonly a Bounded3D anchor with a Bounded2D top;
            // the SDK requires BOTH prefabs to instantiate those variants.
            manager.PlanePrefab = anchorTemplate;
            manager.VolumePrefab = anchorTemplate;
#pragma warning restore CS0618
            manager.ActiveRoomsOnly = true;
            var provider = root.AddComponent<QuestRoomSurfaceProvider>();
            provider.SceneManager = manager;
            provider.BeginDiscovery();
            return provider;
        }

        /// <summary>
        /// A real application action must call this method. No permission prompt,
        /// room scan, or query is launched from Awake/OnEnable/Start.
        /// </summary>
        public void BeginDiscovery()
        {
            StopDiscovery();
            if (!isActiveAndEnabled)
            {
                Status = "Rilevamento stanza non disponibile";
                return;
            }
            EnsureSubscriptions();
            if (SceneManager == null)
            {
                Status = "Supporto ancore non configurato · posizionamento manuale";
                return;
            }

            if (Application.platform != RuntimePlatform.Android)
            {
                Status = "Ancore ambientali disponibili solo su Quest · posizionamento manuale";
                return;
            }

            _optedIn = true;
            if (_loadInFlight)
            {
                Status = "Caricamento precedente in corso · posizionamento manuale";
                return;
            }
            if (Permission.HasUserAuthorizedPermission(ScenePermission))
            {
                LoadScene();
                return;
            }

            var requestGeneration = _generation;
            var callbacks = new PermissionCallbacks();
            callbacks.PermissionGranted += _ =>
            {
                if (!_optedIn || requestGeneration != _generation) return;
                if (!Permission.HasUserAuthorizedPermission(ScenePermission)) { Denied(); return; }
                LoadScene();
            };
            callbacks.PermissionDenied += _ =>
            {
                if (requestGeneration == _generation) Denied();
            };
            callbacks.PermissionDeniedAndDontAskAgain += _ =>
            {
                if (requestGeneration == _generation) Denied();
            };
            _permissionCallbacks = callbacks;
            Status = "Permesso dati spaziali richiesto · nessuna superficie verificata";
            Permission.RequestUserPermission(ScenePermission, callbacks);
        }

        public void StopDiscovery()
        {
            _generation++;
            _optedIn = _sceneLoaded = _roomMissing = _captureRequested = false;
            _permissionCallbacks = null;
            _anchors.Clear();
            _snapshots.Clear();
            Status = "Rilevamento stanza disattivato · posizionamento manuale";
        }

        /// <summary>
        /// Only call from a second, explicit Room Setup user action after no
        /// room data was found. The normal opt-in NEVER starts Scene Capture.
        /// </summary>
        public bool RequestRoomSetup()
        {
            if (Application.platform != RuntimePlatform.Android ||
                !_optedIn || !_roomMissing || _captureRequested || _loadInFlight ||
                SceneManager == null || !_focused || _paused ||
                !Permission.HasUserAuthorizedPermission(ScenePermission)) return false;

            _sceneLoaded = false;
            _captureRequested = true;
            if (SceneManager.RequestSceneCapture())
            {
                Status = "Scansione stanza richiesta sul visore · risultato in attesa";
                return true;
            }

            _captureRequested = false;
            Status = "Scansione stanza non avviata · posizionamento manuale";
            return false;
        }

        /// <summary>
        /// Only loaded, currently tracked Meta scene anchors are allowed here.
        /// Returning true means an SDK-reported table plane intersection, NOT
        /// physical accuracy/comfort validated by a headset wearer.
        /// </summary>
        public bool TryGetTableContact(Ray ray, out SurfaceHit hit)
        {
            hit = default;
            if (Application.platform != RuntimePlatform.Android ||
                !_optedIn || !_sceneLoaded || !_focused || _paused ||
                !isActiveAndEnabled || SceneManager == null ||
                !Permission.HasUserAuthorizedPermission(ScenePermission)) return false;

            _anchors.Clear();
            _snapshots.Clear();
            OVRSceneAnchor.GetSceneAnchors(_anchors);
            foreach (var anchor in _anchors)
            {
                if (anchor == null || !anchor.isActiveAndEnabled ||
                    !anchor.Space.Valid || !anchor.IsTracked) continue;
                if (!OVRPlugin.TryLocateSpace(anchor.Space, OVRPlugin.GetTrackingOriginType(),
                        out _, out var flags) || !flags.IsPositionValid() || !flags.IsOrientationValid()) continue;
                if (!anchor.TryGetComponent<OVRSemanticClassification>(out var semantic) ||
                    !anchor.TryGetComponent<OVRScenePlane>(out var plane)) continue;

                _snapshots.Add(new RoomPlaneSnapshot
                {
                    AnchorId = anchor.Uuid,
                    FromSceneAnchor = true,
                    SpaceValid = true,
                    Tracked = true,
                    HasBoundedPlane = true,
                    Labels = semantic.Labels,
                    LocalToWorld = anchor.transform.localToWorldMatrix,
                    Boundary = plane.Boundary
                });
            }
            return TryFindInSnapshots(ray, _snapshots, true, true, out hit);
        }

        void Denied()
        {
            _sceneLoaded = false;
            _roomMissing = false;
            Status = "Accesso ai dati spaziali negato · posizionamento manuale";
        }

        void LoadScene()
        {
            _sceneLoaded = _roomMissing = false;
            if (!_optedIn || SceneManager == null ||
                !Permission.HasUserAuthorizedPermission(ScenePermission))
            {
                Denied();
                return;
            }
            if (_loadInFlight)
            {
                _invalidateAfterLoad = true;
                Status = "Ricaricamento stanza in attesa · posizionamento manuale";
                return;
            }
            _loadInFlight = true;
            _loadGeneration = _generation;
            _invalidateAfterLoad = false;
            Status = "Caricamento ancore ambientali · posizionamento manuale disponibile";
            if (!SceneManager.LoadSceneModel())
            {
                _loadInFlight = false;
                Status = "Caricamento stanza non avviato · posizionamento manuale";
            }
        }

        void EnsureSubscriptions()
        {
            if (_subscribed) return;
            if (SceneManager == null) SceneManager = GetComponent<OVRSceneManager>();
            if (SceneManager == null) return;
            SceneManager.SceneModelLoadedSuccessfully += OnSceneLoaded;
            SceneManager.LoadSceneModelFailedPermissionNotGranted += OnPermissionMissing;
            SceneManager.NoSceneModelToLoad += OnRoomMissing;
            SceneManager.NewSceneModelAvailable += OnRoomChanged;
            SceneManager.SceneCaptureReturnedWithoutError += OnCaptureReturned;
            SceneManager.UnexpectedErrorWithSceneCapture += OnCaptureFailed;
            _subscribed = true;
        }

        void RemoveSubscriptions()
        {
            if (!_subscribed || SceneManager == null) return;
            SceneManager.SceneModelLoadedSuccessfully -= OnSceneLoaded;
            SceneManager.LoadSceneModelFailedPermissionNotGranted -= OnPermissionMissing;
            SceneManager.NoSceneModelToLoad -= OnRoomMissing;
            SceneManager.NewSceneModelAvailable -= OnRoomChanged;
            SceneManager.SceneCaptureReturnedWithoutError -= OnCaptureReturned;
            SceneManager.UnexpectedErrorWithSceneCapture -= OnCaptureFailed;
            _subscribed = false;
        }

        void OnEnable() => EnsureSubscriptions();
        void OnDisable() { StopDiscovery(); RemoveSubscriptions(); }
        void OnDestroy() { StopDiscovery(); RemoveSubscriptions(); }

        void OnSceneLoaded()
        {
            if (!AcceptLoadCompletion()) return;
            if (!Permission.HasUserAuthorizedPermission(ScenePermission)) { Denied(); return; }
            _sceneLoaded = true;
            _roomMissing = _captureRequested = false;
            Status = "Ancore ambientali caricate · allineamento reale da verificare";
        }

        void OnPermissionMissing()
        {
            if (AcceptLoadCompletion()) Denied();
        }
        void OnRoomMissing()
        {
            if (!AcceptLoadCompletion()) return;
            _sceneLoaded = false;
            _roomMissing = true;
            _captureRequested = false;
            Status = "Nessuna stanza configurata · scansione solo su richiesta esplicita";
        }
        void OnRoomChanged()
        {
            if (!_optedIn) return;
            _sceneLoaded = false;
            if (_loadInFlight) _invalidateAfterLoad = true;
            else if (Permission.HasUserAuthorizedPermission(ScenePermission)) LoadScene();
            else Denied();
        }
        void OnCaptureReturned()
        {
            if (!_optedIn || !_captureRequested) return;
            _captureRequested = false;
            LoadScene();
        }
        void OnCaptureFailed()
        {
            if (!_optedIn) return;
            _captureRequested = _sceneLoaded = false;
            Status = "Scansione stanza non riuscita · posizionamento manuale";
        }

        void OnApplicationPause(bool paused)
        {
            _paused = paused;
            if (paused)
            {
                _sceneLoaded = false;
                if (_loadInFlight) _invalidateAfterLoad = true;
            }
            else if (_optedIn && isActiveAndEnabled && _focused)
            {
                if (Permission.HasUserAuthorizedPermission(ScenePermission)) LoadScene();
                else Denied();
            }
        }
        void OnApplicationFocus(bool focused)
        {
            _focused = focused;
            if (!focused)
            {
                _sceneLoaded = false;
                if (_loadInFlight) _invalidateAfterLoad = true;
            }
            else if (_optedIn && !_paused && isActiveAndEnabled)
            {
                if (Permission.HasUserAuthorizedPermission(ScenePermission)) LoadScene();
                else Denied();
            }
        }

        // Meta's event does not contain a request ID. Never issue two overlapping
        // requests; discard any completion from a previous opt-in generation.
        bool AcceptLoadCompletion()
        {
            if (!_loadInFlight) return false;
            var fresh = _loadGeneration == _generation && !_invalidateAfterLoad &&
                        _optedIn && !_paused && _focused;
            _loadInFlight = false;
            _invalidateAfterLoad = false;
            if (!fresh && _optedIn && !_paused && _focused &&
                Permission.HasUserAuthorizedPermission(ScenePermission)) LoadScene();
            return fresh;
        }

        public readonly struct SurfaceHit
        {
            public readonly Guid AnchorId;
            public readonly Vector3 Point;
            public readonly float DistanceMetres;

            internal SurfaceHit(Guid id, Vector3 point, float distanceMetres)
            {
                AnchorId = id;
                Point = point;
                DistanceMetres = distanceMetres;
            }
        }

        // Pure snapshot contract for Editor tests. In production its sole
        // producer is TryGetTableContact's genuine OVRSceneAnchor enumeration.
        internal sealed class RoomPlaneSnapshot
        {
            internal Guid AnchorId;
            internal bool FromSceneAnchor, SpaceValid, Tracked, HasBoundedPlane;
            internal IReadOnlyList<string> Labels;
            internal Matrix4x4 LocalToWorld;
            internal IReadOnlyList<Vector2> Boundary;
        }

        internal static bool TryFindInSnapshots(Ray ray, IEnumerable<RoomPlaneSnapshot> planes,
            bool permissionGranted, bool sceneLoaded, out SurfaceHit hit)
        {
            hit = default;
            if (!permissionGranted || !sceneLoaded || planes == null ||
                !Finite(ray.origin) || !Finite(ray.direction) ||
                ray.direction.sqrMagnitude < .000001f) return false;

            var normalizedDirection = ray.direction.normalized;
            var nearest = MaxContactDistance + 1f;
            foreach (var plane in planes)
            {
                if (plane == null || !plane.FromSceneAnchor || !plane.SpaceValid ||
                    !plane.Tracked || !plane.HasBoundedPlane || plane.AnchorId == Guid.Empty ||
                    !TableOrDesk(plane.Labels) || !ValidBoundary(plane.Boundary) ||
                    !Finite(plane.LocalToWorld)) continue;

                var origin = plane.LocalToWorld.MultiplyPoint3x4(Vector3.zero);
                var x = plane.LocalToWorld.MultiplyVector(Vector3.right);
                var y = plane.LocalToWorld.MultiplyVector(Vector3.up);
                var normal = plane.LocalToWorld.MultiplyVector(Vector3.forward);
                if (!Finite(origin) || !Finite(x) || !Finite(y) || !Finite(normal) ||
                    Mathf.Abs(x.magnitude - 1f) > .05f || Mathf.Abs(y.magnitude - 1f) > .05f ||
                    Mathf.Abs(normal.magnitude - 1f) > .05f || Mathf.Abs(Vector3.Dot(x, y)) > .02f ||
                    Mathf.Abs(Vector3.Dot(x, normal)) > .02f ||
                    Mathf.Abs(Vector3.Dot(y, normal)) > .02f ||
                    normal.y < .65f) continue;

                var denom = Vector3.Dot(normal, normalizedDirection);
                if (Mathf.Abs(denom) < .00001f) continue;
                var distance = Vector3.Dot(origin - ray.origin, normal) / denom;
                if (!Finite(distance) || distance < .01f || distance > MaxContactDistance ||
                    distance >= nearest) continue;
                var point = ray.origin + normalizedDirection * distance;
                if (!Finite(point)) continue;
                var local = plane.LocalToWorld.inverse.MultiplyPoint3x4(point);
                if (!Finite(local) || Mathf.Abs(local.z) > .002f ||
                    !InsideBoundary(new Vector2(local.x, local.y), plane.Boundary)) continue;

                nearest = distance;
                hit = new SurfaceHit(plane.AnchorId, point, distance);
            }
            return hit.AnchorId != Guid.Empty;
        }

        static bool TableOrDesk(IReadOnlyList<string> labels)
        {
            if (labels == null) return false;
            foreach (var label in labels)
                if (string.Equals(label, "TABLE", StringComparison.Ordinal) ||
                    string.Equals(label, "DESK", StringComparison.Ordinal)) return true;
            return false;
        }

        static bool ValidBoundary(IReadOnlyList<Vector2> boundary)
        {
            if (boundary == null || boundary.Count < 3 || boundary.Count > MaxBoundaryVertices)
                return false;
            double twiceArea = 0;
            for (var i = 0; i < boundary.Count; i++)
            {
                var a = boundary[i];
                var b = boundary[(i + 1) % boundary.Count];
                if (!Finite(a) || !Finite(b)) return false;
                twiceArea += (double)a.x * b.y - (double)b.x * a.y;
            }
            return !double.IsNaN(twiceArea) && !double.IsInfinity(twiceArea) &&
                   Math.Abs(twiceArea) > 2 * MinPolygonArea;
        }

        static bool InsideBoundary(Vector2 point, IReadOnlyList<Vector2> polygon)
        {
            var inside = false;
            for (int i = 0, j = polygon.Count - 1; i < polygon.Count; j = i++)
            {
                var a = polygon[j];
                var b = polygon[i];
                var edge = b - a;
                var toPoint = point - a;
                var cross = edge.x * toPoint.y - edge.y * toPoint.x;
                if (Mathf.Abs(cross) <= .00001f &&
                    Vector2.Dot(toPoint, edge) >= -.00001f &&
                    Vector2.Dot(point - b, edge) <= .00001f) return true;
                if ((a.y > point.y) != (b.y > point.y) &&
                    point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
            }
            return inside;
        }

        static bool Finite(float n) => !float.IsNaN(n) && !float.IsInfinity(n);
        static bool Finite(Vector2 v) => Finite(v.x) && Finite(v.y);
        static bool Finite(Vector3 v) => Finite(v.x) && Finite(v.y) && Finite(v.z);
        static bool Finite(Matrix4x4 m)
        {
            for (var i = 0; i < 16; i++) if (!Finite(m[i])) return false;
            return true;
        }
    }
}
