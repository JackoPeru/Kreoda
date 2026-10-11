using System.Collections.Generic;
using System.Reflection;
using System.Text.Json;
using System.Threading;
using NUnit.Framework;
using UnityEngine;

namespace Kreoda.QuestRuntime.Tests
{
    public class QuestCommandsTests
    {
        const BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;
        [Test]
        public void NumericSchemaFieldsRejectNonFiniteValuesAndCannotRetargetBoundSelection()
        {
            var owned = new GameObject("Owned context form test");
            try
            {
                var commands = owned.AddComponent<QuestCommands>();
                using var schema = JsonDocument.Parse("{\"properties\":{\"radiusMm\":{\"type\":\"number\"},\"targetId\":{\"type\":\"string\"}}}");
                typeof(QuestCommands).GetField("_schema", Private).SetValue(commands, schema.RootElement.Clone());
                ((List<string>)typeof(QuestCommands).GetField("_fields", Private).GetValue(commands)).Add("radiusMm");
                Assert.That(commands.SetField("radiusMm", "1,25"), Is.True);
                Assert.That(commands.SetField("radiusMm", "Infinity"), Is.False);
                Assert.That(commands.SetField("targetId", "different-owner"), Is.False);
            }
            finally { Object.DestroyImmediate(owned); }
        }
        [Test]
        public void CompletedCommandTokenCannotCrashFocusLossCleanup()
        {
            var owned = new GameObject("Owned command cleanup test");
            var commands = owned.AddComponent<QuestCommands>();
            var field = typeof(QuestCommands).GetField("_commandRun", Private);
            try
            {
                var completed = new CancellationTokenSource();completed.Dispose();field.SetValue(commands, completed);
                Assert.DoesNotThrow(() => typeof(QuestCommands).GetMethod("OnApplicationPause", Private).Invoke(commands, new object[] { true }));
            }
            finally { field.SetValue(commands, null);Object.DestroyImmediate(owned); }
        }
    }
}
