using System;
using System.Collections.Generic;
using Kreoda.QuestFoundation;

namespace Kreoda.QuestRuntime
{
    internal static class QuestSemanticContext
    {
        internal static Dictionary<string, object> Build(string kind, string id, string bodyId,
            string featureId, string instanceId = null)
        {
            if (kind != "face" && kind != "edge" && kind != "body" && kind != "instance" &&
                kind != "datumPlane" && kind != "datumAxis" && kind != "datumPoint") return null;
            if (string.IsNullOrWhiteSpace(id)) return null;
            var context = new Dictionary<string, object> { ["kind"] = kind, ["persistentId"] = id };
            if (!string.IsNullOrWhiteSpace(bodyId)) context["bodyId"] = bodyId;
            if (!string.IsNullOrWhiteSpace(featureId)) context["featureId"] = featureId;
            if (!string.IsNullOrWhiteSpace(instanceId)) context["instanceId"] = instanceId;
            return context;
        }
    }
}
