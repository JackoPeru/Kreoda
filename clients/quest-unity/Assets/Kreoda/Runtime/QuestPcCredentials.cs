using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Kreoda.QuestFoundation;

namespace Kreoda.QuestRuntime
{
    internal sealed class QuestPcCredentialRecord
    {
        internal string PcId, Name, Endpoint, DeviceId, Credential, LogicalId, InstallationId;

        internal QuestPcCredentialRecord Copy() => (QuestPcCredentialRecord)MemberwiseClone();
    }

    internal static class QuestPcCredentials
    {
        const int Magic = 0x51504331;
        const int Version = 1;
        const int MaxRecords = 32;
        const int MaxBytes = 32768;
        static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);

        internal static Dictionary<string, QuestPcCredentialRecord> Read(string path)
        {
            return TryRead(path, out var records) ? records : new Dictionary<string, QuestPcCredentialRecord>(StringComparer.Ordinal);
        }

        static bool TryRead(string path, out Dictionary<string, QuestPcCredentialRecord> records)
        {
            records = new Dictionary<string, QuestPcCredentialRecord>(StringComparer.Ordinal);
            try
            {
                if (!File.Exists(path)) return true;
                var length = new FileInfo(path).Length;
                if (length < 12 || length > MaxBytes) return false;
                using var stream = File.OpenRead(path);
                using var reader = new BinaryReader(stream, Utf8);
                if (reader.ReadInt32() != Magic || reader.ReadInt32() != Version) return false;
                var count = reader.ReadInt32();
                if (count < 0 || count > MaxRecords) return false;
                for (var i = 0; i < count; i++)
                {
                    var item = new QuestPcCredentialRecord
                    {
                        PcId = ReadText(reader, 36), Name = ReadText(reader, 320),
                        Endpoint = ReadText(reader, 512), DeviceId = ReadText(reader, 128),
                        Credential = ReadText(reader, 43), LogicalId = ReadText(reader, 43),
                        InstallationId = ReadText(reader, 36),
                    };
                    if (!Valid(item) || records.ContainsKey(item.PcId)) return false;
                    records.Add(item.PcId, item);
                }
                return stream.Position == stream.Length;
            }
            catch { return false; }
        }

        internal static void Write(string path, IEnumerable<QuestPcCredentialRecord> source)
        {
            var records = source?.ToArray() ?? throw new ArgumentNullException(nameof(source));
            if (records.Length > MaxRecords) throw new InvalidDataException("too many PC credentials");
            var keys = new HashSet<string>(StringComparer.Ordinal);
            if (records.Any(item => !Valid(item) || !keys.Add(item.PcId)))
                throw new InvalidDataException("invalid or duplicate PC credentials");

            byte[] bytes;
            using (var memory = new MemoryStream())
            {
                using (var writer = new BinaryWriter(memory, Utf8, true))
                {
                    writer.Write(Magic);writer.Write(Version);writer.Write(records.Length);
                    foreach (var item in records)
                    {
                        WriteText(writer, item.PcId);WriteText(writer, item.Name);WriteText(writer, item.Endpoint);
                        WriteText(writer, item.DeviceId);WriteText(writer, item.Credential);
                        WriteText(writer, item.LogicalId);WriteText(writer, item.InstallationId);
                    }
                }
                if (memory.Length > MaxBytes) throw new InvalidDataException("PC credentials exceed storage limit");
                bytes = memory.ToArray();
            }

            var temporary = path + ".tmp";
            try
            {
                using (var file = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None))
                { file.Write(bytes, 0, bytes.Length);file.Flush(true); }
                if (File.Exists(path)) File.Replace(temporary, path, null);
                else File.Move(temporary, path);
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }

        internal static void Remove(string path, string pcId)
        {
            if (string.IsNullOrEmpty(pcId)) return;
            if (!TryRead(path, out var records))
            {
                if (File.Exists(path)) File.Delete(path);
                return;
            }
            if (!records.Remove(pcId)) return;
            Write(path, records.Values);
        }

        static bool Valid(QuestPcCredentialRecord item)
        {
            if (item == null || !CanonicalGuid(item.PcId) || !CanonicalGuid(item.InstallationId) ||
                item.Name == null || item.Name.Length > 80 || Utf8.GetByteCount(item.Name) > 320 || item.Name.Any(char.IsControl) ||
                !Bounded(item.Endpoint, 512) || !Bounded(item.DeviceId, 128) ||
                item.Credential == null || item.Credential.Length != 43 || item.Credential.Any(c =>
                    !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_' || c == '-')) ||
                !ValidLogicalId(item.LogicalId)) return false;
            var pending = string.IsNullOrEmpty(item.DeviceId);
            return pending ? item.Endpoint.Length == 0 :
                item.Endpoint.Length != 0 && QuestConnectionInput.TryEndpoint(item.Endpoint, out _);
        }

        static bool Bounded(string value, int bytes) => value != null && Utf8.GetByteCount(value) <= bytes && !value.Any(char.IsControl);

        static bool CanonicalGuid(string value) => Guid.TryParseExact(value, "D", out var id) &&
            string.Equals(value, id.ToString("D"), StringComparison.Ordinal);

        static bool ValidLogicalId(string value) => value != null && value.StartsWith("client-", StringComparison.Ordinal) &&
            CanonicalGuid(value.Substring(7));

        static void WriteText(BinaryWriter writer, string value)
        {
            var bytes = Utf8.GetBytes(value);
            WriteLength(writer, bytes.Length);
            writer.Write(bytes);
        }

        static string ReadText(BinaryReader reader, int maxBytes)
        {
            var length = ReadLength(reader);
            if (length < 0 || length > maxBytes || length > reader.BaseStream.Length - reader.BaseStream.Position)
                throw new InvalidDataException("invalid PC credential string length");
            var bytes = reader.ReadBytes(length);
            if (bytes.Length != length) throw new EndOfStreamException();
            return Utf8.GetString(bytes);
        }

        static void WriteLength(BinaryWriter writer, int value)
        {
            uint remaining = (uint)value;
            while (remaining >= 0x80) { writer.Write((byte)(remaining | 0x80));remaining >>= 7; }
            writer.Write((byte)remaining);
        }

        static int ReadLength(BinaryReader reader)
        {
            uint value = 0;
            for (var shift = 0; shift < 35; shift += 7)
            {
                var next = reader.ReadByte();
                if (shift == 28 && next > 7) throw new InvalidDataException("invalid PC credential string length");
                value |= (uint)(next & 0x7f) << shift;
                if ((next & 0x80) == 0)
                {
                    if (shift > 0 && next == 0) throw new InvalidDataException("noncanonical PC credential string length");
                    if (value > int.MaxValue) throw new InvalidDataException("invalid PC credential string length");
                    return (int)value;
                }
            }
            throw new InvalidDataException("invalid PC credential string length");
        }
    }
}
