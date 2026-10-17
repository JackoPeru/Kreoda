using System;
using System.Collections;
using System.IO;
using System.Reflection;
using NUnit.Framework;

namespace Kreoda.QuestRuntime.Tests
{
    public class QuestPcCredentialsTests
    {
        static readonly Type Store = typeof(QuestConnection).Assembly.GetType("Kreoda.QuestRuntime.QuestPcCredentials");
        static readonly Type Record = typeof(QuestConnection).Assembly.GetType("Kreoda.QuestRuntime.QuestPcCredentialRecord");
        const BindingFlags Static = BindingFlags.Static | BindingFlags.NonPublic;
        string directory, path;
        [SetUp] public void Setup()
        {
            directory = Path.Combine(Path.GetTempPath(), "kreoda-pc-cache-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(directory);path = Path.Combine(directory, "credentials.pcs");
        }
        [TearDown] public void Cleanup()
        {
            Assert.That(Path.GetFullPath(directory).StartsWith(Path.GetFullPath(Path.GetTempPath()), StringComparison.OrdinalIgnoreCase), Is.True);
            Assert.That(Path.GetFileName(directory), Does.StartWith("kreoda-pc-cache-"));
            Directory.Delete(directory, true);
        }
        object Item(string pc, bool pending = false)
        {
            var item = Activator.CreateInstance(Record, true);
            var values = new[] { pc, "Studio", pending ? "" : "ws://127.0.0.1:9842/", pending ? "" : "device-a",
                new string('a', 43), "client-" + Guid.NewGuid().ToString("D"), Guid.NewGuid().ToString("D") };
            var fields = new[] { "PcId", "Name", "Endpoint", "DeviceId", "Credential", "LogicalId", "InstallationId" };
            for (var i = 0; i < fields.Length; i++) Record.GetField(fields[i], BindingFlags.Instance | BindingFlags.NonPublic).SetValue(item, values[i]);
            return item;
        }
        void Write(params object[] items)
        {
            var array = Array.CreateInstance(Record, items.Length);
            for (var i = 0; i < items.Length; i++) array.SetValue(items[i], i);
            Store.GetMethod("Write", Static).Invoke(null, new object[] { path, array });
        }
        IDictionary Read() => (IDictionary)Store.GetMethod("Read", Static).Invoke(null, new object[] { path });

        [Test] public void PendingAndTrustedRecordsRoundtripAndRemoveOnlyOnePc()
        {
            var a = Guid.NewGuid().ToString("D");var b = Guid.NewGuid().ToString("D");
            Write(Item(a), Item(b, true));
            Assert.That(Read().Count, Is.EqualTo(2));
            Store.GetMethod("Remove", Static).Invoke(null, new object[] { path, a });
            Assert.That(Read().Contains(b), Is.True);Assert.That(Read().Contains(a), Is.False);
            Assert.That(File.Exists(path + ".tmp"), Is.False);
        }
        [Test] public void DuplicateInvalidAndExcessRecordsCannotReplaceExistingBytes()
        {
            var item = Item(Guid.NewGuid().ToString("D"));Write(item);var old = File.ReadAllBytes(path);
            Assert.Throws<TargetInvocationException>(() => Write(item, item));
            var many = new object[33];for (var i = 0; i < many.Length; i++) many[i] = item;
            Assert.Throws<TargetInvocationException>(() => Write(many));
            Record.GetField("Name", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(item, "bad\nname");
            Assert.Throws<TargetInvocationException>(() => Write(item));
            Assert.That(File.ReadAllBytes(path), Is.EqualTo(old));
        }
        [Test] public void AtomicTemporaryWriteFailureKeepsExistingBytes()
        {
            Write(Item(Guid.NewGuid().ToString("D")));var old = File.ReadAllBytes(path);
            Directory.CreateDirectory(path + ".tmp");
            Assert.Throws<TargetInvocationException>(() => Write(Item(Guid.NewGuid().ToString("D"))));
            Assert.That(File.ReadAllBytes(path), Is.EqualTo(old));
        }
        [TestCase("version")][TestCase("count")][TestCase("truncated")][TestCase("trailing")]
        [TestCase("oversize")][TestCase("length-overflow")][TestCase("length-noncanonical")][TestCase("utf8")]
        public void MalformedOptionalCacheReturnsNoPartialIdentities(string kind)
        {
            Write(Item(Guid.NewGuid().ToString("D")));var bytes = File.ReadAllBytes(path);
            switch (kind)
            {
                case "version": bytes[4] = 2;break;
                case "count": bytes[8] = 33;break;
                case "truncated": Array.Resize(ref bytes, bytes.Length - 1);break;
                case "trailing": Array.Resize(ref bytes, bytes.Length + 1);break;
                case "oversize": Array.Resize(ref bytes, 32769);break;
                case "length-overflow": Array.Copy(new byte[] { 128, 128, 128, 128, 16 }, 0, bytes, 12, 5);break;
                case "length-noncanonical": bytes[12] = 128;bytes[13] = 0;break;
                case "utf8": bytes[13] = 255;break;
            }
            File.WriteAllBytes(path, bytes);Assert.That(Read().Count, Is.Zero);
        }
    }
}
