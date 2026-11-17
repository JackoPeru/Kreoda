using System;
using System.Text.Json.Serialization;
using UnityEngine;

namespace Kreoda.QuestRuntime
{
    /// <summary>
    /// A locally stored link to a Meta-persisted spatial anchor. Coordinates in
    /// this record are exclusively in the anchor's frame, NEVER Unity world space.
    /// SessionId is deliberately excluded: it changes after reconnection.
    /// </summary>
    public sealed class QuestAnchorRecord
    {
        public const int CurrentVersion = 1;
        public int Version { get; set; } = CurrentVersion;
        public string PcId { get; set; }
        public string DocumentId { get; set; }
        public string RoomId { get; set; } = "";
        public string AnchorUuid { get; set; }
        public float[] AnchorRelativePositionMetres { get; set; }
        public float[] AnchorRelativeRotationXyzw { get; set; }
        public float[] ContactModelMetres { get; set; }
        public float DisplayScale { get; set; }
        public float HeightCalibrationMetres { get; set; }

        internal static bool Finite(float value) => !float.IsNaN(value) && !float.IsInfinity(value);
        internal static bool Finite(Vector3 value) => Finite(value.x) && Finite(value.y) && Finite(value.z);
        internal static bool Finite(Quaternion value) => Finite(value.x) && Finite(value.y) && Finite(value.z) && Finite(value.w);
        internal static bool ValidId(string value) => !string.IsNullOrWhiteSpace(value) && value.Length <= 160;
        internal static bool ValidRoomId(string value) => value != null && value.Length <= 160;

        static bool ValidVector(float[] vector, float maxAbs)
        {
            if (vector == null || vector.Length != 3) return false;
            foreach (var value in vector)
                if (!Finite(value) || Mathf.Abs(value) > maxAbs) return false;
            return true;
        }

        static bool ValidRotation(float[] rotation)
        {
            if (rotation == null || rotation.Length != 4) return false;
            double squared = 0;
            foreach (var value in rotation)
            {
                if (!Finite(value)) return false;
                squared += (double)value * value;
            }
            return squared >= .999 && squared <= 1.001;
        }

        public bool IsValid()
        {
            return Version == CurrentVersion && ValidId(PcId) && ValidId(DocumentId) &&
                   ValidRoomId(RoomId) && Guid.TryParse(AnchorUuid, out var uuid) && uuid != Guid.Empty &&
                   ValidVector(AnchorRelativePositionMetres, 25f) &&
                   ValidRotation(AnchorRelativeRotationXyzw) &&
                   ValidVector(ContactModelMetres, 10000f) &&
                   Finite(DisplayScale) && DisplayScale >= .01f && DisplayScale <= 100f &&
                   Finite(HeightCalibrationMetres) && Mathf.Abs(HeightCalibrationMetres) <= .1001f;
        }

        public bool Matches(QuestAnchorScope scope) => IsValid() &&
            PcId == scope.PcId && DocumentId == scope.DocumentId && RoomId == scope.RoomId;

        public static QuestAnchorRecord Create(QuestAnchorScope scope, Guid uuid, Pose anchorWorld,
            Pose displayWorld, float displayScale, Vector3 contactModelMetres, float calibrationMetres)
        {
            if (!scope.IsValid || uuid == Guid.Empty || !Finite(anchorWorld.position) ||
                !Finite(anchorWorld.rotation) || !Finite(displayWorld.position) ||
                !Finite(displayWorld.rotation) || !Finite(contactModelMetres)) return null;

            var relativeRotation = Quaternion.Inverse(anchorWorld.rotation) * displayWorld.rotation;
            var relativePosition = Quaternion.Inverse(anchorWorld.rotation) *
                                   (displayWorld.position - anchorWorld.position);
            var record = new QuestAnchorRecord
            {
                PcId = scope.PcId,
                DocumentId = scope.DocumentId,
                RoomId = scope.RoomId,
                AnchorUuid = uuid.ToString("D"),
                AnchorRelativePositionMetres = new[] { relativePosition.x, relativePosition.y, relativePosition.z },
                AnchorRelativeRotationXyzw = new[] { relativeRotation.x, relativeRotation.y, relativeRotation.z, relativeRotation.w },
                ContactModelMetres = new[] { contactModelMetres.x, contactModelMetres.y, contactModelMetres.z },
                DisplayScale = displayScale,
                HeightCalibrationMetres = calibrationMetres
            };
            return record.IsValid() ? record : null;
        }

        public bool TryGetWorldDisplayPose(Pose localizedAnchorPose, out Pose displayPose)
        {
            displayPose = Pose.identity;
            if (!IsValid() || !Finite(localizedAnchorPose.position) ||
                !Finite(localizedAnchorPose.rotation)) return false;
            var localPosition = new Vector3(AnchorRelativePositionMetres[0],
                AnchorRelativePositionMetres[1], AnchorRelativePositionMetres[2]);
            var localRotation = new Quaternion(AnchorRelativeRotationXyzw[0],
                AnchorRelativeRotationXyzw[1], AnchorRelativeRotationXyzw[2], AnchorRelativeRotationXyzw[3]);
            displayPose = new Pose(localizedAnchorPose.position + localizedAnchorPose.rotation * localPosition,
                localizedAnchorPose.rotation * localRotation);
            return Finite(displayPose.position) && Finite(displayPose.rotation);
        }

        [JsonIgnore]
        public Vector3 ContactModelPoint => ContactModelMetres != null && ContactModelMetres.Length == 3
            ? new Vector3(ContactModelMetres[0], ContactModelMetres[1], ContactModelMetres[2])
            : Vector3.zero;
    }

    /// <summary>
    /// The PC/document/room binding is stable. SessionId and Generation fence
    /// in-flight operations, but are never persisted as physical coordinates.
    /// A missing room id is an unscoped anchor, not proof of a room match.
    /// </summary>
    public readonly struct QuestAnchorScope : IEquatable<QuestAnchorScope>
    {
        public readonly string PcId, DocumentId, RoomId, SessionId;
        public readonly long Generation;

        public QuestAnchorScope(string pcId, string documentId, string sessionId, long generation,
            string roomId = "")
        {
            PcId = pcId;
            DocumentId = documentId;
            SessionId = sessionId;
            Generation = generation;
            RoomId = roomId;
        }

        public bool IsValid => QuestAnchorRecord.ValidId(PcId) && QuestAnchorRecord.ValidId(DocumentId) &&
                               QuestAnchorRecord.ValidId(SessionId) && QuestAnchorRecord.ValidRoomId(RoomId) &&
                               Generation >= 0;

        public bool Equals(QuestAnchorScope other) => PcId == other.PcId && DocumentId == other.DocumentId &&
            RoomId == other.RoomId && SessionId == other.SessionId && Generation == other.Generation;

        public override bool Equals(object obj) => obj is QuestAnchorScope other && Equals(other);
        public override int GetHashCode() => HashCode.Combine(PcId, DocumentId, RoomId, SessionId, Generation);
    }
}
