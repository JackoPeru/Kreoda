using System;
using System.Linq;
using System.Text.Json;
using Kreoda.QuestFoundation;
using Kreoda.Session;
using Kreoda.Session.Generated;
using NUnit.Framework;
using UnityEngine;

namespace Kreoda.QuestRuntime.Tests
{
    public sealed class QuestProjectionTests
    {
        const string Session = "550e8400-e29b-41d4-a716-446655440000";

        [Test]
        public void CapturesOnlyCurrentPersistentEdgesAndWholeCurrentShapeOwners()
        {
            var model = new QuestProjectionModel();
            var state = MakeModel(4, "[ { \"featureId\": \"target\" } ]");
            Assert.That(model.Bind(state, 8), Is.True);

            var edge = Candidate(model, "part-a", "part-a:edge.lin.box.+X~box.+Z");
            Assert.That(model.TryCapture(edge, out var edgeError), Is.True, edgeError);
            Assert.That(model.TryCapture(edge, out _), Is.False, "the same native edge cannot be captured twice");
            Assert.That(model.TryBuildDefinition(out var edgeDefinition, out var definitionError), Is.True, definitionError);
            using (var parsed = JsonDocument.Parse(edgeDefinition.GetRawText()))
            {
                var root = parsed.RootElement;
                Assert.That(root.GetProperty("version").GetInt32(), Is.EqualTo(1));
                Assert.That(root.GetProperty("operation").GetString(), Is.EqualTo("projectEdges"));
                var source = root.GetProperty("sources").EnumerateArray().Single();
                Assert.That(source.GetProperty("type").GetString(), Is.EqualTo("edge"));
                Assert.That(source.GetProperty("featureId").GetString(), Is.EqualTo("part-a"));
                Assert.That(source.GetProperty("persistentEdgeId").GetString(), Is.EqualTo(edge.PersistentEdgeId));
            }

            var ambiguous = Candidate(model, "part-b", "part-b:edge.lin.box.+X");
            ambiguous.ReferenceAmbiguous = true;
            Assert.That(model.TryCapture(ambiguous, out _), Is.False);
            Assert.That(model.Sources, Has.Count.EqualTo(1));

            model.CycleOperation();
            var shape = Candidate(model, "solid-a", null);
            Assert.That(model.TryCapture(shape, out var shapeError), Is.True, shapeError);
            Assert.That(model.TryBuildDefinition(out var shapeDefinition, out _), Is.True);
            using (var parsed = JsonDocument.Parse(shapeDefinition.GetRawText()))
            {
                Assert.That(parsed.RootElement.GetProperty("operation").GetString(), Is.EqualTo("silhouette"));
                var source = parsed.RootElement.GetProperty("sources").EnumerateArray().Single();
                Assert.That(source.GetProperty("type").GetString(), Is.EqualTo("shape"));
                Assert.That(source.GetProperty("featureId").GetString(), Is.EqualTo("solid-a"));
                Assert.That(source.TryGetProperty("persistentEdgeId", out _), Is.False);
            }

            model.CycleOperation();
            Assert.That(model.TryCapture(Candidate(model, "solid-b", null), out _), Is.True);
            Assert.That(model.TryBuildDefinition(out var sectionDefinition, out _), Is.True);
            using (var parsed = JsonDocument.Parse(sectionDefinition.GetRawText()))
                Assert.That(parsed.RootElement.GetProperty("operation").GetString(), Is.EqualTo("section"));
        }

        [Test]
        public void RejectsStaleAmbiguousMismatchedOwnerDatumInstanceAndChangedSelectionMode()
        {
            var model = new QuestProjectionModel();
            Assert.That(model.Bind(MakeModel(4, "[ { \"featureId\": \"target\" } ]"), 8), Is.True);

            Assert.That(model.TryCapture(Candidate(model, "part-a", "part-b:edge.lin.box.+X"), out _), Is.False);
            var stale = Candidate(model, "part-a", "part-a:edge.lin.box.+X");
            stale.Fence = new QuestProjectionModel.Fence(Session, "doc", 3, 8);
            Assert.That(model.TryCapture(stale, out _), Is.False);
            Assert.That(model.TryCapture(Candidate(model, "target", "target:edge.lin.box.+X"), out _), Is.False);
            var ambiguous = Candidate(model, "part-a", "part-a:edge.lin.box.+X");
            ambiguous.ReferenceAmbiguous = true;
            Assert.That(model.TryCapture(ambiguous, out _), Is.False);
            var datum = Candidate(model, "part-a", "part-a:edge.lin.box.+X");
            datum.IsDatum = true;
            Assert.That(model.TryCapture(datum, out _), Is.False);
            var instance = Candidate(model, "part-a", "part-a:edge.lin.box.+X");
            instance.IsInstance = true;
            Assert.That(model.TryCapture(instance, out _), Is.False);
            var modeChanged = Candidate(model, "part-a", "part-a:edge.lin.box.+X");
            modeChanged.CurrentSelectionMode = 1;
            Assert.That(model.TryCapture(modeChanged, out _), Is.False);
            var oversizedFeature = new string('f', 129);
            Assert.That(model.TryCapture(Candidate(model, oversizedFeature, oversizedFeature + ":edge.x"), out _), Is.False);
            var oversizedEdgeId = "part-a:" + new string('x', 506);
            Assert.That(oversizedEdgeId.Length, Is.GreaterThan(512));
            Assert.That(model.TryCapture(Candidate(model, "part-a", oversizedEdgeId), out _), Is.False);
            Assert.That(model.Sources, Is.Empty);
        }

        [Test]
        public void ResolvedInstancesUseTheirCurrentFeatureOwnerForWholeShapeAndNativeEdges()
        {
            var state = ModelWithFeatures(4,
                "[{\"featureId\":\"source-a\",\"type\":\"Pad\",\"status\":\"ok\",\"geometryCurrent\":true}," +
                "{\"featureId\":\"instance-a\",\"type\":\"Instance\",\"dependsOn\":[\"source-a\"],\"status\":\"ok\",\"geometryCurrent\":true}]",
                "[{\"featureId\":\"target\"}]");
            Assert.That(QuestProjections.IsResolvedInstanceOwner(state, "instance-a", "instance-a"), Is.True);
            Assert.That(QuestProjections.IsResolvedInstanceOwner(state, "source-a", "instance-a"), Is.False,
                "source feature is not the placed instance's mesh owner");

            var shapeModel = new QuestProjectionModel();
            Assert.That(shapeModel.Bind(state, 8), Is.True);
            shapeModel.CycleOperation();
            var instanceShape = Candidate(shapeModel, "instance-a", null);
            instanceShape.IsInstance = true;
            instanceShape.InstanceResolved = QuestProjections.IsResolvedInstanceOwner(state, "instance-a", "instance-a");
            Assert.That(shapeModel.TryCapture(instanceShape, out var shapeError), Is.True, shapeError);
            Assert.That(shapeModel.TryBuildDefinition(out var shapeDefinition, out _), Is.True);
            using (var parsed = JsonDocument.Parse(shapeDefinition.GetRawText()))
                Assert.That(parsed.RootElement.GetProperty("sources")[0].GetProperty("featureId").GetString(), Is.EqualTo("instance-a"));

            var edgeModel = new QuestProjectionModel();
            Assert.That(edgeModel.Bind(state, 8), Is.True);
            var instanceEdge = Candidate(edgeModel, "instance-a", "instance-a:edge.returned");
            instanceEdge.IsInstance = true;
            instanceEdge.InstanceResolved = QuestProjections.IsResolvedInstanceOwner(state, "instance-a", "instance-a");
            Assert.That(edgeModel.TryCapture(instanceEdge, out var edgeError), Is.True, edgeError);
            Assert.That(edgeModel.TryBuildDefinition(out var edgeDefinition, out _), Is.True);
            using (var parsed = JsonDocument.Parse(edgeDefinition.GetRawText()))
                Assert.That(parsed.RootElement.GetProperty("sources")[0].GetProperty("persistentEdgeId").GetString(),
                    Is.EqualTo("instance-a:edge.returned"));

            var sourceOwnedEdge = Candidate(edgeModel, "instance-a", "source-a:edge.returned");
            sourceOwnedEdge.IsInstance = true;
            sourceOwnedEdge.InstanceResolved = true;
            Assert.That(edgeModel.TryCapture(sourceOwnedEdge, out _), Is.False,
                "an instance selection cannot rewrite a source-owned native edge id");
            var staleProxy = Candidate(edgeModel, "instance-a", "instance-a:edge.stale");
            staleProxy.IsInstance = true;
            staleProxy.InstanceResolved = true;
            staleProxy.ViewCurrent = false;
            Assert.That(edgeModel.TryCapture(staleProxy, out _), Is.False, "an unresolved or stale instance proxy cannot be captured");
        }

        [Test]
        public void InstanceOwnerRejectsUnresolvedWrongTypeAndAmbiguousModelRecords()
        {
            var unresolved = ModelWithFeatures(4,
                "[{\"featureId\":\"source-a\",\"type\":\"Pad\"}," +
                "{\"featureId\":\"instance-a\",\"type\":\"Instance\",\"dependsOn\":[\"source-a\"],\"status\":\"broken\",\"geometryCurrent\":false}]",
                "[]");
            Assert.That(QuestProjections.IsResolvedInstanceOwner(unresolved, "instance-a", "instance-a"), Is.False);
            var wrongType = ModelWithFeatures(4,
                "[{\"featureId\":\"source-a\",\"type\":\"Pad\"}," +
                "{\"featureId\":\"instance-a\",\"type\":\"Pad\",\"dependsOn\":[\"source-a\"]}]", "[]");
            Assert.That(QuestProjections.IsResolvedInstanceOwner(wrongType, "instance-a", "instance-a"), Is.False);
            var ambiguous = ModelWithFeatures(4,
                "[{\"featureId\":\"source-a\",\"type\":\"Pad\"}," +
                "{\"featureId\":\"instance-a\",\"type\":\"Instance\",\"dependsOn\":[\"source-a\"]}," +
                "{\"featureId\":\"instance-a\",\"type\":\"Instance\",\"dependsOn\":[\"source-a\"]}]", "[]");
            Assert.That(QuestProjections.IsResolvedInstanceOwner(ambiguous, "instance-a", "instance-a"), Is.False);
        }

        [Test]
        public void AuthoredSketchSourcesUseRealLineCircleArcIdsAndMergeWithMeshEdges()
        {
            var targetModel = AuthoredSketchModel(Array.Empty<string>(), Array.Empty<string>(), Array.Empty<string>());
            var sourceModel = AuthoredSketchModel(new[] { "line-a" }, new[] { "circle-a" }, new[] { "arc.a:source" },
                constraintId: "constraint-a");
            var target = AuthoredSketchRecord("target", targetModel);
            var source = AuthoredSketchRecord("source-sketch", sourceModel,
                extraFields: ",\"curveDisplay\":{\"curves\":[{\"memberIndex\":77,\"id\":\"derived-display-id\"}]} ");
            var model = new QuestProjectionModel();
            Assert.That(model.Bind(MakeModel(4, "[" + target + "," + source + "]"), 8), Is.True);

            Assert.That(model.TryCapture(Candidate(model, "part-a", "part-a:edge.persisted"), out var edgeError), Is.True, edgeError);
            Assert.That(model.BeginAuthoredSourceSelection(model.Lineage, "target", out var beginError), Is.True, beginError);
            Assert.That(model.SelectedAuthoredSketchFeatureId, Is.EqualTo("source-sketch"));
            Assert.That(model.AuthoredCurveCount, Is.EqualTo(3));
            Assert.That(model.SelectedAuthoredEntityLabel, Is.EqualTo("Linea · line-a"));
            Assert.That(model.SelectedAuthoredEntityId, Is.Not.EqualTo("derived-display-id"));

            Assert.That(model.ToggleAuthoredEntity(model.Lineage, "target", out var lineError), Is.True, lineError);
            Assert.That(model.CycleAuthoredEntity(1, model.Lineage, "target", out var circleError), Is.True, circleError);
            Assert.That(model.SelectedAuthoredEntityLabel, Is.EqualTo("Cerchio · circle-a"));
            Assert.That(model.ToggleAuthoredEntity(model.Lineage, "target", out var circleToggleError), Is.True, circleToggleError);
            Assert.That(model.AddAuthoredSource(model.Lineage, "target", out var firstAddError), Is.True, firstAddError);

            Assert.That(model.CycleAuthoredEntity(1, model.Lineage, "target", out var arcError), Is.True, arcError);
            Assert.That(model.SelectedAuthoredEntityLabel, Is.EqualTo("Arco · arc.a:source"));
            Assert.That(model.ToggleAuthoredEntity(model.Lineage, "target", out var arcToggleError), Is.True, arcToggleError);
            Assert.That(model.AddAuthoredSource(model.Lineage, "target", out var secondAddError), Is.True, secondAddError);
            Assert.That(model.Sources, Has.Count.EqualTo(2), "same sketch merges into one authored-source record");

            Assert.That(model.TryBuildDefinition(out var definition, out var buildError), Is.True, buildError);
            using (var parsed = JsonDocument.Parse(definition.GetRawText()))
            {
                var sources = parsed.RootElement.GetProperty("sources").EnumerateArray().ToArray();
                Assert.That(sources, Has.Length.EqualTo(2));
                Assert.That(sources[0].GetProperty("type").GetString(), Is.EqualTo("edge"));
                Assert.That(sources[0].GetProperty("persistentEdgeId").GetString(), Is.EqualTo("part-a:edge.persisted"));
                Assert.That(sources[0].TryGetProperty("entityIds", out _), Is.False);
                Assert.That(sources[1].GetProperty("type").GetString(), Is.EqualTo("sketchEntities"));
                Assert.That(sources[1].GetProperty("featureId").GetString(), Is.EqualTo("source-sketch"));
                Assert.That(sources[1].GetProperty("entityIds").EnumerateArray().Select(id => id.GetString()),
                    Is.EqualTo(new[] { "line-a", "circle-a", "arc.a:source" }));
                Assert.That(sources[1].TryGetProperty("persistentEdgeId", out _), Is.False);
            }
        }

        [Test]
        public void AuthoredSketchSelectionSupportsSubsetAndExact128LimitWithoutTruncation()
        {
            var target = AuthoredSketchRecord("target",
                AuthoredSketchModel(Array.Empty<string>(), Array.Empty<string>(), Array.Empty<string>()));
            var lines129 = Enumerable.Range(0, 129).Select(index => "line-" + index.ToString("D3")).ToArray();
            var model = new QuestProjectionModel();
            Assert.That(model.Bind(MakeModel(4, "[" + target + "," + AuthoredSketchRecord("source-sketch",
                AuthoredSketchModel(lines129, Array.Empty<string>(), Array.Empty<string>())) + "]"), 8), Is.True);
            Assert.That(model.BeginAuthoredSourceSelection(model.Lineage, "target", out var beginError), Is.True, beginError);
            Assert.That(model.SelectAllAuthoredEntities(model.Lineage, "target", out var allError), Is.False);
            Assert.That(allError, Does.Contain("129").And.Contain("128"));
            Assert.That(model.PendingAuthoredEntityCount, Is.Zero, "all does not truncate or stage an oversized list");

            for (var index = 0; index < 128; index++)
            {
                Assert.That(model.ToggleAuthoredEntity(model.Lineage, "target", out var toggleError), Is.True, toggleError);
                Assert.That(model.CycleAuthoredEntity(1, model.Lineage, "target", out var cycleError), Is.True, cycleError);
            }
            Assert.That(model.PendingAuthoredEntityCount, Is.EqualTo(128));
            Assert.That(model.ToggleAuthoredEntity(model.Lineage, "target", out var overflowError), Is.False);
            Assert.That(overflowError, Does.Contain("128"));
            Assert.That(model.AddAuthoredSource(model.Lineage, "target", out var addError), Is.True, addError);
            Assert.That(model.PendingAuthoredEntityCount, Is.Zero);

            Assert.That(model.ToggleAuthoredEntity(model.Lineage, "target", out var lastEntityError), Is.True, lastEntityError);
            Assert.That(model.AddAuthoredSource(model.Lineage, "target", out var mergeOverflowError), Is.False);
            Assert.That(mergeOverflowError, Does.Contain("128").And.Contain("nessun ID aggiunto"));
            Assert.That(model.PendingAuthoredEntityCount, Is.EqualTo(1), "failed merge keeps explicit selection for correction");
            Assert.That(model.TryBuildDefinition(out var subset, out var subsetError), Is.True, subsetError);
            using (var parsed = JsonDocument.Parse(subset.GetRawText()))
            {
                var ids = parsed.RootElement.GetProperty("sources")[0].GetProperty("entityIds").EnumerateArray()
                    .Select(id => id.GetString()).ToArray();
                Assert.That(ids, Has.Length.EqualTo(128));
                Assert.That(ids, Is.EqualTo(lines129.Take(128)));
            }

            var exactly128 = new QuestProjectionModel();
            var lines128 = lines129.Take(128).ToArray();
            Assert.That(exactly128.Bind(MakeModel(4, "[" + target + "," + AuthoredSketchRecord("source-sketch",
                AuthoredSketchModel(lines128, Array.Empty<string>(), Array.Empty<string>())) + "]"), 8), Is.True);
            Assert.That(exactly128.BeginAuthoredSourceSelection(exactly128.Lineage, "target", out var exactBeginError), Is.True, exactBeginError);
            Assert.That(exactly128.SelectAllAuthoredEntities(exactly128.Lineage, "target", out var exactAllError), Is.True, exactAllError);
            Assert.That(exactly128.PendingAuthoredEntityCount, Is.EqualTo(128));
            Assert.That(exactly128.AddAuthoredSource(exactly128.Lineage, "target", out var exactAddError), Is.True, exactAddError);
        }

        [Test]
        public void AuthoredSourceDefinitionByteLimitRejectsWithoutTruncatingPendingIds()
        {
            var target = AuthoredSketchRecord("target",
                AuthoredSketchModel(Array.Empty<string>(), Array.Empty<string>(), Array.Empty<string>()));
            var ids = Enumerable.Range(0, 128)
                .Select(index => index.ToString("D3", System.Globalization.CultureInfo.InvariantCulture) + new string('x', 509))
                .ToArray();
            var model = new QuestProjectionModel();
            Assert.That(model.Bind(MakeModel(4, "[" + target + "," + AuthoredSketchRecord("source-sketch",
                AuthoredSketchModel(ids, Array.Empty<string>(), Array.Empty<string>())) + "]"), 8), Is.True);
            Assert.That(model.BeginAuthoredSourceSelection(model.Lineage, "target", out var beginError), Is.True, beginError);
            Assert.That(model.SelectAllAuthoredEntities(model.Lineage, "target", out var allError), Is.True, allError);
            Assert.That(model.AddAuthoredSource(model.Lineage, "target", out var sizeError), Is.False);
            Assert.That(sizeError, Does.Contain("65536 byte"));
            Assert.That(model.PendingAuthoredEntityCount, Is.EqualTo(128), "rejected definitions keep the explicit selection intact");
            Assert.That(model.Sources, Is.Empty, "oversized source definitions are not truncated or partially added");
        }

        [Test]
        public void AuthoredSketchSourcesRejectSelfSummaryBrokenMissingAndMalformedModels()
        {
            var valid = AuthoredSketchModel(new[] { "line-a" }, Array.Empty<string>(), Array.Empty<string>());
            var emptyTarget = AuthoredSketchRecord("target",
                AuthoredSketchModel(Array.Empty<string>(), Array.Empty<string>(), Array.Empty<string>()));
            var unavailable = new[]
            {
                AuthoredSketchRecord("target", valid),
                "{\"featureId\":\"summary\",\"type\":\"Sketch\",\"status\":\"ok\",\"geometryCurrent\":true,\"lines\":1}",
                AuthoredSketchRecord("broken", valid, status: "broken", geometryCurrent: false),
                "{\"featureId\":\"missing-model\",\"type\":\"Sketch\",\"status\":\"ok\",\"geometryCurrent\":true}",
                AuthoredSketchRecord("duplicate", AuthoredSketchModel(new[] { "same-id" }, new[] { "same-id" }, Array.Empty<string>())),
                AuthoredSketchRecord("empty-id", AuthoredSketchModel(new[] { "" }, Array.Empty<string>(), Array.Empty<string>())),
                AuthoredSketchRecord("overlong-id", AuthoredSketchModel(new[] { new string('x', 513) }, Array.Empty<string>(), Array.Empty<string>())),
            };
            foreach (var record in unavailable)
            {
                var model = new QuestProjectionModel();
                var sketches = record == unavailable[0] ? "[" + record + "]" : "[" + emptyTarget + "," + record + "]";
                Assert.That(model.Bind(MakeModel(4, sketches), 8), Is.True);
                Assert.That(model.BeginAuthoredSourceSelection(model.Lineage, "target", out _), Is.False, record);
                Assert.That(model.SelectedAuthoredSketchFeatureId, Is.Null, record);
            }
        }

        [Test]
        public void AuthoredSketchSelectionInvalidatesOnRenameSameRevisionModelChangeAndReconnect()
        {
            var target = AuthoredSketchRecord("target",
                AuthoredSketchModel(Array.Empty<string>(), Array.Empty<string>(), Array.Empty<string>()));
            var first = AuthoredSketchRecord("source-a",
                AuthoredSketchModel(new[] { "line-a" }, Array.Empty<string>(), Array.Empty<string>(), firstX: 1));
            var renamed = AuthoredSketchRecord("source-b",
                AuthoredSketchModel(new[] { "line-a" }, Array.Empty<string>(), Array.Empty<string>(), firstX: 1));
            var model = new QuestProjectionModel();
            Assert.That(model.Bind(MakeModel(4, "[" + target + "," + first + "]"), 8), Is.True);
            Assert.That(model.BeginAuthoredSourceSelection(model.Lineage, "target", out _), Is.True);
            Assert.That(model.ToggleAuthoredEntity(model.Lineage, "target", out _), Is.True);
            var originalFence = model.Lineage;
            var originalBinding = model.BindingVersion;

            Assert.That(model.Bind(MakeModel(4, "[" + target + "," + renamed + "]"), 8), Is.True);
            Assert.That(model.BindingVersion, Is.GreaterThan(originalBinding));
            Assert.That(model.PendingAuthoredEntityCount, Is.Zero, "source rename clears staged IDs");
            Assert.That(model.SelectedAuthoredSketchFeatureId, Is.Null);

            Assert.That(model.BeginAuthoredSourceSelection(model.Lineage, "target", out _), Is.True);
            Assert.That(model.ToggleAuthoredEntity(model.Lineage, "target", out _), Is.True);
            var sameIdsNewGeometry = AuthoredSketchRecord("source-b",
                AuthoredSketchModel(new[] { "line-a" }, Array.Empty<string>(), Array.Empty<string>(), firstX: 2));
            var beforeGeometryUpdate = model.BindingVersion;
            Assert.That(model.Bind(MakeModel(4, "[" + target + "," + sameIdsNewGeometry + "]"), 8), Is.True);
            Assert.That(model.BindingVersion, Is.GreaterThan(beforeGeometryUpdate));
            Assert.That(model.PendingAuthoredEntityCount, Is.Zero, "same-revision source geometry change clears staged IDs");

            Assert.That(model.BeginAuthoredSourceSelection(model.Lineage, "target", out _), Is.True);
            Assert.That(model.ToggleAuthoredEntity(model.Lineage, "target", out _), Is.True);
            var revisionFive = MakeModel(5, "[" + target + "," + sameIdsNewGeometry + "]");
            var beforeRevisionUpdate = model.BindingVersion;
            Assert.That(model.Bind(revisionFive, 8), Is.True);
            Assert.That(model.BindingVersion, Is.GreaterThan(beforeRevisionUpdate));
            Assert.That(model.PendingAuthoredEntityCount, Is.Zero, "revision update clears staged IDs");

            Assert.That(model.BeginAuthoredSourceSelection(model.Lineage, "target", out _), Is.True);
            Assert.That(model.ToggleAuthoredEntity(model.Lineage, "target", out _), Is.True);
            var staleFence = model.Lineage;
            var beforeReconnect = model.BindingVersion;
            Assert.That(model.Bind(revisionFive, 9), Is.True);
            Assert.That(model.BindingVersion, Is.GreaterThan(beforeReconnect));
            Assert.That(model.PendingAuthoredEntityCount, Is.Zero, "connection generation change clears staged IDs");
            Assert.That(model.AddAuthoredSource(staleFence, "target", out var staleError), Is.False);
            Assert.That(staleError, Does.Contain("revisione cambiati"));
        }

        [Test]
        public void ProjectionSourceCountAndSerializedDefinitionRespectNativeLimits()
        {
            var model = new QuestProjectionModel();
            Assert.That(model.Bind(MakeModel(4, "[ { \"featureId\": \"target\" } ]"), 8), Is.True);
            for (var index = 0; index < 128; index++)
            {
                var suffix = index.ToString(System.Globalization.CultureInfo.InvariantCulture);
                var candidate = Candidate(model, "part-a", "part-a:edge." + suffix + new string('x', 450));
                Assert.That(model.TryCapture(candidate, out var error), Is.True, error);
            }
            Assert.That(model.TryCapture(Candidate(model, "part-b", "part-b:edge.last"), out var limitError), Is.False);
            Assert.That(limitError, Does.Contain("128"));
            Assert.That(model.TryBuildDefinition(out _, out var sizeError), Is.False);
            Assert.That(sizeError, Does.Contain("65536 byte"));
        }

        [Test]
        public void RefreshKeepsDefinitionsReadOnlyRepairPreservesAllSourcesAndReplaceKeepsGroupId()
        {
            var original = "{\"version\":1,\"operation\":\"projectEdges\",\"sources\":[" +
                "{\"type\":\"edge\",\"featureId\":\"part-a\",\"persistentEdgeId\":\"part-a:edge.a\"}," +
                "{\"type\":\"sketchEntities\",\"featureId\":\"source-sketch\",\"entityIds\":[\"line-a\",\"arc-b\"]}]}";
            var sketches = "[{\"featureId\":\"target\",\"projectionGroups\":[" +
                "{\"groupId\":\"group-a\",\"definition\":" + original +
                ",\"status\":\"broken\",\"error\":\"edge lineage lost\",\"generation\":3,\"blockingSourceIds\":[\"part-a\"]}," +
                "{\"groupId\":\"group-b\",\"definition\":{\"version\":1,\"operation\":\"projectEdges\",\"sources\":[" +
                "{\"type\":\"edge\",\"featureId\":\"part-old\",\"persistentEdgeId\":\"part-old:edge.old\"}]}," +
                "\"status\":\"broken\",\"error\":\"source unavailable\",\"generation\":5,\"blockingSourceIds\":[\"part-old\"]}]}]";
            sketches = sketches.Substring(0, sketches.Length - 1) + "," +
                AuthoredSketchRecord("source-sketch", AuthoredSketchModel(new[] { "line-current" }, Array.Empty<string>(), Array.Empty<string>())) + "]";
            var model = new QuestProjectionModel();
            Assert.That(model.Bind(ModelWithFeatures(6, "[]", sketches), 2), Is.True);
            Assert.That(model.TryGetRepair(out var repairFeature, out var repairGroup, out var repairDefinition, out var repairError), Is.True, repairError);
            Assert.That(repairFeature, Is.EqualTo("target"));
            Assert.That(repairGroup, Is.EqualTo("group-a"));
            Assert.That(repairDefinition.GetRawText(), Is.EqualTo(original), "repair keeps the complete original multi-source definition");

            var request = model.BeginQuery();
            var brokenReply = Payload(6, "target", "broken", false, "group-a", 3, SketchProjectionGroupSummaryStatus.Broken);
            Assert.That(model.AcceptQuery(request, brokenReply, model.Lineage), Is.True);
            Assert.That(model.SelectedGroup.Definition.GetRawText(), Is.EqualTo(original), "a read-only refresh never changes native metadata");
            Assert.That(model.SelectedGroup.Status, Is.EqualTo("broken"));

            Assert.That(model.CycleGroup(1), Is.True);
            Assert.That(model.SelectedGroup.Id, Is.EqualTo("group-b"));
            Assert.That(model.Status, Does.Contain("source unavailable").And.Contain("part-old"));
            var replacement = Candidate(model, "part-new", "part-new:edge.lin.box.+Y");
            Assert.That(model.TryCapture(replacement, out var captureError), Is.True, captureError);
            Assert.That(model.BeginAuthoredSourceSelection(model.Lineage, model.SelectedTarget.FeatureId, out var beginError),
                Is.True, beginError);
            Assert.That(model.SelectedAuthoredSketchFeatureId, Is.EqualTo("source-sketch"));
            Assert.That(model.ToggleAuthoredEntity(model.Lineage, model.SelectedTarget.FeatureId, out var toggleError), Is.True, toggleError);
            Assert.That(model.AddAuthoredSource(model.Lineage, model.SelectedTarget.FeatureId, out var addError), Is.True, addError);
            Assert.That(model.TryGetRemove(out var replaceFeature, out var replaceGroup, out _), Is.True);
            Assert.That(model.TryBuildDefinition(out var replacementDefinition, out var buildError), Is.True, buildError);
            Assert.That(replaceFeature, Is.EqualTo("target"));
            Assert.That(replaceGroup, Is.EqualTo("group-b"), "source replacement targets the selected existing group");
            using (var parsed = JsonDocument.Parse(replacementDefinition.GetRawText()))
            {
                var sources = parsed.RootElement.GetProperty("sources").EnumerateArray().ToArray();
                Assert.That(sources, Has.Length.EqualTo(2));
                Assert.That(sources[0].GetProperty("featureId").GetString(), Is.EqualTo("part-new"));
                Assert.That(sources[0].GetProperty("persistentEdgeId").GetString(), Is.EqualTo("part-new:edge.lin.box.+Y"));
                Assert.That(sources[1].GetProperty("type").GetString(), Is.EqualTo("sketchEntities"));
                Assert.That(sources[1].GetProperty("featureId").GetString(), Is.EqualTo("source-sketch"));
                Assert.That(sources[1].GetProperty("entityIds").EnumerateArray().Select(id => id.GetString()),
                    Is.EqualTo(new[] { "line-current" }));
                Assert.That(sources[1].TryGetProperty("persistentEdgeId", out _), Is.False);
            }
        }

        [Test]
        public void LateQueryCannotReplaceOrClearResultForNewModelFenceAndBrokenGeometryIsUnavailable()
        {
            var model = new QuestProjectionModel();
            Assert.That(model.Bind(OneGroupModel(4, "ok", 3), 8), Is.True);
            var oldRequest = model.BeginQuery();
            var oldReply = Payload(4, "target", "ok", true, "group-a", 3, SketchProjectionGroupSummaryStatus.Ok);

            Assert.That(model.Bind(OneGroupModel(5, "ok", 4), 8), Is.True);
            var currentRequest = model.BeginQuery();
            var currentReply = Payload(5, "target", "ok", true, "group-a", 4, SketchProjectionGroupSummaryStatus.Ok);
            Assert.That(model.AcceptQuery(currentRequest, currentReply, model.Lineage), Is.True);
            Assert.That(model.TryGetSelectedDisplay(out _, out _), Is.True);
            Assert.That(model.AcceptQuery(oldRequest, oldReply, model.Lineage), Is.False);
            Assert.That(model.FailQuery(oldRequest, model.Lineage, "late failure"), Is.False);
            Assert.That(model.TryGetSelectedDisplay(out var visible, out _), Is.True);
            Assert.That(visible.Generation, Is.EqualTo(4));

            Assert.That(model.Bind(OneGroupModel(6, "broken", 5), 8), Is.True);
            var brokenRequest = model.BeginQuery();
            Assert.That(model.AcceptQuery(brokenRequest,
                Payload(6, "target", "broken", false, "group-a", 5, SketchProjectionGroupSummaryStatus.Broken), model.Lineage), Is.True);
            Assert.That(model.TryGetSelectedDisplay(out _, out var unavailable), Is.False);
            Assert.That(unavailable, Does.Contain("broken"));
        }

        [Test]
        public void EquivalentSnapshotKeepsCurrentDisplayAndBindingVersionOnlyMovesOnSemanticChange()
        {
            var model = new QuestProjectionModel();
            Assert.That(model.Bind(OneGroupModel(4, "ok", 3), 8), Is.True);
            var version = model.BindingVersion;
            var request = model.BeginQuery();
            Assert.That(model.AcceptQuery(request,
                Payload(4, "target", "ok", true, "group-a", 3, SketchProjectionGroupSummaryStatus.Ok), model.Lineage), Is.True);
            Assert.That(model.TryGetSelectedDisplay(out _, out _), Is.True);

            Assert.That(model.Bind(MakeModel(4,
                "[{\"featureId\":\"target\",\"projectionGroups\":[{\"groupId\":\"group-a\",\"definition\":{" +
                "\"sources\":[{\"persistentEdgeId\":\"part-a:edge.a\",\"featureId\":\"part-a\",\"type\":\"edge\"}]," +
                "\"operation\":\"projectEdges\",\"version\":1},\"generation\":3,\"status\":\"ok\"}]}]"), 8), Is.True);
            Assert.That(model.BindingVersion, Is.EqualTo(version), "equivalent same-revision snapshots keep the projection binding");
            Assert.That(model.TryGetSelectedDisplay(out _, out _), Is.True);

            Assert.That(model.Bind(OneGroupModel(5, "ok", 4), 8), Is.True);
            Assert.That(model.BindingVersion, Is.GreaterThan(version));
            Assert.That(model.TryGetSelectedDisplay(out _, out _), Is.False);
        }

        [Test]
        public void OpenedProjectionRefreshCoalescesRevisionBurstsAndDoesNotRetryErrors()
        {
            var model = new QuestProjectionModel();
            Assert.That(model.Bind(OneGroupModel(4, "ok", 3), 8), Is.True);
            var scheduler = new QuestProjectionRefreshScheduler();
            scheduler.ObserveModel(model.BindingVersion, true, 0);
            Assert.That(scheduler.TryTake(1, true, false), Is.False, "closed projection does not auto-query");
            scheduler.MarkOpened(model.BindingVersion);
            Assert.That(model.Bind(OneGroupModel(4, "ok", 3), 8), Is.True);
            scheduler.ObserveModel(model.BindingVersion, true, 1);
            Assert.That(scheduler.TryTake(2, true, false), Is.False, "equivalent binding does not refresh");

            for (var revision = 5; revision <= 7; revision++)
            {
                Assert.That(model.Bind(OneGroupModel(revision, "ok", revision - 1), 8), Is.True);
                scheduler.ObserveModel(model.BindingVersion, true, 2 + (revision - 5) * .04);
            }
            Assert.That(scheduler.TryTake(2.19, true, false), Is.False, "burst waits for a quiet interval");
            Assert.That(scheduler.TryTake(2.20, true, true), Is.False, "busy operation leaves one refresh pending");
            Assert.That(scheduler.TryTake(2.21, true, false), Is.True);
            var failedRead = model.BeginQuery();
            Assert.That(model.FailQuery(failedRead, model.Lineage, "temporary read error"), Is.True);
            Assert.That(scheduler.TryTake(20, true, false), Is.False, "a failed read is not automatically retried");
            scheduler.ObserveModel(model.BindingVersion, true, 20);
            Assert.That(scheduler.TryTake(21, true, false), Is.False);
        }

        [Test]
        public void ProjectionRefreshDisconnectCancelsAndDisposeDropsPendingWork()
        {
            var scheduler = new QuestProjectionRefreshScheduler();
            scheduler.MarkOpened(3);
            scheduler.ObserveModel(4, true, 1);
            scheduler.ObserveModel(5, false, 1.05);
            Assert.That(scheduler.TryTake(2, false, false), Is.False);
            scheduler.ObserveModel(6, true, 2);
            scheduler.MarkRequested(6);
            Assert.That(scheduler.TryTake(3, true, false), Is.False, "a manual refresh consumes the pending automatic refresh");
            scheduler.ObserveModel(7, true, 3);
            scheduler.Dispose();
            Assert.That(scheduler.TryTake(4, true, false), Is.False);
            scheduler.ObserveModel(7, true, 5, force: true);
            Assert.That(scheduler.TryTake(6, true, false), Is.False);
        }

        [Test]
        public void ProjectionRendererConvertsWorldMillimetresOnceAndOwnsNoCollider()
        {
            var shader = Shader.Find("Unlit/Color") ?? Shader.Find("Sprites/Default") ?? Shader.Find("Standard");
            Assert.That(shader, Is.Not.Null);
            var root = new GameObject("projection display root");
            var material = new Material(shader);
            var view = new QuestProjectionView();
            try
            {
                root.transform.SetPositionAndRotation(new Vector3(2, 3, 4), Quaternion.Euler(15, 35, 5));
                var group = new SketchProjectionGroupResult
                {
                    GroupId = "group-a", Generation = 3, Status = SketchProjectionGroupSummaryStatus.Ok,
                    Edges = new[]
                    {
                        new SketchProjectionDisplayEdge
                        {
                            MemberIndex = 7, Closed = false,
                            PointsMm = new[] { new[] { 1000d, 2000d, 3000d }, new[] { 0d, 0d, 0d } },
                        }
                    }
                };
                Assert.That(view.Render(root.transform, material, group, out var error), Is.True, error);
                Assert.That(view.CurveCount, Is.EqualTo(1));
                var line = root.GetComponentInChildren<LineRenderer>();
                Assert.That(line, Is.Not.Null);
                Assert.That(line.transform.parent, Is.EqualTo(root.transform));
                Assert.That(line.useWorldSpace, Is.False);
                Assert.That(line.GetComponent<Collider>(), Is.Null);
                var expected = QuestDimensions.CadPoint(new CadVector(1000, 2000, 3000));
                Assert.That(Vector3.Distance(line.GetPosition(0), expected), Is.LessThan(.000001f));
                Assert.That(Vector3.Distance(line.transform.TransformPoint(line.GetPosition(0)),
                    root.transform.TransformPoint(expected)), Is.LessThan(.000001f));

                var unavailable = new SketchProjectionGroupResult
                {
                    GroupId = "group-a", Generation = 4, Status = SketchProjectionGroupSummaryStatus.Ok,
                    Edges = Array.Empty<SketchProjectionDisplayEdge>(),
                };
                Assert.That(view.Render(root.transform, material, unavailable, out _), Is.False);
                Assert.That(root.transform.childCount, Is.Zero, "unavailable geometry clears previously rendered curves");

                view.Clear();
                Assert.That(root.transform.childCount, Is.Zero);
                Assert.That(view.CurveCount, Is.Zero);

                Assert.That(view.Render(root.transform, material, group, out var validError), Is.True, validError);
                var overflow = new SketchProjectionGroupResult
                {
                    GroupId = "group-a", Generation = 4, Status = SketchProjectionGroupSummaryStatus.Ok,
                    Edges = new[]
                    {
                        group.Edges[0],
                        new SketchProjectionDisplayEdge
                        {
                            MemberIndex = 8, Closed = false,
                            PointsMm = new[] { new[] { 0d, 0d, 0d }, new[] { 1e308, 0d, 0d } },
                        }
                    }
                };
                Assert.That(view.Render(root.transform, material, overflow, out var overflowError), Is.False);
                Assert.That(overflowError, Does.Contain("Unity"));
                Assert.That(root.transform.childCount, Is.Zero,
                    "invalid later edge clears prior lines and creates no partial projection");
                Assert.That(view.CurveCount, Is.Zero);
            }
            finally
            {
                view.Dispose();
                UnityEngine.Object.DestroyImmediate(root);
                UnityEngine.Object.DestroyImmediate(material);
            }
        }

        [Test]
        public void ProjectionPageActionsFitAndDoNotOverlapWithinLegacyShell()
        {
            Assert.That(QuestProjectionLayout.Validate(out var error), Is.True, error);
            Assert.That(QuestProjectionLayout.Actions.Select(action => action.Id).Distinct().Count(),
                Is.EqualTo(QuestProjectionLayout.Actions.Length));
            Assert.That(QuestProjectionLayout.Actions, Has.Length.EqualTo(11));
        }

        static QuestProjectionModel.SourceCandidate Candidate(QuestProjectionModel model, string owner, string edgeId)
        {
            var edge = !string.IsNullOrEmpty(edgeId);
            return new QuestProjectionModel.SourceCandidate
            {
                Fence = model.Lineage,
                TargetFeatureId = model.SelectedTarget?.FeatureId,
                OwnerFeatureId = owner,
                PersistentEdgeId = edgeId,
                UploadVersion = 7,
                ExpectedUploadVersion = 7,
                SelectionMode = edge ? 2 : 0,
                CurrentSelectionMode = edge ? 2 : 0,
                ViewCurrent = true,
                HasHit = edge,
                HasEdgeHit = edge,
            };
        }

        static SessionModelState OneGroupModel(long revision, string status, long generation) =>
            MakeModel(revision, "[{\"featureId\":\"target\",\"projectionGroups\":[" +
                "{\"groupId\":\"group-a\",\"definition\":{\"version\":1,\"operation\":\"projectEdges\",\"sources\":[" +
                "{\"type\":\"edge\",\"featureId\":\"part-a\",\"persistentEdgeId\":\"part-a:edge.a\"}]}," +
                "\"status\":\"" + status + "\",\"generation\":" + generation.ToString(System.Globalization.CultureInfo.InvariantCulture) + "}]}]");

        static GetSketchProjectionPayload Payload(long revision, string featureId, string status, bool geometryCurrent,
            string groupId, long generation, SketchProjectionGroupSummaryStatus groupStatus) => new GetSketchProjectionPayload
        {
            SessionId = Session, DocumentId = "doc", Revision = revision,
            Result = new SketchProjectionResult
            {
                FeatureId = featureId, Status = status, GeometryCurrent = geometryCurrent,
                Groups = new[]
                {
                    new SketchProjectionGroupResult
                    {
                        GroupId = groupId, Generation = generation, Status = groupStatus,
                        Edges = new[]
                        {
                            new SketchProjectionDisplayEdge
                            {
                                MemberIndex = 0,
                                PointsMm = new[] { new[] { 0d, 0d, 0d }, new[] { 1d, 0d, 0d } },
                            }
                        },
                    }
                }
            }
        };

        static SessionModelState MakeModel(long revision, string sketchesJson)
        {
            using var json = JsonDocument.Parse(sketchesJson);
            return new SessionModelState(Session, "doc", revision,
                Array.Empty<JsonElement>(), json.RootElement.EnumerateArray().Select(item => item.Clone()).ToArray(),
                Array.Empty<JsonElement>());
        }

        static SessionModelState ModelWithFeatures(long revision, string featuresJson, string sketchesJson)
        {
            using var features = JsonDocument.Parse(featuresJson);
            using var sketches = JsonDocument.Parse(sketchesJson);
            return new SessionModelState(Session, "doc", revision,
                features.RootElement.EnumerateArray().Select(item => item.Clone()).ToArray(),
                sketches.RootElement.EnumerateArray().Select(item => item.Clone()).ToArray(),
                Array.Empty<JsonElement>());
        }

        static string AuthoredSketchRecord(string featureId, string modelJson, string status = "ok",
            bool geometryCurrent = true, string extraFields = "") =>
            "{\"featureId\":\"" + featureId + "\",\"type\":\"Sketch\",\"status\":\"" + status +
            "\",\"geometryCurrent\":" + (geometryCurrent ? "true" : "false") + ",\"model\":" + modelJson + extraFields + "}";

        static string AuthoredSketchModel(string[] lineIds, string[] circleIds, string[] arcIds,
            double firstX = 1, string constraintId = null)
        {
            var lines = string.Join(",", lineIds.Select(id => "{\"id\":\"" + id + "\",\"p1\":\"p0\",\"p2\":\"p1\"}"));
            var circles = string.Join(",", circleIds.Select(id => "{\"id\":\"" + id + "\",\"center\":\"p0\",\"r\":1}"));
            var arcs = string.Join(",", arcIds.Select(id => "{\"id\":\"" + id + "\",\"center\":\"p0\",\"r\":1,\"startAngleRad\":0,\"endAngleRad\":1}"));
            var constraints = constraintId == null ? "[]" :
                "[{\"id\":\"" + constraintId + "\",\"kind\":\"horizontal\",\"refs\":[\"line-a\"]}]";
            return "{\"points\":[{\"id\":\"p0\",\"x\":0,\"y\":0},{\"id\":\"p1\",\"x\":" +
                firstX.ToString(System.Globalization.CultureInfo.InvariantCulture) + ",\"y\":0}],\"lines\":[" + lines +
                "],\"circles\":[" + circles + "],\"arcs\":[" + arcs + "],\"constraints\":" + constraints + "}";
        }
    }
}
