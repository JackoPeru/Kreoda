using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Kreoda.QuestFoundation;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

namespace Kreoda.QuestRuntime.Tests
{
    public class QuestDimensionsTests
    {
        [Test]
        public void DeclaredAxisHandleRemainsOutsideVisibleBodyInsteadOfHiddenInsideIt()
        {
            var owned = new GameObject("Owned handle placement test");
            try
            {
                var dimensions = owned.AddComponent<QuestDimensions>();
                dimensions.Font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");dimensions.HandleMaterial = dimensions.Font.material;
                using var metadata = JsonDocument.Parse("{\"id\":\"distance\",\"type\":\"linear\",\"parameter\":\"distanceMm\",\"unit\":\"mm\",\"origin\":[50,25,10],\"axis\":[1,0,0]}");
                var intent = new SpatialEditIntent("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "doc", 7, "owner", "body", "tip",
                    metadata.RootElement, new Dictionary<string, double> { ["distanceMm"] = 100 });
                dimensions.SetIntents(new[] { intent }, new[] { 0d, 0, 0, .1, .02, .05 });
                Assert.That(dimensions.GetComponentInChildren<QuestEditHandle>().transform.localPosition.x, Is.GreaterThan(.1f));
                Assert.That(intent.Origin.X, Is.EqualTo(50), "visual handle offset must not change semantic origin");
            }
            finally { Object.DestroyImmediate(owned); }
        }
        [UnityTest]
        public IEnumerator SelectedQuoteStaysReadableAndVisibleWhenOriginsOverlap()
        {
            var owned = new GameObject("Owned dimension test");
            var camera = new GameObject("Owned camera").AddComponent<Camera>();
            try
            {
                camera.transform.position = new Vector3(0, 0, -1);
                var dimensions = owned.AddComponent<QuestDimensions>();
                dimensions.Font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
                dimensions.HandleMaterial = dimensions.Font.material;
                using var metadata = JsonDocument.Parse("{\"id\":\"width\",\"type\":\"linear\",\"parameter\":\"widthMm\",\"unit\":\"mm\",\"origin\":[0,0,0],\"axis\":[1,0,0]}");
                var intents = new[] { "first", "second" }.Select(id => new SpatialEditIntent(
                    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "doc", 7, id, "body", "tip", metadata.RootElement,
                    new Dictionary<string, double> { ["widthMm"] = 100 })).ToArray();
                dimensions.SetIntents(intents);dimensions.Select(intents[1]);
                yield return null;dimensions.Layout(camera);
                var labels = dimensions.GetComponentsInChildren<TextMesh>().Where(x => x.GetComponent<MeshRenderer>().enabled).ToArray();
                Assert.That(labels.Length, Is.EqualTo(2));
                Assert.That(labels.All(x => x.text.Contains("100 mm")), Is.True);
                Assert.That(labels.All(x => x.transform.lossyScale.x >= .99f), Is.True, "quotes cannot be globally shrunk to avoid overlap");
                Assert.That(labels[0].GetComponent<MeshRenderer>().bounds.Intersects(labels[1].GetComponent<MeshRenderer>().bounds), Is.False);
                Assert.That(dimensions.GetComponentsInChildren<QuestEditHandle>().Length, Is.EqualTo(2));
                Assert.That(dimensions.GetComponentsInChildren<QuestMeshView>(), Is.Empty);
            }
            finally { Object.DestroyImmediate(owned);Object.DestroyImmediate(camera.gameObject); }
        }
    }
}
