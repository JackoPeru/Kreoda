using System.Collections.Generic;
using System.Reflection;
using System.Text.Json;
using Kreoda.Session.Generated;
using NUnit.Framework;
using UnityEngine;
using Object = UnityEngine.Object;

namespace Kreoda.QuestRuntime.Tests
{
    public sealed class QuestCommandReviewTests
    {
        [Test]
        public void ParameterlessCommandStillRequiresCurrentSelectionAndNonbusySchema()
        {
            var root = new GameObject("Parameterless command review fixture");
            try
            {
                var command = root.AddComponent<QuestCommands>();
                command.Connection = root.AddComponent<QuestConnection>();
                const BindingFlags hidden = BindingFlags.Instance | BindingFlags.NonPublic;
                var type = typeof(QuestCommands);
                using var schema = JsonDocument.Parse("{\"type\":\"object\",\"properties\":{}}");
                type.GetField("_schema", hidden).SetValue(command, schema.RootElement.Clone());
                type.GetField("_command", hidden).SetValue(command,
                    new ContextCommandInfo { Id = "NoParameters", Label = "Create", Available = true,
                        BoundParameters = new Dictionary<string, object>() });
                type.GetField("_context", hidden).SetValue(command,
                    new ContextCommandsPayload { Commands = new[] { new ContextCommandInfo {
                        Id = "NoParameters", Available = true, BoundParameters = new Dictionary<string, object>() } } });
                Assert.That(command.SelectedField, Is.Null, "zero-property schema is a valid parameterless shape");
                Assert.That(command.CanConfirm, Is.False, "offline or stale selection cannot confirm even with schema ready");
                type.GetProperty("Busy").SetValue(command, true);
                Assert.That(command.CanConfirm, Is.False, "busy commands must never become confirmable");
                type.GetProperty("Busy").SetValue(command, false);
                command.Confirm();
                Assert.That(command.CanConfirm, Is.False, "review must not bypass lineage validation");
            }
            finally { Object.DestroyImmediate(root); }
        }
        [Test]
        public void ReviewIdentityChangesWithParameterRevisionAndSelectionGeneration()
        {
            var values = new Dictionary<string, object> { ["radius"] = 2d, ["target"] = "edge-1" };
            var original = QuestCommands.ReviewFingerprint("Fillet", "s", "d", 7, 2, values);
            Assert.That(original, Is.EqualTo(QuestCommands.ReviewFingerprint("Fillet", "s", "d", 7, 2,
                new Dictionary<string, object> { ["target"] = "edge-1", ["radius"] = 2d })));
            Assert.That(original, Is.Not.EqualTo(QuestCommands.ReviewFingerprint("Fillet", "s", "d", 8, 2, values)));
            Assert.That(original, Is.Not.EqualTo(QuestCommands.ReviewFingerprint("Fillet", "s", "d", 7, 3, values)));
            values["radius"] = 3d;
            Assert.That(original, Is.Not.EqualTo(QuestCommands.ReviewFingerprint("Fillet", "s", "d", 7, 2, values)));
        }
    }
}
